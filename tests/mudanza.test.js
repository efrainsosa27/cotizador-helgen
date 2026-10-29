// Mudanza al servidor propio (etapa 1, docs/servidor-etapa-1.md §12): la propiedad API_MUDADA apaga esta copia de Apps
// Script (un solo escritor durante el cambio) y borrarla la regresa. Sin la propiedad, nada cambia.
// Uso: node tests/mudanza.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: { ROL_COMPRAS: 'efrain@helgen.tech' } });
const { ok, post, props, P } = A;

// Sin la propiedad: como siempre
assert(ok('ana', 'bootstrap').usuario === 'ana@helgen.tech');
const p1 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Q', cliente: { nombre: 'Luis' }, idSolicitud: 'm1' }).folio;
const filas = () => A.libros.DB.pest.Proyectos.m.length;
const antes = filas();

// Con API_MUDADA: ninguna función atiende (con o sin sesión, pública o no) y nada se escribe
props.API_MUDADA = 'https://capri.helgen.online';
[['ana', 'bootstrap'], ['ana', 'crearProyecto', { nombre: 'Otra', ubicacion: 'Q', cliente: { nombre: 'X' }, idSolicitud: 'm2' }],
  ['', 'solicitarCodigo', 'juan@helgen.services'], ['nadie', 'listarCotizaciones', '']].forEach(([quien, f, ...args]) => {
  const r = post(quien, f, ...args);
  assert.deepEqual([r.ok, r.codigo], [false, 'MUDADA'], f + ': ' + JSON.stringify(r));
  assert(/servidor nuevo.*Recarga la página/.test(r.error));
});
assert.equal(filas(), antes, 'no se creó el proyecto');
const llamadasAntes = A.llamadas.length;
assert.deepEqual(P.cadaQuinceMinutos(), { mudada: true }, 'el activador no hace nada');
assert.equal(A.llamadas.length, llamadasAntes, 'ni centro de mando ni Drive');

// Regreso: se borra la propiedad y todo sigue donde estaba
delete props.API_MUDADA;
assert(ok('ana', 'bootstrap').proyectos.some(p => p.folio === p1));
assert(ok('ana', 'crearProyecto', { nombre: 'Otra', ubicacion: 'Q', cliente: { nombre: 'X' }, idSolicitud: 'm2' }).folio !== p1);
console.log('✔ mudanza: API_MUDADA apaga Apps Script (doPost y activador) y borrarla lo regresa');
