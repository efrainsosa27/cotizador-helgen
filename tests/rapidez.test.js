// Rapidez en Apps Script (docs/rapidez-apps-script.md): pruebas de regresión de cada mejora, sobre todo de lo que se reusa
// dentro de una petición o entre peticiones (lo que se reusa nunca puede devolver algo viejo después de una escritura).
//  1. IDs de Script Properties y libros abiertos una vez por petición: un libro que se crea en la misma petición se encuentra
//     (no se crea otro) y un ID que falta se vuelve a leer.
//  2. Encabezados revisados: la fila 1 de una pestaña se lee una vez por petición y no se vuelve a leer en 6 h; se revisa otra
//     vez si el código espera otros encabezados, si la pestaña es nueva (creada por el código o a mano) o si pasaron 6 h.
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

// ================= 2. Encabezados revisados =================
{
  const A = crear({ perfil: true });
  const { ok, props, perfil, correr, cache } = A;
  ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' });
  const P1 = 'PRY-' + A.ANIO + '-0001';
  const pedir = () => ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1 }],
    cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q' + Math.random() }).folio;
  pedir();
  const LC = () => A.libros[props.COMPRAS_DB_ID];
  const lecturasFila1 = nombre => perfil.ops.filter(o => o.tipo === 'lee' && o.celdas > 0 && o.hoja.endsWith('/' + nombre) &&
    (o.pila || []).some(f => f === 'hojaDeArea_' || f === 'hojaProyectos_')).length;
  perfil.pila = true;
  // Ya revisadas: otra requisición no lee ninguna fila 1
  perfil.ops = [];
  const r2 = pedir();
  assert.equal(perfil.ops.filter(o => o.tipo === 'lee' && (o.pila || []).some(f => f === 'hojaDeArea_' || f === 'hojaProyectos_')).length, 0,
    'sin lecturas de encabezados de pestañas ya revisadas');
  // Una vez por petición aunque el caché esté vacío (antes: una por cada uso de la pestaña)
  Object.keys(cache).filter(k => k === 'ENCABEZADOS_OK').forEach(k => delete cache[k]);
  perfil.ops = [];
  ok('pedro', 'getRequisicion', r2);
  for (const n of ['Requisiciones', 'RequisicionesRenglones', 'Proveedores']) assert(lecturasFila1(n) <= 1, n + ': ' + lecturasFila1(n));
  // El código espera otra columna (versión nueva): se revisa y se repone la fila 1 aunque estuviera anotada
  const ev = LC().pest.RequisicionesEventos.m;
  correr("HOJAS_COMPRAS.RequisicionesEventos.enc.push('columna_nueva')");
  pedir();
  assert.equal(ev[0][ev[0].length - 1], 'columna_nueva', 'encabezado nuevo escrito');
  correr("HOJAS_COMPRAS.RequisicionesEventos.enc.pop()");
  const nEv = ev.length;
  pedir(); // como antes: una columna de más al final no se borra (solo se comparan las que espera el código)
  assert(ev.length > nEv && ev[0][0] === 'req_folio', 'sigue escribiendo eventos con los mismos encabezados');
  // Alguien borra la pestaña Bitacora y la vuelve a crear vacía a mano (otro id de pestaña): se revisa y la fila 1 queda con
  // encabezados antes de agregar renglones (si no, el primer renglón quedaría en la fila 1 y se leería como encabezado)
  delete LC().pest.Bitacora;
  LC().pest.Bitacora = A.hoja([]);
  pedir();
  const bit = LC().pest.Bitacora.m;
  assert.equal(bit[0][0], 'fecha', 'encabezados repuestos en la pestaña nueva');
  assert.equal(bit.length, 2, 'el renglón quedó en la fila 2');
  // La pestaña la borra alguien y el código la vuelve a crear (insertSheet): siempre con encabezados
  delete LC().pest.Bitacora;
  pedir();
  assert.equal(LC().pest.Bitacora.m[0][0], 'fecha');
  // Encabezado dañado a mano en la misma pestaña: dentro de las 6 h no se relee; vencida la anotación, se repara
  LC().pest.Bitacora.m[0][0] = 'xx';
  pedir();
  assert.equal(LC().pest.Bitacora.m[0][0], 'xx', 'anotada: no se relee (se repara a más tardar 6 h después)');
  const ok6 = JSON.parse(cache.ENCABEZADOS_OK);
  Object.keys(ok6).forEach(k => { if (/\/Bitacora\//.test(k)) ok6[k] = Date.now() - 6 * 3600 * 1000 - 1; });
  cache.ENCABEZADOS_OK = JSON.stringify(ok6);
  pedir();
  assert.equal(LC().pest.Bitacora.m[0][0], 'fecha', 'vencida: se revisa y se repara');
  // Una anotación vencida no se queda en el caché al guardar otras
  assert(Object.values(JSON.parse(cache.ENCABEZADOS_OK)).every(t => Date.now() - t < 6 * 3600 * 1000));
}

console.log('rapidez: todo bien');
