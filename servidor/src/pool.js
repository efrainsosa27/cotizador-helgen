// Grupo de trabajadores. Cada petición va a un trabajador libre; si no hay, espera en la cola.
//  - Escrituras (funciones de CAMBIOS_API) y lecturas comparten trabajadores, pero siempre queda al menos uno para
//    lecturas: tres guardados esperando el candado nunca dejan sin atender un clic de consulta.
//  - Un trabajo que pasa su límite de tiempo se corta: se termina el trabajador (se crea otro), se espera a que acabe lo
//    que el principal estuviera confirmando por él y se suelta su candado. Lo que no había confirmado no llega a Sheets.
'use strict';
const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const { PuenteServidor } = require('./puente');

class Pool {
  /**
   * @param {object} o
   *   n             trabajadores (≥ 2)
   *   confTrabajador  lo que necesita cada trabajador (archivos de Code.js, plantillas, zona…)
   *   atender       async (tipo, datos, trabajador) → respuesta del puente
   *   alMorir       async (trabajador) → limpiar (soltar candado…)
   *   registro      (nivel, texto, extra)
   *   limiteMs      por petición; limiteActivadorMs para activadores
   */
  constructor(o) {
    Object.assign(this, { n: Math.max(2, o.n || 3), confTrabajador: o.confTrabajador, atender: o.atender, alMorir: o.alMorir || (async () => {}),
      registro: o.registro || (() => {}), limiteMs: o.limiteMs || 120000, limiteActivadorMs: o.limiteActivadorMs || 300000 });
    this.trabajadores = [];
    this.cola = [];
    this.siguienteId = 1;
    this.cambiosApi = new Set();
    this.publicas = new Set();
    this.cerrando = false;
    this.metricas = { atendidos: 0, cortados: 0, reinicios: 0 };
  }

  async iniciar() {
    await Promise.all(Array.from({ length: this.n }, (_, i) => this.crear(i + 1)));
    this.vigia = setInterval(() => this.vigilar(), 1000);
    this.vigia.unref();
  }

  crear(numero) {
    return new Promise((resolve, reject) => {
      const canal = new MessageChannel();
      const memoria = new SharedArrayBuffer(4);
      const worker = new Worker(path.join(__dirname, 'trabajador.js'), {
        workerData: { conf: Object.assign({}, this.confTrabajador, { numero }), puerto: canal.port2, memoria },
        transferList: [canal.port2],
        resourceLimits: this.confTrabajador.memoriaMb ? { maxOldGenerationSizeMb: this.confTrabajador.memoriaMb } : undefined,
      });
      const t = { numero, worker, trabajo: null, listo: false, confirmando: null };
      t.puente = new PuenteServidor(canal.port1, memoria, (tipo, datos) => this.atenderDe(t, tipo, datos));
      worker.on('message', m => {
        if (m.tipo === 'listo') {
          t.listo = true;
          t.msCarga = m.msCarga;
          (m.cambiosApi || []).forEach(f => this.cambiosApi.add(f));
          (m.publicas || []).forEach(f => this.publicas.add(f));
          resolve(t);
          this.despachar();
        } else if (m.tipo === 'hecho') {
          this.terminar(t, m);
        }
      });
      worker.on('error', e => { this.registro('error', 'trabajador ' + numero + ': ' + e.message); if (!t.listo) reject(e); });
      worker.on('exit', codigo => this.alSalir(t, codigo));
      const i = this.trabajadores.findIndex(x => x.numero === numero);
      if (i === -1) this.trabajadores.push(t); else this.trabajadores[i] = t;
    });
  }

  /** El principal atiende lo que pide un trabajador; anota la confirmación en curso (para cortes limpios). */
  atenderDe(t, tipo, datos) {
    const p = this.atender(tipo, datos, t);
    if (tipo === 'tx.confirmar') {
      t.confirmando = p.catch(() => {});
      p.finally(() => { if (t.confirmando) t.confirmando = null; }).catch(() => {});
    }
    return p;
  }

  dueno(t) { return 'w' + t.numero + '#' + (t.trabajo ? t.trabajo.id : 0); }

  /** {cuerpo} (doPost) o {funcion, args} (activador). clase: lectura | escritura | activador. */
  ejecutar(trabajo) {
    if (this.cerrando) return Promise.resolve({ texto: JSON.stringify({ ok: false, error: 'El servidor se está reiniciando. Intenta en unos segundos.' }), metricas: {} });
    return new Promise((resolve, reject) => {
      this.cola.push(Object.assign({ id: this.siguienteId++, llego: Date.now(), resolve, reject }, trabajo));
      this.despachar();
    });
  }

  despachar() {
    for (;;) {
      const libres = this.trabajadores.filter(t => t.listo && !t.trabajo);
      if (!libres.length || !this.cola.length) return;
      const ocupadosEscribiendo = this.trabajadores.filter(t => t.trabajo && t.trabajo.clase !== 'lectura').length;
      // Siempre queda un trabajador para lecturas
      const k = this.cola.findIndex(x => x.clase === 'lectura' || ocupadosEscribiendo < this.n - 1);
      if (k === -1) return;
      const trabajo = this.cola.splice(k, 1)[0];
      // El que lleva más tiempo sin trabajar: reparte la carga (y cada trabajador ve lo que confirmaron los otros)
      const t = libres.reduce((a, b) => ((a.ultimoUso || 0) <= (b.ultimoUso || 0) ? a : b));
      t.ultimoUso = Date.now() + Math.random();
      t.trabajo = trabajo;
      trabajo.inicio = Date.now();
      trabajo.limite = trabajo.inicio + (trabajo.clase === 'activador' ? this.limiteActivadorMs : this.limiteMs);
      t.worker.postMessage({ tipo: 'trabajo', id: trabajo.id, cuerpo: trabajo.cuerpo, funcion: trabajo.funcion, args: trabajo.args });
    }
  }

  terminar(t, m) {
    const trabajo = t.trabajo;
    t.trabajo = null;
    this.metricas.atendidos++;
    if (trabajo && trabajo.id === m.id) {
      trabajo.resolve({ texto: m.texto, metricas: Object.assign({ msCola: trabajo.inicio - trabajo.llego, trabajador: t.numero }, m.metricas) });
    }
    this.despachar();
  }

  vigilar() {
    const ahora = Date.now();
    this.trabajadores.forEach(t => {
      if (t.trabajo && !t.cortando && ahora > t.trabajo.limite) {
        t.cortando = true;
        this.metricas.cortados++;
        this.registro('error', 'trabajo cortado por tiempo', { trabajador: t.numero, funcion: t.trabajo.funcion, ms: ahora - t.trabajo.inicio });
        t.worker.terminate();
      }
    });
  }

  async alSalir(t, codigo) {
    const trabajo = t.trabajo;
    const dueno = this.dueno(t);
    t.listo = false;
    t.trabajo = null;
    t.puente.cerrar();
    if (t.confirmando) await t.confirmando;
    try { await this.alMorir(t, dueno); } catch (e) { this.registro('error', 'limpieza del trabajador ' + t.numero + ': ' + e.message); }
    if (trabajo) {
      trabajo.resolve({ texto: JSON.stringify({ ok: false, codigo: 'TIEMPO', error: t.cortando
        ? 'La operación tardó demasiado y se detuvo. Lo que no alcanzó a guardarse no se guardó; revisa antes de repetir.'
        : 'Error interno del servidor. Revisa antes de repetir.' }), metricas: { msCola: trabajo.inicio - trabajo.llego, trabajador: t.numero } });
    }
    if (!this.cerrando) {
      this.metricas.reinicios++;
      this.registro('aviso', 'trabajador ' + t.numero + ' terminó (' + codigo + '); se crea otro');
      this.crear(t.numero).catch(e => this.registro('error', 'no se pudo crear el trabajador ' + t.numero + ': ' + e.message));
    }
  }

  /** Copias nuevas de libros a todos los trabajadores (menos el que las confirmó, que ya las tiene). */
  difundir(libros, excepto, olvidar) {
    this.trabajadores.forEach(t => {
      if (!t.listo || t.numero === excepto) return;
      if (libros && libros.length) t.puente.avisar({ tipo: 'libros', libros });
      if (olvidar && olvidar.length) t.puente.avisar({ tipo: 'olvidar', ids: olvidar });
    });
  }

  estado() {
    return { trabajadores: this.trabajadores.map(t => ({ numero: t.numero, listo: t.listo, ocupado: t.trabajo ? t.trabajo.funcion || 'doPost' : null,
      msOcupado: t.trabajo ? Date.now() - t.trabajo.inicio : 0, msCarga: t.msCarga })), cola: this.cola.length, metricas: this.metricas };
  }

  async cerrar(msEspera) {
    this.cerrando = true;
    const hasta = Date.now() + (msEspera || 30000);
    while (this.trabajadores.some(t => t.trabajo) && Date.now() < hasta) await new Promise(r => setTimeout(r, 100));
    clearInterval(this.vigia);
    await Promise.all(this.trabajadores.map(t => t.worker.terminate().catch(() => {})));
  }
}

module.exports = { Pool };
