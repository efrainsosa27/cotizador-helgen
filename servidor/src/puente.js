// Puente síncrono entre un trabajador (donde corre Code.js, que es síncrono como Apps Script) y el hilo principal (donde
// viven las llamadas asíncronas a Google, el candado, el caché y las propiedades).
//
// El trabajador manda {id, tipo, datos} por su MessagePort y se queda bloqueado en Atomics.wait sobre una palabra de
// memoria compartida. El principal atiende la petición con async/await, responde por el mismo puerto y despierta al
// trabajador (Atomics.notify). El trabajador saca la respuesta con receiveMessageOnPort (sin volver a su bucle de eventos).
// Es el patrón de synckit, al revés: aquí el que espera es el trabajador y el que trabaja es el principal.
//
// Por el mismo puerto llegan también avisos sin id (copias nuevas de libros después de que otro trabajador confirmó):
// se entregan a alAviso en el orden en que llegaron, antes de la respuesta que se estaba esperando.
'use strict';
const { receiveMessageOnPort } = require('worker_threads');

const ESPERANDO = 0, LISTO = 1;

/** Error que cruza el puente: conserva mensaje y los campos que Code.js revisa (codigo, sesion). */
function errorDesde(e) {
  const err = new Error(e && e.message ? e.message : String(e));
  if (e && e.codigo) err.codigo = e.codigo;
  if (e && e.sesion) err.sesion = true;
  if (e && e.nombre) err.name = e.nombre;
  return err;
}
function errorPlano(e) {
  return { message: e && e.message ? e.message : String(e), codigo: e && e.codigo, sesion: !!(e && e.sesion), nombre: e && e.name };
}

class PuenteTrabajador {
  /**
   * @param {MessagePort} puerto  canal propio con el principal
   * @param {SharedArrayBuffer} memoria  4 bytes compartidos con el principal
   * @param {(aviso) => void} alAviso  mensajes sin id (copias de libros)
   */
  constructor(puerto, memoria, alAviso) {
    this.puerto = puerto;
    this.senal = new Int32Array(memoria);
    this.alAviso = alAviso;
    this.n = 0;
    this.metricas = null; // {tipo: {n, ms}} del trabajo en curso
    this.dormidor = new Int32Array(new SharedArrayBuffer(4));
  }

  /** Llamada bloqueante al principal. Lanza el error que lance el principal (con su codigo). */
  llamar(tipo, datos, limiteMs) {
    const id = ++this.n;
    const limite = limiteMs || 120000;
    Atomics.store(this.senal, 0, ESPERANDO);
    const inicio = Date.now();
    this.puerto.postMessage({ id, tipo, datos });
    for (;;) {
      let m;
      while ((m = receiveMessageOnPort(this.puerto))) {
        const msg = m.message;
        if (msg && msg.respuesta === id) {
          this.medir(tipo, Date.now() - inicio);
          if (msg.error) throw errorDesde(msg.error);
          return msg.datos;
        }
        this.alAviso(msg);
      }
      const resta = limite - (Date.now() - inicio);
      if (resta <= 0) throw new Error('El servidor tardó demasiado en ' + tipo + ' (más de ' + Math.round(limite / 1000) + ' s).');
      // Señal puesta pero el mensaje todavía no se ve en el puerto: espera corta y se vuelve a revisar
      if (Atomics.load(this.senal, 0) === LISTO) Atomics.wait(this.senal, 0, LISTO, 1);
      else Atomics.wait(this.senal, 0, ESPERANDO, Math.min(resta, 1000));
    }
  }

  /** Saca del puerto los avisos que llegaron mientras el trabajador estaba ocupado (sin bloquear). */
  vaciar() {
    let m;
    while ((m = receiveMessageOnPort(this.puerto))) this.alAviso(m.message);
  }

  medir(tipo, ms) {
    if (!this.metricas) return;
    const grupo = tipo.split('.')[0];
    const x = this.metricas[grupo] || (this.metricas[grupo] = { n: 0, ms: 0 });
    x.n++; x.ms += ms;
  }

  /** Utilities.sleep: bloquea el trabajador sin gastar CPU. */
  dormir(ms) {
    Atomics.wait(this.dormidor, 0, 0, Math.max(0, Math.min(Number(ms) || 0, 300000)));
  }
}

class PuenteServidor {
  /**
   * @param {MessagePort} puerto
   * @param {SharedArrayBuffer} memoria
   * @param {(tipo, datos) => Promise<any>} atender
   */
  constructor(puerto, memoria, atender) {
    this.puerto = puerto;
    this.senal = new Int32Array(memoria);
    this.atender = atender;
    this.activo = true;
    puerto.on('message', msg => this.recibir(msg));
  }

  async recibir(msg) {
    if (!msg || !msg.id) return;
    let respuesta;
    try {
      respuesta = { respuesta: msg.id, datos: await this.atender(msg.tipo, msg.datos) };
    } catch (e) {
      respuesta = { respuesta: msg.id, error: errorPlano(e) };
    }
    this.responder(respuesta);
  }

  responder(m) {
    if (!this.activo) return;
    try {
      this.puerto.postMessage(m);
    } catch (e) {
      // Algo que no se puede clonar: se manda el error en su lugar (el trabajador no se queda esperando)
      this.puerto.postMessage({ respuesta: m.respuesta, error: errorPlano(new Error('Respuesta interna no válida: ' + e.message)) });
    }
    Atomics.store(this.senal, 0, LISTO);
    Atomics.notify(this.senal, 0);
  }

  /** Aviso sin respuesta (no despierta al trabajador: lo verá en su siguiente llamada o al empezar otro trabajo). */
  avisar(m) {
    if (this.activo) this.puerto.postMessage(m);
  }

  cerrar() {
    this.activo = false;
    try { this.puerto.close(); } catch (e) { /* ya cerrado */ }
  }
}

module.exports = { PuenteTrabajador, PuenteServidor, errorDesde, errorPlano };
