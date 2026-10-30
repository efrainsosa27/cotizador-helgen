// Tabla de paridad de escritura: cómo queda en Sheets lo que Code.js escribe con setValue / setValues / appendRow
// (entrada USER_ENTERED). La usan pruebas/escritura.test.js (contra el servidor) y herramientas/paridad-escritura.js
// (genera la función de Apps Script que corre los mismos casos en Google y compara: así se confirma la tabla con Apps
// Script real antes del cambio).
//
// celda: 'auto' (formato automático) · 'texto' (texto plano "@") · 'fecha' (dd/MM/yyyy HH:mm, como Cotizaciones!B)
// espera: {tipo: numero|texto|fecha|booleano|formula|vacio, valor, formato?}
//   fecha: "aaaa-mm-dd hh:mm:ss" de pared en la zona del libro ("AAAA" = el año en curso); formula: la fórmula guardada
// fuente: de dónde sale lo esperado
//   API      documentación de la API de Sheets, ValueInputOption USER_ENTERED: "se interpreta como si el usuario lo
//            tecleara en la interfaz: el texto puede volverse número, fecha, etc."
//   §6.2     CLAUDE.md §6.2: observado en producción el 20/10/2026 (cobranza, hojas en "@")
//   regla 7  CLAUDE.md §7 regla 7: "+52…" se lee como fórmula → #ERROR! (por eso existe textoCelda)
//   Config   Code.js migrarConfig_: repara "+52 …" en Config!B (formato "@") con setValue sin apóstrofo
//   texto    ayuda de Sheets, formato "Texto sin formato": lo que se escribe queda como texto
//   supuesto lo más probable, sin documento: lo confirma `node herramientas/paridad-escritura.js` con Apps Script real
'use strict';

const N = (valor, formato) => ({ tipo: 'numero', valor, formato });
const T = valor => ({ tipo: 'texto', valor });
const F = (valor, formato) => ({ tipo: 'fecha', valor, formato });
const B = valor => ({ tipo: 'booleano', valor });
const FX = valor => ({ tipo: 'formula', valor });

const CASOS = [
  // ---- celda con formato automático, libro es_MX (decimal ".", miles ",", día/mes/año)
  { entrada: '123', espera: N(123), fuente: 'API' },
  { entrada: '-12.5', espera: N(-12.5), fuente: 'API' },
  { entrada: '  42 ', espera: N(42), fuente: 'supuesto' },
  { entrada: '1,234.56', espera: N(1234.56, 'NUMBER #,##0.00'), fuente: 'API' },
  { entrada: '007', espera: N(7), fuente: 'API', nota: 'pierde los ceros: por eso los códigos van con apóstrofo o en "@"' },
  { entrada: '012345678901234567', espera: N(12345678901234600), fuente: 'API', nota: 'CLABE sin apóstrofo: 15 cifras' },
  { entrada: "'012345678901234567", espera: T('012345678901234567'), fuente: '§6.2', nota: 'apóstrofo = texto literal' },
  { entrada: '15%', espera: N(0.15, 'PERCENT 0%'), fuente: 'API' },
  { entrada: '12.5%', espera: N(0.125, 'PERCENT 0.00%'), fuente: 'API' },
  { entrada: '$1,160.00', espera: N(1160, 'CURRENCY "$"#,##0.00'), fuente: 'API' },
  { entrada: '1e3', espera: N(1000, 'SCIENTIFIC 0.00E+00'), fuente: 'API' },
  { entrada: '+5', espera: N(5), fuente: 'supuesto' },
  { entrada: 'TRUE', espera: B(true), fuente: 'API' },
  { entrada: 'false', espera: B(false), fuente: 'API' },
  { entrada: 'VERDADERO', espera: B(true), fuente: 'supuesto', nota: 'solo en libros en español' },
  { entrada: '2026-10-20', espera: F('2026-10-20 00:00:00', 'DATE yyyy-mm-dd'), fuente: '§6.2' },
  { entrada: '2026-10-20 17:30', espera: F('2026-10-20 17:30:00', 'DATE_TIME yyyy-mm-dd hh:mm'), fuente: '§6.2' },
  { entrada: '2026-10-20 17:30:05', espera: F('2026-10-20 17:30:05', 'DATE_TIME yyyy-mm-dd hh:mm:ss'), fuente: '§6.2', nota: 'Utilities.formatDate(…, "yyyy-MM-dd HH:mm:ss")' },
  { entrada: '2026/10/20', espera: F('2026-10-20 00:00:00'), fuente: 'supuesto' },
  { entrada: '20/10/2026', espera: F('2026-10-20 00:00:00'), fuente: 'API', nota: 'orden del locale: día/mes' },
  { entrada: '20/10/26', espera: F('2026-10-20 00:00:00'), fuente: 'supuesto', nota: 'año de 2 cifras: 00–29 → 20xx' },
  { entrada: '3/4', espera: F('AAAA-04-03 00:00:00'), fuente: 'supuesto', nota: 'sin año: el año en curso' },
  { entrada: '17:30', espera: F('1899-12-30 17:30:00', 'TIME hh:mm'), fuente: 'API', nota: 'hora sola: getValues da una Date del 30/12/1899' },
  { entrada: '5:30 pm', espera: F('1899-12-30 17:30:00'), fuente: 'supuesto' },
  { entrada: '2026-02-30', espera: T('2026-02-30'), fuente: 'supuesto', nota: 'fecha que no existe' },
  { entrada: '=A1*2', espera: FX('=A1*2'), fuente: 'API' },
  { entrada: '+52 442 644 5391', espera: FX('=+52 442 644 5391'), fuente: 'regla 7', nota: 'getValues da "#ERROR!"' },
  { entrada: "'+52 442 644 5391", espera: T('+52 442 644 5391'), fuente: 'regla 7', nota: 'lo que hace textoCelda' },
  { entrada: '-abc', espera: FX('=-abc'), fuente: 'supuesto', nota: 'mismo mecanismo que la regla 7' },
  { entrada: '-', espera: T('-'), fuente: 'supuesto' },
  { entrada: '@usuario', espera: T('@usuario'), fuente: 'supuesto' },
  { entrada: 'HLG-2026-0001', espera: T('HLG-2026-0001'), fuente: 'API' },
  { entrada: '442 644 5391', espera: T('442 644 5391'), fuente: 'API' },
  { entrada: 'SPEI 123', espera: T('SPEI 123'), fuente: 'API' },
  { entrada: '', espera: { tipo: 'vacio', valor: '' }, fuente: 'API' },
  // ---- libro en_US (mes/día/año): el locale cambia la fecha
  { entrada: '20/10/2026', locale: 'en_US', espera: T('20/10/2026'), fuente: 'API', nota: 'mes 20 no existe' },
  { entrada: '10/20/2026', locale: 'en_US', espera: F('2026-10-20 00:00:00'), fuente: 'API' },
  { entrada: '3/4', locale: 'en_US', espera: F('AAAA-03-04 00:00:00'), fuente: 'supuesto' },
  // ---- celda en texto plano "@" (todas las hojas de cobranza, compras y Administración; Config!B; Catálogo A:C y G:H)
  { entrada: '0012', celda: 'texto', espera: T('0012'), fuente: 'texto', nota: 'Code.js: "01010101" no pierde el cero inicial' },
  { entrada: '123', celda: 'texto', espera: T('123'), fuente: 'texto' },
  { entrada: '2026-10-20', celda: 'texto', espera: F('2026-10-20 00:00:00', 'DATE yyyy-mm-dd'), fuente: '§6.2', nota: 'la excepción observada' },
  { entrada: '2026-10-20 17:30:00', celda: 'texto', espera: F('2026-10-20 17:30:00', 'DATE_TIME yyyy-mm-dd hh:mm:ss'), fuente: '§6.2' },
  { entrada: '20/10/2026', celda: 'texto', espera: T('20/10/2026'), fuente: 'supuesto' },
  { entrada: '+52 442 644 5391', celda: 'texto', espera: T('+52 442 644 5391'), fuente: 'Config' },
  { entrada: 'TRUE', celda: 'texto', espera: T('TRUE'), fuente: 'texto' },
  { entrada: '=A1', celda: 'texto', espera: T('=A1'), fuente: 'supuesto' },
  { entrada: "'abc", celda: 'texto', espera: T('abc'), fuente: '§6.2' },
  // ---- celda con formato de fecha (Cotizaciones!B, Catálogo!E): conserva su formato
  { entrada: '2026-10-20 17:30', celda: 'fecha', espera: F('2026-10-20 17:30:00', 'dd/MM/yyyy HH:mm'), fuente: 'API' },
  { entrada: '123', celda: 'fecha', espera: F('1900-05-02 00:00:00', 'dd/MM/yyyy HH:mm'), fuente: 'API', nota: 'un número en una celda de fecha se lee como fecha' },
];

const FORMATO_CELDA = { auto: null, texto: { tipo: 'TEXT', patron: '@' }, fecha: { tipo: 'DATE_TIME', patron: 'dd/MM/yyyy HH:mm' } };

module.exports = { CASOS, FORMATO_CELDA };
