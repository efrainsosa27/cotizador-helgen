// HTTP: el mismo contrato que el doPost de Apps Script. La interfaz solo cambia API_URL.
//   POST /api (o /)  cuerpo text/plain {"funcion", "args", "token"} → 200 {"ok", "datos" | "error", "codigo"?}
//   GET  /salud      estado del servicio (el detalle solo desde el mismo servidor, sin pasar por nginx; sin datos de CAPRI)
//   POST /admin/correr {"funcion", "args"}  como "Ejecutar" en el editor (solo desde el mismo servidor)
// CORS: solo los orígenes de la interfaz (Cloudflare y la copia local de pruebas). nginx pone TLS y el límite por IP.
'use strict';
const http = require('http');

function correoDelToken(token) {
  // Solo para el registro (sin verificar; la verificación la hace Code.js): ayuda a saber de quién era una llamada lenta
  try {
    const t = String(token || '');
    const partes = t.split('.');
    const carga = JSON.parse(Buffer.from(partes[t.startsWith('capri.') ? 1 : 1], 'base64url').toString('utf8'));
    return String(carga.email || carga.e || '').slice(0, 120);
  } catch (e) { return ''; }
}

function crearServidorHttp(servicio, o) {
  const op = o || {};
  const origenes = new Set(op.origenes || []);
  const limite = op.limiteBytes || 50 * 1024 * 1024;
  const registro = servicio.registro;

  const responder = (res, codigo, cuerpo, extra) => {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    res.writeHead(codigo, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(texto) }, extra || {}));
    res.end(texto);
  };

  const servidor = http.createServer((req, res) => {
    const origen = req.headers.origin;
    const cors = origen && origenes.has(origen) ? { 'Access-Control-Allow-Origin': origen, Vary: 'Origin' } : {};
    const ruta = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, Object.assign({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400' }, cors));
      res.end();
      return;
    }
    if (req.method === 'GET' && ruta === '/salud') {
      // El detalle solo desde el mismo servidor (curl 127.0.0.1:8090/salud); por nginx (trae X-Forwarded-For) solo {ok}
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
      responder(res, 200, local ? servicio.salud() : { ok: true });
      return;
    }
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
    // Como "Ejecutar" en el editor de Apps Script (prepararCapri, cadaQuinceMinutos…): solo desde el mismo servidor
    //   curl -s 127.0.0.1:8090/admin/correr -d '{"funcion":"cadaQuinceMinutos"}'
    if (req.method === 'POST' && ruta === '/admin/correr') {
      if (!local) { responder(res, 404, { ok: false, error: 'No existe esa dirección.' }); return; }
      const t = [];
      req.on('data', d => t.push(d));
      req.on('end', () => {
        let x = {};
        try { x = JSON.parse(Buffer.concat(t).toString('utf8') || '{}'); } catch (e) { x = {}; }
        servicio.correrFuncion(x.funcion, x.args).then(r => responder(res, 200, r.texto), e => responder(res, 200, { ok: false, error: e.message }));
      });
      return;
    }
    if (req.method !== 'POST' || (ruta !== '/api' && ruta !== '/' && ruta !== '/exec')) {
      responder(res, 404, { ok: false, error: 'No existe esa dirección. La API de CAPRI recibe POST en /api.' }, cors);
      return;
    }
    const llego = Date.now();
    const trozos = [];
    let bytes = 0, demasiado = false;
    const rechazarGrande = () => {
      demasiado = true;
      responder(res, 413, { ok: false, error: 'Los archivos pesan demasiado para una sola llamada (máx. ' + Math.round(limite / 1048576) + ' MB).' },
        Object.assign({ Connection: 'close' }, cors));
      res.on('finish', () => setTimeout(() => req.destroy(), 200));
    };
    if (Number(req.headers['content-length']) > limite) { rechazarGrande(); return; }
    req.on('data', d => {
      if (demasiado) return;
      bytes += d.length;
      if (bytes > limite) { trozos.length = 0; rechazarGrande(); return; }
      trozos.push(d);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (demasiado) return;
      const cuerpo = Buffer.concat(trozos).toString('utf8');
      let token = '';
      try { token = (/"token"\s*:\s*"([^"]{0,4096})"/.exec(cuerpo) || [])[1] || ''; } catch (e) { token = ''; }
      servicio.peticion(cuerpo).then(r => {
        responder(res, 200, r.texto, cors);
        const ok = r.texto.startsWith('{"ok":true');
        const codigo = ok ? undefined : ((/"codigo":"([A-Z_]+)"/.exec(r.texto.slice(-200)) || [])[1]);
        const m = r.metricas || {};
        registro('info', 'llamada', { funcion: r.funcion, usuario: correoDelToken(token), ok, codigo, ms: Date.now() - llego,
          msCola: m.msCola, msTrabajo: m.ms && Math.round(m.ms), cpuMs: m.cpuMs && Math.round(m.cpuMs), rpc: m.rpc,
          confirmaciones: m.confirmaciones, operaciones: m.operaciones, entrada: bytes, salida: r.texto.length, trabajador: m.trabajador });
      }, e => {
        responder(res, 200, { ok: false, error: 'Error interno del servidor: ' + e.message }, cors);
        registro('error', 'llamada', { error: e.message });
      });
    });
  });
  servidor.requestTimeout = op.requestTimeoutMs || 300000;
  servidor.headersTimeout = 60000;
  servidor.keepAliveTimeout = 65000;
  return servidor;
}

module.exports = { crearServidorHttp, correoDelToken };
