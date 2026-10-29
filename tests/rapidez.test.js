// Rapidez en Apps Script (docs/rapidez-apps-script.md): pruebas de regresión de cada mejora, sobre todo de lo que se reusa
// dentro de una petición o entre peticiones (lo que se reusa nunca puede devolver algo viejo después de una escritura).
//  1. IDs de Script Properties y libros abiertos una vez por petición: un libro que se crea en la misma petición se encuentra
//     (no se crea otro) y un ID que falta se vuelve a leer.
// Uso: node tests/rapidez.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const crear = extra => require('./arnes')(dir, Object.assign({ props: {
  ROL_COMPRAS: 'pedro@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech',
  SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: '', SUPER_ADMIN: 'leo@helgen.tech' } }, extra || {}));

// ================= 1. IDs y libros por petición =================
{
  const A = crear({ perfil: true });
  const { ok, props, perfil } = A;
  // Sin libro de cobranza: la primera llamada lo crea (lee COBRANZA_DB_ID, no está; lo crea bajo candado) y en la misma
  // petición lo vuelve a buscar: debe encontrar el recién creado, no crear otro
  assert.equal(props.COBRANZA_DB_ID, undefined);
  const antes = Object.keys(A.libros).length;
  ok('efrain', 'listarProyectosCobranza', '');
  assert(props.COBRANZA_DB_ID, 'se creó el libro de cobranza');
  assert.equal(Object.keys(A.libros).length, antes + 1, 'un solo libro nuevo');
  ok('efrain', 'listarProyectosCobranza', '');
  assert.equal(Object.keys(A.libros).length, antes + 1, 'la segunda vez no crea otro');
  // Cada libro se abre una sola vez por petición y las propiedades se leen una vez (más las frescas: contadores y versiones)
  const p = ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio;
  perfil.ops = [];
  ok('efrain', 'getCobranzaProyecto', p);
  const abiertos = perfil.ops.filter(o => o.tipo === 'abrir').map(o => o.hoja);
  assert.deepEqual(abiertos, abiertos.filter((x, i) => abiertos.indexOf(x) === i), 'ningún libro se abre dos veces: ' + abiertos);
  // (COMPRAS_DB_ID todavía no existe: ese sí se lee directo cada vez, por si otra petición lo acaba de crear)
  const ids = perfil.ops.filter(o => o.tipo === 'props' && /^get (SPREADSHEET_ID|FOLDER_ID|COBRANZA_DB_ID)$/.test(o.que));
  assert.deepEqual(ids, [], 'los IDs salen de la lectura de propiedades de la petición');
  assert(perfil.ops.some(o => o.que === 'get COMPRAS_DB_ID'), 'el que falta se lee directo');
  // Un ID que se borra entre peticiones (p. ej. a mano) se nota en la siguiente: la petición nueva lee las propiedades otra vez
  const idCob = props.COBRANZA_DB_ID;
  delete props.COBRANZA_DB_ID;
  ok('efrain', 'listarProyectosCobranza', '');
  assert.notEqual(props.COBRANZA_DB_ID, idCob, 'sin el ID, se crea de nuevo (como antes)');
}

console.log('rapidez: todo bien');
