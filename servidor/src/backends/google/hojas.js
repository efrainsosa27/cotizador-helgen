// Google Sheets ↔ espejo.
//  cargar: (1) propiedades y pestañas, (2) values.batchGet para saber hasta dónde hay datos en cada pestaña, (3)
//          spreadsheets.get con includeGridData SOLO de esa zona + una fila (valor efectivo, visible, fórmula y formato de
//          número): un número con formato de fecha/hora se vuelve Date (lo que da getValues en Apps Script). Pedir la
//          cuadrícula completa traería las 1000 filas vacías con formato de texto de cada pestaña (megas por libro).
//  confirmar: el diario de un libro se traduce a UNA spreadsheets.batchUpdate (atómica: todo o nada) que además regresa
//          las filas tocadas tal como quedaron (includeSpreadsheetInResponse + responseRanges). Esa lectura de regreso
//          reemplaza lo que el trabajador supuso (fechas, fórmulas, texto visible): el espejo queda igual a Sheets.
'use strict';
const M = require('../../espejo/modelo');

const CAMPOS_CELDA = 'values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat/numberFormat)';
const CAMPOS_HOJA = 'properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount)),data(startRow,startColumn,rowData(' + CAMPOS_CELDA + '))';
const CAMPOS_LIBRO = 'spreadsheetId,properties(title,timeZone,locale),namedRanges(namedRangeId,name,range),sheets(' + CAMPOS_HOJA + ')';
const CAMPOS_META = 'spreadsheetId,properties(title,timeZone,locale),namedRanges(namedRangeId,name,range),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount,frozenRowCount)))';
const TIPOS_FECHA = { DATE: 1, TIME: 1, DATE_TIME: 1 };
const PATRON_FECHA_HORA = 'yyyy-mm-dd hh:mm:ss';

// ---------------- Lectura (API → modelo) ----------------
function valorDeCelda(c, zona) {
  if (!c) return { v: '' };
  const ev = c.effectiveValue;
  const nf = c.effectiveFormat && c.effectiveFormat.numberFormat;
  const out = {};
  if (c.userEnteredValue && c.userEnteredValue.formulaValue) out.f = c.userEnteredValue.formulaValue;
  if (!ev) out.v = '';
  else if (ev.numberValue !== undefined) out.v = nf && TIPOS_FECHA[nf.type] ? M.fechaDesdeSerial(ev.numberValue, zona) : ev.numberValue;
  else if (ev.stringValue !== undefined) out.v = ev.stringValue;
  else if (ev.boolValue !== undefined) out.v = ev.boolValue;
  else if (ev.errorValue) out.v = c.formattedValue || '#ERROR!';
  else out.v = '';
  if (nf && TIPOS_FECHA[nf.type]) out.nf = { tipo: nf.type, patron: nf.pattern || '' }; // solo importa si ya es fecha
  if (nf && nf.type === 'TEXT') out.texto = true; // texto plano ("@"): decide cómo se interpreta lo que se escriba ahí
  if (c.formattedValue !== undefined && c.formattedValue !== M.textoVisible(out.v)) out.d = c.formattedValue;
  return out;
}

function hojaDesdeApi(s, zona) {
  const p = s.properties || {}, g = p.gridProperties || {};
  const h = M.nuevaHoja({ id: p.sheetId, titulo: p.title, indice: p.index || 0, filasMax: g.rowCount || 0, columnasMax: g.columnCount || 0,
    congeladas: g.frozenRowCount || 0 });
  (s.data || []).forEach(bloque => {
    const r0 = bloque.startRow || 0, c0 = bloque.startColumn || 0;
    h.cargadas = Math.max(h.cargadas, r0 + (bloque.rowData || []).length);
    (bloque.rowData || []).forEach((fila, i) => {
      const valores = [];
      (fila.values || []).forEach((celda, j) => {
        const x = valorDeCelda(celda, zona), k = M.clave(r0 + i, c0 + j);
        valores[c0 + j] = x.v;
        if (x.f) h.formulas[k] = x.f;
        if (x.nf) h.formatos[k] = x.nf;
        if (x.d !== undefined) h.mostrar[k] = x.d;
        if (x.texto) M.marcarTexto(h, r0 + i, c0 + j, true);
      });
      for (let j = 0; j < valores.length; j++) if (valores[j] === undefined) valores[j] = '';
      while (valores.length && valores[valores.length - 1] === '') valores.pop();
      h.valores[r0 + i] = valores;
    });
  });
  for (let i = 0; i < h.valores.length; i++) if (!h.valores[i]) h.valores[i] = [];
  while (h.valores.length && !h.valores[h.valores.length - 1].length) h.valores.pop();
  return h;
}

function rangoDesdeApi(r) {
  return { r: (r.startRowIndex || 0) + 1, c: (r.startColumnIndex || 0) + 1,
    nr: (r.endRowIndex || 0) - (r.startRowIndex || 0), nc: (r.endColumnIndex || 0) - (r.startColumnIndex || 0) };
}

function libroDesdeApi(d, version) {
  const zona = (d.properties && d.properties.timeZone) || 'America/Mexico_City';
  const libro = M.nuevoLibro({ id: d.spreadsheetId, titulo: d.properties && d.properties.title, zona,
    locale: (d.properties && d.properties.locale) || undefined, version: String(version || '0') });
  libro.hojas = (d.sheets || []).map(s => hojaDesdeApi(s, zona)).sort((a, b) => a.indice - b.indice);
  (d.namedRanges || []).forEach(n => { libro.nombrados[n.name] = { id: n.namedRangeId, hoja: n.range.sheetId || 0, rango: rangoDesdeApi(n.range) }; });
  return libro;
}

// ---------------- Escritura (diario → peticiones de batchUpdate) ----------------
function colorApi(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 };
}

/** GridRange de la API desde las coordenadas del diario (1-based; "columnas" = columna completa). */
function rangoApi(hojaId, x) {
  const r = { sheetId: hojaId, startColumnIndex: x.c - 1, endColumnIndex: x.c - 1 + x.nc };
  if (!x.columnas) { r.startRowIndex = x.r - 1; if (!x.abierto) r.endRowIndex = x.r - 1 + x.nr; }
  return r;
}

const TIPO_API = { TEXT: 'TEXT', NUMBER: 'NUMBER', CURRENCY: 'CURRENCY', PERCENT: 'PERCENT', DATE: 'DATE', TIME: 'TIME', DATE_TIME: 'DATE_TIME' };

/**
 * CellData de una celda del diario, ya tipada como la guardaría Sheets con entrada USER_ENTERED (espejo/entrada.js), y el
 * formato que Sheets le pondría: una fecha en una celda sin formato de fecha (también en texto plano: así la lee
 * getValues como Date) y un número escrito con "%", "$", miles o exponente en una celda con formato automático.
 */
function celdaApi(celda, zona, formatoActual) {
  if (celda.f) return { cd: { userEnteredValue: { formulaValue: celda.f } } };
  const v = celda.v;
  if (v === '' || v === null || v === undefined) return { cd: {} };
  if (v instanceof Date) {
    const cd = { userEnteredValue: { numberValue: M.serialDesdeFecha(v, zona) } };
    const yaEsFecha = formatoActual && TIPOS_FECHA[formatoActual.tipo];
    const patron = celda.p || PATRON_FECHA_HORA;
    return { cd, formato: yaEsFecha ? null : { type: TIPOS_FECHA[celda.t] ? celda.t : (TIPOS_FECHA[M.tipoDePatron(patron)] ? M.tipoDePatron(patron) : 'DATE_TIME'), pattern: patron } };
  }
  if (typeof v === 'number' && isFinite(v)) {
    const cd = { userEnteredValue: { numberValue: v } };
    // El formato se manda si la celda no tenía ninguno o si tenía uno de fecha u hora: un número escrito como texto en
    // una celda de fecha la regresa a formato automático (medido con Apps Script real, caso 49 de casos-escritura.js)
    const reemplaza = !formatoActual || TIPOS_FECHA[formatoActual.tipo];
    return celda.t && celda.p && reemplaza ? { cd, formato: { type: celda.t, pattern: celda.p } } : { cd };
  }
  if (typeof v === 'boolean') return { cd: { userEnteredValue: { boolValue: v } } };
  return { cd: { userEnteredValue: { stringValue: String(v) } } };
}

/**
 * Traduce el diario a peticiones, aplicándolo al mismo tiempo a una copia del libro (para saber en qué fila cae cada
 * appendRow y cuándo hay que agregar filas o columnas a la cuadrícula). Devuelve {requests, tocadas, copia}.
 */
function peticionesDeDiario(libro, ops) {
  const copia = structuredClone(libro);
  const requests = [], cambios = new Map(); // hojaId → {completa, filas: Set}
  const tocar = (hojaId, filas, completa) => {
    if (!cambios.has(hojaId)) cambios.set(hojaId, { completa: false, filas: new Set() });
    const x = cambios.get(hojaId);
    if (completa) x.completa = true;
    (filas || []).forEach(f => x.filas.add(f));
  };
  // Una protección encadenada (protect().setDescription().setWarningOnly()) se manda una vez, con su último estado
  const ultimaProteccion = new Map();
  ops.forEach((op, i) => { if (op.op === 'proteger') ultimaProteccion.set(op.id, i); });

  const asegurarCuadricula = (h, filas, columnas) => {
    if (filas > h.filasMax) {
      requests.push({ appendDimension: { sheetId: h.id, dimension: 'ROWS', length: filas - h.filasMax } });
      h.filasMax = filas;
    }
    if (columnas > h.columnasMax) {
      requests.push({ appendDimension: { sheetId: h.id, dimension: 'COLUMNS', length: columnas - h.columnasMax } });
      h.columnasMax = columnas;
    }
  };
  const escribirCeldas = (h, r, c, celdas) => {
    const ancho = celdas.reduce((m, f) => Math.max(m, f.length), 0);
    asegurarCuadricula(h, r - 1 + celdas.length, c - 1 + ancho);
    const formatos = [];
    const rows = celdas.map((fila, i) => ({ values: fila.map((celda, j) => {
      const x = celdaApi(celda, copia.zona, M.formatoDe(h, r - 1 + i, c - 1 + j));
      if (x.formato) formatos.push({ fila: r - 1 + i, col: c - 1 + j, formato: x.formato });
      return x.cd;
    }) }));
    requests.push({ updateCells: { start: { sheetId: h.id, rowIndex: r - 1, columnIndex: c - 1 }, rows, fields: 'userEnteredValue' } });
    formatos.forEach(f => requests.push({ repeatCell: {
      range: { sheetId: h.id, startRowIndex: f.fila, endRowIndex: f.fila + 1, startColumnIndex: f.col, endColumnIndex: f.col + 1 },
      cell: { userEnteredFormat: { numberFormat: f.formato } }, fields: 'userEnteredFormat.numberFormat' } }));
  };

  ops.forEach((op, i) => {
    const h = op.hoja != null && copia.hojas.find(x => x.id === op.hoja);
    if (op.hoja != null && op.op !== 'nuevaHoja' && !h) throw new Error('El diario usa una hoja que no existe (' + op.hoja + ').');
    switch (op.op) {
      case 'valores':
        escribirCeldas(h, op.r, op.c, op.celdas);
        tocar(h.id, op.celdas.map((_, k) => op.r + k));
        break;
      case 'agregar': {
        const r = M.ultimaFila(h) + 1;
        escribirCeldas(h, r, 1, [op.celdas]);
        tocar(h.id, [r]);
        break;
      }
      case 'borrarFila':
        requests.push({ deleteDimension: { range: { sheetId: h.id, dimension: 'ROWS', startIndex: op.r - 1, endIndex: op.r - 1 + (op.n || 1) } } });
        tocar(h.id, null, true);
        break;
      case 'insertarFilas':
        requests.push({ insertDimension: { range: { sheetId: h.id, dimension: 'ROWS', startIndex: op.despues, endIndex: op.despues + op.n },
          inheritFromBefore: op.despues > 0 } });
        tocar(h.id, null, true);
        break;
      case 'nuevaHoja':
        requests.push({ addSheet: { properties: Object.assign({ sheetId: op.id, title: op.titulo }, op.indice != null ? { index: op.indice } : {}) } });
        tocar(op.id, null, true);
        break;
      case 'renombrarHoja':
        requests.push({ updateSheetProperties: { properties: { sheetId: h.id, title: op.titulo }, fields: 'title' } });
        // Sheets ajusta referencias a la pestaña renombrada: releer también las fórmulas dependientes.
        copia.hojas.forEach(x => tocar(x.id, null, true));
        break;
      case 'borrarHoja': requests.push({ deleteSheet: { sheetId: op.hoja } }); cambios.delete(op.hoja); break;
      case 'formatoNumero': {
        asegurarCuadricula(h, op.rango.columnas || op.rango.abierto ? 0 : op.rango.r - 1 + op.rango.nr, op.rango.c - 1 + op.rango.nc);
        const tipo = M.tipoDePatron(op.patron);
        requests.push({ repeatCell: { range: rangoApi(h.id, op.rango),
          cell: { userEnteredFormat: { numberFormat: tipo === 'TEXT' ? { type: 'TEXT' } : { type: TIPO_API[tipo] || 'NUMBER', pattern: op.patron } } },
          fields: 'userEnteredFormat.numberFormat' } });
        break;
      }
      case 'estilo': {
        asegurarCuadricula(h, op.rango.columnas || op.rango.abierto ? 0 : op.rango.r - 1 + op.rango.nr, op.rango.c - 1 + op.rango.nc);
        const f = {}, campos = [];
        if (op.negrita !== undefined) { f.textFormat = Object.assign(f.textFormat || {}, { bold: !!op.negrita }); campos.push('userEnteredFormat.textFormat.bold'); }
        if (op.color !== undefined && colorApi(op.color)) { f.textFormat = Object.assign(f.textFormat || {}, { foregroundColor: colorApi(op.color) }); campos.push('userEnteredFormat.textFormat.foregroundColor'); }
        if (op.fondo !== undefined && colorApi(op.fondo)) { f.backgroundColor = colorApi(op.fondo); campos.push('userEnteredFormat.backgroundColor'); }
        if (op.alineacion !== undefined) { f.horizontalAlignment = String(op.alineacion).toUpperCase(); campos.push('userEnteredFormat.horizontalAlignment'); }
        if (op.ajuste !== undefined) { f.wrapStrategy = op.ajuste ? 'WRAP' : 'OVERFLOW_CELL'; campos.push('userEnteredFormat.wrapStrategy'); }
        if (campos.length) requests.push({ repeatCell: { range: rangoApi(h.id, op.rango), cell: { userEnteredFormat: f }, fields: campos.join(',') } });
        break;
      }
      case 'anchoColumna':
        asegurarCuadricula(h, 0, op.c);
        requests.push({ updateDimensionProperties: { range: { sheetId: h.id, dimension: 'COLUMNS', startIndex: op.c - 1, endIndex: op.c },
          properties: { pixelSize: op.px }, fields: 'pixelSize' } });
        break;
      case 'congelar':
        requests.push({ updateSheetProperties: { properties: { sheetId: h.id, gridProperties: { frozenRowCount: op.filas } }, fields: 'gridProperties.frozenRowCount' } });
        break;
      case 'validacion': {
        const rango = rangoApi(h.id, op.rango);
        if (!op.regla || !op.regla.condicion) { requests.push({ setDataValidation: { range: rango } }); break; }
        const c = op.regla.condicion;
        requests.push({ setDataValidation: { range: rango, rule: {
          condition: { type: c.tipo, values: c.valores.map(v => ({ userEnteredValue: v })) },
          strict: !op.regla.permitirInvalidos, showCustomUi: c.tipo === 'ONE_OF_LIST' ? c.lista !== false : undefined,
          inputMessage: op.regla.ayuda || undefined } } });
        break;
      }
      case 'proteger':
        if (ultimaProteccion.get(op.id) !== i) break;
        requests.push({ addProtectedRange: { protectedRange: { range: rangoApi(h.id, op.rango), description: op.descripcion || '', warningOnly: !!op.soloAviso } } });
        break;
      case 'nombrarRango': {
        const previo = copia.nombrados[op.nombre];
        const rango = rangoApi(op.hoja, op.rango);
        if (previo && previo.id) requests.push({ updateNamedRange: { namedRange: { namedRangeId: previo.id, name: op.nombre, range: rango }, fields: 'range' } });
        else requests.push({ addNamedRange: { namedRange: { name: op.nombre, range: rango } } });
        break;
      }
      case 'propiedadesLibro': {
        const pr = {}, campos = [];
        if (op.locale) { pr.locale = op.locale; campos.push('locale'); }
        if (op.zona) { pr.timeZone = op.zona; campos.push('timeZone'); }
        if (campos.length) requests.push({ updateSpreadsheetProperties: { properties: pr, fields: campos.join(',') } });
        break;
      }
      case 'recalculo':
        requests.push({ updateSpreadsheetProperties: { properties: { autoRecalc: op.intervalo }, fields: 'autoRecalc' } });
        break;
      default: throw new Error('Operación desconocida en el diario: ' + op.op);
    }
    M.aplicar(copia, op);
  });
  return { requests, cambios, copia };
}

const rangoHoja = titulo => "'" + String(titulo).replace(/'/g, "''") + "'";
const a1 = (titulo, r0, r1, nc) => rangoHoja(titulo) + '!A' + r0 + ':' + M.numeroAColumna(Math.max(1, nc)) + r1;

/** Rango "'Hoja'!A1:AN57" → {r1, c1} (fin, 1-based). */
function finDeRango(rango) {
  const m = String(rango || '').match(/!([A-Z]+)?(\d+)?(?::([A-Z]+)(\d+))?$/);
  if (!m) return { r: 0, c: 0 };
  return { r: Number(m[4] || m[2] || 0), c: M.columnaANumero(m[3] || m[1] || 'A') };
}

/**
 * Filas a releer después de confirmar: por hoja, las filas escritas (agrupadas en tramos) o la hoja entera (hasta la
 * última fila con datos) si cambió su estructura (filas borradas o insertadas, hoja nueva).
 */
function tramosDeRegreso(copia, cambios) {
  const pedidos = [];
  cambios.forEach((x, hojaId) => {
    const h = copia.hojas.find(y => y.id === hojaId);
    if (!h) return;
    const nc = Math.max(M.ultimaColumna(h), 1);
    if (x.completa) { pedidos.push({ hoja: hojaId, r0: 1, r1: Math.max(M.ultimaFila(h), 1) + 1, nc, completa: true, titulo: h.titulo }); return; }
    const filas = [...x.filas].sort((a, b) => a - b);
    let ini = null, ant = null;
    filas.forEach(f => {
      if (ini === null) { ini = f; ant = f; return; }
      if (f === ant + 1) { ant = f; return; }
      pedidos.push({ hoja: hojaId, r0: ini, r1: ant, nc, titulo: h.titulo });
      ini = f; ant = f;
    });
    if (ini !== null) pedidos.push({ hoja: hojaId, r0: ini, r1: ant, nc, titulo: h.titulo });
  });
  return pedidos;
}

/** Reemplaza en la hoja las filas r0..r1 (1-based) con lo que mandó Sheets (lo que no vino, quedó vacío). */
function ponerFilas(h, bloque, r0, r1, zona, completa) {
  const leida = hojaDesdeApi({ properties: { sheetId: h.id, title: h.titulo }, data: [bloque] }, zona);
  const quitar = (mapa, i) => Object.keys(mapa).forEach(k => { if (Number(k.slice(0, k.indexOf(','))) === i) delete mapa[k]; });
  const columnas = new Set(Object.keys(h.texto || {}).concat(Object.keys(leida.texto || {})).map(Number));
  for (let i = r0 - 1; i < r1; i++) {
    ['formulas', 'formatos', 'mostrar'].forEach(n => { quitar(h[n], i); });
    h.valores[i] = (leida.valores[i] || []).slice();
    ['formulas', 'formatos', 'mostrar'].forEach(n => Object.keys(leida[n]).forEach(k => {
      if (Number(k.slice(0, k.indexOf(','))) === i) h[n][k] = leida[n][k];
    }));
    columnas.forEach(j => M.marcarTexto(h, i, j, M.enTexto(leida, i, j)));
  }
  if (completa) {
    // Lo de más abajo no vino: vale el formato de la última fila leída (la "+1")
    Object.keys(h.texto || {}).forEach(j => { h.texto[j] = h.texto[j].filter(t => t[0] < r1).map(t => [t[0], Math.min(t[1], r1 - 1)]); if (!h.texto[j].length) delete h.texto[j]; });
    h.cargadas = r1;
  } else h.cargadas = Math.max(h.cargadas || 0, r1);
  if (completa) h.valores.length = Math.min(h.valores.length, r1);
  for (let i = 0; i < h.valores.length; i++) if (!h.valores[i]) h.valores[i] = [];
  while (h.valores.length && !h.valores[h.valores.length - 1].some(v => !M.vacio(v)) &&
    !Object.keys(h.formulas).some(k => Number(k.slice(0, k.indexOf(','))) === h.valores.length - 1)) h.valores.pop();
}

/** Une la lectura de regreso a la copia (los tramos pedidos, en el orden en que se pidieron). */
function unirRegreso(copia, actualizado, pedidos) {
  if (!actualizado) return copia;
  const zona = (actualizado.properties && actualizado.properties.timeZone) || copia.zona;
  (actualizado.sheets || []).forEach(s => {
    const id = s.properties.sheetId || 0;
    const h = copia.hojas.find(x => x.id === id);
    if (!h) return;
    const g = s.properties.gridProperties || {};
    if (g.rowCount) h.filasMax = g.rowCount;
    if (g.columnCount) h.columnasMax = g.columnCount;
    const mios = pedidos.filter(p => p.hoja === id);
    (s.data || []).forEach((bloque, k) => {
      const p = mios.find(x => x.r0 - 1 === (bloque.startRow || 0)) || mios[k];
      if (p) ponerFilas(h, bloque, p.r0, p.r1, zona, p.completa);
    });
  });
  if (actualizado.namedRanges) {
    copia.nombrados = {};
    actualizado.namedRanges.forEach(n => { copia.nombrados[n.name] = { id: n.namedRangeId, hoja: n.range.sheetId || 0, rango: rangoDesdeApi(n.range) }; });
  }
  return copia;
}

/**
 * @param {object} api  {sheets: cliente de @googleapis/sheets, drive: cliente de @googleapis/drive}
 */
function crearHojasGoogle(api, o) {
  const op = o || {};
  const reintentos = op.reintentos == null ? 3 : op.reintentos;
  const espera = op.espera || (ms => new Promise(r => setTimeout(r, ms)));
  const metricas = { cargas: 0, confirmaciones: 0, peticiones: 0, reintentos: 0 };

  async function versionLibro(id) {
    const r = await api.drive.files.get({ fileId: id, fields: 'version,modifiedTime', supportsAllDrives: true });
    return String(r.data.version);
  }

  async function cargarLibro(id) {
    metricas.cargas++;
    // (1) pestañas y versión
    const [meta, version] = await Promise.all([
      api.sheets.spreadsheets.get({ spreadsheetId: id, fields: CAMPOS_META }),
      versionLibro(id),
    ]);
    const pestanas = meta.data.sheets || [];
    if (!pestanas.length) return libroDesdeApi(meta.data, version);
    // (2) hasta dónde hay datos en cada pestaña
    const usados = await api.sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: pestanas.map(x => rangoHoja(x.properties.title)),
      valueRenderOption: 'FORMULA', majorDimension: 'ROWS', fields: 'valueRanges(range,values)' });
    // Ojo: "range" de la respuesta repite la cuadrícula completa (A1:Z1000); lo que tiene datos es lo que trae "values"
    const rangos = (usados.data.valueRanges || []).map((vr, k) => {
      const t = pestanas[k].properties.title;
      const filas = (vr.values || []).length;
      const cols = (vr.values || []).reduce((m, f) => Math.max(m, f.length), 0);
      return a1(t, 1, Math.max(filas, 1) + 1, Math.max(cols, 1));
    });
    // (3) la cuadrícula de esa zona (+1 fila: el formato con el que nacerá la siguiente fila agregada)
    const r = await api.sheets.spreadsheets.get({ spreadsheetId: id, ranges: rangos, includeGridData: true, fields: CAMPOS_LIBRO });
    return libroDesdeApi(r.data, version);
  }

  async function crearLibro(nombre) {
    const r = await api.sheets.spreadsheets.create({ requestBody: { properties: { title: nombre } }, fields: CAMPOS_LIBRO });
    const version = await versionLibro(r.data.spreadsheetId).catch(() => '1');
    return libroDesdeApi(r.data, version);
  }

  async function confirmar(libro, ops) {
    const { requests, cambios, copia } = peticionesDeDiario(libro, ops);
    if (!requests.length) return copia;
    const pedidos = tramosDeRegreso(copia, cambios);
    const peticion = { spreadsheetId: libro.id,
      fields: 'updatedSpreadsheet(properties(title,timeZone),namedRanges(namedRangeId,name,range),sheets(' + CAMPOS_HOJA + '))',
      requestBody: { requests, includeSpreadsheetInResponse: true, responseIncludeGridData: pedidos.length > 0,
        responseRanges: pedidos.map(p => a1(p.titulo, p.r0, p.r1, p.nc)) } };
    let intento = 0;
    for (;;) {
      try {
        metricas.peticiones++;
        const r = await api.sheets.spreadsheets.batchUpdate(peticion);
        metricas.confirmaciones++;
        return unirRegreso(copia, r.data && r.data.updatedSpreadsheet, pedidos);
      } catch (e) {
        // Solo 429 (cuota): Google no la procesó. Un 5xx o un corte pudo haberse aplicado: no se repite a ciegas
        const codigo = e && (e.status || (e.response && e.response.status) || e.code);
        if (Number(codigo) === 429 && intento < reintentos) { intento++; metricas.reintentos++; await espera(1000 * Math.pow(2, intento - 1) + Math.random() * 250); continue; }
        throw e;
      }
    }
  }

  return { cargarLibro, crearLibro, confirmar, versionLibro, metricas };
}

module.exports = { crearHojasGoogle, libroDesdeApi, hojaDesdeApi, peticionesDeDiario, unirRegreso, tramosDeRegreso, celdaApi, finDeRango,
  CAMPOS_LIBRO, CAMPOS_HOJA, CAMPOS_META };
