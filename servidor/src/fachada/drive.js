// DriveApp para Code.js. Cada operación es una llamada síncrona al principal, que la hace con la API de Drive (o con el
// Drive simulado). El principal guarda en memoria lo que ya sabe de cada archivo y carpeta (nombre, padres, papelera) por
// unos segundos para no repetir búsquedas por nombre en cada guardado.
'use strict';
const { aBuffer } = require('./servicios');

function crearDriveApp(amb, Blob) {
  const iterador = lista => { let i = 0; return { hasNext: () => i < lista.length, next: () => { if (i >= lista.length) throw new Error('No hay más elementos.'); return lista[i++]; } }; };
  const persona = correo => ({ getEmail: () => correo, getName: () => correo, getDomain: () => String(correo).split('@')[1] || '' });
  const deMeta = m => (m.carpeta ? new Carpeta(m) : new Archivo(m));

  class Elemento {
    constructor(m) { this.m = m; }
    getId() { return this.m.id; }
    getName() { return this.m.nombre; }
    isTrashed() { return !!this.m.papelera; }
    getParents() { return iterador((this.m.padres || []).map(id => new Carpeta({ id, carpeta: true, perezosa: true }))); }
    setName(n) { this.m = amb.rpc('drive.renombrar', { id: this.m.id, nombre: String(n) }); return this; }
    moveTo(destino) { this.m = amb.rpc('drive.mover', { id: this.m.id, destino: destino.getId() }); return this; }
    setTrashed(b) { this.m = amb.rpc('drive.papelera', { id: this.m.id, papelera: !!b }); return this; }
    personas() { return amb.rpc('drive.personas', { id: this.m.id }); }
    getEditors() { return this.personas().editores.map(persona); }
    getViewers() { return this.personas().lectores.map(persona); }
    getOwner() { const d = this.personas().dueno; return d ? persona(d) : null; }
    getDateCreated() { return new Date(this.m.creado || 0); }
    getLastUpdated() { return new Date(this.m.modificado || 0); }
    setSharing() {
      // En helgen.tech DriveApp.setSharing da "Access denied: DriveApp." aun al dueño (§6.11): Code.js usa privado_()
      throw new Error('Access denied: DriveApp.');
    }
    // Una carpeta "perezosa" (de getParents) solo trae su id: el resto se pide al usarla
    asegurar() { if (this.m.perezosa) this.m = amb.rpc('drive.obtener', { id: this.m.id }); return this; }
  }

  class Carpeta extends Elemento {
    getName() { return this.asegurar().m.nombre; }
    isTrashed() { return !!this.asegurar().m.papelera; }
    getUrl() { return amb.plantillas.carpeta.replace('{id}', this.m.id); }
    getFoldersByName(n) { return iterador(amb.rpc('drive.hijos', { padre: this.m.id, nombre: String(n), carpetas: true }).map(x => new Carpeta(x))); }
    getFilesByName(n) { return iterador(amb.rpc('drive.hijos', { padre: this.m.id, nombre: String(n), carpetas: false }).map(x => new Archivo(x))); }
    getFolders() { return iterador(amb.rpc('drive.hijos', { padre: this.m.id, carpetas: true }).map(x => new Carpeta(x))); }
    getFiles() { return iterador(amb.rpc('drive.hijos', { padre: this.m.id, carpetas: false }).map(x => new Archivo(x))); }
    createFolder(n) { return new Carpeta(amb.rpc('drive.crearCarpeta', { padre: this.m.id, nombre: String(n) })); }
    createFile(a, contenido, tipo) {
      let nombre, mime, datos;
      if (typeof a === 'string') { nombre = a; mime = tipo || 'text/plain'; datos = aBuffer(String(contenido == null ? '' : contenido)); }
      else { const b = a.getBlob ? a.getBlob() : a; nombre = b.getName(); mime = b.getContentType() || 'application/octet-stream'; datos = aBuffer(b.getBytes ? b.getBytes() : b); }
      return new Archivo(amb.rpc('drive.crearArchivo', { padre: this.m.id, nombre: nombre == null ? 'Sin título' : nombre, mime, datos }, 120000));
    }
    addFile(archivo) { archivo.moveTo(this); return this; }
  }

  class Archivo extends Elemento {
    getUrl() { return (this.m.libro ? amb.plantillas.libro : amb.plantillas.archivo).replace('{id}', this.m.id); }
    getMimeType() { return this.m.mime; }
    getSize() { return Number(this.m.tamano) || 0; }
    getBlob() {
      const c = amb.rpc('drive.contenido', { id: this.m.id }, 120000);
      return new Blob(Buffer.from(c.datos), c.mime, c.nombre);
    }
    getAs(t) { return this.getBlob().getAs(t); }
  }

  return {
    getFolderById: id => {
      const m = amb.rpc('drive.obtener', { id: String(id) });
      if (!m.carpeta) throw new Error('No se encontró la carpeta con el ID ' + id + '.');
      return new Carpeta(m);
    },
    getFileById: id => deMeta(amb.rpc('drive.obtener', { id: String(id) })),
    getRootFolder: () => new Carpeta(amb.rpc('drive.raiz', {})),
    createFolder: n => new Carpeta(amb.rpc('drive.crearCarpeta', { padre: null, nombre: String(n) })),
    createFile: (a, b, c) => new Carpeta(amb.rpc('drive.raiz', {})).createFile(a, b, c),
    getFilesByName: n => iterador(amb.rpc('drive.buscar', { nombre: String(n) }).map(x => new Archivo(x))),
    getFoldersByName: n => iterador(amb.rpc('drive.buscar', { nombre: String(n), carpetas: true }).map(x => new Carpeta(x))),
    Access: { ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER', ORGANIZER: 'ORGANIZER', NONE: 'NONE' },
  };
}

module.exports = { crearDriveApp };
