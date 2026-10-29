// Backend "memoria": Google simulado, sin red. Reproduce la semántica de tests/arnes.js (mismos ids F#/A#/S#, mismas
// ligas, mismo Drive que comparte con el dominio lo nuevo y no deja quitar un permiso heredado), para que la prueba de
// paridad compare el arnés directo contra el servidor completo (HTTP → trabajador → fachada → espejo → diario).
// Opcional: latencia simulada por tipo de llamada, para medir estrategias (pruebas/medir.js).
'use strict';
const M = require('../espejo/modelo');

const ARNES = {
  archivo: 'https://drive.google.com/file/d/{id}/view',
  carpeta: 'https://drive.google.com/drive/folders/{id}',
  libro: 'https://sheets/{id}',
};
const dormir = ms => new Promise(r => setTimeout(r, ms));
const clonar = x => structuredClone(x);
const MIME_CARPETA = 'application/vnd.google-apps.folder', MIME_LIBRO = 'application/vnd.google-apps.spreadsheet';

class ConductorMemoria {
  constructor(o) {
    const op = o || {};
    this.nombre = 'memoria';
    this.plantillas = op.plantillas || ARNES;
    this.n = 0;
    this.libros = new Map();
    this.items = new Map(); // id → {id, nombre, carpeta, padre, acceso, papelera, mime, datos, libro}
    this.correos = [];
    this.fallarCorreo = false;
    this.fallarConfirmar = null; // (libroId, ops) => Error | null  (pruebas de fallas)
    this.rutas = op.rutas || [];  // [{re, fn(peticion) → {codigo, cuerpo}}]
    this.latencia = op.latencia || null;
    this.llamadas = {};
    this.raizId = null;
    this.drive = this.crearDrive();
  }

  async espera(tipo, extra) {
    this.llamadas[tipo] = (this.llamadas[tipo] || 0) + 1;
    const ms = this.latencia && (this.latencia[tipo] || 0) + (extra || 0);
    if (ms) await dormir(ms);
  }

  // ---------- Sheets ----------
  async cargarLibro(id) {
    await this.espera('sheets.leer');
    const l = this.libros.get(id);
    if (!l) throw Object.assign(new Error('No se encontró la hoja de cálculo ' + id + '.'), { codigo: 404 });
    return clonar(l);
  }

  async crearLibro(nombre) {
    await this.espera('sheets.crear');
    const id = 'S' + (++this.n);
    const l = M.nuevoLibro({ id, titulo: nombre, hojas: [{ id: 0, titulo: 'Hoja 1', indice: 0 }] });
    this.libros.set(id, l);
    this.items.set(id, { id, nombre, carpeta: false, padre: this.raizId, acceso: 'DOMAIN', mime: MIME_LIBRO, libro: true });
    return clonar(l);
  }

  async confirmar(libro, ops) {
    await this.espera('sheets.escribir');
    if (this.fallarConfirmar) { const e = this.fallarConfirmar(libro.id, ops); if (e) throw e; }
    const remoto = this.libros.get(libro.id);
    if (!remoto) throw new Error('No se encontró la hoja de cálculo ' + libro.id + '.');
    // Atómico como batchUpdate: se aplica a una copia y solo si todo salió bien se queda
    const copia = clonar(remoto);
    ops.forEach(op => M.aplicar(copia, op));
    copia.version = String(Number(remoto.version || 0) + 1);
    this.libros.set(libro.id, copia);
    return clonar(copia);
  }

  async versionLibro(id) {
    await this.espera('drive.version');
    const l = this.libros.get(id);
    if (!l) throw new Error('No se encontró ' + id);
    return String(l.version || 0);
  }

  /** Para pruebas: una persona edita la hoja directo en Sheets (cambia la versión). */
  editarAMano(id, f) {
    const l = this.libros.get(id);
    f(l);
    l.version = String(Number(l.version || 0) + 1);
  }

  // ---------- Drive ----------
  meta(it) {
    return { id: it.id, nombre: it.nombre, carpeta: !!it.carpeta, padres: it.padre ? [it.padre] : [], papelera: !!it.papelera,
      mime: it.mime, libro: !!it.libro, tamano: it.datos ? it.datos.length : 0 };
  }
  item(id) {
    const it = this.items.get(id);
    if (!it) throw Object.assign(new Error('No se encontró el elemento con el ID ' + id + ' o no tienes permiso para abrirlo.'), { codigo: 404 });
    return it;
  }
  nuevoItem(prefijo, d) {
    const id = prefijo + (++this.n);
    const it = Object.assign({ id, acceso: 'DOMAIN', papelera: false }, d);
    this.items.set(id, it);
    return it;
  }
  crearDrive() {
    const c = this;
    return {
      async obtener({ id }) { await c.espera('drive.leer'); return c.meta(c.item(id)); },
      async raiz() { await c.espera('drive.leer'); return c.meta(c.item(c.raizId)); },
      async hijos({ padre, nombre, carpetas }) {
        await c.espera('drive.leer');
        return [...c.items.values()].filter(it => it.padre === padre && !!it.carpeta === !!carpetas && (nombre == null || it.nombre === nombre))
          .map(it => c.meta(it));
      },
      async buscar({ nombre, carpetas }) {
        await c.espera('drive.leer');
        return [...c.items.values()].filter(it => it.nombre === nombre && !!it.carpeta === !!carpetas && !it.papelera).map(it => c.meta(it));
      },
      async crearCarpeta({ padre, nombre }) {
        await c.espera('drive.escribir');
        return c.meta(c.nuevoItem('F', { nombre, carpeta: true, padre: padre || c.raizId, mime: MIME_CARPETA }));
      },
      async crearArchivo({ padre, nombre, mime, datos }) {
        await c.espera('drive.subir', datos ? Math.round(datos.length / 50000) : 0);
        c.item(padre);
        return c.meta(c.nuevoItem('A', { nombre, carpeta: false, padre, mime, datos: Buffer.from(datos || []) }));
      },
      async renombrar({ id, nombre }) { await c.espera('drive.escribir'); const it = c.item(id); it.nombre = nombre; return c.meta(it); },
      async mover({ id, destino }) { await c.espera('drive.escribir'); const it = c.item(id); c.item(destino); it.padre = destino; return c.meta(it); },
      async papelera({ id, papelera }) { await c.espera('drive.escribir'); const it = c.item(id); it.papelera = !!papelera; return c.meta(it); },
      async personas({ id }) { await c.espera('drive.leer'); c.item(id); return { editores: [], lectores: [], dueno: null }; },
      async contenido({ id }) {
        await c.espera('drive.leer');
        const it = c.item(id);
        return { nombre: it.nombre, mime: it.mime, datos: Buffer.from(it.datos || []) };
      },
    };
  }

  /** Llamadas REST a googleapis.com con el token del script: hoy solo los permisos de Drive (privado_). */
  async fetchGoogle(p) {
    await this.espera('drive.permisos');
    const resp = (codigo, cuerpo) => ({ codigo, cabeceras: { 'content-type': 'application/json' }, cuerpo: Buffer.from(cuerpo == null ? '' : JSON.stringify(cuerpo)) });
    const m = p.url.match(/drive\/v3\/files\/([^/?]+)\/permissions(?:\/([^?]+))?/);
    if (!m) return resp(404, { error: { message: 'sin ruta simulada: ' + p.url } });
    const it = this.items.get(decodeURIComponent(m[1]));
    if (!it) return resp(404, { error: { message: 'File not found' } });
    let heredado = false;
    for (let f = it.padre && this.items.get(it.padre); f; f = f.padre && this.items.get(f.padre)) if (f.acceso === 'DOMAIN') heredado = true;
    if (p.metodo === 'DELETE') {
      if (heredado) return resp(403, { error: { reason: 'cannotDeletePermission' } });
      it.acceso = 'PRIVATE';
      return { codigo: 204, cabeceras: {}, cuerpo: Buffer.alloc(0) };
    }
    return resp(200, { permissions: [{ id: 'own', type: 'user' }].concat(it.acceso === 'DOMAIN' || heredado ? [{ id: 'dom', type: 'domain' }] : []) });
  }

  async fetch(p) {
    await this.espera('http');
    const ruta = this.rutas.find(r => r.re.test(p.url));
    const deTexto = c => (Buffer.isBuffer(c) ? c : Buffer.from(typeof c === 'string' ? c : JSON.stringify(c == null ? {} : c)));
    if (ruta) { const r = ruta.fn(p); return { codigo: r.codigo == null ? 200 : r.codigo, cabeceras: r.cabeceras || {}, cuerpo: deTexto(r.cuerpo) }; }
    return { codigo: 404, cabeceras: {}, cuerpo: deTexto({ error: 'sin ruta simulada: ' + p.url }) };
  }

  async enviarCorreo(m) {
    await this.espera('correo');
    if (this.fallarCorreo) throw new Error('Servicio de correo no disponible');
    this.correos.push(m);
  }

  /** Como el arnés: el "PDF" es el mismo HTML (no hay Chromium en las pruebas). */
  async pdf(html) {
    await this.espera('pdf');
    return Buffer.from(String(html));
  }

  /**
   * Estado inicial igual al de tests/arnes.js: Mi unidad (F1, privada) / Cotizador Helgen (F2) / Cotizaciones Helgen (PDF)
   * (F3), la base de datos "DB" (Config con PREFIJO_FOLIO e IVA_TASA; Cotizaciones vacía) y el catálogo "CAT".
   * Devuelve las Script Properties iniciales.
   */
  sembrarComoArnes() {
    const mi = this.nuevoItem('F', { nombre: 'Mi unidad', carpeta: true, padre: null, mime: MIME_CARPETA, acceso: 'PRIVATE' });
    this.raizId = mi.id;
    const maestra = this.nuevoItem('F', { nombre: 'Cotizador Helgen', carpeta: true, padre: mi.id, mime: MIME_CARPETA });
    const pdf = this.nuevoItem('F', { nombre: 'Cotizaciones Helgen (PDF)', carpeta: true, padre: maestra.id, mime: MIME_CARPETA });
    // En el arnés "DB" está en Drive (sin acceso propio: hereda el de la carpeta maestra) y "CAT" no
    this.items.set('DB', { id: 'DB', nombre: 'Base de datos', carpeta: false, padre: maestra.id, mime: MIME_LIBRO, libro: true, papelera: false });
    this.libros.set('DB', M.nuevoLibro({ id: 'DB', titulo: 'Base de datos', hojas: [
      { id: 0, titulo: 'Config', indice: 0, valores: [['Clave', 'Valor'], ['PREFIJO_FOLIO', 'HLG'], ['IVA_TASA', 0.16]] },
      { id: 1, titulo: 'Cotizaciones', indice: 1, valores: [] }] }));
    this.libros.set('CAT', M.nuevoLibro({ id: 'CAT', titulo: 'Catálogo', hojas: [
      { id: 0, titulo: 'Catalogo', indice: 0, valores: [
        ['Clave', 'Descripción', 'Unidad', 'Precio unitario (sin IVA)', 'Actualizado', 'Actualizó', 'Clave SAT', 'Unidad SAT'],
        ['PAN-550', 'Panel solar 550 W', 'PZA', 4100, '', '', '', '']] }] }));
    return { SPREADSHEET_ID: 'DB', FOLDER_ID: pdf.id, CATALOGO_ID: 'CAT' };
  }
}

module.exports = { ConductorMemoria, PLANTILLAS_ARNES: ARNES };
