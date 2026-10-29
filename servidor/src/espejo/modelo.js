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
//          mostrar: {"f,c": texto} }  lo que da getDisplayValues cuando Sheets lo mandó (si no, String(valor))
// Filas y columnas empiezan en 1 en la interfaz (como Apps Script); en los arreglos, en 0.
'use strict';

const clave = (f, c) => f + ',' + c; // 0-based

function nuevaHoja(d) {
  return {
    id: d.id, titulo: d.titulo, indice: d.indice || 0, filasMax: d.filasMax || 1000, columnasMax: d.columnasMax || 26,
    congeladas: d.congeladas || 0, valores: d.valores || [], formulas: d.formulas || {}, formatos: d.formatos || {},
    formatosRango: d.formatosRango || [], mostrar: d.mostrar || {},
  };
}

function nuevoLibro(d) {
  return { id: d.id, titulo: d.titulo || '', zona: d.zona || 'America/Mexico_City', version: d.version || '0', rev: d.rev || 0,
    hojas: (d.hojas || []).map(nuevaHoja), nombrados: d.nombrados || {} };
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
 * Cómo guarda Sheets lo que escribe Apps Script (la regla que reproduce el arnés, §6.2): apóstrofo al inicio = texto tal
 * cual; texto con forma de fecha ISO ("2026-10-20", "2026-10-20 17:30[:05]") = fecha; "=" al inicio = fórmula.
 * Lo demás se guarda como viene (número, booleano, Date, texto). Devuelve {valor, formula?}.
 */
function interpretar(v) {
  if (v === null || v === undefined) return { valor: '' };
  if (typeof v !== 'string') return { valor: v };
  if (v[0] === "'") return { valor: v.slice(1) };
  if (v[0] === '=' && v.length > 1) return { valor: '', formula: v };
  const x = v.match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d)(?::(\d\d))?)?$/);
  if (x) {
    // Sheets le pone a la celda un formato de fecha parecido a lo que se escribió
    const patron = x[6] !== undefined ? 'yyyy-mm-dd hh:mm:ss' : x[4] !== undefined ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
    return { valor: new Date(+x[1], +x[2] - 1, +x[3], +(x[4] || 0), +(x[5] || 0), +(x[6] || 0)), patron };
  }
  return { valor: v };
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
    case 'borrarFila': {
      const h = hojaPorId(libro, op.hoja);
      h.valores.splice(op.r - 1, 1);
      recorrerMapas(h, op.r - 1);
      h.filasMax = Math.max(1, h.filasMax - 1);
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

/** Formato de número vigente de una celda (0-based): el último setNumberFormat que la cubre o el que tenía en Sheets. */
function formatoDe(h, i, j) {
  const f = i + 1, c = j + 1;
  for (let k = h.formatosRango.length - 1; k >= 0; k--) {
    const x = h.formatosRango[k];
    if (c >= x.c && c < x.c + x.nc && f >= x.r && (x.abierto || f < x.r + x.nr)) return x;
  }
  return h.formatos[clave(i, j)] || null;
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
  return { id: libro.id, rev: libro.rev, revBase, titulo: libro.titulo, zona: libro.zona, version: libro.version, nombrados: libro.nombrados,
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
  espejo.set(x.id, Object.assign({}, local, { rev: x.rev, titulo: x.titulo, zona: x.zona, version: x.version, nombrados: x.nombrados, hojas }));
  return true;
}

module.exports = {
  parcheDe, aplicarLibroOParche,
  clave, nuevaHoja, nuevoLibro, ultimaFila, ultimaColumna, leer, leerFormulas, leerVisibles, textoVisible, interpretar,
  aplicar, hojaPorId, tipoDePatron, formatoDe, serialDesdeFecha, fechaDesdeSerial, desfase, columnaANumero,
  numeroAColumna, rangoA1, vacio,
};
