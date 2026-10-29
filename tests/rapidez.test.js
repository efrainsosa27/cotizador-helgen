// Rapidez en Apps Script (docs/rapidez-apps-script.md): pruebas de regresión de cada mejora, sobre todo de lo que se reusa
// dentro de una petición o entre peticiones (lo que se reusa nunca puede devolver algo viejo después de una escritura).
//  1. IDs de Script Properties y libros abiertos una vez por petición: un libro que se crea en la misma petición se encuentra
//     (no se crea otro) y un ID que falta se vuelve a leer.
//  2. Encabezados revisados: la fila 1 de una pestaña se lee una vez por petición y no se vuelve a leer en 6 h; se revisa otra
//     vez si el código espera otros encabezados, si la pestaña es nueva (creada por el código o a mano) o si pasaron 6 h; y si
//     alguien la vació a mano, se reponen antes de la primera escritura (ningún renglón cae en la fila 1).
//  3. Filas leídas en la petición (MEMO_.filas): toda escritura de Code.js pasa por escribe_ y todo candado por candado_ (revisión
//     del código); una lectura después de escribir ve lo escrito; al tomar el candado se relee lo que otro cambió; al leer las
//     versiones se olvida lo leído antes; quien recibe filas puede cambiarlas sin tocar las de los demás. (Además, el arnés
//     falla cualquier prueba que escriba en una pestaña con sus filas guardadas.)
//  4. Config y la carpeta del área una vez por petición: getConfig_ lee Config una vez (y relee si hubo que migrar);
//     configLigera_ se reusa también en las escrituras y se olvida al escribir; carpetaArea_ busca y revisa la carpeta una vez.
//  5. Escribir en una pestaña olvida solo lo leído de esa pestaña (las demás siguen guardadas); escribir en el libro (crear o
//     borrar una pestaña) o en algo que no es una pestaña olvida todo.
//  6. Las vistas de compras (requisición y órdenes del proyecto) toman moneda y línea del caché de contratos: sin leer Contratos
//     si nada cambió y con la moneda nueva en cuanto cobranza marca otra cotización aceptada.
//  7. Encabezados de Cotizaciones y del catálogo (columnas SAT): revisados una vez en 6 h, y repuestos si faltan.
//  8. Caché: un valor que cabe en un trozo va en la misma entrada (una lectura); uno grande, en trozos; lo guardado con el
//     formato de antes (N:n + trozos) se sigue leyendo; null y valores con acentos regresan iguales.
//  9. La sincronización revisa Permisos con lo que ya trajo para los roles (sin pedirlo otra vez al caché) y, cuando toca
//     releer la hoja, un cambio a mano en Permisos sí se detecta (sube la versión; la siguiente consulta y cada función ya
//     usan los permisos nuevos, como antes).
// 10. Una fuente ya leída en la petición (proyectos) no se reusa si la versión cambió a media petición: una lista que se guarda
//     en caché con la versión nueva no lleva el dato de antes (antes quedaba así hasta 6 h).
// Revisión independiente de la rapidez (una sección por hallazgo):
// 11. Memos derivados (MEMOS_DERIVADOS_: devoluciones, pagos a proveedor, anulados, roles, Config ligera): se olvidan al releer
//     las versiones, con el candado (menos los roles) y al escribir en su pestaña; el arnés falla una escritura en su pestaña con
//     el memo guardado; el activador ya no guarda «mis requisiciones» con una devolución resuelta como Abierta.
// 12. Huella cambiada y una escritura en medio: lo que la consulta de fondo guarda con la versión que subió se lee después de
//     subirla (lleva el proyecto que otra ejecución creó mientras tanto).
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
  // Alguien vacía a mano la pestaña (con todo y encabezados) sin borrarla: la anotación sigue vigente, pero antes de la primera
  // escritura se ve que está vacía y se reponen los encabezados; el renglón nuevo queda en la fila 2 (como antes)
  for (const n of ['Bitacora', 'RequisicionesEventos', 'Requisiciones']) LC().pest[n].m.length = 0;
  perfil.ops = [];
  const r3 = pedir();
  for (const n of ['Bitacora', 'RequisicionesEventos', 'Requisiciones']) {
    const m = LC().pest[n].m;
    assert.equal(m[0][0], n === 'Bitacora' ? 'fecha' : n === 'Requisiciones' ? 'folio' : 'req_folio', n + ': encabezados en la fila 1');
    assert(m.length >= 2 && String(m[1][0]).length > 0, n + ': el renglón nuevo en la fila 2');
  }
  assert.equal(LC().pest.Requisiciones.m[1][0], r3);
  // Sin vaciar: cada pestaña escrita se revisa con una sola llamada barata por petición (getLastRow), sin leer la fila 1
  perfil.ops = [];
  pedir();
  const fila1 = perfil.ops.filter(o => o.tipo === 'lee' && (o.pila || [])[0] === 'revisar' && /\/(Bitacora|RequisicionesEventos)$/.test(o.hoja));
  assert.equal(fila1.length, 0, JSON.stringify(fila1));
  assert.equal(perfil.ops.filter(o => o.tipo === 'ultimaFila' && /\/Bitacora$/.test(o.hoja) && (o.pila || [])[0] === 'escribe_').length, 1,
    'una revisión barata de la Bitacora en la petición');
}

// ================= 3. Filas leídas en la petición =================
{
  const fs = require('fs'), path = require('path');
  const { escrituras } = require('./escrituras');
  const src = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
  const sin = escrituras(src).filter(e => !/^escribe_\(/.test(e.cadena));
  assert.deepEqual(sin.map(e => 'línea ' + e.linea + ': ' + e.cadena.slice(0, 60) + '.' + e.metodo), [],
    'toda escritura a una hoja pasa por escribe_(…) (si no, una lectura posterior en la misma petición vería filas viejas)');
  assert(escrituras(src).length > 100, 'el revisor encuentra las escrituras');
  const candados = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /LockService\.getScriptLock\(\)/.test(l) && !/^\s*\*|^\s*\/\//.test(l));
  assert.equal(candados.length, 1, 'solo candado_ toma LockService.getScriptLock(): ' + candados.map(x => x[0]).join(', '));

  const A = crear({ perfil: true });
  const { ok, props, perfil, correr, como, P } = A;
  P.exigirDocumentosParaPagar_ = function () {};
  const P1 = ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio;
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1 }],
    cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q1' }).folio;
  const H = () => A.libros[props.COMPRAS_DB_ID].pest.Requisiciones;
  const estado = () => correr(`buscarReq_(libroCompras_(), ${JSON.stringify(folio)}).req.estado`);
  const lecturasReq = () => perfil.ops.filter(o => o.tipo === 'lee' && /\/Requisiciones$/.test(o.hoja)).length;
  // Dentro de una petición: la segunda lectura sale de lo guardado; después de escribir, se relee y se ve lo escrito
  como('pedro@helgen.tech');
  perfil.ops = [];
  assert.equal(estado(), 'Solicitada');
  assert.equal(estado(), 'Solicitada');
  assert.equal(lecturasReq(), 1, 'una sola lectura de Requisiciones para dos búsquedas');
  correr(`(() => { const b = buscarReq_(libroCompras_(), ${JSON.stringify(folio)}); cambiarReq_(b.hoja, b.req, 'Rechazada', { motivo: 'prueba de memoria' }); })()`);
  assert.equal(estado(), 'Rechazada', 'después de escribir se ve lo escrito');
  // Otra ejecución cambia la hoja mientras esta espera el candado: adentro del candado se relee
  const fila = H().m.findIndex(r => r[0] === folio);
  assert.equal(estado(), 'Rechazada');
  H().m[fila][5] = 'Solicitada'; // "otra persona" (otra ejecución) la regresó
  assert.equal(estado(), 'Rechazada', 'fuera del candado, la misma petición sigue con lo que leyó');
  assert.equal(correr(`conCandado_(() => buscarReq_(libroCompras_(), ${JSON.stringify(folio)}).req.estado)`), 'Solicitada',
    'al tomar el candado se olvida lo leído antes');
  // Leer las versiones también lo olvida (una lista guardada con una versión se arma con filas leídas después de ella)
  assert.equal(estado(), 'Solicitada');
  H().m[fila][5] = 'Devuelta';
  correr('versiones_(true)');
  assert.equal(estado(), 'Devuelta');
  // Copias: quien recibe las filas puede cambiarlas
  correr(`filasDeArea_(hojaReq_(libroCompras_()), HOJAS_COMPRAS, 'Requisiciones').forEach(r => { r[5] = 'Cambiada en memoria'; })`);
  assert.equal(estado(), 'Devuelta', 'las filas guardadas no cambian');
  H().m[fila][5] = 'Solicitada';
  correr('MEMO_ = {}');
  // De punta a punta: pagar una autorizada y la vista que regresa (y la siguiente sincronización) ya dicen Pagada
  const oc = ok('pedro', 'autorizarRequisicion', folio, { proveedor: { razonSocial: 'Ferretera' }, fechaEntrega: A.masDias(1), lugarEntrega: 'Querétaro', formaPago: 'Transferencia',
    condicionesPago: 'Contado', diasCredito: 0, renglones: [{ descripcion: 'Cable', unidad: 'PZA', cantidad: 1, costo: 100 }], idSolicitud: 'oc1' }).ocFolio;
  const vers = ok('pedro', 'bootstrap').versiones;
  const v = ok('pedro', 'registrarPagoProveedor', { reqFolio: folio, fecha: A.HOY_ISO, monto: 116, monedaPago: 'MXN', metodo: 'Transferencia',
    referencia: 'SPEI 1', comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'pg1' });
  assert.deepEqual([v.vista.requisicion.estado, v.vista.orden.estado, v.vista.pagos.length], ['Pagada', 'Pagada', 1]);
  const sy = ok('pedro', 'sincronizar', vers, { req: folio, rcBuscar: '', rcEstado: '' });
  assert.equal(sy.requisicion.requisicion.estado, 'Pagada');
  assert.equal(sy.comRequisiciones.find(r => r.folio === folio).estado, 'Pagada');
  assert.equal(oc, sy.requisicion.orden.folio);
}

// ================= 4. Config y carpeta del área por petición =================
{
  const A = crear({ perfil: true });
  const { ok, props, perfil, correr, como } = A;
  const cfg = A.libros.DB.pest.Config.m;
  cfg.push(['SITIOS', 'QRO | Querétaro']);
  ok('ana', 'bootstrap'); // migra Config la primera vez (agrega las claves que faltan)
  const leeConfig = () => perfil.ops.filter(o => (o.tipo === 'lee' || o.tipo === 'dataRange') && /\/Config$/.test(o.hoja)).length;
  como('pedro@helgen.tech');
  perfil.ops = [];
  correr('getConfig_()');
  assert.equal(leeConfig(), 2, 'una lectura (getDataRange + getValues), no dos');
  // Si falta una clave, se migra y lo que regresa ya la trae (se relee después de migrar)
  const i = cfg.findIndex(r => r[0] === 'VIGENCIA_DIAS');
  const quitada = cfg.splice(i, 1)[0];
  const c = correr('getConfig_()');
  assert(cfg.some(r => r[0] === 'VIGENCIA_DIAS'), 'migró');
  assert.equal(String(c.VIGENCIA_DIAS), String(cfg.find(r => r[0] === 'VIGENCIA_DIAS')[1]), 'devuelve lo migrado');
  // En una escritura (sin caché) Config se lee una vez aunque se pida varias veces; escribir en Config la olvida
  correr('MEMO_ = {}; SIN_CACHE_ = true;');
  perfil.ops = [];
  correr('sitios_(); sitiosDetalle_(); sitios_();');
  assert.equal(leeConfig(), 2, 'una sola lectura de Config para tres usos');
  const filaSitios = cfg.findIndex(r => r[0] === 'SITIOS') + 1;
  correr(`escribe_(db_().getSheetByName('Config')).getRange(${filaSitios}, 2).setValue('VER | Veracruz (ICAVE)')`);
  assert.deepEqual(A.plain(correr('sitios_()')), ['Veracruz (ICAVE)'], 'después de escribir en Config se relee');
  correr('SIN_CACHE_ = false; MEMO_ = {};');
  // La carpeta del área: buscarla y revisar sus permisos una vez por petición
  ok('obrero', 'guardarRequisicion', { proyectoFolio: ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio,
    sitio: 'Veracruz (ICAVE)', renglones: [{ descripcion: 'Cable', cantidad: 1 }], cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q1' });
  como('pedro@helgen.tech');
  perfil.ops = [];
  correr('carpetaCompras_(); carpetaCompras_(); carpetaCompras_();');
  assert.equal(perfil.ops.filter(o => o.tipo === 'drive' && o.que === 'getFolderById').length, 1);
  assert.equal(perfil.ops.filter(o => o.tipo === 'urlfetch').length, 1, 'los permisos se revisan una vez');
  correr('MEMO_ = {}');
  perfil.ops = [];
  correr('carpetaCompras_()');
  assert.equal(perfil.ops.filter(o => o.tipo === 'urlfetch').length, 1, 'en otra petición se vuelven a revisar');
  void quitada; void props;
}

// ================= 5. Olvidar por pestaña =================
{
  const A = crear({ perfil: true });
  const { ok, props, perfil, correr, como } = A;
  const P1 = ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio;
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1 }],
    cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q1' }).folio;
  const lecturas = n => perfil.ops.filter(o => o.tipo === 'lee' && o.hoja.endsWith('/' + n)).length;
  como('pedro@helgen.tech');
  const F = JSON.stringify(folio);
  const leerTodo = () => correr(`(() => { const l = libroCompras_(); buscarReq_(l, ${F}); filasDeArea_(hojaCompras_(l, 'RequisicionesEventos'), HOJAS_COMPRAS, 'RequisicionesEventos'); filasProyectos_(); })()`);
  leerTodo(); // la primera lectura de versiones de la petición olvida lo leído antes (§3): se lee todo dos veces
  leerTodo();
  perfil.ops = [];
  // Un evento nuevo (escritura en RequisicionesEventos): Requisiciones y Proyectos siguen guardadas; Eventos se relee y trae el nuevo
  correr(`eventoReq_(libroCompras_(), ${F}, 'Solicitada', 'nota de prueba')`);
  leerTodo();
  assert.deepEqual([lecturas('Requisiciones'), lecturas('Proyectos'), lecturas('RequisicionesEventos')], [0, 0, 1]);
  assert(correr(`filasDeArea_(hojaCompras_(libroCompras_(), 'RequisicionesEventos'), HOJAS_COMPRAS, 'RequisicionesEventos')`)
    .some(r => r[5] === 'nota de prueba'), 'el evento nuevo se ve');
  // Cambiar el estado (Requisiciones): se relee esa y nada más
  perfil.ops = [];
  correr(`(() => { const b = buscarReq_(libroCompras_(), ${F}); cambiarReq_(b.hoja, b.req, 'Rechazada', { motivo: 'por pestaña' }); })()`);
  assert.equal(correr(`buscarReq_(libroCompras_(), ${F}).req.estado`), 'Rechazada');
  assert.deepEqual([lecturas('Requisiciones'), lecturas('Proyectos'), lecturas('RequisicionesEventos')], [1, 0, 0]);
  // Escribir en el libro (crear una pestaña) olvida todo
  perfil.ops = [];
  correr(`escribe_(libroCompras_()).insertSheet('Otra')`);
  leerTodo();
  assert.deepEqual([lecturas('Requisiciones'), lecturas('Proyectos'), lecturas('RequisicionesEventos')], [1, 1, 1]);
  void props;
}

// ================= 6. Vistas de compras con el caché de contratos =================
{
  const A = crear({ perfil: true });
  const { ok, perfil } = A;
  A.P.exigirDocumentosParaPagar_ = function () {};
  const P1 = ok('ana', 'crearProyecto', { nombre: 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio;
  const folio = ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1 }],
    cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q1' }).folio;
  const cot = (moneda, n) => ok('ana', 'guardarCotizacion', { cliente: { nombre: 'Luis' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 100 }],
    proyectoFolio: P1, moneda, tipoCambio: moneda === 'USD' ? 18 : '', idSolicitud: 'c' + n }).folio;
  const cMxn = cot('MXN', 1), cUsd = cot('USD', 2);
  assert.equal(ok('pedro', 'getRequisicion', folio).moneda, 'MXN', 'sin aceptada: MXN');
  ok('efrain', 'marcarAceptada', P1, cUsd);
  let v = ok('pedro', 'getRequisicion', folio);
  assert.deepEqual([v.moneda, v.sinContrato], ['USD', false], 'la aceptada nueva se ve de inmediato (sube la versión de contratos)');
  perfil.ops = [];
  v = ok('pedro', 'getRequisicion', folio);
  assert.equal(v.moneda, 'USD');
  assert.equal(perfil.ops.filter(o => o.tipo === 'lee' && /\/Contratos$/.test(o.hoja)).length, 0, 'no lee Contratos si nada cambió');
  ok('efrain', 'marcarAceptada', P1, cMxn);
  assert.equal(ok('pedro', 'getRequisicion', folio).moneda, 'MXN');
  assert.equal(ok('pedro', 'getComprasProyecto', P1).moneda, 'MXN', 'órdenes por proyecto: igual');
}

// ================= 7. Encabezados de Cotizaciones y del catálogo =================
{
  const A = crear({ perfil: true });
  const { ok, perfil, cache } = A;
  perfil.pila = true;
  const guardar = n => ok('ana', 'guardarCotizacion', { cliente: { nombre: 'Luis' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 100 }],
    idSolicitud: 'c' + n }).folio;
  const filas1 = () => perfil.ops.filter(o => o.tipo === 'lee' && ((/\/Cotizaciones$/.test(o.hoja) && (o.pila || [])[0] === 'revisarEnc') ||
    (/\/Catalogo$/.test(o.hoja) && (o.pila || []).indexOf('asegurarColumnasSat_') !== -1 && o.celdas === 2))).length;
  perfil.ops = [];
  guardar(1);
  assert.equal(filas1(), 2, 'la primera vez se revisan los dos encabezados');
  const cot = A.libros.DB.pest.Cotizaciones.m, cat = A.libros.CAT.pest.Catalogo.m;
  assert.equal(cot[0][19], 'proyecto_folio', 'encabezados de Cotizaciones escritos');
  perfil.ops = [];
  guardar(2);
  assert.equal(filas1(), 0, 'después, ninguno');
  // Vencida la anotación (6 h) se revisan y se reponen
  cat[0][6] = ''; cot[0][19] = 'x';
  const ok6 = JSON.parse(cache.ENCABEZADOS_OK);
  Object.keys(ok6).forEach(k => { ok6[k] = Date.now() - 6 * 3600 * 1000 - 1; });
  cache.ENCABEZADOS_OK = JSON.stringify(ok6);
  guardar(3);
  assert.deepEqual([cat[0][6], cot[0][19]], ['Clave SAT', 'proyecto_folio'], 'repuestos');
}

// ================= 8. Formato del caché =================
{
  const A = crear({ perfil: true });
  const { correr, cache, perfil, plain } = A;
  const chico = { a: 'Señalización — ñ', n: [1, 2, 3] };
  correr(`guardarCache_('K_prueba_chico', ${JSON.stringify(chico)}, 600)`);
  assert.equal(cache.K_prueba_chico.slice(0, 2), 'V:', 'en la misma entrada');
  perfil.ops = [];
  assert.deepEqual(plain(correr(`leerCache_('K_prueba_chico')`)), chico);
  assert.equal(perfil.ops.filter(o => o.tipo === 'cache').length, 1, 'una lectura');
  correr(`guardarCache_('K_prueba_nulo', null, 600)`);
  assert.equal(correr(`leerCache_('K_prueba_nulo')`), null, 'null se guarda (no es "no está")');
  assert.equal(correr(`leerCache_('K_no_existe')`), undefined);
  const grande = Array.from({ length: 3000 }, (_, i) => 'renglón ' + i + ' con acentos áéíóú');
  correr(`guardarCache_('K_prueba_grande', ${JSON.stringify(grande)}, 600)`);
  assert(/^N:\d+$/.test(cache.K_prueba_grande) && cache['K_prueba_grande#1'], 'en trozos');
  assert.deepEqual(plain(correr(`leerCache_('K_prueba_grande')`)), grande);
  // Formato de antes (lo dejó la versión publicada): se sigue leyendo
  cache.K_viejo = 'N:1'; cache['K_viejo#0'] = JSON.stringify({ viejo: true });
  assert.deepEqual(plain(correr(`leerCache_('K_viejo')`)), { viejo: true });
  cache.K_roto = 'N:2'; cache['K_roto#0'] = '{"a"';
  assert.equal(correr(`leerCache_('K_roto')`), undefined, 'falta un trozo: no está');
}

// ================= 9. Revisar Permisos en la sincronización =================
{
  const A = crear({ perfil: true });
  const { ok, perfil, cache, props, P } = A;
  P.prepararCapri(); // Permisos en el libro de Administración
  let vers = ok('pedro', 'bootstrap').versiones;
  ok('pedro', 'sincronizar', vers, {}); // deja las marcas R_ (ya se revisaron)
  perfil.ops = [];
  let r = ok('pedro', 'sincronizar', vers, {});
  const gets = n => perfil.ops.filter(o => o.tipo === 'cache' && o.que === 'get' && String(o.clave).indexOf('F_' + n + '_') === 0).length;
  assert.deepEqual([gets('usuarios'), gets('delegaciones')], [1, 1], 'un solo viaje por fuente');
  assert.deepEqual(r.cambios, []);
  // Alguien le quita compras a Pedro a mano en la hoja; vencida la marca, la siguiente consulta lo detecta
  const per = A.libros[props.ADMIN_DB_ID].pest.Permisos.m;
  const fila = per.find(x => x[0] === 'pedro@helgen.tech');
  fila[3] = 'requisicion';
  delete cache.R_usuarios;
  r = ok('pedro', 'sincronizar', vers, {});
  assert(r.cambios.indexOf('permisos') !== -1, 'sube la versión de permisos');
  // Como en la versión publicada: los permisos de esa misma respuesta se calcularon antes de revisar; la siguiente ya los trae
  assert.equal(ok('pedro', 'sincronizar', r.versiones, {}).permisos.compras, false, 'ya no tiene compras');
  A.falla('pedro', 'getRequisicion', ['REQ-1'], /permiso de compras/, 'PERMISO');
}

// ================= 10. Fuente con la versión de la petición =================
{
  const A = crear();
  const { ok, correr, como, props } = A;
  const P1 = ok('ana', 'crearProyecto', { nombre: 'Nombre viejo', cliente: { nombre: 'Luis' }, idSolicitud: 'p1' }).folio;
  ok('obrero', 'guardarRequisicion', { proyectoFolio: P1, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1 }],
    cotizacion: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: 'q1' });
  ok('pedro', 'bootstrap');
  // Una consulta de compras ya trae proyectos; mientras, otra petición cambia el nombre del proyecto y sube la versión; la
  // consulta vuelve a leer las versiones (como sincronizar) y arma la lista de requisiciones (que se guarda con la versión nueva)
  como('pedro@helgen.tech');
  correr('VERSIONES_ = null; SIN_CACHE_ = false;');
  correr('proyectosCache_()');
  A.libros.DB.pest.Proyectos.m[1][2] = 'Nombre nuevo';
  props.VER_proyectos = String(Number(props.VER_proyectos || 0) + 1);
  correr('versiones_(true)');
  assert.equal(correr("listarRequisiciones('', '')")[0].proyectoNombre, 'Nombre nuevo', 'en la misma petición');
  assert.equal(ok('pedro', 'listarRequisiciones', '', '')[0].proyectoNombre, 'Nombre nuevo', 'lo que quedó en caché');
}

// Para las pruebas de la revisión (11 en adelante): el flujo de compras de punta a punta y "otra ejecución" en medio de esta
const compras = A => {
  const { ok } = A;
  A.P.exigirDocumentosParaPagar_ = function () {};
  let n = 0;
  const id = p => p + (++n);
  const proyecto = nombre => ok('ana', 'crearProyecto', { nombre: nombre || 'Uno', cliente: { nombre: 'Luis' }, idSolicitud: id('p') }).folio;
  const pedir = pry => ok('obrero', 'guardarRequisicion', { proyectoFolio: pry, sitio: 'Querétaro', cotizacion: { nombre: 'c.pdf', datos: A.PDF },
    renglones: [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }],
    idSolicitud: id('q') }).folio;
  const autorizar = req => ok('pedro', 'autorizarRequisicion', req, { proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: A.masDias(1),
    lugarEntrega: 'Querétaro', condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Transferencia', idSolicitud: id('oc'),
    renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 }, { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] }).ocFolio;
  const pagar = req => ok('pedro', 'registrarPagoProveedor', { reqFolio: req, fecha: A.HOY_ISO, monto: 1624, monedaPago: 'MXN', metodo: 'Transferencia',
    referencia: 'SPEI ' + id(''), comprobante: { nombre: 'c.pdf', datos: A.PDF }, idSolicitud: id('pg') });
  // Apps Script aísla cada ejecución; aquí comparten el contexto de vm: se guardan las globales de la ejecución en curso, la otra
  // corre por doPost y se restauran
  const otraEjecucion = fn => {
    A.correr('globalThis.__g = { MEMO_: MEMO_, VERSIONES_: VERSIONES_, SIN_CACHE_: SIN_CACHE_, VENDEDOR_: VENDEDOR_ };');
    try { return fn(); } finally {
      A.correr('MEMO_ = __g.MEMO_; VERSIONES_ = __g.VERSIONES_; SIN_CACHE_ = __g.SIN_CACHE_; VENDEDOR_ = __g.VENDEDOR_;');
    }
  };
  return { id, proyecto, pedir, autorizar, pagar, otraEjecucion, LC: () => A.libros[A.props.COMPRAS_DB_ID] };
};

// ================= 11. Memos derivados (devoluciones, pagos, anulados, roles, Config ligera) =================
{
  const A = crear();
  const { ok, correr, plain } = A;
  const C = compras(A);
  // a) Todos se olvidan al tomar el candado y al releer las versiones; escribir en una pestaña olvida los que salen de ella
  const derivados = plain(correr('MEMOS_DERIVADOS_'));
  ['devs', 'pagosProv', 'anulados', 'ctxRoles', 'rolesYo', 'cfgLigera'].forEach(k => assert(derivados[k], 'MEMOS_DERIVADOS_.' + k));
  const llenar = () => correr(`Object.keys(MEMOS_DERIVADOS_).forEach(k => { MEMO_[k] = { de: 'antes' }; })`);
  const vivos = () => plain(correr(`Object.keys(MEMOS_DERIVADOS_).filter(k => MEMO_[k] != null)`));
  const P1 = C.proyecto('Uno');
  const req = C.pedir(P1);
  C.autorizar(req);
  C.pagar(req);
  llenar(); correr('versiones_(true)');
  assert.deepEqual(vivos(), [], 'releer las versiones los olvida');
  llenar(); correr('conCandado_(() => null)');
  assert.deepEqual(vivos(), plain(correr('MEMOS_DE_LA_LLAMADA_')), 'el candado los olvida (menos los roles: una vez por llamada)');
  llenar(); correr(`escribe_({ getName: () => 'Permisos', getSheetId: () => 999, getLastRow: () => 1 })`);
  assert.deepEqual(vivos().filter(k => k === 'ctxRoles' || k === 'rolesYo'), [], 'escribir en Permisos olvida los roles');
  llenar();
  correr(`escribe_(libroCompras_().getSheetByName('PagosProveedores'))`);
  assert.equal(vivos().indexOf('pagosProv'), -1, 'escribir en PagosProveedores olvida los pagos');
  assert.notEqual(vivos().indexOf('devs'), -1, '…y no las devoluciones');
  // b) El arnés falla una escritura en la pestaña de un memo derivado que sigue guardado (no pasó por escribe_)
  correr(`hojaCompras_(libroCompras_(), 'Devoluciones')`);
  correr('MEMO_.devs = []');
  assert.throws(() => correr(`libroCompras_().getSheetByName('Devoluciones').appendRow(['x'])`), /MEMO_\.devs/);
  correr('MEMO_ = {}');
  // c) El activador (cadaQuinceMinutos) paso a paso: lee las devoluciones bajo candado, otra ejecución resuelve una, el activador
  //    sube las versiones y calienta el caché con la lista de quien pidió: esa lista no puede llevar la devolución de antes
  ok('obrero', 'cerrarRequisicion', req, 'Llegó', { renglones: A.conFotos([{ renglon: 1 }, { renglon: 2 }]) });
  const dev = ok('obrero', 'reportarProblema', req, { renglon: 1, cantidad: 10, tipo: 'Dañado', comentario: 'Rollo aplastado',
    foto: { nombre: 'foto.jpg', datos: A.FOTO, mime: 'image/jpeg' }, idSolicitud: 'd1' }).folio;
  const enHoja = () => C.LC().pest.Devoluciones.m.find(r => r[0] === dev)[14];
  ok('obrero', 'misRequisiciones');
  correr('VENDEDOR_ = null; VERSIONES_ = null; SIN_CACHE_ = false; MEMO_ = {};');
  correr(`conCandado_(() => { const l = libroCompras_(); devolucionAbiertaDe_(l, buscarReq_(l, ${JSON.stringify(req)}).req); })`);
  C.otraEjecucion(() => ok('pedro', 'resolverDevolucion', dev, { resolucion: 'Conservar', nota: 'Se queda así', idSolicitud: 'rs1' }));
  assert.notEqual(enHoja(), 'Abierta', 'la otra ejecución la resolvió');
  correr("subirVersiones_(['requisiciones', 'oc'])");
  correr(`(() => { VENDEDOR_ = { email: 'obrero@helgen.tech', nombre: '', apellido: '' }; misRequisiciones(); })()`);
  correr('VENDEDOR_ = null; MEMO_ = {};');
  const mia = ok('obrero', 'misRequisiciones').find(x => x.folio === req);
  assert.deepEqual(mia.devoluciones.map(d => d.estado), [enHoja()], 'lo que quedó en caché trae la devolución como está en la hoja');
}

// ================= 12. Huella cambiada y una escritura en medio =================
{
  const A = crear();
  const { ok, cache, props } = A;
  const C = compras(A);
  // gancho: corre una vez cuando fuenteConHuella_ va a comparar la huella de proyectos (después de leer la hoja y antes de
  // subir la versión)
  let gancho = null;
  const original = A.ctx.CacheService.getScriptCache;
  A.ctx.CacheService.getScriptCache = () => {
    const c = original(), get = c.get;
    c.get = k => { if (gancho && /^H_proyectos/.test(k)) { const g = gancho; gancho = null; g(); } return get(k); };
    return c;
  };
  C.proyecto('Uno');
  const P2 = C.proyecto('Dos');
  const vers = ok('obrero', 'bootstrap').versiones;
  ok('obrero', 'sincronizar', vers, {});
  // Alguien cierra "Dos" a mano (otra huella) y vence la marca: la consulta de fondo relee la hoja; mientras compara la huella,
  // otra ejecución crea "Tres" y sube la versión
  const pry = A.libros.DB.pest.Proyectos.m;
  pry[pry.findIndex(r => r[0] === P2)][6] = 'Cerrado';
  Object.keys(cache).filter(k => /^R_proyectos/.test(k)).forEach(k => delete cache[k]);
  let P3 = '';
  gancho = () => C.otraEjecucion(() => { P3 = C.proyecto('Tres'); });
  const s = ok('obrero', 'sincronizar', vers, {});
  assert(P3 && !gancho, 'la otra ejecución corrió en medio');
  assert.notEqual(s.versiones.proyectos, vers.proyectos, 'subió la versión');
  // Lo que se guardó con la versión nueva ya lleva el proyecto que la otra ejecución creó (y "Dos" cerrado)
  const folios = l => l.map(p => p.folio);
  assert(folios(s.reqProyectos).indexOf(P3) !== -1, 'la consulta lo trae: ' + folios(s.reqProyectos));
  assert(folios(ok('rosa', 'listarProyectosRequisicion', '')).indexOf(P3) !== -1, 'otra persona, del caché, también');
  assert.equal(ok('rosa', 'listarProyectosRequisicion', '').find(p => p.folio === P2).estado, 'Cerrado');
  assert.equal(String(props.VER_proyectos), String(s.versiones.proyectos), 'la versión que vio es la de la propiedad');
}

console.log('rapidez: todo bien');
