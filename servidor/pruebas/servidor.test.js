// Comportamiento del servidor (backend memoria, con latencia simulada donde importa):
//  1. lecturas en paralelo mientras una escritura espera a Google; dos escrituras a la vez se hacen una tras otra
//  2. si Sheets rechaza la confirmación: {ok:false, codigo GUARDAR}, nada a medias en la hoja, el folio no se gasta y
//     repetir con el mismo idSolicitud funciona
//  3. una edición a mano en la hoja: el sondeo la ve, sube la versión y la consulta de los navegadores la trae; quien
//     toma el candado la ve aunque no haya pasado el minuto (frescura)
//  4. una operación que se pasa del tiempo: se corta, se suelta el candado, el trabajador renace; lo que el principal ya
//     estaba confirmando termina y la idempotencia lo devuelve al repetir
//  5. modo solo lectura (corrida de sombra): no escribe en Sheets ni Drive, y lo dice en el registro
//  6. HTTP: CORS, 404, 413, /salud
//  7. activadores (ScriptApp.newTrigger) y caché/propiedades que sobreviven un reinicio
// Uso: node pruebas/servidor.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { levantar, REPO } = require('./apoyo');
const { PROPS } = require('./escenario');
const { clientIdDeCode } = require('../src/servicio');
const M = require('../src/espejo/modelo');

const CID = clientIdDeCode(path.join(REPO, 'Code.js'));
const exp = String(Math.floor(Date.now() / 1000) + 3600);
const claims = (email, n, a) => ({ aud: CID, iss: 'https://accounts.google.com', exp, email, email_verified: 'true', hd: 'helgen.tech', given_name: n, family_name: a });
const TOKENS = { efrain: claims('efrain@helgen.tech', 'Efrain', 'Sosa'), obrero: claims('obrero@helgen.tech', 'Juan', 'Obrero'),
  ana: claims('ana@helgen.tech', 'Ana', 'López'), tania: claims('tania@helgen.tech', 'Tania', 'R') };
const PDF = Buffer.from('%PDF-1.4 cotizacion').toString('base64');
const RENGLONES = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }];
const anio = String(new Date().getFullYear());
const ms = async f => { const t = Date.now(); const r = await f(); return { r, ms: Date.now() - t }; };
const casos = [];
const caso = (n, f) => casos.push([n, f]);

async function proyecto(B, id) {
  const r = await B.post('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: id || 'p1' });
  assert(r.ok, JSON.stringify(r));
  return r.datos.folio;
}
const requisicion = (B, folio, id) => B.post('obrero', 'guardarRequisicion', { proyectoFolio: folio, sitio: 'Querétaro', renglones: RENGLONES,
  cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: id });
const filas = (B, prop, hoja) => {
  const l = B.conductor.libros.get(B.servicio.props.leer(prop));
  return l.hojas.find(h => h.titulo === hoja).valores.slice(1).filter(f => f.length);
};

caso('lecturas en paralelo mientras una escritura espera a Google; dos escrituras a la vez se serializan', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS, trabajadores: 3,
    latencia: { 'sheets.escribir': 600, 'drive.subir': 150, 'drive.escribir': 80, 'drive.leer': 20, 'drive.permisos': 40, correo: 100 } });
  try {
    const p = await proyecto(B);
    await B.post('obrero', 'bootstrap'); await B.post('efrain', 'bootstrap'); await B.post('ana', 'bootstrap'); // calienta
    const escritura = ms(() => requisicion(B, p, 'q1'));
    await new Promise(r => setTimeout(r, 80));
    const lecturas = await Promise.all([
      ms(() => B.post('ana', 'listarProyectos', '', false)), ms(() => B.post('efrain', 'listarRequisiciones', '', '')),
      ms(() => B.post('obrero', 'misRequisiciones')), ms(() => B.post('ana', 'sincronizar', {}, {}))]);
    const w = await escritura;
    assert(w.r.ok, JSON.stringify(w.r));
    lecturas.forEach(x => assert(x.r.ok, JSON.stringify(x.r)));
    const maxLectura = Math.max(...lecturas.map(x => x.ms));
    console.log('   escritura ' + w.ms + ' ms (Google simulado: 600 ms por confirmación); lecturas a la vez: ' + lecturas.map(x => x.ms).join(', ') + ' ms');
    assert(w.ms >= 600, 'la escritura sí esperó a Google');
    assert(maxLectura < 300, 'ninguna lectura esperó a la escritura (' + maxLectura + ' ms)');
    // Dos escrituras al mismo tiempo: el candado las pone una tras otra, folios distintos y sin perder ninguna
    const [a, b] = await Promise.all([ms(() => requisicion(B, p, 'q2')), ms(() => requisicion(B, p, 'q3'))]);
    assert(a.r.ok && b.r.ok, JSON.stringify([a.r, b.r]));
    assert.notEqual(a.r.datos.folio, b.r.datos.folio);
    assert(Math.max(a.ms, b.ms) >= 1200, 'la segunda esperó a la primera (' + a.ms + ', ' + b.ms + ' ms)');
    assert.equal(filas(B, 'COMPRAS_DB_ID', 'Requisiciones').length, 3);
  } finally { await B.cerrar(); }
});

caso('Sheets rechaza la confirmación: error claro, nada a medias, el folio no se gasta y repetir funciona', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS });
  try {
    const p = await proyecto(B);
    const r1 = await requisicion(B, p, 'q1');
    assert(r1.ok);
    const compras = B.servicio.props.leer('COMPRAS_DB_ID');
    const ver = B.servicio.props.leer('VER_requisiciones');
    let veces = 0;
    B.conductor.fallarConfirmar = id => (id === compras && veces++ === 0 ? Object.assign(new Error('The service is currently unavailable.'), { status: 503 }) : null);
    const archivosAntes = [...B.conductor.items.values()].filter(x => !x.carpeta).length;
    const r2 = await requisicion(B, p, 'q2');
    assert.deepEqual([r2.ok, r2.codigo], [false, 'GUARDAR'], JSON.stringify(r2));
    assert(/No se pudo guardar en Google Sheets .*unavailable.*No se guardó nada de esta operación/.test(r2.error), r2.error);
    assert.equal(filas(B, 'COMPRAS_DB_ID', 'Requisiciones').length, 1, 'ni una fila a medias');
    assert.equal(B.servicio.props.leer('VER_requisiciones'), ver, 'la versión no subió');
    const mias = await B.post('obrero', 'misRequisiciones');
    assert.equal(mias.datos.length, 1, 'quien pide solo ve la que sí se guardó (el trabajador tiró su copia supuesta)');
    // El PDF de la cotización ya se había subido (Drive va antes que la fila, como en Apps Script): queda huérfano
    assert.equal([...B.conductor.items.values()].filter(x => !x.carpeta).length, archivosAntes + 1);
    const r3 = await requisicion(B, p, 'q2');
    assert(r3.ok, JSON.stringify(r3));
    assert.equal(r3.datos.folio, 'REQ-' + anio + '-0002', 'el folio que falló no se gastó');
    assert.equal(filas(B, 'COMPRAS_DB_ID', 'Requisiciones').length, 2);
    assert.equal((await requisicion(B, p, 'q2')).datos.folio, r3.datos.folio, 'idempotencia intacta');
  } finally { await B.cerrar(); }
});

caso('edición a mano: el sondeo la ve, sube la versión y la consulta de los navegadores la trae; el candado la ve al instante', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS, conf: { frescuraSeg: 0.001 } });
  try {
    const p = await proyecto(B);
    const boot = await B.post('ana', 'bootstrap');
    assert.equal(boot.datos.proyectos.length, 1);
    await B.post('ana', 'sincronizar', boot.datos.versiones, {}); // deja las marcas R_ de "ya revisé"
    // Alguien pone el proyecto en Cerrado desde la hoja (columna G), como se hace hoy
    B.conductor.editarAMano('DB', l => { const h = l.hojas.find(x => x.titulo === 'Proyectos'); h.valores[1][6] = 'Cerrado'; });
    const cambiados = await B.servicio.espejo.sondear();
    assert.deepEqual(cambiados, ['DB']);
    assert(Number(B.servicio.props.leer('VER_proyectos')) > Number(boot.datos.versiones.proyectos), 'subió la versión de proyectos');
    const s = await B.post('ana', 'sincronizar', boot.datos.versiones, {});
    assert(s.datos.cambios.includes('proyectos') && s.datos.proyectos.length === 0, 'el navegador ya no lo ve activo: ' + JSON.stringify(s.datos.cambios));
    // Quien toma el candado ve lo editado sin esperar el sondeo: alguien agregó a mano PRY-AAAA-0005
    B.conductor.editarAMano('DB', l => {
      const h = l.hojas.find(x => x.titulo === 'Proyectos');
      h.valores.push(['PRY-' + anio + '-0005', new Date(), 'A mano', 'X', 'x', 'Q', 'Activo', '', '', '', '', 'AMA']);
    });
    await new Promise(r => setTimeout(r, 5));
    const nuevo = await proyecto(B, 'p2');
    assert.equal(nuevo, 'PRY-' + anio + '-0006', 'el folio siguiente cuenta el renglón agregado a mano');
    void p;
  } finally { await B.cerrar(); }
});

caso('tiempo agotado: se corta, el candado se suelta, el trabajador renace; lo que ya se confirmaba termina y repetir lo devuelve', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS, conf: { limiteMs: 500 } });
  try {
    await proyecto(B, 'p0');
    B.conductor.latencia = { 'sheets.escribir': 1500 };
    const r = await B.post('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Q', cliente: { nombre: 'L', empresa: 'S' }, idSolicitud: 'p-lento' });
    assert.deepEqual([r.ok, r.codigo], [false, 'TIEMPO'], JSON.stringify(r));
    assert(/revisa antes de repetir/.test(r.error));
    await new Promise(x => setTimeout(x, 1700)); // la confirmación en curso termina (el principal no la abandona)
    B.conductor.latencia = null;
    const otra = await B.post('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Q', cliente: { nombre: 'L', empresa: 'S' }, idSolicitud: 'p-lento' });
    assert(otra.ok, JSON.stringify(otra));
    assert.equal(otra.datos.folio, 'PRY-' + anio + '-0002', 'la idempotencia devuelve el mismo proyecto');
    assert.equal(filas(B, 'SPREADSHEET_ID', 'Proyectos').length, 2, 'un solo renglón');
    assert.equal(B.servicio.pool.metricas.cortados, 1);
    assert.equal(B.servicio.candado.dueno, null, 'candado libre');
    assert(B.servicio.pool.trabajadores.every(t => t.listo), 'el trabajador cortado ya renació');
    // Cortado MIENTRAS ESPERABA el candado: su petición sale de la cola (si no, el candado se entregaría a un muerto)
    await B.servicio.candado.tomar('prueba', null);
    const esperando = await B.post('ana', 'crearProyecto', { nombre: 'Planta Sur', ubicacion: 'Q', cliente: { nombre: 'L' }, idSolicitud: 'p-espera' });
    assert.equal(esperando.codigo, 'TIEMPO');
    await new Promise(x => setTimeout(x, 100));
    B.servicio.candado.soltar('prueba');
    await new Promise(x => setTimeout(x, 50));
    assert.equal(B.servicio.candado.dueno, null, 'nadie quedó con el candado');
    assert((await B.post('ana', 'crearProyecto', { nombre: 'Planta Sur', ubicacion: 'Q', cliente: { nombre: 'L' }, idSolicitud: 'p-espera-2' })).ok);
  } finally { await B.cerrar(); }
});

caso('solo lectura (corrida de sombra): no escribe en Sheets ni Drive y lo deja en el registro', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS, conf: { soloLectura: true } });
  try {
    const r = await B.post('ana', 'crearProyecto', { nombre: 'X', ubicacion: 'Q', cliente: { nombre: 'L' }, idSolicitud: 'p1' });
    assert.deepEqual([r.ok, r.codigo], [false, 'SOLO_LECTURA']);
    const boot = await B.post('ana', 'bootstrap');
    assert(boot.ok, JSON.stringify(boot));
    assert(!B.conductor.llamadas['sheets.escribir'], 'ninguna escritura llegó a Sheets');
    assert(B.lineas.some(l => /^solo lectura: no se escribió/.test(l.texto)), 'lo que habría escrito (migraciones de Config) quedó en el registro');
  } finally { await B.cerrar(); }
});

caso('HTTP: CORS solo para la interfaz, 404, 413 y /salud', async () => {
  const B = await levantar({ props: PROPS, tokens: TOKENS });
  try {
    const bien = await B.enviar(JSON.stringify({ funcion: 'bootstrap', args: [], token: 'ana' }), { Origin: 'http://127.0.0.1:8788' });
    assert.equal(bien.cabeceras['access-control-allow-origin'], 'http://127.0.0.1:8788');
    assert.equal(bien.cabeceras['content-type'], 'application/json; charset=utf-8');
    const mal = await B.enviar(JSON.stringify({ funcion: 'bootstrap', args: [], token: 'ana' }), { Origin: 'https://evil.example.com' });
    assert.equal(mal.cabeceras['access-control-allow-origin'], undefined, 'otro origen: el navegador no deja leer la respuesta');
    const http = require('http');
    const pedir = (metodo, ruta, cuerpo, cab) => new Promise((res, rej) => {
      const q = http.request({ host: '127.0.0.1', port: B.puerto, path: ruta, method: metodo, headers: cab || {} }, r => {
        const t = []; r.on('data', d => t.push(d)); r.on('end', () => res({ estado: r.statusCode, cabeceras: r.headers, texto: Buffer.concat(t).toString() }));
      });
      q.on('error', rej); q.end(cuerpo);
    });
    const opciones = await pedir('OPTIONS', '/api', null, { Origin: 'http://127.0.0.1:8788' });
    assert.equal(opciones.estado, 204);
    assert.equal((await pedir('GET', '/otra')).estado, 404);
    const salud = JSON.parse((await pedir('GET', '/salud')).texto);
    assert(salud.ok && salud.trabajadores.trabajadores.length === 3 && salud.backend === 'memoria');
    assert.deepEqual(JSON.parse((await pedir('GET', '/salud', null, { 'X-Forwarded-For': '201.141.1.1' })).texto), { ok: true }, 'por nginx: sin detalle');
    const corrida = JSON.parse((await pedir('POST', '/admin/correr', JSON.stringify({ funcion: 'cadaQuinceMinutos' }))).texto);
    assert.equal(corrida.ok, true, 'una función del editor corre desde el servidor: ' + JSON.stringify(corrida).slice(0, 200));
    assert.equal((await pedir('POST', '/admin/correr', JSON.stringify({ funcion: 'prepararCapri' }), { 'X-Forwarded-For': '201.141.1.1' })).estado, 404, 'por nginx no existe');
    const grande = await pedir('POST', '/api', Buffer.alloc(51 * 1024 * 1024, 'a'));
    assert.equal(grande.estado, 413);
    assert(/pesan demasiado/.test(JSON.parse(grande.texto).error));
  } finally { await B.cerrar(); }
});

caso('activadores de Code.js (cadaQuinceMinutos) y caché/propiedades que sobreviven un reinicio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-'));
  try {
    // Declarado en la configuración: se crea al arrancar
    let B = await levantar({ props: PROPS, tokens: TOKENS, conf: { datos: dir, activadoresFijos: [{ funcion: 'cadaQuinceMinutos', cadaMinutos: 15 }] } });
    assert.deepEqual(B.servicio.activadores.listar().map(a => [a.funcion, a.cadaMinutos]), [['cadaQuinceMinutos', 15]]);
    // Y Code.js lo reconoce como suyo (instalarActivadorPortal no lo duplica)
    const r = await B.servicio.pool.ejecutar({ funcion: 'instalarActivadorPortal', args: [], clase: 'activador' });
    assert(JSON.parse(r.texto).ok);
    assert.deepEqual(B.servicio.activadores.listar().map(a => [a.funcion, a.cadaMinutos]), [['cadaQuinceMinutos', 15]]);
    const corrida = JSON.parse((await B.servicio.activadores.correr('cadaQuinceMinutos')).texto);
    assert(corrida.ok && corrida.datos.cache, JSON.stringify(corrida).slice(0, 300));
    const p = await proyecto(B, 'p-reinicio');
    const conductor = B.conductor;
    await B.cerrar();
    assert.equal((fs.statSync(path.join(dir, 'propiedades.json')).mode & 0o777).toString(8), '600', 'propiedades con permisos 600');
    // Reinicio con los mismos datos (y el mismo Google): el doble clic de antes sigue dando el mismo folio
    B = await levantar({ conductor, tokens: TOKENS, conf: { datos: dir } });
    const otra = await B.post('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Luis', empresa: 'Solar' }, idSolicitud: 'p-reinicio' });
    assert.equal(otra.datos.folio, p);
    assert.deepEqual(B.servicio.activadores.listar().map(a => a.funcion), ['cadaQuinceMinutos'], 'el activador sigue instalado');
    await B.cerrar();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

(async () => {
  let fallas = 0;
  for (const [n, f] of casos) {
    try { await f(); console.log('✔ ' + n); } catch (e) { fallas++; console.log('✘ ' + n + '\n   ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n   ')); }
  }
  if (fallas) { console.log(fallas + ' prueba(s) fallaron'); process.exit(1); }
  void M;
})();
