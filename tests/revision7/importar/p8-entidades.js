// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P8 · Detalles del lector de CFDI (atributosXml, compartido con proveedores y gastos):
//  a) una referencia numérica fuera de Unicode (&#x110000;) lanza RangeError de JavaScript: el usuario ve "Invalid code point 1114112"
//     (en inglés, sin decir qué está mal) en lugar del texto en español de siempre;
//  b) doble decodificación: "&#38;lt;" (= el texto literal "&lt;") termina como "<".
//  Lo que sí está bien: DOCTYPE/ENTITY rechazados, comentarios ignorados, prefijos cfdi:/cfdi4:/sin prefijo, CFDI 3.3 y Pagos 1.0
//  rechazados con el texto para clientes, varios Pago y DoctoRelacionado leídos.
// Uso: node revision/p8-entidades.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();
const P = A.ctx;
const leer = s => { try { return P.leerCfdiCliente(s); } catch (e) { return { error: e.constructor.name + ': ' + e.message }; } };

const a = leer(C.cfdi({ nombreReceptor: 'CLIENTE &#x110000; SA' }).replace('&amp;#x110000;', '&#x110000;'));
console.log('a) &#x110000; →', a.error);
assert(/^Error: El XML no es válido/.test(a.error), 'ARREGLADO: el error en español');
const b = P.leerCfdiCliente(C.cfdi({ nombreReceptor: 'X' }).replace('Nombre="X"', 'Nombre="A &#38;lt;b&#38;gt; B"'));
console.log('b) "A &#38;lt;b&#38;gt; B" →', JSON.stringify(b.receptor.nombre));
assert.equal(b.receptor.nombre, 'A &lt;b&gt; B', 'ARREGLADO: una sola vez');

// Lo correcto (para el informe)
const ok1 = leer(C.cfdi({}).replace(/cfdi:/g, 'cfdi4:').replace('xmlns:cfdi4=', 'xmlns:cfdi4='));
const ok2 = leer(C.cfdi({}).replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "y">]>'));
const ok3 = leer(C.cfdi({}).replace('http://www.sat.gob.mx/cfd/4', 'http://www.sat.gob.mx/cfd/3').replace('Version="4.0"', 'Version="3.3"'));
const ok4 = leer(C.cfdi({ tipo: 'P', pagos: [{ fecha: '2026-10-01', monto: '1', docs: [{ uuid: C.U(1), ant: '1', pagado: '1', insoluto: '0' }] }] }).replace('Version="2.0"', 'Version="1.0"'));
const ok5 = leer(C.cfdi({ tipo: 'P', pagos: [{ fecha: '2026-10-01', monto: '2', docs: [{ uuid: C.U(1), ant: '2', pagado: '1', insoluto: '1' }, { uuid: C.U(2), ant: '1', pagado: '1', insoluto: '0' }] },
  { fecha: '2026-10-02', monto: '1', docs: [{ uuid: C.U(1), ant: '1', pagado: '1', insoluto: '0', parc: 2 }] }] }));
console.log('cfdi4: →', ok1.uuid ? 'leído' : ok1.error, '| DOCTYPE →', ok2.error, '| 3.3 →', ok3.error, '| Pagos 1.0 →', ok4.error,
  '| 2 Pago / 3 DoctoRelacionado →', ok5.pagos.length + '/' + ok5.pagos.reduce((s, p) => s + p.documentos.length, 0));
