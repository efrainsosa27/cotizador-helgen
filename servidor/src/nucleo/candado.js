// Candado de script (el de LockService.getScriptLock) en el principal: uno solo para todo el servicio, en orden de
// llegada. Además de Code.js lo usan el principal para confirmar lo escrito fuera del candado y para cambiar la copia
// canónica de un libro editado a mano: así la copia canónica solo cambia con el candado tomado y quien lo tiene ve
// exactamente lo que está en Sheets (salvo ediciones a mano de los últimos segundos; ver alEntregar).
'use strict';

class Candado {
  constructor(opciones) {
    const o = opciones || {};
    this.dueno = null;
    this.desde = 0;
    this.cola = [];
    this.alEntregar = o.alEntregar || null; // async: p. ej. revisar si alguien editó a mano antes de entregar
    this.entregando = false;
    this.registro = o.registro || (() => {});
  }

  libre() { return !this.dueno && !this.entregando && !this.cola.some(p => !p.cancelada); }

  /** Promesa: true si se obtuvo antes de ms (null = esperar lo que haga falta), false si no. */
  tomar(dueno, ms) {
    return new Promise(resolve => {
      if (ms === 0 && !this.libre()) { resolve(false); return; }
      const pet = { dueno, resolve, cancelada: false, timer: null, llego: Date.now() };
      if (ms != null && ms > 0) {
        pet.timer = setTimeout(() => {
          pet.cancelada = true;
          const i = this.cola.indexOf(pet);
          if (i !== -1) { this.cola.splice(i, 1); resolve(false); }
        }, ms);
      }
      this.cola.push(pet);
      this.siguiente();
    });
  }

  async siguiente() {
    if (this.dueno || this.entregando) return;
    let pet;
    while ((pet = this.cola.shift()) && pet.cancelada) { /* se brinca */ }
    if (!pet) return;
    if (pet.timer) clearTimeout(pet.timer);
    this.entregando = true;
    this.dueno = pet.dueno;
    this.desde = Date.now();
    if (this.alEntregar) {
      try { await this.alEntregar(pet.dueno); } catch (e) { this.registro('aviso', 'Revisión antes de entregar el candado: ' + e.message); }
    }
    this.entregando = false;
    pet.resolve(true);
  }

  soltar(dueno) {
    if (this.dueno !== dueno) return false;
    this.dueno = null;
    this.desde = 0;
    setImmediate(() => this.siguiente());
    return true;
  }

  /** Corre f() con el candado (para el principal). */
  async con(dueno, f) {
    await this.tomar(dueno, null);
    try { return await f(); } finally { this.soltar(dueno); }
  }

  estado() {
    return { dueno: this.dueno, msTomado: this.dueno ? Date.now() - this.desde : 0, enCola: this.cola.filter(p => !p.cancelada).length };
  }
}

module.exports = { Candado };
