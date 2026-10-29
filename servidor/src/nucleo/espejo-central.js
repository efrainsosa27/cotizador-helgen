// Copia canónica de los libros en el principal.
//
//  abrir(id)       la primera vez se carga de Google (una llamada) y se registra para vigilarla.
//  confirmar(...)  con el candado tomado: por libro, en orden, una batchUpdate atómica + lectura de regreso de las hojas
//                  tocadas (lo que Sheets guardó de verdad). Si todos los libros llegaron, se aplican propiedades y caché
//                  y se manda la copia nueva a los demás trabajadores. Si uno falla, ese libro se vuelve a leer de Google,
//                  los que siguen no se mandan y la llamada lanza error (doPost contesta {ok:false}).
//  sondear()       cada minuto: versión de cada libro en Drive; si alguien lo editó a mano, se relee y se reemplaza (con
//                  el candado), se suben las versiones de sus colecciones y se borran las marcas R_ del caché para que la
//                  siguiente consulta de los navegadores lo vea.
//  reconciliar()   cada 10 min: relee todo y compara; si algo difiere (una fórmula que se recalculó, como el tipo de
//                  cambio, o una edición que el sondeo no vio) se reemplaza y queda en el registro como "deriva".
'use strict';
const crypto = require('crypto');

const huella = libro => crypto.createHash('sha1').update(JSON.stringify(libro.hojas, (k, v) => (k === 'mostrar' ? undefined : v))).digest('hex');

class EspejoCentral {
  /**
   * @param {object} o
   *   conductor  backend (memoria o google): cargarLibro, crearLibro, confirmar, versionLibro
   *   candado    Candado
   *   difundir   (libros, exceptoTrabajador) => void
   *   alCambioExterno  (libroId) => void   (sube versiones de colecciones, borra marcas R_)
   *   registro   (nivel, texto, extra) => void
   */
  constructor(o) {
    Object.assign(this, { conductor: o.conductor, candado: o.candado, difundir: o.difundir || (() => {}),
      alCambioExterno: o.alCambioExterno || (() => {}), registro: o.registro || (() => {}) });
    this.libros = new Map();    // id → {libro, version, huella, cargado}
    this.cargando = new Map();  // id → Promise
    this.ultimoSondeo = 0;
    this.soloLectura = !!o.soloLectura;
    this.metricas = { confirmaciones: 0, fallas: 0, recargas: 0, derivas: 0, msGoogle: 0 };
  }

  async abrir(id) {
    const x = this.libros.get(id);
    if (x) return x.libro;
    if (!this.cargando.has(id)) {
      this.cargando.set(id, (async () => {
        try {
          const libro = await this.conductor.cargarLibro(id);
          this.libros.set(id, { libro, version: libro.version, huella: huella(libro), cargado: Date.now() });
          return libro;
        } finally {
          this.cargando.delete(id);
        }
      })());
    }
    return this.cargando.get(id);
  }

  async crear(nombre) {
    if (this.soloLectura) throw new Error('Servidor en modo solo lectura: no se crean libros.');
    const libro = await this.conductor.crearLibro(nombre);
    this.libros.set(libro.id, { libro, version: libro.version, huella: huella(libro), cargado: Date.now() });
    return libro;
  }

  /**
   * Confirma lo que mandó un trabajador. Hay que llamarla con el candado tomado (la llama quien lo tiene).
   * @returns {libros: [libro]} copias canónicas nuevas de los libros tocados
   */
  async confirmar(libros, opciones) {
    const o = opciones || {};
    const nuevos = [];
    for (const { id, ops } of libros) {
      if (!ops || !ops.length) continue;
      await this.abrir(id);
      const actual = this.libros.get(id);
      if (this.soloLectura) {
        // Corrida de sombra: lo que se habría escrito queda en el registro y no sale del servidor
        this.registro('aviso', 'solo lectura: no se escribió en ' + id, { ops: ops.map(x => x.op + (x.hoja != null ? '@' + x.hoja : '')) });
        nuevos.push(actual.libro);
        continue;
      }
      const t0 = Date.now();
      try {
        const libro = await this.conductor.confirmar(actual.libro, ops);
        this.metricas.msGoogle += Date.now() - t0;
        this.metricas.confirmaciones++;
        // La versión de Drive después de nuestro cambio: se pide aparte (sin esperar) para no confundirla con una edición
        // a mano; si mientras tanto alguien editó, la reconciliación lo corrige
        this.libros.set(id, { libro, version: actual.version, huella: huella(libro), cargado: Date.now(), pidiendoVersion: true });
        this.anotarVersion(id);
        nuevos.push(libro);
      } catch (e) {
        this.metricas.fallas++;
        this.registro('error', 'No se confirmó el libro ' + id + ': ' + e.message, { ops: ops.length });
        // Lo que haya en Google manda: se vuelve a leer (si tampoco se puede, se olvida y se cargará al pedirlo)
        let recargado = null;
        try { recargado = await this.conductor.cargarLibro(id); } catch (e2) { this.libros.delete(id); }
        if (recargado) this.libros.set(id, { libro: recargado, version: recargado.version, huella: huella(recargado), cargado: Date.now() });
        const confirmados = nuevos.map(l => l.id);
        if (nuevos.length) this.difundir(nuevos, o.trabajador);
        this.difundir(recargado ? [recargado] : [], o.trabajador, recargado ? [] : [id]);
        const err = new Error('No se pudo guardar en Google Sheets (' + (o.nombreDe ? o.nombreDe(id) : id) + '): ' + resumenError(e) +
          (confirmados.length ? ' Lo de ' + confirmados.length + ' libro(s) anterior(es) sí se guardó.' : ' No se guardó nada de esta operación.') +
          ' Revisa antes de repetir.');
        err.codigo = 'GUARDAR';
        throw err;
      }
    }
    if (nuevos.length) this.difundir(nuevos, o.trabajador);
    return { libros: nuevos };
  }

  async anotarVersion(id) {
    try {
      const v = await this.conductor.versionLibro(id);
      const x = this.libros.get(id);
      if (x) { x.version = v; x.pidiendoVersion = false; }
    } catch (e) {
      this.registro('aviso', 'No se leyó la versión de ' + id + ' después de guardar: ' + e.message);
    }
  }

  /** Revisa en Drive si algún libro cambió fuera del servicio (a mano). Devuelve los ids que se releyeron. */
  async sondear() {
    this.ultimoSondeo = Date.now();
    const ids = [...this.libros.keys()];
    const versiones = await Promise.all(ids.map(id => this.conductor.versionLibro(id).catch(e => {
      this.registro('aviso', 'Sondeo de ' + id + ': ' + e.message);
      return null;
    })));
    const cambiados = ids.filter((id, i) => {
      const x = this.libros.get(id);
      return versiones[i] != null && x && !x.pidiendoVersion && String(versiones[i]) !== String(x.version);
    });
    for (const id of cambiados) await this.recargar(id, 'edición fuera del servicio');
    return cambiados;
  }

  /** Relee un libro de Google y reemplaza la copia canónica con el candado tomado (nadie está a medio escribir). */
  async recargar(id, motivo, sinCandado) {
    const inicio = Date.now();
    const libro = await this.conductor.cargarLibro(id);
    const cambiar = async () => {
      const antes = this.libros.get(id);
      // Si mientras se leía se confirmó algo en este libro, lo leído puede ser más viejo: se deja para el siguiente sondeo
      if (antes && antes.cargado > inicio) return false;
      const h = huella(libro);
      this.libros.set(id, { libro, version: libro.version, huella: h, cargado: Date.now() });
      this.metricas.recargas++;
      if (antes && antes.huella !== h) {
        this.registro('info', 'libro releído: ' + id + ' (' + motivo + ')');
        this.difundir([libro], null);
        this.alCambioExterno(id);
        return true;
      }
      return false;
    };
    return sinCandado ? cambiar() : this.candado.con('principal:recarga', cambiar);
  }

  /** Relee todos y reemplaza los que difieren (fórmulas recalculadas, ediciones que el sondeo no vio). */
  async reconciliar() {
    const ids = [...this.libros.keys()];
    let derivas = 0;
    for (const id of ids) {
      try {
        if (await this.recargar(id, 'reconciliación')) { derivas++; this.metricas.derivas++; }
      } catch (e) {
        this.registro('aviso', 'Reconciliación de ' + id + ': ' + e.message);
      }
    }
    return derivas;
  }

  estado() {
    const ahora = Date.now();
    return [...this.libros].map(([id, x]) => ({ id, titulo: x.libro.titulo, hojas: x.libro.hojas.length,
      celdas: x.libro.hojas.reduce((s, h) => s + h.valores.reduce((t, f) => t + (f ? f.length : 0), 0), 0),
      version: x.version, segDesdeCarga: Math.round((ahora - x.cargado) / 1000) }));
  }
}

function resumenError(e) {
  const r = e && e.response;
  if (r && r.data && r.data.error) return (r.data.error.status || r.status) + ' ' + String(r.data.error.message || '').slice(0, 200);
  return String(e && e.message || e).slice(0, 300);
}

module.exports = { EspejoCentral, huella, resumenError };
