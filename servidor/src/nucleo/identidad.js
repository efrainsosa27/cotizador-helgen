// Verificación local del ID token de Google (inicio de sesión de @helgen.tech), sin llamar a tokeninfo en cada clic.
// Code.js sigue llamando a https://oauth2.googleapis.com/tokeninfo?id_token=… con UrlFetchApp: el servidor intercepta
// esa dirección y contesta lo mismo que tokeninfo (los claims como texto), después de revisar aquí firma RS256 con las
// llaves públicas de Google (JWKS, guardadas en memoria según su Cache-Control), emisor, audiencia (el Client ID de
// CAPRI) y vencimiento. Code.js vuelve a revisar aud, iss, exp, hd y email_verified (validarClaimsToken) sin cambios.
// Las sesiones de CAPRI (@helgen.services, "capri.…") no pasan por aquí: Code.js las verifica con SESION_SECRETO.
'use strict';
const jose = require('jose');

const EMISORES = ['accounts.google.com', 'https://accounts.google.com'];
const JWKS_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs';

/** Como tokeninfo: todos los claims como texto (exp, iat, email_verified…). */
const comoTokeninfo = payload => {
  const out = {};
  Object.keys(payload).forEach(k => { const v = payload[k]; out[k] = v !== null && typeof v === 'object' ? v : String(v); });
  return out;
};

class VerificadorGoogle {
  /**
   * @param {object} o  clientId (obligatorio), jwks (opcional: un JWKS fijo para pruebas), url, fetch (opcional)
   */
  constructor(o) {
    if (!o || !o.clientId) throw new Error('Falta el Client ID de Google para verificar sesiones.');
    this.clientId = o.clientId;
    this.llaves = o.jwks ? jose.createLocalJWKSet(o.jwks)
      : jose.createRemoteJWKSet(new URL(o.url || JWKS_GOOGLE), Object.assign({ cacheMaxAge: 6 * 3600 * 1000, cooldownDuration: 30000, timeoutDuration: 10000 },
        o.fetch ? { [jose.customFetch]: o.fetch } : {}));
    this.metricas = { ok: 0, rechazados: 0 };
    this.reloj = o.reloj || null; // pruebas: segundos "ahora"
  }

  /** {codigo: 200, claims} o {codigo: 400, error}. Nunca lanza. */
  async verificar(token) {
    const t = String(token || '');
    if (!t || t.length > 4096 || t.split('.').length !== 3) { this.metricas.rechazados++; return { codigo: 400, error: 'invalid_token' }; }
    try {
      const { payload } = await jose.jwtVerify(t, this.llaves, Object.assign({ issuer: EMISORES, audience: this.clientId,
        algorithms: ['RS256'], clockTolerance: 30, requiredClaims: ['exp', 'iat', 'sub'] },
      this.reloj ? { currentDate: new Date(this.reloj() * 1000) } : {}));
      this.metricas.ok++;
      return { codigo: 200, claims: comoTokeninfo(payload) };
    } catch (e) {
      this.metricas.rechazados++;
      return { codigo: 400, error: e && e.code ? e.code : 'invalid_token' };
    }
  }
}

/** Para memoria y pruebas: tabla token → claims (como las rutas de tokeninfo del arnés). */
class VerificadorTabla {
  constructor(tabla) { this.tabla = tabla || {}; this.metricas = { ok: 0, rechazados: 0 }; }
  async verificar(token) {
    const c = this.tabla[String(token || '')];
    if (!c) { this.metricas.rechazados++; return { codigo: 400, error: 'invalid_token' }; }
    this.metricas.ok++;
    return { codigo: 200, claims: comoTokeninfo(c) };
  }
}

module.exports = { VerificadorGoogle, VerificadorTabla, comoTokeninfo, JWKS_GOOGLE };
