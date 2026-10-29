// Escrituras a Sheets en Code.js (rapidez, docs/rapidez-apps-script.md §memo de filas): encuentra cada llamada que cambia valores
// de una hoja (appendRow, setValue(s), setFormula(s), deleteRow(s), insertRow(s)…, insertSheet, deleteSheet, clear…) y el
// principio de su cadena (lo que va antes del primer .getRange o del método). La usa tests/rapidez.test.js para exigir que
// toda escritura pase por escribe_(…) (que olvida las filas leídas en la petición).
'use strict';
const METODOS = ['appendRow', 'setValue', 'setValues', 'setFormula', 'setFormulas', 'deleteRow', 'deleteRows', 'insertRowAfter',
  'insertRowsAfter', 'insertRowBefore', 'insertRowsBefore', 'insertRows', 'insertSheet', 'deleteSheet', 'clearContent',
  'clearContents', 'clear'];
const RE = new RegExp('\\.\\s*(' + METODOS.join('|') + ')\\s*\\(', 'g');

/** Índice del principio de la expresión que termina justo antes de `fin` (cadena a.b(c)[d].e…), saltando paréntesis, corchetes y textos. */
function inicioCadena(src, fin) {
  let i = fin - 1;
  const saltaEspacio = () => { while (i >= 0 && /\s/.test(src[i])) i--; };
  for (;;) {
    saltaEspacio();
    if (src[i] === ')' || src[i] === ']') {
      const abre = src[i] === ')' ? '(' : '[', cierra = src[i];
      let prof = 0;
      for (; i >= 0; i--) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') { const q = c; i--; while (i >= 0 && !(src[i] === q && src[i - 1] !== '\\')) i--; continue; }
        if (c === cierra) prof++;
        else if (c === abre && --prof === 0) break;
      }
      i--;
      continue; // antes del paréntesis va el nombre de la función (o nada: una expresión entre paréntesis)
    }
    if (/[\w$]/.test(src[i] || '')) {
      while (i >= 0 && /[\w$]/.test(src[i])) i--;
      const j = i;
      saltaEspacio();
      if (src[i] === '.') { i--; continue; }
      return j + 1;
    }
    return i + 1;
  }
}

/** [{metodo, linea, inicio, fin, cadena}] de cada escritura (cadena = texto desde su principio hasta el método). */
function escrituras(src) {
  const r = [];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    const punto = m.index;
    const ini = inicioCadena(src, punto);
    const linea = src.slice(0, punto).split('\n').length;
    // Comentarios de una línea: se saltan
    const deLinea = src.slice(src.lastIndexOf('\n', punto) + 1, punto);
    if (/\/\//.test(deLinea.replace(/'[^']*'|"[^"]*"/g, ''))) continue;
    r.push({ metodo: m[1], linea, inicio: ini, fin: punto, cadena: src.slice(ini, punto) });
  }
  return r;
}

module.exports = { escrituras, inicioCadena, METODOS };
