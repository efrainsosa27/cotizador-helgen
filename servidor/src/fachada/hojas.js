// SpreadsheetApp para Code.js, sobre el espejo local del trabajador. Leer nunca sale del proceso; escribir cambia el
// espejo local al instante (el código lee lo que acaba de escribir, como en Apps Script) y anota la operación en el
// diario de la transacción. El diario se confirma en Google Sheets al soltar el candado (o al terminar la petición), en
// una sola llamada por libro (fachada/transaccion.js). SpreadsheetApp.flush() no hace nada: confirmar al soltar el
// candado da la misma garantía (nadie más ve el cambio antes) con menos viajes.
'use strict';
const M = require('../espejo/modelo');

// Sheets no acepta más de 50 000 caracteres en una celda; Apps Script lanza este error y no escribe nada
const MAX_CARACTERES_CELDA = 50000;
const ERROR_CELDA_LARGA = 'Your input contains more than the maximum of 50000 characters in a single cell.';

function crearSpreadsheetApp(amb) {
  /** Libro del espejo local; si este trabajador no lo tiene, lo pide al principal (lo carga de Google si hace falta). */
  function libroDe(id) {
    let l = amb.espejo.get(id);
    if (!l) {
      amb.aplicarLibro(amb.rpc('hojas.abrir', { id: id }));
      l = amb.espejo.get(id);
    }
    return l;
  }
  const escribir = (libroId, op) => amb.escribirHoja(libroId, op);
  /**
   * Celda del diario para lo que Code.js escribe en la celda (i, j) 0-based: como la guarda Sheets con entrada
   * USER_ENTERED (espejo/entrada.js), según el locale del libro y el formato vigente de esa celda. {v} · {v, f} (fórmula) ·
   * {v, p, t} (número o fecha con el formato que Sheets le pondría si la celda no tiene uno).
   */
  const formatosAnio = new Map();
  const anio = zona => {
    let f = formatosAnio.get(zona);
    if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric' }); formatosAnio.set(zona, f); }
    return Number(f.format(new Date()));
  };
  const celdaDe = (libro, h, i, j, v) => {
    if (typeof v === 'string' && v.length > MAX_CARACTERES_CELDA) throw new Error(ERROR_CELDA_LARGA);
    const x = M.interpretar(v, Object.assign(M.contextoCelda(libro, h, i, j), { anioActual: anio(libro.zona) }));
    if (x.formula) return { v: '', f: x.formula };
    if (x.patron) return { v: x.valor, p: x.patron, t: x.tipo };
    return { v: x.valor };
  };

  class Proteccion {
    constructor(rango) { this.rango = rango; this.d = { descripcion: '', soloAviso: false }; }
    setDescription(t) { this.d.descripcion = String(t); this.anotar(); return this; }
    setWarningOnly(b) { this.d.soloAviso = !!b; this.anotar(); return this; }
    getDescription() { return this.d.descripcion; }
    isWarningOnly() { return this.d.soloAviso; }
    anotar() {
      // Una sola protección por rango: la última versión de la descripción y el aviso es la que se manda
      const r = this.rango;
      escribir(r.libroId, { op: 'proteger', hoja: r.hojaId, rango: r.coords(), descripcion: this.d.descripcion, soloAviso: this.d.soloAviso, id: this.idOp });
    }
  }

  class BuscadorTexto {
    constructor(rango, texto) { this.rango = rango; this.texto = String(texto); this.entera = false; this.mayus = false; this.pos = -1; }
    matchEntireCell(b) { this.entera = !!b; return this; }
    matchCase(b) { this.mayus = !!b; return this; }
    useRegularExpression() { throw new Error('createTextFinder con expresiones regulares no está disponible en el servidor.'); }
    coincidencias() {
      const r = this.rango, vis = r.getDisplayValues(), out = [];
      const norm = s => (this.mayus ? s : s.toLowerCase());
      const t = norm(this.texto);
      vis.forEach((fila, i) => fila.forEach((s, j) => {
        const x = norm(String(s));
        if (this.entera ? x === t : (t !== '' && x.indexOf(t) !== -1)) out.push([r.r + i, r.c + j]);
      }));
      return out;
    }
    findNext() {
      const todas = this.coincidencias();
      this.pos++;
      if (this.pos >= todas.length) return null;
      const [f, c] = todas[this.pos];
      return new Rango(this.rango.libroId, this.rango.hojaId, f, c, 1, 1);
    }
    findAll() { return this.coincidencias().map(([f, c]) => new Rango(this.rango.libroId, this.rango.hojaId, f, c, 1, 1)); }
  }

  class Rango {
    /** abierta: {columnas: columna completa desde la fila 1 ("B:B"), abierto: hasta el final de la hoja ("A2:A")} */
    constructor(libroId, hojaId, r, c, nr, nc, abierta) {
      if (!(r >= 1) || !(c >= 1)) throw new Error('Las coordenadas del rango no son válidas (' + r + ', ' + c + ').');
      if (!(nr >= 1)) throw new Error('The number of rows in the range must be at least 1.');
      if (!(nc >= 1)) throw new Error('The number of columns in the range must be at least 1.');
      const a = abierta || {};
      Object.assign(this, { libroId, hojaId, r, c, nr, nc, columnas: !!a.columnas, abierto: !!(a.abierto || a.columnas) });
    }
    get h() { return M.hojaPorId(libroDe(this.libroId), this.hojaId); }
    coords() { return { r: this.r, c: this.c, nr: this.nr, nc: this.nc, columnas: this.columnas, abierto: this.abierto }; }
    getRow() { return this.r; }
    getColumn() { return this.c; }
    getLastRow() { return this.r + this.nr - 1; }
    getLastColumn() { return this.c + this.nc - 1; }
    getNumRows() { return this.nr; }
    getNumColumns() { return this.nc; }
    getSheet() { return new Hoja(this.libroId, this.hojaId); }
    getA1Notation() {
      const a = M.numeroAColumna(this.c) + this.r;
      return this.nr === 1 && this.nc === 1 ? a : a + ':' + M.numeroAColumna(this.c + this.nc - 1) + (this.r + this.nr - 1);
    }
    /** Para leer, un rango abierto hacia abajo llega hasta la última fila con datos (no hasta las 1000 vacías). */
    filasLeibles() { return this.abierto ? Math.max(1, Math.min(this.nr, M.ultimaFila(this.h) - this.r + 1)) : this.nr; }
    getValues() { return M.leer(this.h, this.r, this.c, this.filasLeibles(), this.nc); }
    getValue() { return M.leer(this.h, this.r, this.c, 1, 1)[0][0]; }
    getDisplayValues() { return M.leerVisibles(this.h, this.r, this.c, this.filasLeibles(), this.nc); }
    getDisplayValue() { return M.leerVisibles(this.h, this.r, this.c, 1, 1)[0][0]; }
    getFormulas() { return M.leerFormulas(this.h, this.r, this.c, this.filasLeibles(), this.nc); }
    getFormula() { return M.leerFormulas(this.h, this.r, this.c, 1, 1)[0][0]; }
    setValues(matriz) {
      if (!Array.isArray(matriz) || matriz.length !== this.nr) {
        throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' +
          (Array.isArray(matriz) ? matriz.length : 0) + ' but the range has ' + this.nr + '.');
      }
      const celdas = matriz.map(fila => {
        if (!Array.isArray(fila) || fila.length !== this.nc) {
          throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' +
            (Array.isArray(fila) ? fila.length : 0) + ' but the range has ' + this.nc + '.');
        }
        return fila;
      });
      const l = libroDe(this.libroId), h = M.hojaPorId(l, this.hojaId);
      escribir(this.libroId, { op: 'valores', entrada: 'USER_ENTERED', hoja: this.hojaId, r: this.r, c: this.c,
        celdas: celdas.map((fila, i) => fila.map((v, j) => celdaDe(l, h, this.r - 1 + i, this.c - 1 + j, v))) });
      return this;
    }
    setValue(v) {
      const l = libroDe(this.libroId), h = M.hojaPorId(l, this.hojaId);
      const celdas = Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (__, j) => celdaDe(l, h, this.r - 1 + i, this.c - 1 + j, v)));
      escribir(this.libroId, { op: 'valores', entrada: 'USER_ENTERED', hoja: this.hojaId, r: this.r, c: this.c, celdas: celdas });
      return this;
    }
    setFormula(f) {
      const formula = String(f)[0] === '=' ? String(f) : '=' + f;
      const celdas = Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => ({ v: '', f: formula })));
      escribir(this.libroId, { op: 'valores', entrada: 'RAW', hoja: this.hojaId, r: this.r, c: this.c, celdas: celdas });
      return this;
    }
    setFormulas(matriz) {
      escribir(this.libroId, { op: 'valores', entrada: 'RAW', hoja: this.hojaId, r: this.r, c: this.c,
        celdas: matriz.map(fila => fila.map(f => (f ? { v: '', f: String(f) } : { v: '' }))) });
      return this;
    }
    clearContent() {
      const celdas = Array.from({ length: this.filasLeibles() }, () => Array.from({ length: this.nc }, () => ({ v: '' })));
      escribir(this.libroId, { op: 'valores', entrada: 'RAW', hoja: this.hojaId, r: this.r, c: this.c, celdas: celdas });
      return this;
    }
    setNumberFormat(p) { escribir(this.libroId, { op: 'formatoNumero', hoja: this.hojaId, rango: this.coords(), patron: String(p) }); return this; }
    getNumberFormat() { const x = M.formatoDe(this.h, this.r - 1, this.c - 1); return x ? x.patron : 'General'; }
    setNumberFormats(m) { return this.setNumberFormat(m && m[0] && m[0][0]); }
    estilo(campo, valor) { escribir(this.libroId, { op: 'estilo', hoja: this.hojaId, rango: this.coords(), [campo]: valor }); return this; }
    setFontWeight(w) { return this.estilo('negrita', String(w) === 'bold'); }
    setBackground(c) { return this.estilo('fondo', c); }
    setFontColor(c) { return this.estilo('color', c); }
    setHorizontalAlignment(a) { return this.estilo('alineacion', a); }
    setWrap(b) { return this.estilo('ajuste', !!b); }
    setDataValidation(regla) { escribir(this.libroId, { op: 'validacion', hoja: this.hojaId, rango: this.coords(), regla: regla || null }); return this; }
    protect() { const p = new Proteccion(this); p.idOp = 'P' + Math.random().toString(36).slice(2, 10); p.anotar(); return p; }
    createTextFinder(t) { return new BuscadorTexto(this, t); }
    offset(df, dc, nr, nc) { return new Rango(this.libroId, this.hojaId, this.r + df, this.c + dc, nr || this.nr, nc || this.nc); }
  }

  class Hoja {
    constructor(libroId, hojaId) { this.libroId = libroId; this.hojaId = hojaId; }
    get h() { return M.hojaPorId(libroDe(this.libroId), this.hojaId); }
    getName() { return this.h.titulo; }
    getSheetName() { return this.h.titulo; }
    setName(nombre) {
      escribir(this.libroId, { op: 'renombrarHoja', hoja: this.hojaId, titulo: String(nombre) });
      return this;
    }
    getSheetId() { return this.hojaId; }
    getIndex() { return this.h.indice + 1; }
    getParent() { return new Libro(this.libroId); }
    getLastRow() { return M.ultimaFila(this.h); }
    getLastColumn() { return M.ultimaColumna(this.h); }
    getMaxRows() { return this.h.filasMax; }
    getMaxColumns() { return this.h.columnasMax; }
    getFrozenRows() { return this.h.congeladas; }
    getDataRange() {
      return new Rango(this.libroId, this.hojaId, 1, 1, Math.max(1, M.ultimaFila(this.h)), Math.max(1, M.ultimaColumna(this.h)));
    }
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const x = M.rangoA1(a.replace(/^.*!/, ''), this.h.filasMax);
        return new Rango(this.libroId, this.hojaId, x.r, x.c, x.nr, x.nc, { columnas: x.columnas, abierto: x.abierto });
      }
      return new Rango(this.libroId, this.hojaId, Number(a), Number(b == null ? 1 : b), Number(c == null ? 1 : c), Number(d == null ? 1 : d));
    }
    appendRow(fila) {
      // La fila nueva es la siguiente a la última con contenido (la misma que calcula aplicar 'agregar'): su formato manda
      const l = libroDe(this.libroId), h = M.hojaPorId(l, this.hojaId), i = M.ultimaFila(h);
      escribir(this.libroId, { op: 'agregar', entrada: 'USER_ENTERED', hoja: this.hojaId, celdas: (fila || []).map((v, j) => celdaDe(l, h, i, j, v)) });
      return this;
    }
    deleteRow(n) { return this.deleteRows(n, 1); }
    deleteRows(n, k) {
      const r = Number(n), cuantas = Number(k == null ? 1 : k);
      if (!(r >= 1) || !(cuantas >= 1) || r - 1 + cuantas > this.h.filasMax) throw new Error('Those rows are out of bounds.');
      escribir(this.libroId, { op: 'borrarFila', hoja: this.hojaId, r, n: cuantas });
      return this;
    }
    insertRowsAfter(despues, n) {
      escribir(this.libroId, { op: 'insertarFilas', hoja: this.hojaId, despues: Number(despues), n: Number(n) });
      return this;
    }
    createTextFinder(t) { return this.getDataRange().createTextFinder(t); }
    setFrozenRows(n) { escribir(this.libroId, { op: 'congelar', hoja: this.hojaId, filas: Number(n) || 0 }); return this; }
    setColumnWidth(c, px) { escribir(this.libroId, { op: 'anchoColumna', hoja: this.hojaId, c: Number(c), px: Number(px) }); return this; }
    setColumnWidths(c, n, px) { for (let i = 0; i < n; i++) this.setColumnWidth(c + i, px); return this; }
    activate() { return this; }
  }

  class Libro {
    constructor(id) { this.id = id; }
    get l() { return libroDe(this.id); }
    getId() { return this.id; }
    getName() { return this.l.titulo; }
    getUrl() { return amb.plantillas.libro.replace('{id}', this.id); }
    getSpreadsheetTimeZone() { return this.l.zona; }
    getSpreadsheetLocale() { return this.l.locale; }
    setSpreadsheetLocale(x) { escribir(this.id, { op: 'propiedadesLibro', locale: String(x) }); return this; }
    setSpreadsheetTimeZone(x) { escribir(this.id, { op: 'propiedadesLibro', zona: String(x) }); return this; }
    getSheets() { return this.l.hojas.slice().sort((a, b) => a.indice - b.indice).map(h => new Hoja(this.id, h.id)); }
    getSheetByName(n) { const h = this.l.hojas.find(x => x.titulo === String(n)); return h ? new Hoja(this.id, h.id) : null; }
    getSheetById(id) { const h = this.l.hojas.find(x => x.id === id); return h ? new Hoja(this.id, h.id) : null; }
    insertSheet(nombre, indice) {
      const titulo = nombre == null ? 'Hoja ' + (this.l.hojas.length + 1) : String(nombre);
      if (this.l.hojas.some(x => x.titulo === titulo)) {
        throw new Error('Ya existe una hoja con el nombre "' + titulo + '". Ingresa otro nombre.');
      }
      const id = amb.nuevoIdHoja(this.l);
      escribir(this.id, { op: 'nuevaHoja', id: id, titulo: titulo, indice: typeof indice === 'number' ? indice : null });
      return new Hoja(this.id, id);
    }
    deleteSheet(hoja) { escribir(this.id, { op: 'borrarHoja', hoja: hoja.getSheetId() }); }
    setNamedRange(nombre, rango) {
      escribir(this.id, { op: 'nombrarRango', nombre: String(nombre), hoja: rango.hojaId, rango: rango.coords() });
    }
    getRangeByName(nombre) {
      const x = this.l.nombrados[nombre];
      return x ? new Rango(this.id, x.hoja, x.rango.r, x.rango.c, x.rango.nr, x.rango.nc) : null;
    }
    setRecalculationInterval(i) { escribir(this.id, { op: 'recalculo', intervalo: String(i) }); return this; }
    getSheetByIdOrNull() { return null; }
  }

  /** Constructor de reglas de validación (lo que usa Code.js: lista, fórmula, número ≥). */
  function newDataValidation() {
    const regla = { condicion: null, permitirInvalidos: true, ayuda: '' };
    const b = {
      requireValueInList: (valores, mostrarLista) => { regla.condicion = { tipo: 'ONE_OF_LIST', valores: valores.map(String), lista: mostrarLista !== false }; return b; },
      requireFormulaSatisfied: f => { regla.condicion = { tipo: 'CUSTOM_FORMULA', valores: [String(f)] }; return b; },
      requireNumberGreaterThanOrEqualTo: n => { regla.condicion = { tipo: 'NUMBER_GREATER_THAN_EQ', valores: [String(n)] }; return b; },
      requireNumberBetween: (a, z) => { regla.condicion = { tipo: 'NUMBER_BETWEEN', valores: [String(a), String(z)] }; return b; },
      setAllowInvalid: x => { regla.permitirInvalidos = !!x; return b; },
      setHelpText: t => { regla.ayuda = String(t); return b; },
      build: () => JSON.parse(JSON.stringify(regla)),
    };
    return b;
  }

  return {
    openById: id => { libroDe(String(id)); return new Libro(String(id)); },
    openByUrl: url => {
      const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!m) throw new Error('URL de hoja de cálculo no válida.');
      libroDe(m[1]);
      return new Libro(m[1]);
    },
    create: nombre => {
      const l = amb.rpc('hojas.crear', { nombre: String(nombre) });
      amb.espejo.set(l.id, l);
      return new Libro(l.id);
    },
    // Se confirma al soltar el candado o al terminar la petición (ver arriba)
    flush: () => {},
    newDataValidation: newDataValidation,
    RecalculationInterval: { ON_CHANGE: 'ON_CHANGE', MINUTE: 'MINUTE', HOUR: 'HOUR' },
    getActiveSpreadsheet: () => null,
  };
}

module.exports = { crearSpreadsheetApp };
