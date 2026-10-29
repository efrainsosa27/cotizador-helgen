// Piezas sueltas: modelo del espejo (interpretación como Sheets, operaciones, A1, fechas ↔ serie, parches con
// revisión), Utilities (formatDate como SimpleDateFormat, base64, digests con signo, CSV), Blob.getAs y el candado.
// Uso: node pruebas/unidades.test.js
'use strict';
process.env.TZ = 'America/Mexico_City';
const assert = require('assert');
const M = require('../src/espejo/modelo');
const S = require('../src/fachada/servicios');
const { Candado } = require('../src/nucleo/candado');

const casos = [];
const caso = (n, f) => casos.push([n, f]);

caso('interpretar: apóstrofo = texto, fecha ISO = Date (con su formato), "=" = fórmula, lo demás tal cual', () => {
  assert.deepEqual(M.interpretar("'0012"), { valor: '0012' });
  assert.deepEqual(M.interpretar("'2026-10-20"), { valor: '2026-10-20' });
  const d = M.interpretar('2026-10-20 17:30');
  assert(d.valor instanceof Date && d.valor.getHours() === 17 && d.patron === 'yyyy-mm-dd hh:mm');
  assert.equal(M.interpretar('2026-10-20').patron, 'yyyy-mm-dd');
  assert.deepEqual(M.interpretar('=A1*2'), { valor: '', formula: '=A1*2' });
  assert.deepEqual([M.interpretar(12.5).valor, M.interpretar(true).valor, M.interpretar('+52 442').valor, M.interpretar(null).valor], [12.5, true, '+52 442', '']);
});

caso('operaciones del diario sobre el modelo (como Apps Script: getLastRow cuenta fórmulas, appendRow tras la última fila)', () => {
  const l = M.nuevoLibro({ id: 'L', hojas: [{ id: 1, titulo: 'H', valores: [['a', 'b'], ['x', '']] }] });
  M.aplicar(l, { op: 'agregar', hoja: 1, celdas: [{ v: 'y' }, { v: 2 }] });
  M.aplicar(l, { op: 'valores', hoja: 1, r: 5, c: 3, celdas: [[{ v: '', f: '=1+1' }]] });
  const h = l.hojas[0];
  assert.equal(M.ultimaFila(h), 5, 'una fórmula cuenta como contenido');
  assert.deepEqual(M.leer(h, 3, 1, 1, 3), [['y', 2, '']]);
  assert.deepEqual(M.leerFormulas(h, 5, 3, 1, 1), [['=1+1']]);
  M.aplicar(l, { op: 'borrarFila', hoja: 1, r: 2 });
  assert.deepEqual(M.leer(h, 2, 1, 1, 2), [['y', 2]]);
  assert.equal(h.formulas['3,2'], '=1+1', 'la fórmula subió una fila');
  M.aplicar(l, { op: 'insertarFilas', hoja: 1, despues: 1, n: 2 });
  assert.deepEqual(M.leer(h, 4, 1, 1, 2), [['y', 2]]);
  M.aplicar(l, { op: 'nuevaHoja', id: 9, titulo: 'Nueva', indice: 0 });
  assert.deepEqual(l.hojas.map(x => x.titulo), ['Nueva', 'H']);
  assert.throws(() => M.aplicar(l, { op: 'nuevaHoja', id: 10, titulo: 'Nueva' }), /Ya existe/);
  M.aplicar(l, { op: 'formatoNumero', hoja: 1, rango: { r: 1, c: 2, nr: 1000, nc: 1, columnas: true }, patron: 'dd/MM/yyyy HH:mm' });
  assert.equal(M.formatoDe(h, 499, 1).tipo, 'DATE_TIME');
  assert.equal(M.formatoDe(h, 0, 0), null);
  M.aplicar(l, { op: 'borrarHoja', hoja: 9 });
  assert.deepEqual(l.hojas.map(x => x.titulo), ['H']);
});

caso('A1: columnas completas, abiertas desde una fila, celda y rango', () => {
  assert.deepEqual(M.rangoA1('B:B', 1000), { r: 1, c: 2, nr: 1000, nc: 1, columnas: true, abierto: true });
  assert.deepEqual(M.rangoA1('A2:A', 1000), { r: 2, c: 1, nr: 999, nc: 1, columnas: false, abierto: true });
  assert.deepEqual(M.rangoA1('G:H', 1000).nc, 2);
  assert.deepEqual(M.rangoA1('D4', 1000), { r: 4, c: 4, nr: 1, nc: 1, columnas: false, abierto: false });
  assert.deepEqual(M.rangoA1('A1:AN57', 1000), { r: 1, c: 1, nr: 57, nc: 40, columnas: false, abierto: false });
  assert.equal(M.numeroAColumna(42), 'AP');
});

caso('fechas ↔ número de serie de Sheets en la zona del libro (incluye el horario de verano que México tenía hasta 2022)', () => {
  const z = 'America/Mexico_City';
  const d = new Date(Date.UTC(2026, 9, 29, 21, 30)); // 15:30 en Querétaro
  assert.equal(M.serialDesdeFecha(d, z).toFixed(6), '46324.645833');
  assert.equal(M.fechaDesdeSerial(46324.645833333336, z).toISOString(), '2026-10-29T21:30:00.000Z');
  const verano = new Date(Date.UTC(2022, 6, 1, 17, 0)); // 12:00 con horario de verano (-05:00)
  assert.equal(M.fechaDesdeSerial(M.serialDesdeFecha(verano, z), z).toISOString(), verano.toISOString());
  assert.equal(M.serialDesdeFecha(verano, z) % 1, 0.5, 'mediodía local');
  assert.equal(M.fechaDesdeSerial(46324, 'UTC').toISOString(), '2026-10-29T00:00:00.000Z');
});

caso('parches con revisión: lo viejo no pisa lo nuevo y un parche sobre otra base tira la copia local', () => {
  const base = M.nuevoLibro({ id: 'L', rev: 3, hojas: [{ id: 1, titulo: 'A', valores: [['1']] }, { id: 2, titulo: 'B', valores: [['2']] }] });
  const esp = new Map([['L', structuredClone(base)]]);
  const nuevo = structuredClone(base);
  nuevo.rev = 4; nuevo.hojas[1].valores = [['2b']]; nuevo.hojas.push(M.nuevaHoja({ id: 3, titulo: 'C', valores: [['3']] }));
  const p = M.parcheDe(nuevo, 3, new Set([2, 3]), []);
  assert.equal(p.hojas.length, 2, 'solo las hojas tocadas');
  M.aplicarLibroOParche(esp, p);
  assert.deepEqual(esp.get('L').hojas.map(h => h.valores[0][0]), ['1', '2b', '3']);
  assert.equal(esp.get('L').rev, 4);
  M.aplicarLibroOParche(esp, p); // repetido: no pasa nada
  M.aplicarLibroOParche(esp, Object.assign(structuredClone(base), { rev: 2 })); // libro completo viejo: se ignora
  assert.equal(esp.get('L').rev, 4);
  assert.equal(M.aplicarLibroOParche(esp, Object.assign({}, p, { rev: 6, revBase: 5 })), false, 'base distinta');
  assert(!esp.has('L'), 'la copia local se tira: la siguiente lectura trae la canónica');
  const p2 = M.parcheDe(Object.assign(structuredClone(nuevo), { rev: 5 }), 4, new Set(), [2]);
  const esp2 = new Map([['L', structuredClone(nuevo)]]);
  M.aplicarLibroOParche(esp2, p2);
  assert.deepEqual(esp2.get('L').hojas.map(h => h.id), [1, 3], 'hoja borrada');
});

caso('Utilities.formatDate como java.text.SimpleDateFormat, con zona', () => {
  const d = new Date(Date.UTC(2026, 9, 29, 21, 5, 9, 45));
  const f = (p, z) => S.formatDate(d, z || 'America/Mexico_City', p);
  assert.equal(f('yyyy-MM-dd HH:mm:ss'), '2026-10-29 15:05:09');
  assert.equal(f('dd/MM/yyyy'), '29/10/2026');
  assert.equal(f('yyyyMMddHHmmss'), '20261029150509');
  assert.equal(f("yyyy-MM-dd'T'HH:mm:ss.SSSXXX"), '2026-10-29T15:05:09.045-06:00');
  assert.equal(f('EEE, d MMM yyyy h:mm a Z'), 'Thu, 29 Oct 2026 3:05 PM -0600');
  assert.equal(f("'Hoy es' EEEE"), 'Hoy es Thursday');
  assert.equal(f('yyyy-MM-dd HH:mm', 'UTC'), '2026-10-29 21:05');
  assert.equal(f("h 'o''clock'"), "3 o'clock");
});

caso('Utilities: bytes con signo, base64 (también web-safe con relleno, como Apps Script), digests, HMAC y CSV', () => {
  const U = S.crearUtilities({ dormir() {} }, S.crearBlob({}));
  const b = U.base64Decode(Buffer.from([0, 127, 128, 255]).toString('base64'));
  assert.deepEqual(b, [0, 127, -128, -1]);
  assert.equal(U.base64Encode(b), 'AH+A/w==');
  assert.equal(U.base64EncodeWebSafe(b), 'AH-A_w==', 'web-safe conserva el relleno');
  assert.deepEqual(U.base64DecodeWebSafe('AH-A_w'), b);
  assert.equal(U.base64Encode('ñ', U.Charset.UTF_8), 'w7E=');
  const md5 = U.computeDigest(U.DigestAlgorithm.MD5, 'hola');
  assert.equal(Buffer.from(md5.map(x => x & 255)).toString('hex'), '4d186321c1a7f0f354b297e8914ab240');
  const h = U.computeHmacSha256Signature('mensaje', 'secreto');
  assert(h.some(x => x < 0) && h.length === 32);
  assert.deepEqual(U.parseCsv('a,"b,c",d\n1,"dijo ""hola""\nadiós",3'), [['a', 'b,c', 'd'], ['1', 'dijo "hola"\nadiós', '3']]);
  assert(/^[0-9a-f-]{36}$/.test(U.getUuid()));
});

caso('Blob.getAs(application/pdf) pide el PDF al principal y nombra "<nombre>.pdf"', () => {
  const pedidos = [];
  const Blob = S.crearBlob({ rpc: (t, d) => { pedidos.push([t, d]); return Buffer.from('%PDF-1.7'); } });
  const U = S.crearUtilities({}, Blob);
  const pdf = U.newBlob('<p>hola</p>', 'text/html', 'HLG-2026-0007.html').getAs('application/pdf');
  assert.deepEqual([pdf.getName(), pdf.getContentType(), pdf.getDataAsString()], ['HLG-2026-0007.pdf', 'application/pdf', '%PDF-1.7']);
  assert.deepEqual(pedidos[0], ['pdf.html', { html: '<p>hola</p>', nombre: 'HLG-2026-0007.html' }]);
  assert.equal(pdf.setName('x.pdf').getName(), 'x.pdf');
  assert.throws(() => U.newBlob('x', 'text/plain').getAs('image/png'), /Conversión no disponible/);
});

caso('candado: uno a la vez en orden de llegada, tryLock(0) no espera, tiempo agotado y revisión antes de entregar', async () => {
  const revisados = [];
  const c = new Candado({ alEntregar: async d => { revisados.push(d); } });
  assert.equal(await c.tomar('a', 1000), true);
  assert.equal(await c.tomar('x', 0), false, 'tryLock(0) con el candado tomado');
  const orden = [];
  const b = c.tomar('b', 5000).then(ok => { orden.push('b'); return ok; });
  const d = c.tomar('d', 50).then(ok => { orden.push('d:' + ok); return ok; });
  await new Promise(r => setTimeout(r, 80));
  c.soltar('a');
  assert.equal(await b, true);
  assert.equal(await d, false);
  assert.deepEqual(orden, ['d:false', 'b']);
  assert.equal(c.soltar('a'), false, 'solo suelta su dueño');
  c.soltar('b');
  assert.deepEqual(revisados, ['a', 'b']);
});

caso('PDF con Chromium (puppeteer-core, navegador falso): sin JavaScript, sin red, sin fondos, máx. 2 a la vez, renace si se cae', async () => {
  const { MotorPdf } = require('../src/nucleo/servicios');
  const registro = { paginas: 0, abiertas: 0, max: 0, lanzamientos: 0, opciones: null, peticiones: [] };
  let alCaer = null;
  const navegadorFalso = () => ({
    on: (ev, f) => { if (ev === 'disconnected') alCaer = f; },
    close: async () => {},
    newPage: async () => {
      registro.paginas++; registro.abiertas++; registro.max = Math.max(registro.max, registro.abiertas);
      const oyentes = {};
      return {
        setJavaScriptEnabled: async b => { assert.equal(b, false); },
        setRequestInterception: async b => { assert.equal(b, true); },
        on: (ev, f) => { oyentes[ev] = f; },
        setContent: async html => {
          // la página pide una imagen data: (se permite) y una externa (se bloquea)
          for (const url of ['data:image/png;base64,AAAA', 'https://evil.example.com/x.png']) {
            oyentes.request({ url: () => url, continue: () => registro.peticiones.push('sí ' + url.slice(0, 5)), abort: () => registro.peticiones.push('no ' + url.slice(0, 5)) });
          }
          await new Promise(r => setTimeout(r, 30));
          void html;
        },
        pdf: async o => { registro.opciones = o; return new Uint8Array([37, 80, 68, 70]); },
        close: async () => { registro.abiertas--; },
      };
    },
  });
  const motor = new MotorPdf({ lanzar: async () => { registro.lanzamientos++; return navegadorFalso(); } });
  const pdfs = await Promise.all([1, 2, 3, 4, 5].map(i => motor.html('<p>' + i + '</p>')));
  assert(pdfs.every(b => b.toString() === '%PDF'));
  assert.equal(registro.max, 2, 'nunca más de 2 páginas a la vez');
  assert.equal(registro.abiertas, 0, 'cada página se cierra');
  assert.equal(registro.lanzamientos, 1, 'un solo navegador para todos');
  assert.deepEqual([registro.opciones.format, registro.opciones.printBackground], ['Letter', false]);
  assert(registro.peticiones.includes('sí data:') && registro.peticiones.includes('no https'));
  alCaer();
  await motor.html('<p>otra vez</p>');
  assert.equal(registro.lanzamientos, 2, 'si Chromium se cae, se vuelve a abrir');
});

(async () => {
  let fallas = 0;
  for (const [n, f] of casos) {
    try { await f(); console.log('✔ ' + n); } catch (e) { fallas++; console.log('✘ ' + n + '\n   ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n   ')); }
  }
  if (fallas) { console.log(fallas + ' prueba(s) fallaron'); process.exit(1); }
})();
