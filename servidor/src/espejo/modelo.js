// Modelo del espejo en memoria de un libro de Google Sheets. Lo usan igual el hilo principal (copia canónica) y cada
// trabajador (copia local + lo que escribió la transacción en curso). Sin E/S: solo datos y las operaciones del diario.
//
// Libro: { id, titulo, zona, version, rev, hojas: [Hoja], nombrados: {nombre: {hoja, r, c, nr, nc}} }
//   rev: revisión de la copia canónica (el principal la sube en cada cambio); los parches dicen sobre cuál se aplican
// Hoja:  { id (sheetId), titulo, indice, filasMax, columnasMax, congeladas,
//          valores: [[valor]]          lo que da getValues: '' · número · texto · booleano · Date
//          formulas: {"f,c": '=…'}     celdas con fórmula (su valor es el último que calculó Sheets)
//          formatos: {"f,c": {tipo, patron}}   formato de número por celda (lo que vino de Sheets; solo fechas y texto)
//          formatosRango: [{r, c, nr, nc, abierto, tipo, patron}]  setNumberFormat desde la última carga (el último manda;
//                         un rango de 1000 filas es un renglón aquí, no 1000 celdas)
//          mostrar: {"f,c": texto}     lo que da getDisplayValues cuando Sheets lo mandó (si no, String(valor))
//          texto: {c: [[fIni, fFin]]}  celdas con formato de texto plano ("@") que vinieron de Sheets, por columna en
//                                      tramos de filas (las hojas de CAPRI tienen columnas enteras en "@": por celda
//                                      costaría memoria). Decide cómo se interpreta lo que se escribe (entrada.js).
//          cargadas: filas que vinieron de Sheets (la zona con datos + una); más abajo vale el formato de la última }
// Filas y columnas empiezan en 1 en la interfaz (como Apps Script); en los arreglos, en 0.
'use strict';
const { interpretarEntrada, LOCALE_OMISION } = require('./entrada');

const clave = (f, c) => f + ',' + c; // 0-based

function nuevaHoja(d) {
  return {
    id: d.id, titulo: d.titulo, indice: d.indice || 0, filasMax: d.filasMax || 1000, columnasMax: d.columnasMax || 26,
    congeladas: d.congeladas || 0, valores: d.valores || [], formulas: d.formulas || {}, formatos: d.formatos || {},
    formatosRango: d.formatosRango || [], mostrar: d.mostrar || {}, texto: d.texto || {}, cargadas: d.cargadas || 0,
  };
}

function nuevoLibro(d) {
  return { id: d.id, titulo: d.titulo || '', zona: d.zona || 'America/Mexico_City', locale: d.locale || LOCALE_OMISION,
    version: d.version || '0', rev: d.rev || 0, hojas: (d.hojas || []).map(nuevaHoja), nombrados: d.nombrados || {} };
}

const vacio = v => v === '' || v === null || v === undefined;

/** Última fila con contenido (valor o fórmula), 1-based; 0 si la hoja está vacía (como getLastRow). */
function ultimaFila(h) {
  let conFormula = 0;
  for (const k in h.formulas) { const f = Number(k.slice(0, k.indexOf(','))) + 1; if (f > conFormula) conFormula = f; }
  for (let i = h.valores.length - 1; i >= conFormula; i--) {
    const fila = h.valores[i];
    if (fila && fila.some(v => !vacio(v))) return i + 1;
  }
  return conFormula;
}

/** Última columna con contenido, 1-based (como getLastColumn). */
function ultimaColumna(h) {
  let n = 0;
  h.valores.forEach(fila => {
    if (!fila) return;
    for (let j = fila.length - 1; j >= n; j--) if (!vacio(fila[j])) { n = j + 1; break; }
  });
  Object.keys(h.formulas).forEach(k => { const c = Number(k.split(',')[1]) + 1; if (c > n) n = c; });
  return n;
}

const copiaValor = v => (v instanceof Date ? new Date(v.getTime()) : v);

/** Matriz nr×nc desde (r, c) 1-based; rellena con ''. Las fechas salen como Date nuevos (el código puede cambiarlos). */
function leer(h, r, c, nr, nc) {
  const salida = new Array(nr);
  for (let i = 0; i < nr; i++) {
    const fila = h.valores[r - 1 + i] || [];
    const f = new Array(nc);
    for (let j = 0; j < nc; j++) {
      const v = fila[c - 1 + j];
      f[j] = vacio(v) ? '' : copiaValor(v);
    }
    salida[i] = f;
  }
  return salida;
}

function leerFormulas(h, r, c, nr, nc) {
  const salida = [];
  for (let i = 0; i < nr; i++) {
    const f = [];
    for (let j = 0; j < nc; j++) f.push(h.formulas[clave(r - 1 + i, c - 1 + j)] || '');
    salida.push(f);
  }
  return salida;
}

/** Texto visible por omisión (lo que hace el arnés: String(valor)). Sheets manda el real al confirmar (lectura de regreso). */
function textoVisible(v) {
  return vacio(v) ? '' : String(v);
}

function leerVisibles(h, r, c, nr, nc) {
  const valores = leer(h, r, c, nr, nc);
  return valores.map((fila, i) => fila.map((v, j) => {
    const m = h.mostrar[clave(r - 1 + i, c - 1 + j)];
    return m !== undefined ? m : textoVisible(v);
  }));
}

/**
 * Cómo guarda Sheets lo que escribe Apps Script (setValue, setValues, appendRow): entrada.js. ctx: {locale, formato, zona}
 * (sin ctx: celda con formato automático en un libro es_MX de la Ciudad de México). Devuelve {valor, formula?, tipo?, patron?}.
 */
function interpretar(v, ctx) {
  const c = Object.assign({ locale: LOCALE_OMISION, formato: null, zona: 'America/Mexico_City', desdeSerial: fechaDesdeSerial }, ctx || {});
  if (c.anioActual === undefined) c.anioActual = Number(new Intl.DateTimeFormat('en-CA', { timeZone: c.zona, year: 'numeric' }).format(new Date()));
  return interpretarEntrada(v, c);
}

/** Lo que interpreta la celda (i, j) 0-based de la hoja h del libro: su locale, zona y formato vigente. */
function contextoCelda(libro, h, i, j) {
  return { locale: libro.locale, zona: libro.zona, formato: formatoDe(h, i, j) };
}

// ---- Formato de texto plano ("@") por columna, en tramos de filas ----
function enTexto(h, i, j) {
  const t = h.texto && h.texto[j];
  if (!t) return false;
  for (let k = 0; k < t.length; k++) { if (i < t[k][0]) return false; if (i <= t[k][1]) return true; }
  return false;
}
/** Marca (si) o desmarca la celda (i, j) como texto plano, uniendo tramos vecinos. */
function marcarTexto(h, i, j, si) {
  if (!h.texto) h.texto = {};
  const t = h.texto[j] || [];
  for (let k = 0; k < t.length; k++) {
    const [a, b] = t[k];
    if (i < a) break;
    if (i <= b) {
      if (si) return;
      const resto = [];
      if (a <= i - 1) resto.push([a, i - 1]);
      if (i + 1 <= b) resto.push([i + 1, b]);
      t.splice(k, 1, ...resto);
      break;
    }
  }
  if (si) {
    let k = 0;
    while (k < t.length && t[k][0] < i) k++;
    t.splice(k, 0, [i, i]);
    if (k + 1 < t.length && t[k + 1][0] === i + 1) { t[k][1] = t[k + 1][1]; t.splice(k + 1, 1); }
    if (k > 0 && t[k - 1][1] === i - 1) { t[k - 1][1] = t[k][1]; t.splice(k, 1); }
  }
  if (t.length) h.texto[j] = t; else delete h.texto[j];
}
/** Recorre los tramos al borrar la fila i (n = -1) o al insertar n filas antes de la fila i (heredan el formato de arriba). */
function recorrerTexto(h, i, n) {
  Object.keys(h.texto || {}).forEach(j => {
    const t = [];
    h.texto[j].forEach(([a, b]) => {
      if (n < 0) {
        if (b < i) t.push([a, b]);
        else if (a > i) t.push([a - 1, b - 1]);
        else if (b - 1 >= a) t.push([a, b - 1]);
      } else if (a >= i) t.push([a + n, b + n]);
      else if (b >= i - 1) t.push([a, b + n]);
      else t.push([a, b]);
    });
    for (let k = t.length - 1; k > 0; k--) if (t[k][0] <= t[k - 1][1] + 1) { t[k - 1][1] = Math.max(t[k - 1][1], t[k][1]); t.splice(k, 1); }
    if (t.length) h.texto[j] = t; else delete h.texto[j];
  });
  if (h.cargadas && i < h.cargadas) h.cargadas = Math.max(0, h.cargadas + n);
}

function asegurarFila(h, i) {
  while (h.valores.length <= i) h.valores.push([]);
  if (!h.valores[i]) h.valores[i] = [];
  return h.valores[i];
}

/** Celda tipada del diario: {v} o {v, f} (fórmula). */
function ponerCelda(h, i, j, celda) {
  const fila = asegurarFila(h, i);
  while (fila.length < j) fila.push('');
  fila[j] = copiaValor(celda.v);
  const k = clave(i, j);
  if (celda.f) h.formulas[k] = celda.f; else delete h.formulas[k];
  delete h.mostrar[k];
  if (i + 1 > h.filasMax) h.filasMax = i + 1;
  if (j + 1 > h.columnasMax) h.columnasMax = j + 1;
}

/** Mueve las claves "f,c" de los mapas por fila cuando se borra la fila i (0-based). */
function recorrerMapas(h, i) {
  ['formulas', 'formatos', 'mostrar'].forEach(nombre => {
    const nuevo = {};
    Object.keys(h[nombre]).forEach(k => {
      const [f, c] = k.split(',').map(Number);
      if (f === i) return;
      nuevo[clave(f > i ? f - 1 : f, c)] = h[nombre][k];
    });
    h[nombre] = nuevo;
  });
}

function hojaPorId(libro, id) {
  const h = libro.hojas.find(x => x.id === id);
  if (!h) throw new Error('La hoja ' + id + ' ya no existe en el libro ' + libro.id + '.');
  return h;
}

/**
 * Aplica una operación del diario al libro (en el trabajador al escribir; en el principal al confirmar). Devuelve la fila
 * en la que quedó un "agregar" (para la lectura de regreso). Las de solo formato no cambian los valores.
 */
function aplicar(libro, op) {
  switch (op.op) {
    case 'valores': {
      const h = hojaPorId(libro, op.hoja);
      op.celdas.forEach((fila, i) => fila.forEach((celda, j) => ponerCelda(h, op.r - 1 + i, op.c - 1 + j, celda)));
      return op.r;
    }
    case 'agregar': {
      const h = hojaPorId(libro, op.hoja);
      const r = ultimaFila(h) + 1;
      op.celdas.forEach((celda, j) => ponerCelda(h, r - 1, j, celda));
      return r;
    }
    case 'borrarFila': { // deleteRow / deleteRows(r, n)
      const h = hojaPorId(libro, op.hoja);
      for (let k = 0; k < (op.n || 1); k++) {
        h.valores.splice(op.r - 1, 1);
        recorrerMapas(h, op.r - 1);
        recorrerTexto(h, op.r - 1, -1);
        h.filasMax = Math.max(1, h.filasMax - 1);
      }
      return op.r;
    }
    case 'insertarFilas': {
      const h = hojaPorId(libro, op.hoja);
      if (op.despues < h.valores.length) {
        // Recorre hacia abajo lo que está después (solo pasa al importar el SAT, que inserta al final)
        const vacias = Array.from({ length: op.n }, () => []);
        h.valores.splice(op.despues, 0, ...vacias);
        ['formulas', 'formatos', 'mostrar'].forEach(nombre => {
          const nuevo = {};
          Object.keys(h[nombre]).forEach(k => {
            const [f, c] = k.split(',').map(Number);
            nuevo[clave(f >= op.despues ? f + op.n : f, c)] = h[nombre][k];
          });
          h[nombre] = nuevo;
        });
      }
      recorrerTexto(h, op.despues, op.n);
      h.filasMax += op.n;
      return 0;
    }
    case 'nuevaHoja': {
      if (libro.hojas.some(x => x.titulo === op.titulo)) throw new Error('Ya existe una hoja llamada "' + op.titulo + '".');
      const indice = op.indice == null ? libro.hojas.length : op.indice;
      libro.hojas.forEach(x => { if (x.indice >= indice) x.indice++; });
      libro.hojas.push(nuevaHoja({ id: op.id, titulo: op.titulo, indice: indice }));
      libro.hojas.sort((a, b) => a.indice - b.indice);
      return 0;
    }
    case 'renombrarHoja': {
      const h = hojaPorId(libro, op.hoja);
      if (!op.titulo || libro.hojas.some(x => x.id !== h.id && x.titulo === op.titulo)) {
        throw new Error('El nombre de la hoja está vacío o ya existe: "' + op.titulo + '".');
      }
      h.titulo = op.titulo;
      return 0;
    }
    case 'borrarHoja': {
      const k = libro.hojas.findIndex(x => x.id === op.hoja);
      if (k !== -1) libro.hojas.splice(k, 1);
      libro.hojas.forEach((x, i) => { x.indice = i; });
      return 0;
    }
    case 'formatoNumero': {
      const h = hojaPorId(libro, op.hoja);
      const x = op.rango;
      h.formatosRango.push({ r: x.r, c: x.c, nr: x.nr, nc: x.nc, abierto: !!(x.columnas || x.abierto), tipo: tipoDePatron(op.patron), patron: op.patron });
      if (h.formatosRango.length > 200) h.formatosRango.splice(0, h.formatosRango.length - 200);
      return 0;
    }
    case 'congelar': hojaPorId(libro, op.hoja).congeladas = op.filas; return 0;
    case 'propiedadesLibro': if (op.locale) libro.locale = op.locale; if (op.zona) libro.zona = op.zona; return 0;
    case 'nombrarRango': libro.nombrados[op.nombre] = { hoja: op.hoja, rango: op.rango }; return 0;
    // Solo apariencia o reglas de la hoja: no cambian lo que lee el código (sí van a Sheets)
    case 'estilo': case 'anchoColumna': case 'validacion': case 'proteger': case 'recalculo': return 0;
    default: throw new Error('Operación desconocida en el diario: ' + op.op);
  }
}

/** Tipo de formato de Sheets a partir del patrón (para saber si un número es fecha). */
function tipoDePatron(p) {
  const s = String(p || '');
  if (s === '@') return 'TEXT';
  const sinTexto = s.replace(/"[^"]*"/g, '');
  const fecha = /[dy]/i.test(sinTexto) || /M{1,4}/.test(sinTexto);
  const hora = /[hHs]/.test(sinTexto) || /(^|[^M])mm/.test(sinTexto);
  if (fecha && hora) return 'DATE_TIME';
  if (fecha) return 'DATE';
  if (hora && /:/.test(sinTexto)) return 'TIME';
  if (/[$¤]/.test(s)) return 'CURRENCY';
  if (/%/.test(s)) return 'PERCENT';
  return 'NUMBER';
}

const TEXTO_PLANO = Object.freeze({ tipo: 'TEXT', patron: '@' });
/**
 * Formato de número vigente de una celda (0-based): el último setNumberFormat que la cubre o el que tenía en Sheets (fechas
 * por celda; texto plano por tramos). Más abajo de lo que vino de Sheets vale el de la última fila que vino (la "+1").
 */
function formatoDe(h, i, j) {
  const f = i + 1, c = j + 1;
  for (let k = h.formatosRango.length - 1; k >= 0; k--) {
    const x = h.formatosRango[k];
    if (c >= x.c && c < x.c + x.nc && f >= x.r && (x.abierto || f < x.r + x.nr)) return x;
  }
  const x = h.formatos[clave(i, j)];
  if (x) return x;
  if (enTexto(h, i, j) || (h.cargadas > 0 && i >= h.cargadas && enTexto(h, h.cargadas - 1, j))) return TEXTO_PLANO;
  return null;
}

// ---- Fechas ↔ número de serie de Sheets (días desde 1899-12-30 en la zona horaria del libro) ----
const MS_DIA = 86400000, EPOCA = 25569; // 1970-01-01 = 25569
const formatos = new Map();
function partesZona(zona, t) {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatos.set(zona, f);
  }
  const p = {};
  f.formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
/** Desfase (ms) de la zona en el instante t: hora local − UTC. */
function desfase(zona, t) {
  const ms = t % 1000;
  return partesZona(zona, t - ms) - (t - ms);
}
function serialDesdeFecha(fecha, zona) {
  const t = fecha.getTime();
  return (t + desfase(zona, t)) / MS_DIA + EPOCA;
}
function fechaDesdeSerial(serial, zona) {
  const pared = Math.round((serial - EPOCA) * MS_DIA);
  let t = pared - desfase(zona, pared);
  t = pared - desfase(zona, t);
  return new Date(t);
}

// ---- A1 ----
function columnaANumero(letras) {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numeroAColumna(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
/**
 * Rango A1 sin nombre de hoja ("B:B", "A2:A", "D4", "A1:C10") → {r, c, nr, nc, columnas}. "columnas" = abierto hacia
 * abajo (columna completa o desde una fila): vale hasta el final de la hoja.
 */
function rangoA1(a1, filasMax) {
  const m = String(a1).trim().toUpperCase().match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/);
  if (!m || (!m[1] && !m[2])) throw new Error('Rango no válido: ' + a1);
  const c1 = m[1] ? columnaANumero(m[1]) : 1;
  const r1 = m[2] ? Number(m[2]) : 1;
  const tieneFin = m[3] !== undefined || m[4] !== undefined;
  const c2 = tieneFin ? (m[3] ? columnaANumero(m[3]) : c1) : c1;
  const abierto = tieneFin ? !m[4] : !m[2];
  const r2 = abierto ? filasMax : (tieneFin ? Number(m[4]) : r1);
  return { r: r1, c: c1, nr: r2 - r1 + 1, nc: c2 - c1 + 1, columnas: abierto && r1 === 1, abierto: abierto };
}

/**
 * Parche de un libro: las hojas que cambiaron completas (no el libro entero: copiar un libro de un año a cada trabajador
 * después de cada guardado costaría decenas de ms en el principal). revBase = revisión sobre la que se aplica.
 */
function parcheDe(libro, revBase, idsHojas, borradas) {
  return { id: libro.id, rev: libro.rev, revBase, titulo: libro.titulo, zona: libro.zona, locale: libro.locale, version: libro.version, nombrados: libro.nombrados,
    orden: libro.hojas.map(h => h.id), hojas: libro.hojas.filter(h => idsHojas.has(h.id)), borradas: borradas || [] };
}

/**
 * Aplica a un espejo (Map id → libro) un libro completo o un parche. Devuelve false si el parche no corresponde a la
 * copia local (se borra: la siguiente lectura trae la canónica). Lo viejo nunca pisa lo nuevo.
 */
function aplicarLibroOParche(espejo, x) {
  const local = espejo.get(x.id);
  if (x.revBase === undefined) {
    if (!local || !(local.rev > x.rev)) espejo.set(x.id, x);
    return true;
  }
  if (!local) return true;            // no la tiene: la pedirá completa cuando la use
  if (local.rev >= x.rev) return true; // ya incluye este cambio
  if (local.rev !== x.revBase) { espejo.delete(x.id); return false; }
  const nuevas = new Map(x.hojas.map(h => [h.id, h]));
  const hojas = local.hojas.filter(h => !x.borradas.includes(h.id)).map(h => nuevas.get(h.id) || h);
  x.hojas.forEach(h => { if (!hojas.some(y => y.id === h.id)) hojas.push(h); });
  const orden = new Map(x.orden.map((id, i) => [id, i]));
  hojas.sort((a, b) => (orden.has(a.id) ? orden.get(a.id) : 1e9) - (orden.has(b.id) ? orden.get(b.id) : 1e9));
  espejo.set(x.id, Object.assign({}, local, { rev: x.rev, titulo: x.titulo, zona: x.zona, locale: x.locale || local.locale,
    version: x.version, nombrados: x.nombrados, hojas }));
  return true;
}

module.exports = {
  parcheDe, aplicarLibroOParche,
  clave, nuevaHoja, nuevoLibro, ultimaFila, ultimaColumna, leer, leerFormulas, leerVisibles, textoVisible, interpretar,
  contextoCelda, enTexto, marcarTexto, recorrerTexto, aplicar, hojaPorId, tipoDePatron, formatoDe, serialDesdeFecha, fechaDesdeSerial, desfase, columnaANumero,
  numeroAColumna, rangoA1, vacio,
};
