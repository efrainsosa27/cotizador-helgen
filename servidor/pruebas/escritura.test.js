// Paridad de escritura con Apps Script: lo que Code.js escribe con setValue / setValues / appendRow queda en Sheets como
// lo dejaría Apps Script (entrada USER_ENTERED): número, fecha, hora, booleano, fórmula o texto, según el locale del
// libro y el formato de la celda. La tabla (con la fuente de cada caso) está en pruebas/casos-escritura.js.
//   1. Cada caso por el camino real: interpretar (lo que ve Code.js) → celda del diario → CellData de la batchUpdate.
//   2. De punta a punta en la fachada: formato de texto que vino de Sheets (por tramos) o que puso Code.js
//      (setNumberFormat), appendRow en la fila correcta, locale del libro, y la batchUpdate que sale.
//   3. Carga: locale y texto plano desde la API; la lectura de regreso los mantiene al día.
// Uso: node pruebas/escritura.test.js
'use strict';
process.env.TZ = 'America/Mexico_City';
const assert = require('assert');
const M = require('../src/espejo/modelo');
const H = require('../src/backends/google/hojas');
const { formatDate } = require('../src/fachada/servicios');
const { crearSpreadsheetApp } = require('../src/fachada/hojas');
const { CASOS, FORMATO_CELDA } = require('./casos-escritura');

const ZONA = 'America/Mexico_City';
const ANIO = String(new Date().getFullYear());
const casos = [];
const caso = (n, f) => casos.push([n, f]);

/** Lo que queda en Sheets y lo que lee Code.js para un caso, por el mismo camino que una escritura real. */
function resultado(c) {
  const formatoCelda = FORMATO_CELDA[c.celda || 'auto'];
  const x = M.interpretar(c.entrada, { locale: c.locale || 'es_MX', zona: ZONA, formato: formatoCelda });
  const celda = x.formula ? { v: '', f: x.formula } : x.patron ? { v: x.valor, p: x.patron, t: x.tipo } : { v: x.valor };
  const api = H.celdaApi(celda, ZONA, formatoCelda);
  const uev = api.cd.userEnteredValue || {};
  let tipo, valor;
  if (uev.formulaValue !== undefined) { tipo = 'formula'; valor = uev.formulaValue; }
  else if (celda.v instanceof Date) { tipo = 'fecha'; valor = formatDate(celda.v, ZONA, 'yyyy-MM-dd HH:mm:ss'); assert.equal(typeof uev.numberValue, 'number'); }
  else if (uev.numberValue !== undefined) { tipo = 'numero'; valor = uev.numberValue; }
  else if (uev.boolValue !== undefined) { tipo = 'booleano'; valor = uev.boolValue; }
  else if (uev.stringValue !== undefined) { tipo = 'texto'; valor = uev.stringValue; }
  else { tipo = 'vacio'; valor = ''; }
  // Lo que lee Code.js en la línea siguiente (antes de que Sheets conteste) es lo mismo que se manda
  if (tipo !== 'formula' && tipo !== 'fecha') assert.deepEqual(celda.v === '' && tipo === 'vacio' ? '' : celda.v, valor);
  const formato = api.formato ? api.formato.type + ' ' + api.formato.pattern : formatoCelda ? formatoCelda.patron : undefined;
  return { tipo, valor, formato };
}

caso('tabla de paridad (' + CASOS.length + ' casos): números, fechas, horas, apóstrofo, +52…, fórmulas, booleanos, locale y formato de la celda', () => {
  const mal = [];
  CASOS.forEach(c => {
    const r = resultado(c);
    const e = c.espera;
    const valor = typeof e.valor === 'string' ? e.valor.replace('AAAA', ANIO) : e.valor;
    const desc = JSON.stringify(c.entrada) + ' (' + (c.celda || 'auto') + ', ' + (c.locale || 'es_MX') + ')';
    if (r.tipo !== e.tipo || r.valor !== valor) mal.push(desc + ': esperaba ' + e.tipo + ' ' + JSON.stringify(valor) + ', quedó ' + r.tipo + ' ' + JSON.stringify(r.valor));
    else if (e.formato !== undefined && r.formato !== e.formato) mal.push(desc + ': formato esperado ' + e.formato + ', quedó ' + r.formato);
    else if (e.tipo === 'numero' && e.formato === undefined && r.formato !== undefined) mal.push(desc + ': no debía cambiar el formato (' + r.formato + ')');
  });
  assert.deepEqual(mal, []);
  const fuentes = CASOS.reduce((o, c) => { o[c.fuente] = (o[c.fuente] || 0) + 1; return o; }, {});
  console.log('   fuentes: ' + Object.keys(fuentes).map(k => k + ' ' + fuentes[k]).join(' · '));
});

caso('lo que no es texto pasa tal cual (número, booleano, Date); un número en una celda de fecha se lee como fecha', () => {
  const d = new Date(2026, 9, 29, 15, 30);
  assert.deepEqual(M.interpretar(1160), { valor: 1160 });
  assert.deepEqual(M.interpretar(false), { valor: false });
  assert.equal(M.interpretar(d).valor, d);
  assert.deepEqual(M.interpretar(null), { valor: '' });
  const x = M.interpretar(46324.645833333336, { formato: FORMATO_CELDA.fecha });
  assert.equal(formatDate(x.valor, ZONA, 'yyyy-MM-dd HH:mm'), '2026-10-29 15:30');
});

// ---------------------------------------------------------------- de punta a punta en la fachada
function libroDePrueba() {
  // "Pagos" como la deja hojaDeArea_ (todo en "@"), cargada de Sheets: A:C texto en las 3 filas que vinieron (encabezado,
  // un pago y la "+1"); "Cotizaciones" con formato automático salvo B (fecha)
  const l = M.nuevoLibro({ id: 'L', zona: ZONA, locale: 'es_MX', hojas: [
    { id: 1, titulo: 'Pagos', filasMax: 1000, columnasMax: 4, valores: [['folio', 'fecha', 'telefono', 'monto'], ['PAG-2026-0001', new Date(2026, 9, 1), '442', 10]], cargadas: 3 },
    { id: 2, titulo: 'Cotizaciones', filasMax: 1000, columnasMax: 8, valores: [['Folio', 'Fecha', 'Tasa', 'Total', 'Tel', 'Firmado', 'Hora', 'Clave']],
      formatos: { '1,1': { tipo: 'DATE_TIME', patron: 'dd/MM/yyyy HH:mm' } } }] });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M.marcarTexto(l.hojas[0], i, j, true);
  return l;
}
function fachada(libro) {
  const diario = [];
  const amb = { espejo: new Map([[libro.id, libro]]), plantillas: { libro: 'x/{id}' }, rpc: () => { throw new Error('sin red'); },
    aplicarLibro: () => {}, nuevoIdHoja: () => 99, escribirHoja: (id, op) => { M.aplicar(amb.espejo.get(id), op); diario.push(op); } };
  return { ss: crearSpreadsheetApp(amb).openById(libro.id), diario };
}

caso('fachada: appendRow en una hoja "@" cargada de Sheets (también la fila de abajo de lo cargado) y setValues en celdas automáticas', () => {
  const original = libroDePrueba();
  const { ss, diario } = fachada(structuredClone(original));
  const pagos = ss.getSheetByName('Pagos');
  pagos.appendRow(['PAG-2026-0002', '2026-10-20', '+52 442 644 5391', 1160]); // fila 3: la "+1" que vino de Sheets
  pagos.appendRow(['0012', '2026-10-21 17:30:00', '123', '15%']);              // fila 4: más abajo de lo cargado
  // En "@" nada se convierte (medido): ni la fecha ISO ni el teléfono
  assert.deepEqual(pagos.getRange(3, 1, 1, 3).getValues()[0].map(v => (v instanceof Date ? 'Date' : v)), ['PAG-2026-0002', '2026-10-20', '+52 442 644 5391']);
  assert.deepEqual(pagos.getRange(4, 1, 1, 3).getValues()[0].map(v => (v instanceof Date ? 'Date' : v)), ['0012', '2026-10-21 17:30:00', '123'],
    'la fila 4 no vino de Sheets: toma el formato "@" de la última que vino');
  assert.equal(pagos.getRange(4, 4).getValue(), 0.15, 'la columna D no es texto: "15%" es número');
  const cot = ss.getSheetByName('Cotizaciones');
  cot.getRange(2, 1, 1, 8).setValues([['HLG-2026-0009', '2026-10-29 15:30', '16%', '$1,160.00', '+52 442 644 5391', 'TRUE', '17:30', "'0012"]]);
  assert.deepEqual(cot.getRange(2, 1, 1, 8).getValues()[0].map(v => (v instanceof Date ? 'Date' : v)),
    ['HLG-2026-0009', 'Date', 0.16, 1160, '+52 442 644 5391', true, 'Date', '0012']);
  assert.equal(cot.getRange(2, 5).getFormula(), '', 'un "+" al inicio no hace fórmula por esta vía (medido)');
  assert(diario.every(op => op.entrada === 'USER_ENTERED'), 'setValues y appendRow anotan su entrada');
  cot.getRange(3, 1).setFormula('=A2');
  assert.equal(diario[diario.length - 1].entrada, 'RAW');
  assert.equal(ss.getSpreadsheetLocale(), 'es_MX');

  // La batchUpdate que sale (una sola, atómica): valores tipados y los formatos que Sheets pondría
  const { requests } = H.peticionesDeDiario(original, diario);
  const celdas = requests.filter(r => r.updateCells).map(r => r.updateCells.rows[0].values.map(v => v.userEnteredValue || {}));
  const [p3, p4, c2] = celdas;
  assert.deepEqual([p3[0], p3[2], p3[3]], [{ stringValue: 'PAG-2026-0002' }, { stringValue: '+52 442 644 5391' }, { numberValue: 1160 }]);
  assert.deepEqual(p3[1], { stringValue: '2026-10-20' }, 'fecha ISO en "@": queda texto (medido; CLAUDE.md §6.2 decía lo contrario)');
  assert.deepEqual([p4[0], p4[2], p4[3]], [{ stringValue: '0012' }, { stringValue: '123' }, { numberValue: 0.15 }]);
  assert.deepEqual([c2[2], c2[3], c2[4], c2[5], c2[7]], [{ numberValue: 0.16 }, { numberValue: 1160 }, { stringValue: '+52 442 644 5391' }, { boolValue: true }, { stringValue: '0012' }]);
  assert((c2[6].numberValue - 0.7291666) < 1e-6 && c2[6].numberValue > 0.729, '17:30 = 0.729 del día');
  const formatos = requests.filter(r => r.repeatCell).map(r => {
    const g = r.repeatCell.range, nf = r.repeatCell.cell.userEnteredFormat.numberFormat;
    return g.sheetId + '!' + M.numeroAColumna(g.startColumnIndex + 1) + (g.startRowIndex + 1) + ' ' + nf.type + ' ' + nf.pattern;
  });
  assert.deepEqual(formatos, ['1!D4 PERCENT 0%',
    '2!C2 PERCENT 0%', '2!D2 CURRENCY "$"#,##0.00', '2!G2 TIME hh:mm'],
    'B2 ya era fecha: no se toca; B3 y B4 quedaron texto en "@" (no hay formato que poner); los demás, como Sheets');
});

caso('fachada: el formato "@" que pone Code.js con setNumberFormat (hoja nueva) también protege lo que se escriba después', () => {
  const { ss } = fachada(M.nuevoLibro({ id: 'N', zona: ZONA, hojas: [{ id: 0, titulo: 'Hoja 1' }] }));
  const h = ss.insertSheet('Proveedores');
  h.getRange(1, 1, h.getMaxRows(), 3).setNumberFormat('@');
  h.appendRow(['012180001234567890', '00123', '5'] );
  h.appendRow(['x', 'y', '7']);
  assert.deepEqual(h.getRange(1, 1, 2, 3).getValues(), [['012180001234567890', '00123', '5'], ['x', 'y', '7']]);
  h.getRange(3, 4).setValue('5');
  assert.strictEqual(h.getRange(3, 4).getValue(), 5, 'fuera del rango con "@": número');
});

// ---------------------------------------------------------------- carga y lectura de regreso
caso('carga: locale del libro y texto plano por tramos desde la API; la lectura de regreso los actualiza', () => {
  const t = { effectiveFormat: { numberFormat: { type: 'TEXT' } } };
  const fila = (...vals) => ({ values: vals.map(v => Object.assign(v === '' ? {} : { effectiveValue: { stringValue: v }, formattedValue: v }, t)) });
  const l = H.libroDesdeApi({ spreadsheetId: 'S', properties: { title: 'Compras', timeZone: ZONA, locale: 'en_US' }, sheets: [
    { properties: { sheetId: 4, title: 'Proveedores', index: 0, gridProperties: { rowCount: 1000, columnCount: 3 } },
      data: [{ rowData: [fila('id', 'clabe', 'notas'), fila('RFC1', '0121', 'x'), fila('', '', '')] }] }] }, '7');
  const h = l.hojas[0];
  assert.equal(l.locale, 'en_US');
  assert.equal(h.cargadas, 3, 'la "+1" vino (vacía pero con formato)');
  assert.deepEqual(h.texto, { 0: [[0, 2]], 1: [[0, 2]], 2: [[0, 2]] });
  assert.equal(M.formatoDe(h, 50, 1).tipo, 'TEXT');
  assert.equal(M.interpretar('10/20/2026', M.contextoCelda(l, h, 3, 1)).valor, '10/20/2026', 'en "@" no se convierte');
  // La batchUpdate regresa la fila 3 ya sin formato de texto en C (alguien lo cambió a mano): el espejo lo sabe
  const regreso = { properties: { title: 'Compras', timeZone: ZONA }, sheets: [{ properties: { sheetId: 4, title: 'Proveedores', gridProperties: { rowCount: 1000, columnCount: 3 } },
    data: [{ startRow: 2, rowData: [{ values: [Object.assign({ effectiveValue: { stringValue: 'RFC2' } }, t), Object.assign({ effectiveValue: { stringValue: '0099' } }, t), { effectiveValue: { numberValue: 5 } }] }] }] }] };
  H.unirRegreso(l, regreso, [{ hoja: 4, r0: 3, r1: 3, nc: 3, titulo: 'Proveedores' }]);
  assert.deepEqual(h.texto, { 0: [[0, 2]], 1: [[0, 2]], 2: [[0, 1]] });
  assert.equal(h.valores[2][2], 5);
});

caso('herramientas/paridad-escritura.js: la función de Apps Script que genera corre (aquí, sobre la fachada) y "comparar" sale igual', () => {
  const vm = require('vm'), fs = require('fs'), os = require('os'), path = require('path');
  const S = require('../src/fachada/servicios');
  const P = require('../herramientas/paridad-escritura');
  const libros = new Map();
  let n = 0, linea = null;
  const amb = { espejo: libros, plantillas: { libro: 'x/{id}' }, nuevoIdHoja: () => 1000 + (++n), aplicarLibro: () => {},
    rpc: (tipo, d) => { if (tipo !== 'hojas.crear') throw new Error('sin ' + tipo); const id = 'P' + (++n); return M.nuevoLibro({ id, titulo: d.nombre, hojas: [{ id: 0, titulo: 'Hoja 1' }] }); },
    escribirHoja: (id, op) => M.aplicar(libros.get(id), op) };
  const ctx = { SpreadsheetApp: crearSpreadsheetApp(amb), Utilities: S.crearUtilities({}, S.crearBlob({})), Date,
    DriveApp: { getFileById: () => ({ setTrashed: () => {} }) }, console: { log: t => { linea = t; } } };
  vm.createContext(ctx);
  vm.runInContext(P.codigo() + '\nparidadEscrituraTemporal();', ctx);
  assert(linea && linea.startsWith('{"apps":['), 'imprime una línea JSON');
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'capri-paridad-')), 'resultado.json');
  fs.writeFileSync(archivo, '1:23:45 PM\tInformación\t' + linea + '\n'); // como se copia del registro de ejecución
  const log = console.log; const salida = [];
  console.log = t => salida.push(String(t));
  let codigo;
  try { codigo = P.comparar(archivo); } finally { console.log = log; }
  assert.equal(codigo, 0, salida.join('\n'));
  // Una diferencia se reporta con su fuente
  const x = JSON.parse(linea); x.apps[0] = { tipo: 'texto', valor: '123', formato: '@', visible: '123' };
  fs.writeFileSync(archivo, JSON.stringify(x));
  salida.length = 0; console.log = t => salida.push(String(t));
  try { codigo = P.comparar(archivo); } finally { console.log = log; }
  assert.equal(codigo, 1);
  assert(/"123" \(auto, es_MX, fuente: API\)/.test(salida.join('\n')));
});

(async () => {
  let fallas = 0;
  for (const [n, f] of casos) {
    try { await f(); console.log('✔ ' + n); } catch (e) { fallas++; console.log('✘ ' + n + '\n   ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n   ')); }
  }
  if (fallas) { console.log(fallas + ' prueba(s) fallaron'); process.exit(1); }
})();
