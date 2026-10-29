// Transacción de un trabajo (una petición o una corrida del activador) dentro del trabajador.
//
// - Lo que Code.js escribe en Sheets va al espejo local y a un diario por libro.
// - Mientras tiene el candado de script, lo que escribe en Script Properties y en CacheService también se guarda aparte
//   (lo lee él mismo, nadie más) y viaja junto con el diario.
// - Puntos de confirmación: al soltar el candado (releaseLock), al tomarlo (lo escrito antes va primero) y al terminar el
//   trabajo. El principal confirma todo bajo el candado: Sheets primero (una batchUpdate atómica por libro) y, solo si
//   todo llegó, propiedades y caché. Si algo falla, este trabajador tira sus copias de esos libros y la llamada lanza
//   error: doPost contesta {ok: false} y nunca "listo" sin que el cambio esté en Sheets.
'use strict';

class Transaccion {
  constructor(amb) {
    this.amb = amb;
    this.diarios = new Map();  // libroId → [op] (en orden; el orden de los libros = el de su primera escritura)
    this.props = new Map();    // clave → texto | null (borrada)
    this.borrarProps = false;  // deleteAllProperties dentro del candado
    this.cache = new Map();    // clave → {v, ttl} | null (borrada)
    this.profundidad = 0;      // candados tomados por este trabajo (reentrante)
    this.confirmaciones = 0;
  }

  get enCandado() { return this.profundidad > 0; }

  anotar(libroId, op) {
    if (!this.diarios.has(libroId)) this.diarios.set(libroId, []);
    this.diarios.get(libroId).push(op);
  }

  hayDiario() { return this.diarios.size > 0; }
  pendiente() { return this.diarios.size > 0 || this.props.size > 0 || this.cache.size > 0 || this.borrarProps; }

  /**
   * Manda al principal todo lo pendiente. conCandado: el trabajo tiene el candado del principal (al soltarlo, la
   * profundidad ya es 0 pero el candado sigue tomado hasta después de confirmar). Lanza error si no llegó a Google (y
   * deja el espejo local como el canónico).
   */
  confirmar(conCandado) {
    if (!this.pendiente()) return null;
    const libros = [...this.diarios].map(([id, ops]) => ({ id, ops }));
    const props = { cambios: Object.fromEntries(this.props), borrarTodo: this.borrarProps };
    const cache = [...this.cache].map(([k, x]) => (x === null ? [k, null, 0] : [k, x.v, x.ttl]));
    this.diarios = new Map(); this.props = new Map(); this.cache = new Map(); this.borrarProps = false;
    this.confirmaciones++;
    let r;
    try {
      r = this.amb.rpc('tx.confirmar', { libros, props, cache, conCandado: conCandado === undefined ? this.enCandado : !!conCandado }, 180000);
    } catch (e) {
      // Lo que no se pudo confirmar se borra del espejo local: la siguiente lectura trae la copia del principal
      libros.forEach(x => this.amb.espejo.delete(x.id));
      throw e;
    }
    (r && r.libros || []).forEach(l => this.amb.espejo.set(l.id, l));
    return r;
  }
}

/** LockService.getScriptLock(): el candado único de escritura (en el principal), reentrante dentro de un trabajo. */
function crearLockService(amb) {
  class Candado {
    constructor() { this.mio = false; }
    tryLock(ms) {
      const tx = amb.tx;
      if (this.mio) return true;
      if (tx.enCandado) { tx.profundidad++; this.mio = true; return true; }
      const espera = Math.max(0, Math.min(Number(ms) || 0, 300000));
      if (!amb.rpc('candado.tomar', { ms: espera }, espera + 60000)) return false;
      tx.profundidad = 1;
      this.mio = true;
      amb.aplicarPendientes(); // copias más nuevas de los libros que confirmaron otros
      if (tx.hayDiario()) {
        // Lo que este trabajo escribió antes de tomar el candado se confirma primero (mismo orden que en Apps Script)
        try { tx.confirmar(); } catch (e) { this.soltar(); throw e; }
      }
      return true;
    }
    waitLock(ms) {
      if (!this.tryLock(ms)) throw new Error('Lock timeout: another process was holding the lock for too long.');
    }
    hasLock() { return this.mio; }
    releaseLock() {
      if (!this.mio) return;
      this.mio = false;
      const tx = amb.tx;
      tx.profundidad--;
      if (tx.profundidad > 0) return;
      let error = null;
      try { tx.confirmar(true); } catch (e) { error = e; }
      amb.rpc('candado.soltar', {});
      if (error) throw error;
    }
    soltar() {
      this.mio = false;
      amb.tx.profundidad = 0;
      try { amb.rpc('candado.soltar', {}); } catch (e) { /* el principal lo suelta al terminar el trabajo */ }
    }
  }
  const sinUsuario = () => { throw new Error('getDocumentLock/getUserLock no existen en el servidor (Code.js usa getScriptLock).'); };
  return { getScriptLock: () => new Candado(), getDocumentLock: sinUsuario, getUserLock: sinUsuario };
}

const MAX_CACHE_VALOR = 100 * 1024, MAX_CACHE_CLAVE = 250, TTL_MAX = 21600, TTL_OMISION = 600;

/** CacheService.getScriptCache(): en el principal, compartido por todos los trabajadores (y guardado al reiniciar). */
function crearCacheService(amb) {
  const revisar = (k, v) => {
    if (String(k).length > MAX_CACHE_CLAVE) throw new Error('Argument too large: key');
    if (v !== undefined && Buffer.byteLength(String(v), 'utf8') > MAX_CACHE_VALOR) throw new Error('Argument too large: value');
  };
  const ttlDe = t => Math.max(1, Math.min(TTL_MAX, t == null ? TTL_OMISION : Number(t) || TTL_OMISION));
  const cache = {
    get(k) {
      const tx = amb.tx;
      if (tx.enCandado && tx.cache.has(String(k))) { const x = tx.cache.get(String(k)); return x === null ? null : x.v; }
      const r = amb.rpc('cache.leer', { claves: [String(k)] });
      return r[String(k)] == null ? null : r[String(k)];
    },
    getAll(claves) {
      const tx = amb.tx, out = {}, faltan = [];
      (claves || []).map(String).forEach(k => {
        if (tx.enCandado && tx.cache.has(k)) { const x = tx.cache.get(k); if (x !== null) out[k] = x.v; } else faltan.push(k);
      });
      if (faltan.length) Object.assign(out, amb.rpc('cache.leer', { claves: faltan }));
      return out;
    },
    put(k, v, ttl) { cache.putAll({ [k]: v }, ttl); },
    putAll(obj, ttl) {
      const tx = amb.tx, pares = [];
      Object.keys(obj || {}).forEach(k => {
        const v = String(obj[k]);
        revisar(k, v);
        if (tx.enCandado) tx.cache.set(String(k), { v, ttl: ttlDe(ttl) }); else pares.push([String(k), v, ttlDe(ttl)]);
      });
      if (pares.length) amb.rpc('cache.escribir', { pares });
    },
    remove(k) { cache.removeAll([k]); },
    removeAll(claves) {
      const tx = amb.tx, pares = [];
      (claves || []).map(String).forEach(k => { if (tx.enCandado) tx.cache.set(k, null); else pares.push([k, null, 0]); });
      if (pares.length) amb.rpc('cache.escribir', { pares });
    },
  };
  const sinUsuario = () => { throw new Error('Solo existe el caché del script en el servidor.'); };
  return { getScriptCache: () => cache, getDocumentCache: () => null, getUserCache: sinUsuario };
}

/** PropertiesService.getScriptProperties(): archivo JSON en el servidor (incluye los secretos; nunca en el repositorio). */
function crearPropertiesService(amb) {
  const p = {
    getProperty(k) {
      const tx = amb.tx;
      k = String(k);
      if (tx.enCandado && tx.props.has(k)) return tx.props.get(k);
      if (tx.enCandado && tx.borrarProps) return null;
      const v = amb.rpc('props.leer', { clave: k });
      return v == null ? null : v;
    },
    getProperties() {
      const tx = amb.tx;
      const todas = tx.enCandado && tx.borrarProps ? {} : amb.rpc('props.todas', {});
      if (tx.enCandado) tx.props.forEach((v, k) => { if (v === null) delete todas[k]; else todas[k] = v; });
      return todas;
    },
    getKeys() { return Object.keys(p.getProperties()); },
    setProperty(k, v) { return p.setProperties({ [k]: v }); },
    setProperties(obj, borrarOtras) {
      const tx = amb.tx, cambios = {};
      Object.keys(obj || {}).forEach(k => { cambios[String(k)] = String(obj[k]); });
      if (tx.enCandado) {
        if (borrarOtras) { tx.borrarProps = true; tx.props = new Map(); }
        Object.keys(cambios).forEach(k => tx.props.set(k, cambios[k]));
      } else {
        amb.rpc('props.escribir', { cambios, borrarTodo: !!borrarOtras });
      }
      return p;
    },
    deleteProperty(k) {
      const tx = amb.tx;
      if (tx.enCandado) tx.props.set(String(k), null); else amb.rpc('props.escribir', { cambios: { [String(k)]: null } });
      return p;
    },
    deleteAllProperties() {
      const tx = amb.tx;
      if (tx.enCandado) { tx.borrarProps = true; tx.props = new Map(); } else amb.rpc('props.escribir', { cambios: {}, borrarTodo: true });
      return p;
    },
  };
  const otras = () => { throw new Error('Solo existen las propiedades del script en el servidor.'); };
  return { getScriptProperties: () => p, getUserProperties: otras, getDocumentProperties: () => null };
}

module.exports = { Transaccion, crearLockService, crearCacheService, crearPropertiesService };
