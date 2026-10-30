// Monta la interfaz (web/home/index.html) con un DOM y un fetch simulados conectados al servidor simulado del arnés (A.post),
// como la sección de interfaz de tests/pagos.test.js. No es una prueba: la usan otras (require('./montar-interfaz')(A, dir)).
// dialogos.confirmar / dialogos.prompt = lo que responden window.confirm / window.prompt; dialogos.mensajes = lo que preguntaron.
'use strict';
module.exports = function (A, dir) {
  const fs = require('fs'), vm = require('vm'), path = require('path');
  const html = fs.readFileSync(path.join(dir, 'web/home/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
  function montar(quien, permisos) {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
    function elemento(tag) {
      const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
        classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
        addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
        focus() {}, remove() {}, click() {}, insertAdjacentHTML(pos, x) { e.innerHTML += x; }, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
        querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
      let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
      return e;
    }
    const porId = {}, oyentesDoc = {};
    const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
      visibilityState: 'visible', activeElement: null, body: elemento('body'),
      addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
    document.getElementById('login').classList.add('oculto');
    const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
    async function fetch(url, o) {
      const c = JSON.parse(o.body); llamadas.push(c);
      const datos = c.funcion === 'sincronizar' ? { ok: true, datos: { versiones: {}, permisos: permisos, soloRequisicion: false, cambios: [] } } : A.post(quien, c.funcion, ...c.args);
      return { ok: true, json: async () => datos };
    }
    class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
    const dialogos = { confirmar: true, prompt: null, mensajes: [] };
    const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader,
      atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
      sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      confirm: m => { dialogos.mensajes.push(String(m)); return dialogos.confirmar; }, prompt: m => { dialogos.mensajes.push(String(m)); return dialogos.prompt; },
      CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
      setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    ['api-web', undefined, 'mod-proveedores', 'mod-recepcion'].forEach(n => vm.runInContext(scripts.find(x => x.id === n).src, ctx));
    return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
  }
  const esperar = async (k = 25) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
  const comprobante = n => ({ name: n || 'spei.pdf', type: 'application/pdf', size: 2048, b64: A.PDF });
  return { montar, esperar, comprobante };
};
