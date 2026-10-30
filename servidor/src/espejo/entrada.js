// Cómo guarda Google Sheets lo que escribe Apps Script con setValue / setValues / appendRow: la entrada es
// "USER_ENTERED", o sea, el texto se interpreta como si alguien lo tecleara en la celda (número, fecha, hora, booleano,
// fórmula) según el idioma/región (locale) del libro y el formato de número de la celda.
//
// spreadsheets.batchUpdate (la llamada atómica del diario) no tiene valueInputOption: solo lo tienen values.update y
// values.batchUpdate, que costarían otra llamada por libro y la atomicidad (estructura y valores en dos llamadas). Por eso
// la conversión se hace aquí, en el trabajador, al escribir: el código lee en la línea siguiente lo ya convertido (como en
// Apps Script) y el diario lleva cada celda ya tipada (número, Date, booleano, fórmula o texto literal) con el formato que
// Sheets le pondría. Cada operación del diario anota entrada: 'USER_ENTERED' (setValue, setValues, appendRow) o 'RAW'
// (setFormula y lo que escribe el propio servidor).
//
// Reglas, en orden (docs/servidor-etapa-1.md §4.4; casos en pruebas/casos-escritura.js):
//   1. No es texto (número, booleano, Date, vacío): tal cual.
//   2. Empieza con apóstrofo: texto literal sin el apóstrofo (lo que hace textoCelda / textoFecha_ de Code.js).
//   3. Celda con formato de texto plano ("@"): queda texto SIEMPRE (también una fecha ISO), salvo "=" (sigue siendo
//      fórmula).
//   4. Empieza con "=": fórmula. Un "+" o un "-" al inicio NO hacen fórmula por esta vía.
//   5. Booleano (solo TRUE/FALSE en inglés, en cualquier locale), número (separadores del locale, signo "-", "$", "%",
//      miles bien agrupados, exponente; más de 15 cifras significativas queda texto), fecha, fecha y hora u hora
//      (sin am/pm).
//   6. Lo demás: texto.
//
// Las 6 reglas se MIDIERON con Apps Script real el 29/10/2026 (herramientas/paridad-escritura.js, 49 casos, corrida de
// Leo): 10 de ellos contradecían lo que este archivo suponía. Lo que cambió, con su caso en pruebas/casos-escritura.js:
// un "+" al inicio no hace número ni fórmula ("+5", "+52 442 644 5391" → texto); "-abc" → texto; más de 15 cifras
// significativas → texto ("012345678901234567", el largo de una CLABE, se guardaba con las cifras cambiadas);
// "VERDADERO" → texto; "5:30 pm" → texto; una celda "@" no convierte fechas ISO (al revés de lo que dice CLAUDE.md
// §6.2); "=A1" en una celda "@" sí es fórmula; y un número escrito como texto en una celda con formato de fecha deja
// la celda en formato automático. NO cambiar ninguna de estas reglas sin volver a medir.
'use strict';

const LOCALE_OMISION = 'es_MX';
const porLocale = new Map();

const escapar = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Separadores y orden de la fecha del locale de Sheets ("es_MX", "en_US"…), con Intl (ICU completo en Node). */
function datosLocale(locale) {
  const clave = String(locale || LOCALE_OMISION);
  let d = porLocale.get(clave);
  if (d) return d;
  const tag = clave.replace(/_/g, '-');
  let decimal = '.', grupo = ',', orden = 'dmy';
  try {
    const p = new Intl.NumberFormat(tag, { useGrouping: true }).formatToParts(1234567.5);
    decimal = (p.find(x => x.type === 'decimal') || {}).value || '.';
    grupo = (p.find(x => x.type === 'group') || {}).value || (decimal === ',' ? '.' : ',');
    const f = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(2026, 10, 25));
    const o = f.filter(x => x.type === 'day' || x.type === 'month' || x.type === 'year').map(x => x.type[0]).join('');
    if (/^(dmy|mdy|ymd)$/.test(o)) orden = o;
  } catch (e) { /* locale que ICU no conoce: el de México */ }
  const g = /\s/.test(grupo) ? '[ \\u00a0\\u202f]' : escapar(grupo);
  const dd = escapar(decimal);
  const simple = '(?:\\d+(?:' + dd + '\\d*)?|' + dd + '\\d+)';
  const agrupado = '\\d{1,3}(?:' + g + '\\d{3})+(?:' + dd + '\\d*)?';
  d = {
    locale: clave, decimal, grupo, orden,
    espanol: /^es/i.test(clave),
    // signo, "$", signo (uno solo en total), mantisa, "%"
    reNumero: new RegExp('^([+-]?)(\\$?)([+-]?)(' + agrupado + '|' + simple + ')(%?)$'),
    reExponente: new RegExp('^([+-]?)(' + simple + ')[eE]([+-]?\\d{1,3})$'),
    reGrupo: new RegExp(g, 'g'),
  };
  porLocale.set(clave, d);
  return d;
}

const cifras15 = n => (n === 0 ? 0 : Number(n.toPrecision(15)));

/** Cifras significativas de una mantisa ya normalizada ("1234.56"): sin ceros a la izquierda ni a la derecha. */
const significativas = m => m.replace(/^0+/, '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;

function numero(t, L) {
  let m = L.reNumero.exec(t);
  if (m) {
    const [, s1, pesos, s2, mantisa, porciento] = m;
    if ((s1 && s2) || (pesos && porciento) || (s2 && !pesos)) return null;
    if (s1 === '+' || s2 === '+') return null; // "+5" queda texto (medido)
    const signo = (s1 || s2) === '-' ? -1 : 1;
    const agrupado = L.reGrupo.test(mantisa);
    L.reGrupo.lastIndex = 0;
    const limpio = mantisa.replace(L.reGrupo, '').replace(L.decimal, '.');
    L.reGrupo.lastIndex = 0;
    if (significativas(limpio) > 15) return null; // "012345678901234567" (CLABE) queda texto, no un número cambiado
    let n = Number(limpio);
    if (!isFinite(n)) return null;
    const conDecimales = mantisa.includes(L.decimal) && !mantisa.endsWith(L.decimal);
    n = signo * n;
    if (porciento) return { valor: cifras15(n / 100), tipo: 'PERCENT', patron: conDecimales ? '0.00%' : '0%' };
    if (pesos) return { valor: cifras15(n), tipo: 'CURRENCY', patron: '"$"#,##0.00' };
    if (agrupado) return { valor: cifras15(n), tipo: 'NUMBER', patron: conDecimales ? '#,##0.00' : '#,##0' };
    return { valor: cifras15(n) };
  }
  m = L.reExponente.exec(t);
  if (m) {
    if (m[1] === '+') return null;
    const n = Number((m[1] === '-' ? '-' : '') + m[2].replace(L.decimal, '.') + 'e' + m[3]);
    if (!isFinite(n)) return null;
    return { valor: cifras15(n), tipo: 'SCIENTIFIC', patron: '0.00E+00' };
  }
  return null;
}

// ---- Fechas y horas ----
const MS_DIA = 86400000, EPOCA = 25569;
const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
// Sin am/pm: "5:30 pm" queda texto (medido con Apps Script real)
const RE_HORA = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?';
const RE_ISO = new RegExp('^(\\d{4})([-/])(\\d{1,2})\\2(\\d{1,2})(?:\\s+' + RE_HORA + ')?$');
const RE_NUMERICA = new RegExp('^(\\d{1,2})([/-])(\\d{1,2})(?:\\2(\\d{4}|\\d{2}))?(?:\\s+' + RE_HORA + ')?$');
const RE_SOLO_HORA = new RegExp('^' + RE_HORA + '$');
/** Hora "h:mm[:ss]" → segundos del día, o null si no es válida. */
function segundosDeHora(h, mi, s) {
  const hh = Number(h), m = Number(mi), ss = s === undefined ? 0 : Number(s);
  if (m > 59 || ss > 59 || hh > 23) return null;
  return hh * 3600 + m * 60 + ss;
}

const patronHora = s => (s === undefined ? 'hh:mm' : 'hh:mm:ss');

/** Fecha de pared (año, mes, día, segundos del día) en la zona del libro → Date (el instante que da getValues). */
function fechaDePared(a, m, d, seg, desdeSerial, zona) {
  const serial = Date.UTC(a, m - 1, d) / MS_DIA + EPOCA + seg / 86400;
  return desdeSerial(serial, zona);
}

function fecha(t, L, ctx) {
  let m = RE_ISO.exec(t);
  let a, mes, dia, conHora = false, seg = 0, ph = '', base;
  if (m) {
    a = Number(m[1]); mes = Number(m[3]); dia = Number(m[4]);
    base = m[2] === '-' ? 'yyyy-mm-dd' : 'yyyy/mm/dd';
    if (m[5] !== undefined) { conHora = true; seg = segundosDeHora(m[5], m[6], m[7]); ph = patronHora(m[7]); }
  } else if ((m = RE_NUMERICA.exec(t)) && L.orden !== 'ymd') {
    if (m[4] === undefined && m[2] !== '/') return null; // "3/4" sí; "3-4" no
    const x = Number(m[1]), y = Number(m[3]);
    if (L.orden === 'mdy') { mes = x; dia = y; } else { dia = x; mes = y; }
    if (m[4] === undefined) a = ctx.anioActual;
    else a = m[4].length === 2 ? (Number(m[4]) < 30 ? 2000 : 1900) + Number(m[4]) : Number(m[4]);
    base = L.orden === 'mdy' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
    if (m[2] === '-') base = base.replace(/\//g, '-');
    if (m[5] !== undefined) { conHora = true; seg = segundosDeHora(m[5], m[6], m[7]); ph = patronHora(m[7]); }
  } else if ((m = RE_SOLO_HORA.exec(t))) {
    const s = segundosDeHora(m[1], m[2], m[3]);
    if (s === null) return null;
    return { valor: fechaDePared(1899, 12, 30, s, ctx.desdeSerial, ctx.zona), tipo: 'TIME', patron: patronHora(m[3]) };
  } else return null;
  if (seg === null || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(a, mes) || a < 1000) return null;
  return { valor: fechaDePared(a, mes, dia, seg, ctx.desdeSerial, ctx.zona), tipo: conHora ? 'DATE_TIME' : 'DATE',
    patron: conHora ? base + ' ' + ph : base };
}

/**
 * @param {*} v  lo que Code.js escribe
 * @param {object} ctx  {locale, formato: formato de número vigente de la celda ({tipo, patron} | null), zona,
 *                       desdeSerial(serial, zona) → Date, anioActual (para "3/4" sin año)}
 * @returns {{valor, formula?, tipo?, patron?}}  tipo/patron: el formato que Sheets le pone a la celda (si no tenía uno)
 */
function interpretarEntrada(v, ctx) {
  const c = ctx || {};
  const x = interpretarSinFormato(v, c);
  if (typeof x.valor === 'number' && !x.tipo && c.formato && FORMATOS_FECHA[c.formato.tipo]) {
    // Un número ESCRITO COMO TEXTO en una celda con formato de fecha: Sheets guarda el número y deja la celda en
    // formato automático (medido; antes aquí se devolvía una fecha)
    if (typeof v === 'string') return { valor: x.valor, tipo: 'NUMBER', patron: PATRON_GENERAL };
    // Un número de verdad conserva el formato de la celda, así que getValues lo lee como fecha (no medido: es cómo
    // Sheets lee una celda con formato de fecha, igual que al cargar el libro)
    if (c.desdeSerial) return { valor: c.desdeSerial(x.valor, c.zona) };
  }
  return x;
}
const FORMATOS_FECHA = { DATE: 1, TIME: 1, DATE_TIME: 1 };
const PATRON_GENERAL = '0.###############';

function interpretarSinFormato(v, c) {
  if (v === null || v === undefined) return { valor: '' };
  if (typeof v !== 'string') return { valor: v };
  if (v === '') return { valor: '' };
  if (v[0] === "'") return { valor: v.slice(1) };
  const formato = c.formato || null;
  // Celda en texto plano ("@"): nada se convierte (tampoco una fecha ISO), pero "=" sí es fórmula (medido)
  if (formato && formato.tipo === 'TEXT') {
    return v[0] === '=' && v.length > 1 ? { valor: '', formula: v } : { valor: v };
  }
  if (v[0] === '=' && v.length > 1) return { valor: '', formula: v };
  const L = datosLocale(c.locale);
  const t = v.trim();
  if (t !== '') {
    if (/^(true|false)$/i.test(t)) return { valor: /^t/i.test(t) }; // "VERDADERO" no: queda texto (medido)
    if (/[\d.,]/.test(t)) {
      const n = numero(t, L);
      if (n) return n;
      const f = fecha(t, L, c);
      if (f) return f;
    }
  }
  return { valor: v };
}

module.exports = { interpretarEntrada, datosLocale, LOCALE_OMISION };
