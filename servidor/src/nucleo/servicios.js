// Servicios del principal que atienden al puente: Drive (con memoria de corto plazo), UrlFetch (con las desviaciones
// de tokeninfo y googleapis.com), correo (cuota diaria), PDF y activadores.
'use strict';

/** Drive con memoria de unos segundos para lo que se busca en cada guardado (carpeta del año, del proyecto…). */
class ServicioDrive {
  constructor(o) {
    this.c = o.conductor.drive;
    this.ttl = o.ttlMs == null ? 60000 : o.ttlMs;
    this.soloLectura = !!o.soloLectura;
    this.metas = new Map();
    this.hijosCache = new Map();
  }
  recordar(m) { if (m && m.id) this.metas.set(m.id, { m, vence: Date.now() + this.ttl }); return m; }
  olvidarHijos(padre) { for (const k of [...this.hijosCache.keys()]) if (k.startsWith(padre + '|')) this.hijosCache.delete(k); }
  noEscribir(que) { if (this.soloLectura) throw new Error('Servidor en modo solo lectura: no se ' + que + ' en Drive.'); }
  async obtener(d) {
    const x = this.metas.get(d.id);
    if (x && x.vence > Date.now()) return x.m;
    return this.recordar(await this.c.obtener(d));
  }
  async raiz() {
    if (this.raizId) return this.obtener({ id: this.raizId });
    const m = this.recordar(await this.c.raiz({}));
    this.raizId = m.id;
    return m;
  }
  async hijos(d) {
    const k = d.padre + '|' + (d.carpetas ? 'c' : 'a') + '|' + (d.nombre == null ? '*' : d.nombre);
    const x = this.hijosCache.get(k);
    if (x && x.vence > Date.now()) return x.lista;
    const lista = await this.c.hijos(d);
    lista.forEach(m => this.recordar(m));
    this.hijosCache.set(k, { lista, vence: Date.now() + this.ttl });
    return lista;
  }
  async buscar(d) { return this.c.buscar(d); }
  async crearCarpeta(d) {
    this.noEscribir('crean carpetas');
    const padre = d.padre || (await this.raiz()).id;
    const m = await this.c.crearCarpeta({ padre, nombre: d.nombre });
    this.olvidarHijos(padre);
    return this.recordar(m);
  }
  async crearArchivo(d) {
    this.noEscribir('suben archivos');
    const m = await this.c.crearArchivo(d);
    this.olvidarHijos(d.padre);
    return this.recordar(m);
  }
  async cambio(f, d) {
    const antes = this.metas.get(d.id);
    const m = await f(d);
    (antes && antes.m.padres || []).concat(m.padres || []).forEach(p => this.olvidarHijos(p));
    return this.recordar(m);
  }
  async renombrar(d) { this.noEscribir('renombran archivos'); return this.cambio(x => this.c.renombrar(x), d); }
  async mover(d) { this.noEscribir('mueven archivos'); return this.cambio(x => this.c.mover(x), d); }
  async papelera(d) { this.noEscribir('borran archivos'); return this.cambio(x => this.c.papelera(x), d); }
  async personas(d) { return this.c.personas(d); }
  async contenido(d) { return this.c.contenido(d); }
}

/**
 * UrlFetchApp.fetch del lado del principal:
 *  - tokeninfo → verificación local (identidad.js)
 *  - *.googleapis.com con el token marcador de ScriptApp.getOAuthToken() → el conductor pone la credencial real
 *  - lo demás (centro de mando, API de Claude) → red normal
 */
function crearSalida(o) {
  const { identidad, conductor, marcaToken, soloLectura, registro } = o;
  const json = (codigo, x) => ({ codigo, cabeceras: { 'content-type': 'application/json; charset=utf-8' }, cuerpo: Buffer.from(JSON.stringify(x)) });
  return async function salida(p) {
    let url;
    try { url = new URL(p.url); } catch (e) { throw new Error('Dirección no válida: ' + p.url); }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/tokeninfo') {
      const r = await identidad.verificar(url.searchParams.get('id_token'));
      return r.codigo === 200 ? json(200, r.claims) : json(400, { error: 'invalid_token', error_description: r.error });
    }
    const auth = Object.keys(p.cabeceras || {}).find(k => k.toLowerCase() === 'authorization');
    if (/(^|\.)googleapis\.com$/.test(url.hostname) && auth && p.cabeceras[auth] === 'Bearer ' + marcaToken) {
      if (soloLectura && p.metodo !== 'GET') {
        registro('aviso', 'solo lectura: no se mandó ' + p.metodo + ' ' + url.pathname);
        return { codigo: 204, cabeceras: {}, cuerpo: Buffer.alloc(0) };
      }
      return conductor.fetchGoogle(p);
    }
    if (soloLectura) {
      registro('aviso', 'solo lectura: llamada externa bloqueada ' + url.hostname);
      return json(503, { ok: false, error: 'Servidor en modo solo lectura (corrida de sombra).' });
    }
    return conductor.fetch(p);
  };
}

/** Correo como la cuenta del servicio, con la misma idea de cuota diaria que MailApp (destinatarios por día). */
class ServicioCorreo {
  constructor(o) {
    Object.assign(this, { conductor: o.conductor, estado: o.estado, limite: o.limiteDiario || 1500, zona: o.zona || 'America/Mexico_City',
      soloLectura: !!o.soloLectura, registro: o.registro || (() => {}) });
    this.enviados = 0;
  }
  hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: this.zona }).format(new Date()); }
  usados() {
    const c = this.estado.datos.correo;
    if (c.dia !== this.hoy()) { c.dia = this.hoy(); c.destinatarios = 0; }
    return c.destinatarios;
  }
  cuota() { return Math.max(0, this.limite - this.usados()); }
  async enviar(m) {
    const n = [m.para, m.cc, m.cco].filter(Boolean).join(',').split(',').filter(x => x.trim()).length;
    if (this.soloLectura) { this.registro('aviso', 'solo lectura: correo no enviado', { asunto: m.asunto, n }); return true; }
    if (this.cuota() < n) throw new Error('Service invoked too many times for one day: email.');
    await this.conductor.enviarCorreo(m);
    this.estado.datos.correo.destinatarios = this.usados() + n;
    this.estado.guardar();
    this.enviados++;
    return true;
  }
}

/** HTML → PDF con Chromium (puppeteer-core). JavaScript apagado y sin red: solo el HTML y sus imágenes data:. */
class MotorPdf {
  constructor(o) {
    const op = o || {};
    this.ejecutable = op.ejecutable;
    this.formato = op.formato || 'Letter';
    this.margen = op.margen || { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' };
    this.max = op.concurrencia || 2;
    this.lanzar = op.lanzar || null; // pruebas: función que devuelve un navegador falso
    this.args = op.args || ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'];
    this.activos = 0;
    this.espera = [];
    this.nav = null;
    this.metricas = { pdfs: 0, ms: 0, reinicios: 0 };
  }
  async navegador() {
    if (!this.nav) {
      this.nav = (async () => {
        // chrome-headless-shell (el de la imagen) va en modo "shell" (puppeteer ≥ 22); un Chromium completo, en headless normal
        const headless = /headless-shell/.test(String(this.ejecutable || '')) ? 'shell' : true;
        const lanzar = this.lanzar || (async () => require('puppeteer-core').launch({ executablePath: this.ejecutable, headless, args: this.args }));
        const n = await lanzar();
        if (n.on) n.on('disconnected', () => { this.nav = null; this.metricas.reinicios++; });
        return n;
      })().catch(e => { this.nav = null; throw new Error('No se pudo abrir Chromium para el PDF: ' + e.message); });
    }
    return this.nav;
  }
  async turno() {
    if (this.activos < this.max) { this.activos++; return; }
    await new Promise(r => this.espera.push(r));
    this.activos++;
  }
  libre() { this.activos--; const r = this.espera.shift(); if (r) r(); }
  async html(html) {
    await this.turno();
    const t0 = Date.now();
    let pagina = null;
    try {
      const nav = await this.navegador();
      pagina = await nav.newPage();
      await pagina.setJavaScriptEnabled(false);
      await pagina.setRequestInterception(true);
      pagina.on('request', r => (/^(data:|about:)/.test(r.url()) ? r.continue() : r.abort()));
      await pagina.setContent(String(html), { waitUntil: 'load', timeout: 20000 });
      // Sin colores de fondo, como el conversor de Google (el HTML ya está hecho para eso, §6.3)
      const pdf = await pagina.pdf({ format: this.formato, printBackground: false, margin: this.margen, preferCSSPageSize: true, timeout: 30000 });
      this.metricas.pdfs++;
      this.metricas.ms += Date.now() - t0;
      return Buffer.from(pdf);
    } finally {
      if (pagina) await pagina.close().catch(() => {});
      this.libre();
    }
  }
  async cerrar() { if (this.nav) { const n = await this.nav.catch(() => null); this.nav = null; if (n) await n.close().catch(() => {}); } }
}

/** Activadores de tiempo (ScriptApp.newTrigger): se guardan en estado.json y los corre el servicio. */
class Activadores {
  constructor(o) {
    Object.assign(this, { estado: o.estado, ejecutar: o.ejecutar, registro: o.registro || (() => {}), habilitados: o.habilitados !== false });
    this.timers = new Map();
    this.corriendo = new Set();
  }
  listar() { return this.estado.datos.activadores.slice(); }
  crear(d) {
    if (!d.cadaMinutos || d.cadaMinutos < 1) throw new Error('Activador sin intervalo.');
    const t = { id: 'act-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), funcion: d.funcion, cadaMinutos: d.cadaMinutos };
    this.estado.datos.activadores.push(t);
    this.estado.guardar();
    this.programar(t);
    return t;
  }
  borrar(d) {
    this.estado.datos.activadores = this.estado.datos.activadores.filter(t => t.id !== d.id);
    this.estado.guardar();
    const x = this.timers.get(d.id);
    if (x) { clearInterval(x); this.timers.delete(d.id); }
    return true;
  }
  programar(t) {
    if (!this.habilitados || this.timers.has(t.id)) return;
    this.timers.set(t.id, setInterval(() => this.correr(t.funcion), t.cadaMinutos * 60000));
  }
  iniciar() { this.listar().forEach(t => this.programar(t)); }
  async correr(funcion) {
    if (this.corriendo.has(funcion)) { this.registro('aviso', 'activador ' + funcion + ': la corrida anterior sigue; se salta'); return null; }
    this.corriendo.add(funcion);
    try { return await this.ejecutar(funcion); } finally { this.corriendo.delete(funcion); }
  }
  detener() { this.timers.forEach(x => clearInterval(x)); this.timers.clear(); }
}

module.exports = { ServicioDrive, crearSalida, ServicioCorreo, MotorPdf, Activadores };
