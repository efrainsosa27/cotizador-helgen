// Script Properties y CacheService en el principal.
//  - Propiedades: un archivo JSON (incluye los secretos que hoy están en Script Properties: SESION_SECRETO,
//    PORTAL_SECRETO, ANTHROPIC_API_KEY). Permisos 600, fuera del repositorio. Cada cambio se guarda en disco (escribir a
//    un temporal y renombrar) antes de contestar.
//  - Caché: en memoria con vencimiento (máx. 6 h, como CacheService). Se guarda en disco cada 30 s y al apagar, para que
//    un reinicio no olvide las claves de idempotencia (doble clic = mismo folio) ni los bloqueos de códigos de entrada.
'use strict';
const fs = require('fs');
const path = require('path');

function guardarSeguro(archivo, texto) {
  const tmp = archivo + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, texto, { mode: 0o600 });
  const fd = fs.openSync(tmp, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, archivo);
}

function leerJson(archivo, siNo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return siNo; throw e; }
}

class Propiedades {
  /** @param {string|null} archivo  null = solo en memoria (pruebas) */
  constructor(archivo, iniciales) {
    this.archivo = archivo;
    this.datos = Object.assign({}, archivo ? leerJson(archivo, {}) : {}, iniciales || {});
    Object.keys(this.datos).forEach(k => { this.datos[k] = String(this.datos[k]); });
    if (archivo && iniciales) this.guardar();
  }
  leer(k) { return Object.prototype.hasOwnProperty.call(this.datos, k) ? this.datos[k] : null; }
  todas() { return Object.assign({}, this.datos); }
  /** cambios: {clave: texto | null (borrar)}; borrarTodo primero vacía todo. */
  escribir(cambios, borrarTodo) {
    if (borrarTodo) this.datos = {};
    Object.keys(cambios || {}).forEach(k => {
      if (cambios[k] === null || cambios[k] === undefined) delete this.datos[k]; else this.datos[k] = String(cambios[k]);
    });
    this.guardar();
  }
  guardar() {
    if (this.archivo) guardarSeguro(this.archivo, JSON.stringify(this.datos, Object.keys(this.datos).sort(), 1));
  }
}

class Cache {
  constructor(archivo, opciones) {
    this.archivo = archivo;
    this.max = (opciones && opciones.max) || 20000;
    this.mapa = new Map(); // clave → {v, vence}
    if (archivo) {
      const previo = leerJson(archivo, []);
      const ahora = Date.now();
      previo.forEach(([k, v, vence]) => { if (vence > ahora) this.mapa.set(k, { v, vence }); });
    }
    this.sucio = false;
  }
  leer(claves) {
    const ahora = Date.now(), out = {};
    claves.forEach(k => {
      const x = this.mapa.get(k);
      if (!x) return;
      if (x.vence <= ahora) { this.mapa.delete(k); return; }
      out[k] = x.v;
    });
    return out;
  }
  /** pares: [[clave, valor | null (borrar), ttlSeg]] */
  escribir(pares) {
    const ahora = Date.now();
    pares.forEach(([k, v, ttl]) => {
      this.mapa.delete(k);
      if (v !== null && v !== undefined) this.mapa.set(k, { v: String(v), vence: ahora + Math.max(1, Number(ttl) || 600) * 1000 });
    });
    // Como CacheService, lo más viejo se puede perder: aquí se recorta en orden de escritura
    while (this.mapa.size > this.max) this.mapa.delete(this.mapa.keys().next().value);
    this.sucio = true;
  }
  /** Borra las claves que empiezan con alguno de los prefijos (p. ej. "R_" para releer las hojas editadas a mano). */
  borrarPrefijos(prefijos) {
    for (const k of [...this.mapa.keys()]) if (prefijos.some(p => k.startsWith(p))) this.mapa.delete(k);
    this.sucio = true;
  }
  guardar() {
    if (!this.archivo || !this.sucio) return;
    const ahora = Date.now(), filas = [];
    this.mapa.forEach((x, k) => { if (x.vence > ahora) filas.push([k, x.v, x.vence]); });
    guardarSeguro(this.archivo, JSON.stringify(filas));
    this.sucio = false;
  }
  get tamano() { return this.mapa.size; }
}

/** Estado propio del servicio (activadores instalados, cuota de correo del día). */
class Estado {
  constructor(archivo) {
    this.archivo = archivo;
    this.datos = Object.assign({ activadores: [], correo: { dia: '', destinatarios: 0 } }, archivo ? leerJson(archivo, {}) : {});
  }
  guardar() { if (this.archivo) guardarSeguro(this.archivo, JSON.stringify(this.datos, null, 1)); }
}

function asegurarCarpeta(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

module.exports = { Propiedades, Cache, Estado, guardarSeguro, leerJson, asegurarCarpeta, path };
