// Adaptadores de Google (backend "google") contra HTTP simulado: un cliente de autenticación falso recibe cada petición
// que arman @googleapis/sheets, /drive y /gmail (URL, método, parámetros, cuerpo) y contesta con respuestas con la forma
// documentada por Google. Sin red ni credenciales. Revisa lo que se manda y cómo se lee lo que regresa.
// Uso: node pruebas/google.test.js
'use strict';
process.env.TZ = 'America/Mexico_City';
const assert = require('assert');
const { Readable } = require('stream');
const M = require('../src/espejo/modelo');
const { crearConductorGoogle } = require('../src/backends/google');
const H = require('../src/backends/google/hojas');
const { armarMime } = require('../src/backends/google/correo');
const { EspejoCentral } = require('../src/nucleo/espejo-central');
const { Candado } = require('../src/nucleo/candado');

async function leerCuerpo(d) {
  if (d == null) return null;
  if (d instanceof Readable || (d && typeof d.pipe === 'function')) {
    const trozos = [];
    for await (const x of d) trozos.push(Buffer.from(x));
    return Buffer.concat(trozos);
  }
  return d;
}

/** Cliente de autenticación falso: googleapis-common le pasa cada petición a request(). */
class AuthFalso {
  constructor() { this.rutas = []; this.peticiones = []; }
  en(metodo, re, fn) { this.rutas.push({ metodo, re, fn }); return this; }
  getUniverseDomain() { return 'googleapis.com'; }
  async request(o) {
    const metodo = String(o.method || 'GET').toUpperCase();
    const p = { metodo, url: o.url, params: Object.assign({}, o.params || {}), cuerpo: await leerCuerpo(o.data), headers: o.headers, responseType: o.responseType };
    this.peticiones.push(p);
    const r = this.rutas.find(x => x.metodo === metodo && x.re.test(o.url));
    if (!r) throw Object.assign(new Error('sin ruta: ' + metodo + ' ' + o.url), { status: 404, response: { status: 404, data: {} } });
    const res = await r.fn(p);
    const status = res.status || 200;
    // Como gaxios: con responseType arraybuffer el cuerpo llega en bytes
    if (o.responseType === 'arraybuffer' && res.data != null && !(res.data instanceof ArrayBuffer)) {
      const b = Buffer.from(typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
      res.data = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    }
    if (status >= 400 && !(o.validateStatus && o.validateStatus(status))) {
      throw Object.assign(new Error(res.data && res.data.error ? res.data.error.message : 'HTTP ' + status), { status, response: { status, data: res.data } });
    }
    return { status, data: res.data, headers: res.headers || {} };
  }
}

const ID = '1ozFsyt1OjSnSv-PVpRWZjgqeWt6voQREbjvOJAXPEaI';
/** Cuerpo JSON de una petición (googleapis manda el recurso como objeto; gaxios lo serializa después). */
const json = p => (Buffer.isBuffer(p.cuerpo) || typeof p.cuerpo === 'string' ? JSON.parse(p.cuerpo) : p.cuerpo);
const SERIAL_29OCT_1530 = 46324.645833333336; // 2026-10-29 15:30:00 en America/Mexico_City
const casos = [];
const caso = (n, f) => casos.push([n, f]);

// ---------------------------------------------------------------- Sheets: cargar
caso('cargar: zona usada con valores, fechas, fórmulas, texto visible y rangos con nombre', async () => {
  const auth = new AuthFalso();
  auth.en('GET', /sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+$/, p => {
    if (!p.params.includeGridData) {
      return { data: { spreadsheetId: ID, properties: { title: 'Cotizador Helgen — Base de datos', timeZone: 'America/Mexico_City' },
        namedRanges: [{ namedRangeId: 'nr1', name: 'TIPO_CAMBIO', range: { sheetId: 7, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 } }],
        sheets: [{ properties: { sheetId: 0, title: 'Cotizaciones', index: 0, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } } },
          { properties: { sheetId: 7, title: "Tipo de cambio", index: 1, gridProperties: { rowCount: 1000, columnCount: 26 } } }] } };
    }
    // (3) solo la zona pedida
    assert.deepEqual(p.params.ranges, ["'Cotizaciones'!A1:D4", "'Tipo de cambio'!A1:B5"]);
    return { data: { spreadsheetId: ID, properties: { title: 'Cotizador Helgen — Base de datos', timeZone: 'America/Mexico_City' },
      namedRanges: [{ namedRangeId: 'nr1', name: 'TIPO_CAMBIO', range: { sheetId: 7, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 } }],
      sheets: [
        { properties: { sheetId: 0, title: 'Cotizaciones', index: 0, gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } },
          data: [{ rowData: [
            { values: [{ userEnteredValue: { stringValue: 'Folio' }, effectiveValue: { stringValue: 'Folio' }, formattedValue: 'Folio' },
              { effectiveValue: { stringValue: 'Fecha' }, formattedValue: 'Fecha' }, { effectiveValue: { stringValue: 'Total' }, formattedValue: 'Total' },
              { effectiveValue: { stringValue: 'Firmado' }, formattedValue: 'Firmado' }] },
            { values: [{ effectiveValue: { stringValue: 'HLG-2026-0007' }, formattedValue: 'HLG-2026-0007' },
              { effectiveValue: { numberValue: SERIAL_29OCT_1530 }, formattedValue: '29/10/2026 15:30', effectiveFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy HH:mm' } } },
              { effectiveValue: { numberValue: 1160 }, formattedValue: '$1,160.00', effectiveFormat: { numberFormat: { type: 'CURRENCY', pattern: '$#,##0.00' } } },
              { effectiveValue: { boolValue: true }, formattedValue: 'TRUE' }] },
            { values: [{ effectiveValue: { stringValue: '0012' }, formattedValue: '0012', effectiveFormat: { numberFormat: { type: 'TEXT' } } },
              {}, { userEnteredValue: { formulaValue: '=C2*2' }, effectiveValue: { numberValue: 2320 }, formattedValue: '$2,320.00' },
              { userEnteredValue: { formulaValue: '=1/0' }, effectiveValue: { errorValue: { type: 'DIVIDE_BY_ZERO' } }, formattedValue: '#DIV/0!' }] },
          ] }] },
        { properties: { sheetId: 7, title: 'Tipo de cambio', index: 1, gridProperties: { rowCount: 1000, columnCount: 26 } },
          data: [{ rowData: [{ values: [{ effectiveValue: { stringValue: 'Concepto' } }] }, {}, {},
            { values: [{ effectiveValue: { stringValue: 'Tipo de cambio en uso' } },
              { userEnteredValue: { formulaValue: '=IF(ISNUMBER(B3),B3,IFERROR(ROUND(B2,4),""))' }, effectiveValue: { numberValue: 18.425 }, formattedValue: '18.4250' }] }] }] }],
    } };
  });
  auth.en('GET', /sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values:batchGet$/, p => {
    assert.equal(p.params.valueRenderOption, 'FORMULA');
    // Como la API real: "range" es la cuadrícula completa; "values" llega recortado a lo que tiene datos
    return { data: { valueRanges: [{ range: "'Cotizaciones'!A1:Z1000", values: [['Folio', 'Fecha', 'Total', 'Firmado'], ['x', 1, 2, true], ['0012', '', '=C2*2', '=1/0']] },
      { range: "'Tipo de cambio'!A1:Z1000", values: [['Concepto'], [], [], ['Tipo de cambio en uso', '=IF(…)']] }] } };
  });
  auth.en('GET', /www\.googleapis\.com\/drive\/v3\/files\/[^/]+$/, p => ({ data: { version: '812', modifiedTime: '2026-10-29T21:30:00Z' } }));
  const g = crearConductorGoogle({}, { auth });
  const l = await g.cargarLibro(ID);
  assert.equal(l.version, '812');
  assert.equal(l.titulo, 'Cotizador Helgen — Base de datos');
  const h = l.hojas[0];
  assert.deepEqual([h.titulo, h.filasMax, h.columnasMax, h.congeladas], ['Cotizaciones', 1000, 26, 1]);
  assert(h.valores[1][1] instanceof Date, 'número con formato de fecha → Date');
  assert.equal(h.valores[1][1].toISOString(), '2026-10-29T21:30:00.000Z', '15:30 en Querétaro = 21:30 UTC');
  assert.deepEqual([h.valores[1][2], h.valores[1][3], h.valores[2][0]], [1160, true, '0012']);
  assert.equal(h.formulas['2,2'], '=C2*2');
  assert.equal(h.valores[2][2], 2320, 'la fórmula trae su valor calculado');
  assert.equal(h.valores[2][3], '#DIV/0!', 'error: lo que muestra Sheets (como getValues)');
  assert.equal(M.leerVisibles(h, 2, 2, 1, 2)[0].join('|'), '29/10/2026 15:30|$1,160.00');
  assert.deepEqual(M.formatoDe(h, 1, 1), { tipo: 'DATE_TIME', patron: 'dd/MM/yyyy HH:mm' });
  assert.equal(M.ultimaFila(h), 3);
  assert.deepEqual(l.nombrados.TIPO_CAMBIO, { id: 'nr1', hoja: 7, rango: { r: 4, c: 2, nr: 1, nc: 1 } });
  assert.equal(l.hojas[1].valores[3][1], 18.425);
  assert.equal(auth.peticiones.length, 4, '3 de Sheets + la versión de Drive');
});

// ---------------------------------------------------------------- Sheets: confirmar
function libroBase() {
  return M.nuevoLibro({ id: ID, titulo: 'Compras', zona: 'America/Mexico_City', version: '5', hojas: [
    { id: 0, titulo: 'OrdenesCompra', indice: 0, filasMax: 3, columnasMax: 4, valores: [['folio', 'fecha', 'total', 'notas'], ['OC-2026-0001', new Date(2026, 9, 20), 100, '']] },
    { id: 11, titulo: "Bitácora d'Ana", indice: 1, filasMax: 1000, columnasMax: 26, valores: [['fecha', 'accion']],
      formatos: { '1,0': { tipo: 'DATE', patron: 'dd/MM/yyyy' } } }] });
}
caso('confirmar: el diario se vuelve una sola batchUpdate (valores tipados, filas y columnas nuevas, formato, estilo, validación, protección, nombres)', async () => {
  const auth = new AuthFalso();
  let cuerpo = null, params = null;
  auth.en('POST', /:batchUpdate$/, p => { cuerpo = json(p); params = p.params; return { data: { spreadsheetId: ID, updatedSpreadsheet: { properties: { title: 'Compras', timeZone: 'America/Mexico_City' }, sheets: [
    { properties: { sheetId: 0, title: 'OrdenesCompra', index: 0, gridProperties: { rowCount: 4, columnCount: 6 } },
      data: [{ startRow: 1, rowData: [
        { values: [{ effectiveValue: { stringValue: 'OC-2026-0001' } }, { effectiveValue: { numberValue: 46315 }, formattedValue: '2026-10-20', effectiveFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
          { effectiveValue: { numberValue: 116 } }, { effectiveValue: { stringValue: 'Pagada' } }] },
        { values: [{ effectiveValue: { stringValue: 'OC-2026-0002' } }, { effectiveValue: { numberValue: SERIAL_29OCT_1530 }, formattedValue: '2026-10-29 15:30:00', effectiveFormat: { numberFormat: { type: 'DATE_TIME' } } },
          { effectiveValue: { numberValue: 1624 } }, { effectiveValue: { stringValue: '+52 442' } }, { userEnteredValue: { formulaValue: '=C4*2' }, effectiveValue: { numberValue: 3248 } }, { effectiveValue: { boolValue: false } }] }] }] },
      { properties: { sheetId: 555, title: 'Devoluciones', index: 2, gridProperties: { rowCount: 1000, columnCount: 26 } },
        data: [{ rowData: [{ values: [{ effectiveValue: { stringValue: 'folio' } }] }] }] }] } } }; });
  const g = crearConductorGoogle({}, { auth });
  const ops = [
    { op: 'valores', hoja: 0, r: 2, c: 3, celdas: [[{ v: 116 }, { v: 'Pagada' }]] },
    { op: 'agregar', hoja: 0, celdas: [{ v: 'OC-2026-0002' }, { v: new Date(2026, 9, 29, 15, 30) }, { v: 1624 }, { v: '+52 442' }, { v: '', f: '=C4*2' }, { v: false }] },
    { op: 'formatoNumero', hoja: 11, rango: { r: 1, c: 2, nr: 1000, nc: 1, columnas: true }, patron: '@' },
    { op: 'estilo', hoja: 11, rango: { r: 1, c: 1, nr: 1, nc: 2 }, negrita: true, fondo: '#2C3C5B', color: '#FFFFFF' },
    { op: 'validacion', hoja: 11, rango: { r: 2, c: 1, nr: 999, nc: 1, abierto: true }, regla: { condicion: { tipo: 'ONE_OF_LIST', valores: ['Activo', 'Cerrado'], lista: true }, permitirInvalidos: false, ayuda: 'Elige' } },
    { op: 'proteger', hoja: 11, id: 'P1', rango: { r: 1, c: 9, nr: 1000, nc: 1, columnas: true }, descripcion: '', soloAviso: false },
    { op: 'proteger', hoja: 11, id: 'P1', rango: { r: 1, c: 9, nr: 1000, nc: 1, columnas: true }, descripcion: 'No escribir', soloAviso: true },
    { op: 'nombrarRango', nombre: 'TIPO_CAMBIO', hoja: 11, rango: { r: 4, c: 2, nr: 1, nc: 1 } },
    { op: 'congelar', hoja: 11, filas: 1 },
    { op: 'anchoColumna', hoja: 11, c: 2, px: 160 },
    { op: 'nuevaHoja', id: 555, titulo: 'Devoluciones', indice: null },
    { op: 'valores', hoja: 555, r: 1, c: 1, celdas: [[{ v: 'folio' }]] },
  ];
  const nuevo = await g.confirmar(libroBase(), ops);
  const R = cuerpo.requests;
  assert.equal(auth.peticiones.length, 1, 'una sola llamada a Google');
  assert.equal(cuerpo.includeSpreadsheetInResponse, true);
  // valores: número y texto literal
  assert.deepEqual(R[0], { updateCells: { start: { sheetId: 0, rowIndex: 1, columnIndex: 2 }, rows: [{ values: [{ userEnteredValue: { numberValue: 116 } }, { userEnteredValue: { stringValue: 'Pagada' } }] }], fields: 'userEnteredValue' } });
  // agregar más allá de la cuadrícula: primero filas y columnas, luego la fila 3 (después de la última con datos)
  assert.deepEqual(R[1], { appendDimension: { sheetId: 0, dimension: 'COLUMNS', length: 2 } });
  assert.equal(R[2].updateCells.start.rowIndex, 2);
  const fila = R[2].updateCells.rows[0].values;
  assert.equal(fila[1].userEnteredValue.numberValue.toFixed(6), SERIAL_29OCT_1530.toFixed(6), 'Date → número de serie en la zona del libro');
  assert.deepEqual(fila[3], { userEnteredValue: { stringValue: '+52 442' } }, 'texto siempre literal (nunca se interpreta como fórmula)');
  assert.deepEqual(fila[4], { userEnteredValue: { formulaValue: '=C4*2' } });
  assert.deepEqual(fila[5], { userEnteredValue: { boolValue: false } });
  // la fecha en una celda sin formato de fecha lleva su formato (como Apps Script al escribir una Date)
  assert.deepEqual(R[3].repeatCell.cell.userEnteredFormat.numberFormat, { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' });
  assert.deepEqual(R[3].repeatCell.range, { sheetId: 0, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 });
  // formato de columna completa, estilo, validación abierta hacia abajo, una sola protección con su último estado
  assert.deepEqual(R[4], { repeatCell: { range: { sheetId: 11, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } });
  assert.equal(R[5].repeatCell.fields, 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.backgroundColor');
  assert.equal(R[5].repeatCell.cell.userEnteredFormat.backgroundColor.red.toFixed(3), (0x2C / 255).toFixed(3));
  assert.deepEqual(R[6].setDataValidation.range, { sheetId: 11, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 });
  assert.deepEqual(R[6].setDataValidation.rule.condition, { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Activo' }, { userEnteredValue: 'Cerrado' }] });
  assert.equal(R[6].setDataValidation.rule.strict, true);
  const prot = R.filter(x => x.addProtectedRange);
  assert.equal(prot.length, 1);
  assert.deepEqual([prot[0].addProtectedRange.protectedRange.description, prot[0].addProtectedRange.protectedRange.warningOnly], ['No escribir', true]);
  assert(R.some(x => x.addNamedRange && x.addNamedRange.namedRange.name === 'TIPO_CAMBIO'));
  assert(R.some(x => x.updateSheetProperties && x.updateSheetProperties.properties.gridProperties.frozenRowCount === 1));
  assert(R.some(x => x.updateDimensionProperties && x.updateDimensionProperties.properties.pixelSize === 160));
  assert(R.some(x => x.addSheet && x.addSheet.properties.sheetId === 555 && x.addSheet.properties.title === 'Devoluciones'));
  // lectura de regreso: solo las filas tocadas (2 y 3) y la hoja nueva completa; nombre con apóstrofo escapado
  assert.deepEqual(cuerpo.responseRanges, ["'OrdenesCompra'!A2:F3", "'Devoluciones'!A1:A2"]);
  assert.equal(cuerpo.responseIncludeGridData, true);
  assert(/updatedSpreadsheet\(/.test(params.fields), 'pide solo lo necesario');
  // el espejo nuevo toma lo que Sheets guardó (fechas como Date, fórmulas, dimensiones)
  const oc = nuevo.hojas.find(h => h.titulo === 'OrdenesCompra');
  assert.deepEqual(oc.valores[1].slice(2), [116, 'Pagada']);
  assert(oc.valores[2][1] instanceof Date && oc.valores[2][1].getHours() === 15);
  assert.equal(oc.formulas['2,4'], '=C4*2');
  assert.equal(oc.valores[2][4], 3248);
  assert.deepEqual([oc.filasMax, oc.columnasMax], [4, 6]);
  assert(nuevo.hojas.some(h => h.titulo === 'Devoluciones'), 'la hoja nueva queda en el espejo');
});

caso('confirmar: una Date en una celda que ya tiene formato de fecha no le cambia el formato', async () => {
  const auth = new AuthFalso();
  let cuerpo;
  auth.en('POST', /:batchUpdate$/, p => { cuerpo = json(p); return { data: { updatedSpreadsheet: { sheets: [] } } }; });
  const g = crearConductorGoogle({}, { auth });
  await g.confirmar(libroBase(), [{ op: 'valores', hoja: 11, r: 2, c: 1, celdas: [[{ v: new Date(2026, 9, 29) }]] }]);
  assert.equal(cuerpo.requests.length, 1, 'sin repeatCell de formato');
  // y si la columna se formateó en esta misma transacción, tampoco
  await g.confirmar(libroBase(), [{ op: 'formatoNumero', hoja: 0, rango: { r: 1, c: 2, nr: 3, nc: 1, columnas: true }, patron: 'dd/MM/yyyy HH:mm' },
    { op: 'agregar', hoja: 0, celdas: [{ v: 'x' }, { v: new Date() }] }]);
  assert.equal(cuerpo.requests.filter(x => x.repeatCell && x.repeatCell.fields === 'userEnteredFormat.numberFormat').length, 1, 'solo el formato de la columna');
});

caso('confirmar: borrar una fila relee la hoja completa (hasta su última fila con datos)', async () => {
  const auth = new AuthFalso();
  let cuerpo;
  auth.en('POST', /:batchUpdate$/, p => { cuerpo = json(p); return { data: { updatedSpreadsheet: { sheets: [{ properties: { sheetId: 0, title: 'OrdenesCompra', gridProperties: { rowCount: 2, columnCount: 4 } },
    data: [{ rowData: [{ values: [{ effectiveValue: { stringValue: 'folio' } }] }] }] }] } } }; });
  const g = crearConductorGoogle({}, { auth });
  const nuevo = await g.confirmar(libroBase(), [{ op: 'borrarFila', hoja: 0, r: 2 }]);
  assert.deepEqual(cuerpo.requests[0], { deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } });
  assert.deepEqual(cuerpo.responseRanges, ["'OrdenesCompra'!A1:D2"]);
  assert.deepEqual(nuevo.hojas[0].valores, [['folio']], 'lo que no vino de regreso quedó vacío');
});

caso('confirmar: 429 se reintenta; 500 no (pudo haberse aplicado) y lanza error', async () => {
  const auth = new AuthFalso();
  let n = 0;
  auth.en('POST', /:batchUpdate$/, () => (++n < 3 ? { status: 429, data: { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } } } : { data: { updatedSpreadsheet: { sheets: [] } } }));
  const g = crearConductorGoogle({ espera: async () => {} }, { auth });
  await g.confirmar(libroBase(), [{ op: 'valores', hoja: 0, r: 2, c: 4, celdas: [[{ v: 'x' }]] }]);
  assert.equal(n, 3);
  const auth2 = new AuthFalso();
  let m = 0;
  auth2.en('POST', /:batchUpdate$/, () => { m++; return { status: 500, data: { error: { message: 'Internal error', status: 'INTERNAL' } } }; });
  const g2 = crearConductorGoogle({ espera: async () => {} }, { auth: auth2 });
  await assert.rejects(g2.confirmar(libroBase(), [{ op: 'valores', hoja: 0, r: 2, c: 4, celdas: [[{ v: 'x' }]] }]), /Internal error/);
  assert.equal(m, 1, 'un 500 no se repite');
});

caso('espejo canónico + Google: si la batchUpdate falla, se relee el libro, nadie recibe la copia supuesta y el error dice qué pasó', async () => {
  const auth = new AuthFalso();
  let cargas = 0, fallar = true;
  auth.en('GET', /sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+$/, p => {
    if (!p.params.includeGridData) { cargas++; return { data: { spreadsheetId: ID, properties: { title: 'Compras', timeZone: 'America/Mexico_City' }, sheets: [{ properties: { sheetId: 0, title: 'Hoja', index: 0, gridProperties: { rowCount: 10, columnCount: 3 } } }] } }; }
    return { data: { spreadsheetId: ID, properties: { title: 'Compras', timeZone: 'America/Mexico_City' }, sheets: [{ properties: { sheetId: 0, title: 'Hoja', index: 0, gridProperties: { rowCount: 10, columnCount: 3 } },
      data: [{ rowData: [{ values: [{ effectiveValue: { stringValue: 'encabezado' } }] }] }] }] } };
  });
  auth.en('GET', /values:batchGet$/, () => ({ data: { valueRanges: [{ range: "'Hoja'!A1:A1", values: [['encabezado']] }] } }));
  auth.en('GET', /drive\/v3\/files\//, () => ({ data: { version: '9' } }));
  auth.en('POST', /:batchUpdate$/, () => (fallar ? { status: 503, data: { error: { message: 'The service is currently unavailable.', status: 'UNAVAILABLE' } } }
    : { data: { updatedSpreadsheet: { sheets: [{ properties: { sheetId: 0, title: 'Hoja', gridProperties: { rowCount: 10, columnCount: 3 } }, data: [{ startRow: 1, rowData: [{ values: [{ effectiveValue: { stringValue: 'fila' } }] }] }] }] } } }));
  const g = crearConductorGoogle({ espera: async () => {} }, { auth });
  const difundidos = [];
  const e = new EspejoCentral({ conductor: g, candado: new Candado(), difundir: (l, ex, olv) => difundidos.push({ l: l.map(x => x.id), olv }) });
  await e.abrir(ID);
  await assert.rejects(e.confirmar([{ id: ID, ops: [{ op: 'agregar', hoja: 0, celdas: [{ v: 'fila' }] }] }], { trabajador: 1, nombreDe: () => '"Compras"' }),
    err => /No se pudo guardar en Google Sheets \("Compras"\): UNAVAILABLE.*No se guardó nada/.test(err.message) && err.codigo === 'GUARDAR');
  assert.equal(cargas, 2, 'se volvió a leer de Google');
  assert.equal(M.ultimaFila(e.libros.get(ID).libro.hojas[0]), 1, 'la copia canónica no tiene la fila que no llegó');
  fallar = false;
  const r = await e.confirmar([{ id: ID, ops: [{ op: 'agregar', hoja: 0, celdas: [{ v: 'fila' }] }] }], { trabajador: 1 });
  assert.equal(r.libros[0].hojas[0].valores[1][0], 'fila');
  assert.deepEqual(difundidos[difundidos.length - 1].l, [ID], 'la copia nueva va a los demás trabajadores');
});

// ---------------------------------------------------------------- Drive
caso('drive: obtener, buscar por nombre (con comillas), crear carpeta, subir archivo (multipart), mover, personas y contenido', async () => {
  const auth = new AuthFalso();
  const archivo = (id, extra) => Object.assign({ id, name: 'x', mimeType: 'application/pdf', parents: ['P1'], trashed: false }, extra || {});
  auth.en('GET', /drive\/v3\/files\/NOEXISTE/, () => ({ status: 404, data: { error: { message: 'File not found: NOEXISTE.' } } }));
  auth.en('GET', /drive\/v3\/files\/A1$/, p => (p.params.alt === 'media' ? { data: new Uint8Array([37, 80, 68, 70]).buffer } : { data: archivo('A1', { name: 'OC-2026-0001 — Proveedor.pdf', parents: ['P1'] }) }));
  auth.en('GET', /drive\/v3\/files$/, p => ({ data: { files: [{ id: 'F9', name: p.params.q, mimeType: 'application/vnd.google-apps.folder', parents: ['P1'], trashed: true }] } }));
  auth.en('POST', /upload\/drive\/v3\/files/, p => ({ data: archivo('A2', { name: 'foto.jpg', mimeType: 'image/jpeg' }), cuerpo: p.cuerpo }));
  auth.en('POST', /drive\/v3\/files$/, p => ({ data: { id: 'F10', name: json(p).name, mimeType: 'application/vnd.google-apps.folder', parents: json(p).parents } }));
  auth.en('PATCH', /drive\/v3\/files\/A1$/, p => ({ data: archivo('A1', { parents: [p.params.addParents] }) }));
  auth.en('GET', /drive\/v3\/files\/F1\/permissions/, () => ({ data: { permissions: [{ type: 'user', role: 'owner', emailAddress: 'facilities@helgen.tech' },
    { type: 'user', role: 'writer', emailAddress: 'tania@helgen.tech' }, { type: 'user', role: 'reader', emailAddress: 'leo@helgen.tech' }, { type: 'domain', role: 'reader' }] } }));
  const d = crearConductorGoogle({}, { auth }).drive;
  await assert.rejects(d.obtener({ id: 'NOEXISTE' }), e => e.codigo === 404 && /No se encontró/.test(e.message));
  const m = await d.obtener({ id: 'A1' });
  assert.deepEqual([m.nombre, m.carpeta, m.padres, m.papelera], ['OC-2026-0001 — Proveedor.pdf', false, ['P1'], false]);
  const hijos = await d.hijos({ padre: 'P1', nombre: "Proyectos d'Ana", carpetas: true });
  assert.equal(auth.peticiones[auth.peticiones.length - 1].params.q,
    "'P1' in parents and mimeType = 'application/vnd.google-apps.folder' and name = 'Proyectos d\\'Ana'", 'nombre escapado');
  assert.equal(hijos[0].papelera, true, 'incluye los de la Papelera (Code.js los filtra)');
  const c = await d.crearCarpeta({ padre: 'P1', nombre: '2026' });
  assert.deepEqual([c.id, c.carpeta, c.padres], ['F10', true, ['P1']]);
  const bytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
  const a = await d.crearArchivo({ padre: 'F10', nombre: 'foto.jpg', mime: 'image/jpeg', datos: bytes });
  assert.equal(a.id, 'A2');
  const subida = auth.peticiones.find(p => /upload/.test(p.url));
  assert.equal(subida.params.uploadType, 'multipart');
  assert(subida.cuerpo.includes(bytes), 'los bytes van en la parte multimedia');
  assert(subida.cuerpo.toString('latin1').includes('"name":"foto.jpg"') && subida.cuerpo.toString('latin1').includes('"parents":["F10"]'));
  auth.en('GET', /drive\/v3\/files\/A1$/, () => ({ data: { parents: ['P1'] } }));
  const mov = await d.mover({ id: 'A1', destino: 'F10' });
  const patch = auth.peticiones.find(p => p.metodo === 'PATCH');
  assert.deepEqual([patch.params.addParents, patch.params.removeParents], ['F10', 'P1']);
  assert.deepEqual(mov.padres, ['F10']);
  const per = await d.personas({ id: 'F1' });
  assert.deepEqual(per, { editores: ['tania@helgen.tech'], lectores: ['leo@helgen.tech'], dueno: 'facilities@helgen.tech' });
  auth.rutas = auth.rutas.filter(r => !String(r.re).includes('A1$') || r.metodo !== 'GET');
  auth.en('GET', /drive\/v3\/files\/A1$/, p => (p.params.alt === 'media' ? { data: new Uint8Array([37, 80, 68, 70]).buffer } : { data: { name: 'c.pdf', mimeType: 'application/pdf' } }));
  const cont = await d.contenido({ id: 'A1' });
  assert.equal(cont.datos.toString('latin1'), '%PDF');
});

caso('privado_: GET y DELETE de permisos de Drive con la credencial del servidor (el token marcador nunca sale)', async () => {
  const auth = new AuthFalso();
  auth.en('GET', /permissions/, () => ({ data: { permissions: [{ id: 'own', type: 'user' }, { id: 'dom', type: 'domain' }] } }));
  auth.en('DELETE', /permissions\/dom/, () => ({ status: 204, data: '' }));
  const g = crearConductorGoogle({}, { auth });
  const url = 'https://www.googleapis.com/drive/v3/files/F1/permissions';
  const r = await g.fetchGoogle({ url: url + '?supportsAllDrives=true&fields=permissions(id,type)', metodo: 'GET', cabeceras: { Authorization: 'Bearer token-del-servidor-capri' } });
  assert.equal(r.codigo, 200);
  assert.deepEqual(JSON.parse(r.cuerpo.toString()).permissions.map(p => p.type), ['user', 'domain']);
  const d = await g.fetchGoogle({ url: url + '/dom?supportsAllDrives=true', metodo: 'DELETE', cabeceras: { Authorization: 'Bearer token-del-servidor-capri' } });
  assert.equal(d.codigo, 204);
  auth.peticiones.forEach(p => assert(!String(p.headers && p.headers.get ? p.headers.get('authorization') : '').includes('token-del-servidor'), 'no se manda el marcador'));
});

// ---------------------------------------------------------------- Gmail
caso('gmail: MIME con UTF-8 en asunto y nombre, Reply-To, texto + HTML; se manda como facilities@', async () => {
  const mime = armarMime({ para: 'tania@helgen.tech, leo@helgen.tech', asunto: '[CAPRI] Requisición REQ-2026-0005 autorizada', texto: 'Hola, ñandú', html: '<p>Hola, ñandú</p>',
    nombre: 'CAPRI Helgen', responderA: 'efrain@helgen.tech\r\nBcc: intruso@x.com' }, 'facilities@helgen.tech');
  assert(/^From: CAPRI Helgen <facilities@helgen\.tech>\r\nTo: tania@helgen\.tech, leo@helgen\.tech\r\n/.test(mime));
  assert(mime.includes('Reply-To: efrain@helgen.tech Bcc: intruso@x.com'), 'sin saltos de línea: no se pueden inyectar encabezados');
  assert(!/\r\nBcc:/.test(mime));
  assert(mime.includes('Subject: =?UTF-8?B?' + Buffer.from('[CAPRI] Requisición REQ-2026-0005 autorizada').toString('base64') + '?='));
  assert(/multipart\/alternative/.test(mime) && mime.includes(Buffer.from('<p>Hola, ñandú</p>').toString('base64')));
  const auth = new AuthFalso();
  let raw;
  auth.en('POST', /gmail\/v1\/users\/me\/messages\/send/, p => { raw = json(p).raw; return { data: { id: 'm1' } }; });
  const g = crearConductorGoogle({ remitente: 'facilities@helgen.tech' }, { auth });
  await g.enviarCorreo({ para: 'ana@helgen.tech', asunto: 'Prueba', texto: 'x', html: null, nombre: 'CAPRI Helgen' });
  assert(Buffer.from(raw, 'base64url').toString().startsWith('From: CAPRI Helgen <facilities@helgen.tech>\r\nTo: ana@helgen.tech'));
});

(async () => {
  let fallas = 0;
  for (const [n, f] of casos) {
    try { await f(); console.log('✔ ' + n); } catch (e) { fallas++; console.log('✘ ' + n + '\n   ' + (e && e.stack || e).split('\n').slice(0, 6).join('\n   ')); }
  }
  if (fallas) { console.log(fallas + ' prueba(s) fallaron'); process.exit(1); }
})();
