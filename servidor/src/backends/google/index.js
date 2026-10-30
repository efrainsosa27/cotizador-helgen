// Backend "google": Sheets, Drive y Gmail reales, como la cuenta del servicio (facilities@helgen.tech).
//
// Credenciales (un archivo en el servidor, nunca en el repositorio):
//   - modo "oauth" (recomendado): {"type": "authorized_user", "client_id", "client_secret", "refresh_token"} de
//     facilities@ con una app OAuth Interna (herramientas/autorizar.js lo genera). Opcional: un segundo archivo solo
//     con gmail.send (google.credencialesCorreo), así un cambio de contraseña de facilities@ solo apaga los correos.
//   - modo "cuenta-servicio": la llave JSON de una cuenta de servicio con delegación de todo el dominio; se hace pasar
//     por google.sujeto (facilities@).
'use strict';
const fs = require('fs');
const { OAuth2Client, JWT } = require('google-auth-library');
const { sheets } = require('@googleapis/sheets');
const { drive } = require('@googleapis/drive');
const { gmail } = require('@googleapis/gmail');
const { crearHojasGoogle } = require('./hojas');
const { crearDriveGoogle } = require('./drive');
const { crearCorreoGoogle } = require('./correo');

const ALCANCE_HOJAS = 'https://www.googleapis.com/auth/spreadsheets';
const ALCANCE_DRIVE = 'https://www.googleapis.com/auth/drive';
const ALCANCE_CORREO = 'https://www.googleapis.com/auth/gmail.send';
const ALCANCES = [ALCANCE_HOJAS, ALCANCE_DRIVE, ALCANCE_CORREO];

// Lo mismo que da Apps Script en getUrl(): las ligas que ya están en las hojas tienen esta forma
const PLANTILLAS_APPS_SCRIPT = {
  archivo: 'https://drive.google.com/file/d/{id}/view?usp=drivesdk',
  carpeta: 'https://drive.google.com/drive/folders/{id}',
  libro: 'https://docs.google.com/spreadsheets/d/{id}/edit',
};

function credencialDesde(archivo, sujeto, alcances) {
  const c = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (c.type === 'service_account') {
    if (!sujeto) throw new Error('Con una cuenta de servicio falta google.sujeto (la cuenta por la que se hace pasar: facilities@).');
    return new JWT({ email: c.client_email, key: c.private_key, scopes: alcances, subject: sujeto });
  }
  if (c.type === 'authorized_user' || c.refresh_token) {
    const o = new OAuth2Client({ clientId: c.client_id, clientSecret: c.client_secret });
    o.setCredentials({ refresh_token: c.refresh_token });
    return o;
  }
  throw new Error('Credencial de Google no reconocida en ' + archivo + ' (se espera authorized_user o service_account).');
}

/**
 * @param {object} conf  {credenciales, credencialesCorreo?, sujeto?, remitente}
 * @param {object} inyectado  pruebas: {auth, authCorreo, fetch}
 */
function crearConductorGoogle(conf, inyectado) {
  const iny = inyectado || {};
  const auth = iny.auth || credencialDesde(conf.credenciales, conf.sujeto, conf.credencialesCorreo ? [ALCANCE_HOJAS, ALCANCE_DRIVE] : ALCANCES);
  const authCorreo = iny.authCorreo || (conf.credencialesCorreo ? credencialDesde(conf.credencialesCorreo, conf.sujeto, [ALCANCE_CORREO]) : auth);
  const tiempo = conf.tiempoMs || 30000;
  const api = {
    sheets: sheets({ version: 'v4', auth, timeout: tiempo }),
    drive: drive({ version: 'v3', auth, timeout: tiempo }),
    gmail: gmail({ version: 'v1', auth: authCorreo, timeout: tiempo }),
  };
  const hojas = crearHojasGoogle(api, conf);
  const fetchExterno = iny.fetch || globalThis.fetch;

  return {
    nombre: 'google',
    plantillas: PLANTILLAS_APPS_SCRIPT,
    api,
    cargarLibro: hojas.cargarLibro,
    crearLibro: hojas.crearLibro,
    confirmar: hojas.confirmar,
    versionLibro: hojas.versionLibro,
    drive: crearDriveGoogle(api),
    enviarCorreo: crearCorreoGoogle(api, conf.remitente || conf.sujeto || 'facilities@helgen.tech'),
    metricas: hojas.metricas,

    /** REST de googleapis.com con la credencial del servidor (privado_ usa la API de permisos de Drive). */
    async fetchGoogle(p) {
      const headers = {};
      Object.keys(p.cabeceras || {}).forEach(k => { if (k.toLowerCase() !== 'authorization') headers[k] = p.cabeceras[k]; });
      if (p.cuerpo && p.tipo) headers['Content-Type'] = p.tipo;
      const r = await auth.request({ url: p.url, method: p.metodo, headers, data: p.cuerpo ? Buffer.from(p.cuerpo) : undefined,
        responseType: 'arraybuffer', validateStatus: () => true, retry: false, timeout: tiempo });
      const cab = {};
      if (r.headers) (typeof r.headers.forEach === 'function' ? r.headers.forEach((v, k) => { cab[k] = v; }) : Object.assign(cab, r.headers));
      const d = r.data;
      const cuerpo = d == null ? Buffer.alloc(0) : Buffer.isBuffer(d) ? d : d instanceof ArrayBuffer ? Buffer.from(d)
        : typeof d === 'string' ? Buffer.from(d) : Buffer.from(JSON.stringify(d));
      return { codigo: r.status, cabeceras: cab, cuerpo };
    },

    /** Red normal (centro de mando, API de Claude). Como UrlFetchApp: sigue redirecciones salvo que se pida lo contrario. */
    async fetch(p) {
      const headers = Object.assign({}, p.cabeceras || {});
      if (p.cuerpo && p.tipo) headers['Content-Type'] = p.tipo;
      const r = await fetchExterno(p.url, { method: p.metodo, headers, body: p.cuerpo ? Buffer.from(p.cuerpo) : undefined,
        redirect: p.seguirRedirecciones ? 'follow' : 'manual', signal: AbortSignal.timeout(tiempo) });
      const cab = {};
      r.headers.forEach((v, k) => { cab[k] = v; });
      return { codigo: r.status, cabeceras: cab, cuerpo: Buffer.from(await r.arrayBuffer()) };
    },
  };
}

module.exports = { crearConductorGoogle, credencialDesde, ALCANCES, PLANTILLAS_APPS_SCRIPT };
