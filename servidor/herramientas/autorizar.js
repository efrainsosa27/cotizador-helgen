#!/usr/bin/env node
// Autoriza al servidor a usar Sheets, Drive y Gmail como facilities@helgen.tech (modo "oauth", el recomendado).
// Se corre UNA vez (y otra si un día se revoca el permiso), con una ventana de navegador donde se entra como
// facilities@. Guarda {"type":"authorized_user", client_id, client_secret, refresh_token} con permisos 600.
//
//   node herramientas/autorizar.js --cliente client_secret_XXXX.json --alcances hojas,drive --salida google-facilities.json
//   node herramientas/autorizar.js --cliente client_secret_XXXX.json --alcances correo      --salida google-facilities-correo.json
//
// En el servidor (sin navegador), dentro de la imagen de CAPRI (Node solo existe ahí): túnel desde la Mac y la liga que
// imprime se abre en el navegador de la Mac, entrando como facilities@ (docs/servidor-google-paso-a-paso.md, paso 7):
//   ssh -L 8765:127.0.0.1:8765 <usuario>@helgensrvr
//   docker compose run --rm -p 127.0.0.1:8765:8765 -v /srv/capri/config:/salida capri node herramientas/autorizar.js \
//     --cliente /salida/cliente-oauth.json --alcances hojas,drive --salida /salida/google-facilities.json --escuchar 0.0.0.0
// --escuchar 0.0.0.0: dentro del contenedor (Docker publica solo 127.0.0.1:8765 del servidor). La dirección de regreso
// sigue siendo http://127.0.0.1:8765/oauth (la que acepta Google para una "App de escritorio").
// El cliente OAuth es de tipo "App de escritorio" en el proyecto de Google Cloud de helgen.tech (pantalla de
// consentimiento Interna).
'use strict';
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const ALCANCES = {
  hojas: 'https://www.googleapis.com/auth/spreadsheets',
  drive: 'https://www.googleapis.com/auth/drive',
  correo: 'https://www.googleapis.com/auth/gmail.send',
};
const arg = n => { const i = process.argv.indexOf('--' + n); return i === -1 ? null : process.argv[i + 1]; };
const cliente = arg('cliente'), salida = arg('salida');
const alcances = String(arg('alcances') || 'hojas,drive,correo').split(',').map(x => x.trim()).filter(Boolean);
const cuenta = arg('cuenta') || 'facilities@helgen.tech';
const puerto = Number(arg('puerto') || 8765);
const escuchar = arg('escuchar') || '127.0.0.1';
if (!cliente || !salida || alcances.some(a => !ALCANCES[a])) {
  console.error('Uso: autorizar.js --cliente client_secret.json --salida archivo.json [--alcances hojas,drive,correo] [--cuenta facilities@helgen.tech] [--escuchar 0.0.0.0]');
  process.exit(2);
}
const c = JSON.parse(fs.readFileSync(cliente, 'utf8'));
const datos = c.installed || c.web;
if (!datos) { console.error('El archivo no es un cliente OAuth (falta "installed").'); process.exit(2); }
const redirect = 'http://127.0.0.1:' + puerto + '/oauth';
const oauth = new OAuth2Client({ clientId: datos.client_id, clientSecret: datos.client_secret, redirectUri: redirect });
const verificador = crypto.randomBytes(48).toString('base64url');
const reto = crypto.createHash('sha256').update(verificador).digest('base64url');
const estado = crypto.randomBytes(16).toString('hex');
const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', login_hint: cuenta, state: estado,
  scope: ['openid', 'email'].concat(alcances.map(a => ALCANCES[a])), code_challenge: reto, code_challenge_method: 'S256' });

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== '/oauth') { res.writeHead(404); res.end(); return; }
  try {
    if (u.searchParams.get('state') !== estado) throw new Error('estado distinto (¿otra pestaña?)');
    if (u.searchParams.get('error')) throw new Error(u.searchParams.get('error'));
    const { tokens } = await oauth.getToken({ code: u.searchParams.get('code'), codeVerifier: verificador });
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: datos.client_id });
    const correo = ticket.getPayload().email;
    if (correo !== cuenta) throw new Error('entraste como ' + correo + ', no como ' + cuenta + '. Vuelve a correrlo con la cuenta correcta.');
    if (!tokens.refresh_token) throw new Error('Google no mandó refresh_token (quita el acceso de la app en la cuenta y vuelve a intentar).');
    const faltan = alcances.filter(a => !String(tokens.scope || '').includes(ALCANCES[a]));
    if (faltan.length) throw new Error('no se aceptaron estos permisos: ' + faltan.join(', '));
    fs.writeFileSync(salida, JSON.stringify({ type: 'authorized_user', client_id: datos.client_id, client_secret: datos.client_secret,
      refresh_token: tokens.refresh_token, cuenta: correo, alcances, creado: new Date().toISOString() }, null, 1), { mode: 0o600 });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Listo: ' + salida + ' guardado para ' + correo + '. Puedes cerrar esta ventana.');
    console.log('✔ Guardado ' + salida + ' (' + alcances.join(', ') + ') para ' + correo + ', con permisos 600.');
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No se pudo: ' + e.message);
    console.error('✘ ' + e.message);
    process.exitCode = 1;
  }
  setTimeout(() => servidor.close(), 200);
});
servidor.listen(puerto, escuchar, () => {
  console.log('Abre esta liga en el navegador (entra como ' + cuenta + '):\n\n' + url + '\n');
});
