// Verificación local del ID token de Google (JWKS): firma, emisor, audiencia, vencimiento y algoritmo; y de punta a
// punta con el Code.js real (validarClaimsToken sigue exigiendo hd y email_verified). Llaves generadas aquí.
// Uso: node pruebas/identidad.test.js
'use strict';
process.env.TZ = 'America/Mexico_City';
const assert = require('assert');
const path = require('path');
const jose = require('jose');
const { VerificadorGoogle } = require('../src/nucleo/identidad');
const { crearServicio, clientIdDeCode } = require('../src/servicio');
const { ConductorMemoria } = require('../src/backends/memoria');
const { REPO } = require('./apoyo');

(async () => {
  const CID = clientIdDeCode(path.join(REPO, 'Code.js'));
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const jwk = Object.assign(await jose.exportJWK(publicKey), { kid: 'k1', alg: 'RS256', use: 'sig' });
  const otra = await jose.generateKeyPair('RS256', { extractable: true });
  const ahora = Math.floor(Date.now() / 1000);
  const firmar = (claims, o) => new jose.SignJWT(Object.assign({ iss: 'https://accounts.google.com', aud: CID, sub: '1234567890', iat: ahora - 10,
    exp: ahora + 3600, email: 'ana@helgen.tech', email_verified: true, hd: 'helgen.tech', given_name: 'Ana', family_name: 'López' }, claims || {}))
    .setProtectedHeader({ alg: 'RS256', kid: (o && o.kid) || 'k1', typ: 'JWT' }).sign((o && o.llave) || privateKey);
  const v = new VerificadorGoogle({ clientId: CID, jwks: { keys: [jwk] } });

  const ok = await v.verificar(await firmar());
  assert.equal(ok.codigo, 200);
  assert.deepEqual([ok.claims.email, ok.claims.email_verified, typeof ok.claims.exp], ['ana@helgen.tech', 'true', 'string'], 'como tokeninfo: claims en texto');
  assert.equal((await v.verificar(await firmar({ iss: 'accounts.google.com' }))).codigo, 200, 'los dos emisores de Google');
  const rechaza = async (t, que) => assert.equal((await v.verificar(t)).codigo, 400, que);
  await rechaza(await firmar({ aud: 'otra-app.apps.googleusercontent.com' }), 'otra audiencia');
  await rechaza(await firmar({ iss: 'https://evil.example.com' }), 'otro emisor');
  await rechaza(await firmar({ exp: ahora - 120 }), 'vencido');
  await rechaza(await firmar({}, { llave: otra.privateKey }), 'firmado con otra llave');
  await rechaza(await firmar({}, { kid: 'desconocida' }), 'llave desconocida');
  const partes = (await firmar()).split('.');
  const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  carga.email = 'leo@helgen.tech';
  await rechaza(partes[0] + '.' + Buffer.from(JSON.stringify(carga)).toString('base64url') + '.' + partes[2], 'carga alterada');
  const hs = await new jose.SignJWT({ iss: 'https://accounts.google.com', aud: CID, sub: '1', exp: ahora + 60, iat: ahora })
    .setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(new TextEncoder().encode(JSON.stringify(jwk)));
  await rechaza(hs, 'HS256 con la llave pública como secreto (confusión de algoritmo)');
  await rechaza('a.b', 'mal formado');
  await rechaza('', 'vacío');
  console.log('✔ verificación local del token (' + v.metricas.ok + ' aceptados, ' + v.metricas.rechazados + ' rechazados)');

  // De punta a punta: el token firmado entra a Code.js por la intercepción de tokeninfo
  const conductor = new ConductorMemoria();
  const servicio = crearServicio({ trabajadores: 2, codigo: { dir: REPO }, zonaHoraria: 'America/Mexico_City', cuentaServicio: 'facilities@helgen.tech',
    propiedadesIniciales: conductor.sembrarComoArnes(), silencioso: true, sondeoSeg: 0, reconciliarMin: 0, precargar: false, activadores: false },
  { conductor, identidad: v, registro: () => {} });
  await servicio.iniciar();
  const llamar = async (token, funcion) => JSON.parse((await servicio.peticion(JSON.stringify({ funcion, args: [], token }))).texto);
  const b = await llamar(await firmar(), 'bootstrap');
  assert(b.ok && b.datos.usuario === 'ana@helgen.tech' && b.datos.vendedor.nombre === 'Ana', 'bootstrap con sesión verificada localmente');
  const gmail = await llamar(await firmar({ email: 'ana@gmail.com', hd: undefined }), 'bootstrap');
  assert.deepEqual([gmail.ok, gmail.codigo], [false, 'SESION'], 'cuenta sin hd: Code.js la rechaza igual que antes');
  const sinVerificar = await llamar(await firmar({ email_verified: false }), 'bootstrap');
  assert.equal(sinVerificar.codigo, 'SESION');
  const vencido = await llamar(await firmar({ exp: ahora - 120 }), 'bootstrap');
  assert.deepEqual([vencido.codigo, /expiró|válida/.test(vencido.error)], ['SESION', true]);
  await servicio.detener();
  console.log('✔ de punta a punta con Code.js (hd, email_verified y vencimiento)');
})().catch(e => { console.error(e); process.exit(1); });
