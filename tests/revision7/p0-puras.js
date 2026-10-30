'use strict';
const A = require('../arnes')(process.argv[2] || '.', {});
const { P, plain } = A;
// importeDeTexto con punto de miles (Excel es-ES, separador ;)
console.log('importe "45.000" ->', P.importeDeTexto('45.000'), ' "45,000" ->', P.importeDeTexto('45,000'), ' "1.250.000" ->', P.importeDeTexto('1.250.000'));
console.log(plain(P.leerCsvCostos('correo;mes;costo\nana@helgen.tech;2026-10;45.000\n')));
