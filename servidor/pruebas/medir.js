// Mediciones para elegir la estrategia (docs/servidor-etapa-1.md §3):
//  A. El escenario de paridad con Google simulado (latencias típicas por tipo de llamada, abajo) en dos modos:
//     (a) síncrono sobre asíncrono escribiendo en cada llamada: cada setValue/appendRow es una batchUpdate;
//     (c) la elegida: memoria primero + una batchUpdate por libro al soltar el candado.
//     Y cuántas llamadas de cada escritura usan su resultado en el momento (Drive, HTTP, PDF, correo): lo que (b) no
//     podría diferir sin cambiar Code.js.
//  B. Lecturas mientras hay escrituras (3 trabajadores).
//  C. Presupuesto de memoria: el espejo con datos del tamaño de un año de CAPRI y lo que cuesta copiarlo entre hilos.
// Uso: node pruebas/medir.js            (LATENCIA=0 para medir solo el proceso)
'use strict';
const path = require('path');
const v8 = require('v8');
const { levantar, correrEscenario, tokensDeArnes, REPO, fechaFija } = require('./apoyo');
const { escenario, PROPS } = require('./escenario');
const M = require('../src/espejo/modelo');
const { huella } = require('../src/nucleo/espejo-central');

// Latencias supuestas (ms) desde un servidor en México hacia las API de Google (p50 típicas; ajustar con la corrida de
// sombra). La lectura de regreso va dentro de la batchUpdate.
const LATENCIA = process.env.LATENCIA === '0' ? null : {
  'sheets.leer': 450, 'sheets.crear': 600, 'sheets.escribir': 350, 'drive.version': 120, 'drive.leer': 150, 'drive.escribir': 300,
  'drive.subir': 500, 'drive.permisos': 150, http: 300, correo: 400, pdf: 450,
};

async function correr(modo) {
  const crearArnes = require(path.join(REPO, 'tests', 'arnes.js'));
  const A = crearArnes(REPO, { props: PROPS });
  const T = Date.now();
  const B = await levantar({ props: PROPS, tokens: tokensDeArnes(A), relojFijo: T, latencia: LATENCIA, conf: { escrituraInmediata: modo === 'a', frescuraSeg: 15 } });
  const r = await correrEscenario(escenario(T), (quien, f, ...args) => B.post(quien, f, ...args));
  const lineas = B.lineas.filter(l => l.texto === 'llamada');
  r.pasos.forEach((p, i) => { p.l = lineas[i] || {}; });
  await B.cerrar();
  void fechaFija;
  return r.pasos;
}

function tablaEstrategias(a, c) {
  console.log('\nA · Escenario con Google simulado (ms por llamada; latencias supuestas: ' + (LATENCIA ? JSON.stringify(LATENCIA) : 'ninguna') + ')');
  console.log('  ' + 'paso'.padEnd(40) + '(a) cada escritura   (c) al soltar candado   ops hoja   batchUpdates (a/c)   bloqueantes*');
  let ta = 0, tc = 0, ea = 0, ec = 0;
  c.forEach((p, i) => {
    const la = a[i].l, lc = p.l;
    const escribe = (lc.operaciones || 0) > 0;
    const rpc = lc.rpc || {};
    const bloqueantes = ['drive', 'url', 'pdf', 'correo'].map(k => (rpc[k] ? k + ':' + rpc[k].n : '')).filter(Boolean).join(' ');
    ta += a[i].ms; tc += p.ms;
    if (escribe) { ea += a[i].ms; ec += p.ms; }
    if (!escribe && p.ms < 60 && a[i].ms < 60) return;
    console.log('  ' + (String(i + 1).padStart(2) + ' ' + p.paso).slice(0, 39).padEnd(40) + String(Math.round(a[i].ms)).padStart(10) + String(Math.round(p.ms)).padStart(22) +
      String(lc.operaciones || 0).padStart(13) + ((la.confirmaciones || 0) + ' / ' + (lc.confirmaciones || 0)).padStart(16) + '   ' + bloqueantes);
  });
  console.log('  total del escenario: (a) ' + Math.round(ta) + ' ms · (c) ' + Math.round(tc) + ' ms · solo llamadas que escriben: (a) ' + Math.round(ea) + ' ms · (c) ' + Math.round(ec) + ' ms');
  console.log('  * llamadas cuyo resultado Code.js usa en el momento (id y liga de Drive, código HTTP de privado_, bytes del PDF, envío):');
  console.log('    con (b) habría que reescribir esos puntos de Code.js; con (a) y (c) se hacen síncronas por el puente.');
}

async function lecturasBajoCarga() {
  const crearArnes = require(path.join(REPO, 'tests', 'arnes.js'));
  const A = crearArnes(REPO, { props: PROPS });
  const B = await levantar({ props: PROPS, tokens: tokensDeArnes(A), latencia: LATENCIA, trabajadores: 3, conf: { frescuraSeg: 15 } });
  const P = (await B.post('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Q', cliente: { nombre: 'L', empresa: 'S' }, idSolicitud: 'p1' })).datos.folio;
  const pdf = Buffer.from('%PDF-1.4 x').toString('base64');
  for (const q of ['obrero', 'efrain', 'ana']) await B.post(q, 'bootstrap');
  await B.post('obrero', 'guardarRequisicion', { proyectoFolio: P, sitio: 'Querétaro', renglones: [{ descripcion: 'x', cantidad: 1, unidad: 'm' }], cotizacion: { nombre: 'c.pdf', datos: pdf }, idSolicitud: 'q0' });
  const t0 = Date.now();
  const escrituras = [1, 2, 3].map(n => B.post('obrero', 'guardarRequisicion', { proyectoFolio: P, sitio: 'Querétaro',
    renglones: [{ descripcion: 'x' + n, cantidad: 1, unidad: 'm' }], cotizacion: { nombre: 'c.pdf', datos: pdf }, idSolicitud: 'q' + n }).then(() => Date.now() - t0));
  const lecturas = [];
  const fin = Date.now() + 2500;
  while (Date.now() < fin) {
    const t = Date.now();
    await Promise.all([B.post('ana', 'sincronizar', {}, {}), B.post('efrain', 'listarRequisiciones', '', '')]);
    lecturas.push(Date.now() - t);
  }
  const fins = await Promise.all(escrituras);
  await B.cerrar();
  lecturas.sort((x, y) => x - y);
  const p = q => lecturas[Math.min(lecturas.length - 1, Math.floor(q * lecturas.length))];
  console.log('\nB · 3 requisiciones guardándose a la vez (terminan a los ' + fins.join(', ') + ' ms) y, mientras, pares de lecturas en bucle:');
  console.log('  ' + lecturas.length + ' pares de lecturas · p50 ' + p(0.5) + ' ms · p95 ' + p(0.95) + ' ms · máx ' + lecturas[lecturas.length - 1] + ' ms');
}

function presupuestoMemoria() {
  // Un año de CAPRI con holgura: 3,000 cotizaciones, 500 proyectos, 2,000 requisiciones con 8,000 renglones y 10,000
  // eventos, 2,000 órdenes de 45 columnas, 2,000 pagos, 5,000 movimientos de inventario, 1,000 correos, catálogo de 2,000
  const texto = (n, i) => ('Texto de prueba ' + i + ' ').repeat(Math.ceil(n / 20)).slice(0, n);
  const hoja = (id, titulo, filas, cols, largo) => {
    const valores = [Array.from({ length: cols }, (_, j) => 'col' + j)];
    for (let i = 0; i < filas; i++) valores.push(Array.from({ length: cols }, (_, j) => (j === 1 ? new Date(2026, 0, 1 + (i % 300)) : j % 5 === 2 ? i * 13.37 : texto(largo, i + j))));
    return M.nuevaHoja({ id, titulo, valores });
  };
  const libros = [
    M.nuevoLibro({ id: 'DB', hojas: [hoja(0, 'Cotizaciones', 3000, 22, 30), hoja(1, 'Proyectos', 500, 12, 25), hoja(2, 'Config', 20, 2, 200)] }),
    M.nuevoLibro({ id: 'CAT', hojas: [hoja(0, 'Catalogo', 2000, 9, 25)] }),
    M.nuevoLibro({ id: 'COM', hojas: [hoja(0, 'OrdenesCompra', 2000, 45, 20), hoja(1, 'Requisiciones', 2000, 25, 20), hoja(2, 'RequisicionesRenglones', 8000, 9, 20),
      hoja(3, 'RequisicionesEventos', 10000, 6, 25), hoja(4, 'PagosProveedores', 2000, 21, 20), hoja(5, 'MovimientosInventario', 5000, 24, 20), hoja(6, 'Proveedores', 300, 26, 25)] }),
    M.nuevoLibro({ id: 'COB', hojas: [hoja(0, 'Contratos', 300, 13, 20), hoja(1, 'Pagos', 1500, 23, 20)] }),
    M.nuevoLibro({ id: 'ADM', hojas: [hoja(0, 'Permisos', 60, 9, 20), hoja(1, 'Correos', 3000, 8, 40), hoja(2, 'Bitacora', 3000, 6, 40)] }),
  ];
  const celdas = libros.reduce((s, l) => s + l.hojas.reduce((t, h) => t + h.valores.length * (h.valores[0] || []).length, 0), 0);
  global.gc && global.gc();
  const antes = process.memoryUsage().heapUsed;
  const copia = structuredClone(libros);
  global.gc && global.gc();
  const mb = (process.memoryUsage().heapUsed - antes) / 1048576;
  let t = Date.now();
  const ser = v8.serialize(copia);
  const msSerializar = Date.now() - t;
  t = Date.now();
  v8.deserialize(ser);
  const msDeserializar = Date.now() - t;
  t = Date.now();
  huella(libros[2]);
  const msHuella = Date.now() - t;
  const com = libros[2];
  t = Date.now();
  structuredClone(com);
  const msCompras = Date.now() - t;
  console.log('\nC · Presupuesto de memoria (espejo de ' + celdas.toLocaleString('es-MX') + ' celdas, un año de CAPRI con holgura):');
  console.log('  una copia del espejo en el montón: ~' + Math.round(mb) + ' MB' + (global.gc ? '' : ' (aprox.; con --expose-gc es exacto)') +
    ' · al cable entre hilos: ' + Math.round(ser.length / 1048576) + ' MB (' + msSerializar + ' ms + ' + msDeserializar + ' ms)');
  console.log('  copiar el libro de compras entero a un trabajador (lo que pasa después de cada guardado): ' + msCompras + ' ms · huella: ' + msHuella + ' ms');
  void copia;
}

(async () => {
  const a = await correr('a');
  const c = await correr('c');
  tablaEstrategias(a, c);
  await lecturasBajoCarga();
  presupuestoMemoria();
  const memo = process.memoryUsage();
  console.log('\nProceso (principal + 3 trabajadores con Code.js cargado, pruebas): RSS ' + Math.round(memo.rss / 1048576) + ' MB');
})().catch(e => { console.error(e); process.exit(1); });
