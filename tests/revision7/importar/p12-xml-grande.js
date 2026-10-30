// P12 · (Correcto) Tiempo del lector con XML hostiles de ~2 MB (el máximo de validarXml): atributo enorme, muchas etiquetas sin cerrar,
// miles de atributos y comillas sin cerrar. El patrón de etiquetas no tiene retroceso catastrófico: todo en milisegundos.
// Uso: node revision/p12-xml-grande.js
'use strict';
const C = require('./comun');
const A = C.crearArnes();
const casos = {
  'atributo de 2 MB': C.cfdi({ nombreReceptor: 'X'.repeat(2e6) }),
  '100k etiquetas abiertas': C.cfdi({}).replace('</cfdi:Comprobante>', '<a x="1" '.repeat(1e5) + '</cfdi:Comprobante>'),
  'comillas sin cerrar': C.cfdi({}).replace('<cfdi:Emisor', '<z a="' + '<b c="'.repeat(2e5) + '<cfdi:Emisor'),
  'atributos sin fin': '<cfdi:Comprobante ' + 'a="1" '.repeat(3e5),
};
for (const [k, s] of Object.entries(casos)) {
  const t = Date.now();
  let r; try { r = A.ctx.leerCfdiCliente(s).uuid; } catch (e) { r = 'error: ' + e.message.slice(0, 70); }
  console.log(k.padEnd(24), (Date.now() - t + ' ms').padStart(7), '·', r);
}
