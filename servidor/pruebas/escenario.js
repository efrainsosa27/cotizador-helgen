// Escenario de paridad (el flujo de compras completo): bootstrap → requisición → autorizar (emite la OC) → pagar →
// recibir. Lo corren igual el arnés directo (tests/arnes.js) y el servidor por HTTP (pruebas/paridad.test.js).
// llamar(quien, funcion, ...args) → la respuesta cruda de doPost: {ok, datos | error, codigo}.
'use strict';

const PROPS = {
  ROL_COMPRAS: 'efrain@helgen.tech', ROL_COBRANZA: 'efrain@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: '',
};

/**
 * El escenario como generador de llamadas (para que el mismo código sirva síncrono con el arnés y asíncrono con HTTP).
 * Cada `yield [nombre, quien, funcion, ...args]` regresa la respuesta.
 */
function* escenario(ahoraMs) {
  const pad2 = n => String(n).padStart(2, '0');
  const isoDe = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const hoy = isoDe(new Date(ahoraMs)), manana = isoDe(new Date(ahoraMs + 86400000));
  const PDF = Buffer.from('%PDF-1.4 cotizacion del proveedor').toString('base64');
  const FOTO = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1]).toString('base64');
  const debe = (r, que) => { if (!r || !r.ok) throw new Error(que + ' falló: ' + JSON.stringify(r)); return r.datos; };

  // 1 · Entrada y proyecto (ventas)
  yield ['sin sesión', '', 'bootstrap'];
  yield ['token inválido', 'nadie', 'bootstrap'];
  yield ['bootstrap de ana', 'ana', 'bootstrap'];
  const proyecto = debe(yield ['crear proyecto', 'ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro',
    cliente: { nombre: 'Luis', empresa: 'Solar del Bajío', rfc: 'SBA010101AB1' }, idSolicitud: 'p-paridad-1' }], 'crear proyecto').folio;
  yield ['crear proyecto (repetido: idempotencia)', 'ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro',
    cliente: { nombre: 'Luis', empresa: 'Solar del Bajío', rfc: 'SBA010101AB1' }, idSolicitud: 'p-paridad-1' }];
  yield ['listar proyectos', 'ana', 'listarProyectos', '', false];
  yield ['sin permiso de compras', 'ana', 'listarRequisiciones', '', ''];

  // 2 · Requisición (quien pide: obrero)
  yield ['bootstrap de obrero', 'obrero', 'bootstrap'];
  yield ['proyectos para pedir', 'obrero', 'listarProyectosRequisicion', ''];
  const renglones = [{ descripcion: 'Cable THW 10', cantidad: 80, unidad: 'm' }, { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza', notas: 'Galvanizado' }];
  yield ['requisición sin cotización (error)', 'obrero', 'guardarRequisicion', { proyectoFolio: proyecto, sitio: 'Querétaro', renglones, idSolicitud: 'q-sin' }];
  const req = debe(yield ['guardar requisición', 'obrero', 'guardarRequisicion', { proyectoFolio: proyecto, sitio: 'Querétaro', renglones,
    cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: 'q-paridad-1' }], 'guardar requisición').folio;
  yield ['guardar requisición (repetida)', 'obrero', 'guardarRequisicion', { proyectoFolio: proyecto, sitio: 'Querétaro', renglones,
    cotizacion: { nombre: 'cot.pdf', datos: PDF }, idSolicitud: 'q-paridad-1' }];
  yield ['mis requisiciones', 'obrero', 'misRequisiciones'];
  yield ['quien pide no autoriza (error)', 'obrero', 'autorizarRequisicion', req, {}];

  // 3 · Compras autoriza (emite la OC con PDF)
  yield ['bootstrap de efrain', 'efrain', 'bootstrap'];
  yield ['requisiciones de compras', 'efrain', 'listarRequisiciones', '', ''];
  yield ['ver requisición', 'efrain', 'getRequisicion', req];
  const oc = { proveedor: { razonSocial: 'Ferretera del Puerto', rfc: 'FPU990101AA1', correo: 'ventas@ferretera.mx' }, fechaEntrega: manana,
    lugarEntrega: 'Querétaro', condicionesPago: 'Contado', diasCredito: 0, formaPago: 'Efectivo', idSolicitud: 'oc-paridad-1',
    renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80, costo: 10 }, { descripcion: 'Tubo conduit 3/4', unidad: 'PZA', cantidad: 12, costo: 50 }] };
  yield ['autorizar sin costo (error)', 'efrain', 'autorizarRequisicion', req, Object.assign({}, oc, { idSolicitud: 'oc-mal',
    renglones: [{ descripcion: 'Cable THW 10', unidad: 'M', cantidad: 80 }] })];
  const ocFolio = debe(yield ['autorizar requisición', 'efrain', 'autorizarRequisicion', req, oc], 'autorizar').ocFolio;
  yield ['autorizar (repetida)', 'efrain', 'autorizarRequisicion', req, oc];
  yield ['órdenes del proyecto', 'efrain', 'getComprasProyecto', proyecto];

  // 4 · Pago al proveedor ($1,400 + IVA = $1,624)
  const pago = { reqFolio: req, fecha: hoy, monto: 1624, monedaPago: 'MXN', metodo: 'Efectivo', referencia: '',
    comprobante: { nombre: 'recibo.pdf', datos: PDF }, idSolicitud: 'pg-paridad-1' };
  yield ['pago con monto distinto (error)', 'efrain', 'registrarPagoProveedor', Object.assign({}, pago, { monto: 1500, idSolicitud: 'pg-mal' })];
  yield ['registrar pago', 'efrain', 'registrarPagoProveedor', pago];
  yield ['registrar pago (repetido)', 'efrain', 'registrarPagoProveedor', pago];
  yield ['sincronizar de obrero', 'obrero', 'sincronizar', {}, {}];

  // 5 · Recepción ("Recibí el material", con una foto por renglón)
  const fotos = { renglones: [1, 2].map(n => ({ renglon: n, foto: { nombre: 'foto.jpg', datos: FOTO, mime: 'image/jpeg' } })) };
  yield ['recibir sin fotos (error)', 'obrero', 'cerrarRequisicion', req, 'Llegó completo', {}];
  yield ['recibí el material', 'obrero', 'cerrarRequisicion', req, 'Llegó completo', fotos];
  yield ['requisición cerrada (compras)', 'efrain', 'getRequisicion', req];
  yield ['mis requisiciones (cerrada)', 'obrero', 'misRequisiciones'];
  yield ['pendientes de efrain', 'efrain', 'pendientes', false];
  yield ['sincronizar de efrain', 'efrain', 'sincronizar', {}, { req }];
  return { proyecto, req, ocFolio };
}

module.exports = { PROPS, escenario };
