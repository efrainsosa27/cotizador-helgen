// Google Drive (API v3) para la fachada DriveApp. Todo con supportsAllDrives para que funcione igual si algún día las
// carpetas pasan a una unidad compartida.
'use strict';
const { Readable } = require('stream');

const MIME_CARPETA = 'application/vnd.google-apps.folder', MIME_LIBRO = 'application/vnd.google-apps.spreadsheet';
const CAMPOS = 'id,name,mimeType,parents,trashed,size,createdTime,modifiedTime';
const comillas = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function meta(f) {
  return { id: f.id, nombre: f.name, carpeta: f.mimeType === MIME_CARPETA, padres: f.parents || [], papelera: !!f.trashed,
    mime: f.mimeType, libro: f.mimeType === MIME_LIBRO, tamano: Number(f.size) || 0, creado: f.createdTime, modificado: f.modifiedTime };
}

function noEncontrado(e, id) {
  const codigo = e && (e.status || (e.response && e.response.status));
  if (Number(codigo) === 404) {
    return Object.assign(new Error('No se encontró el elemento con el ID ' + id + ' o no tienes permiso para abrirlo.'), { codigo: 404 });
  }
  return e;
}

function crearDriveGoogle(api) {
  const d = api.drive;
  const base = { supportsAllDrives: true };
  const metricas = { lecturas: 0, escrituras: 0, subidas: 0, bytesSubidos: 0 };

  async function listar(q) {
    const out = [];
    let pageToken;
    do {
      metricas.lecturas++;
      const r = await d.files.list(Object.assign({ q, fields: 'nextPageToken,files(' + CAMPOS + ')', pageSize: 1000, spaces: 'drive',
        includeItemsFromAllDrives: true, pageToken }, base));
      (r.data.files || []).forEach(f => out.push(meta(f)));
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    return out;
  }

  return {
    metricas,
    async obtener({ id }) {
      metricas.lecturas++;
      try { return meta((await d.files.get(Object.assign({ fileId: id, fields: CAMPOS }, base))).data); } catch (e) { throw noEncontrado(e, id); }
    },
    async raiz() {
      metricas.lecturas++;
      return meta((await d.files.get(Object.assign({ fileId: 'root', fields: CAMPOS }, base))).data);
    },
    /** Hijos de una carpeta (incluye los de la Papelera, como getFoldersByName: Code.js los filtra con isTrashed). */
    async hijos({ padre, nombre, carpetas }) {
      let q = comillas(padre) + ' in parents and mimeType ' + (carpetas ? '=' : '!=') + ' ' + comillas(MIME_CARPETA);
      if (nombre != null) q += ' and name = ' + comillas(nombre);
      return listar(q);
    },
    async buscar({ nombre, carpetas }) {
      return listar('name = ' + comillas(nombre) + ' and trashed = false and mimeType ' + (carpetas ? '=' : '!=') + ' ' + comillas(MIME_CARPETA));
    },
    async crearCarpeta({ padre, nombre }) {
      metricas.escrituras++;
      const r = await d.files.create(Object.assign({ requestBody: { name: nombre, mimeType: MIME_CARPETA, parents: padre ? [padre] : undefined }, fields: CAMPOS }, base));
      return meta(r.data);
    },
    async crearArchivo({ padre, nombre, mime, datos }) {
      metricas.subidas++;
      const buf = Buffer.from(datos || []);
      metricas.bytesSubidos += buf.length;
      const r = await d.files.create(Object.assign({ requestBody: { name: nombre, parents: padre ? [padre] : undefined },
        media: { mimeType: mime || 'application/octet-stream', body: Readable.from([buf]) }, fields: CAMPOS }, base));
      return meta(r.data);
    },
    async renombrar({ id, nombre }) {
      metricas.escrituras++;
      try { return meta((await d.files.update(Object.assign({ fileId: id, requestBody: { name: nombre }, fields: CAMPOS }, base))).data); } catch (e) { throw noEncontrado(e, id); }
    },
    async mover({ id, destino }) {
      metricas.escrituras++;
      const actual = (await d.files.get(Object.assign({ fileId: id, fields: 'parents' }, base))).data;
      const r = await d.files.update(Object.assign({ fileId: id, addParents: destino, removeParents: (actual.parents || []).join(','),
        requestBody: {}, fields: CAMPOS }, base));
      return meta(r.data);
    },
    async papelera({ id, papelera }) {
      metricas.escrituras++;
      return meta((await d.files.update(Object.assign({ fileId: id, requestBody: { trashed: !!papelera }, fields: CAMPOS }, base))).data);
    },
    async personas({ id }) {
      metricas.lecturas++;
      const r = await d.permissions.list(Object.assign({ fileId: id, fields: 'permissions(type,role,emailAddress)' }, base));
      const ps = (r.data.permissions || []).filter(p => p.type === 'user' || p.type === 'group');
      return {
        editores: ps.filter(p => ['writer', 'fileOrganizer', 'organizer'].includes(p.role)).map(p => p.emailAddress),
        lectores: ps.filter(p => ['reader', 'commenter'].includes(p.role)).map(p => p.emailAddress),
        dueno: (ps.find(p => p.role === 'owner') || {}).emailAddress || null,
      };
    },
    async contenido({ id }) {
      metricas.lecturas++;
      const m = (await d.files.get(Object.assign({ fileId: id, fields: 'name,mimeType' }, base))).data;
      const r = await d.files.get(Object.assign({ fileId: id, alt: 'media' }, base), { responseType: 'arraybuffer' });
      return { nombre: m.name, mime: m.mimeType, datos: Buffer.from(r.data) };
    },
  };
}

module.exports = { crearDriveGoogle, meta, comillas, MIME_CARPETA, MIME_LIBRO };
