// Incremento 5 · módulo F (proveedores y forma de pago). Lógica pura: formas de pago (FORMAS_PAGO_OC, regla de lectura de las
// órdenes de antes, crédito con días ≥ 1, recibeAntesDePagar_), métodos del pago (METODOS_PAGO; números de tarjeta rechazados),
// CLABE con dígito verificador, ficha del proveedor, avisos de documentos (faltan, domicilio > 3 meses, CSF > 12 meses), Pendientes
// con crédito y el correo proveedor.banco. Por doPost: permisos (solo compras y super admin), alta automática al emitir la orden con
// su forma de pago (hoja, PDF, avisoProveedor), ficha con banco y documentos en Drive (privados, "(2)" al reemplazar), cambio de
// banco con carátula nueva + Bitácora + correo a compras (últimos 4), bloqueo del pago sin CSF y carátula (excepción de super admin
// con motivo), banco y CLABE en la vista del pago, crédito del proveedor en el flujo de siempre (recibir antes de pagar, Pendientes,
// pago que cierra), propuesta con forma de pago (flujo con aprobaciones) y sincronizar. Interfaz: módulo mod-proveedores con DOM simulado.
// Uso: node tests/proveedores.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech',
  ROL_COBRANZA: 'efrain@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr, ANIO, PDF, FOTOS } = A;
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64');
const TXT = Buffer.from('hola, no soy un PDF').toString('base64');
const CLABE1 = '032180000118359719', CLABE2 = '002010077777777771';
const meses = n => P.sumarMeses(HOY_ISO, n);

// ================= Lógica pura =================
assert.deepEqual(plain(P.FORMAS_PAGO_OC || correr('FORMAS_PAGO_OC')),
  ['Transferencia', 'Crédito del proveedor', 'Tarjeta de crédito', 'Tarjeta de débito (en sitio)', 'Efectivo', 'Cheque']);
assert.deepEqual(plain(correr('METODOS_PAGO')), ['Transferencia', 'Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Cheque']);
assert.deepEqual(plain(correr('METODOS_COBRO')), ['Transferencia', 'Efectivo', 'Cheque'], 'cobranza (clientes) no cambia');
// Forma de pago: obligatoria; crédito con días ≥ 1; órdenes de antes por sus días de crédito
assert.equal(P.formaPagoDeOrden('', 0), 'Transferencia');
assert.equal(P.formaPagoDeOrden('', 30), 'Crédito del proveedor');
assert.equal(P.formaPagoDeOrden(null, ''), 'Transferencia');
assert.equal(P.formaPagoDeOrden('  crédito DEL proveedor ', 0), 'Crédito del proveedor', 'sin distinguir mayúsculas ni acentos');
assert.equal(P.formaPagoDeOrden('Efectivo', 30), 'Efectivo', 'la guardada manda');
assert.equal(P.formaPagoDeOrden('algo raro', 15), 'Crédito del proveedor', 'una celda editada a mano se lee por los días');
assert.throws(() => P.normalizarFormaPago('', 0), /Elige la forma de pago/);
assert.throws(() => P.normalizarFormaPago('Bitcoin', 0), /Forma de pago no válida/);
assert.throws(() => P.normalizarFormaPago('Crédito del proveedor', 0), /días de crédito \(1 o más\)/);
assert.equal(P.normalizarFormaPago('tarjeta de debito (en sitio)', 0), 'Tarjeta de débito (en sitio)');
assert.equal(P.normalizarFormaPago('Transferencia', 30), 'Transferencia', 'las demás aceptan cualquier día (0 = contado)');
assert.equal(P.recibeAntesDePagar_({ formaPago: 'Crédito del proveedor', diasCredito: 30 }), true);
assert.equal(P.recibeAntesDePagar_({ formaPago: 'Transferencia', diasCredito: 30 }), false);
assert.equal(P.recibeAntesDePagar_({ diasCredito: 15 }), true, 'orden de antes con días de crédito');
assert.equal(P.recibeAntesDePagar_({ diasCredito: 0 }), false);
assert.equal(P.recibeAntesDePagar_(null), false);
// normalizarOrdenCompra la exige y la devuelve
const PRO = { moneda: 'MXN', ubicacion: 'Qro', hoy: HOY_ISO, ivaTasa: 0.16 };
const BASE = { proveedor: { razonSocial: 'X SA' }, fechaEntrega: masDias(1), condicionesPago: 'Contado', diasCredito: 0,
  renglones: [{ descripcion: 'A', cantidad: 1, costo: 10 }] };
assert.throws(() => P.normalizarOrdenCompra(BASE, PRO), /Elige la forma de pago/);
assert.equal(P.normalizarOrdenCompra(Object.assign({}, BASE, { formaPago: 'Efectivo' }), PRO).formaPago, 'Efectivo');
assert.throws(() => P.normalizarOrdenCompra(Object.assign({}, BASE, { formaPago: 'Crédito del proveedor' }), PRO), /días de crédito/);
// Propuesta guardada antes de este cambio (sin formaPago): la orden sale con la regla de lectura
assert.equal(P.ordenDePropuesta({ proveedor: {}, diasCredito: 45, renglones: [] }).formaPago, 'Crédito del proveedor');
assert.equal(P.ordenDePropuesta({ proveedor: {}, diasCredito: 0, formaPago: 'Cheque', renglones: [] }).formaPago, 'Cheque');
// PDF: "Forma de pago" junto a las condiciones
const cfg = { EMPRESA_NOMBRE: 'Helgen Servicios Especializados', EMPRESA_RFC: 'HSE240304PC1', TERMINOS_OC: 'Uno' };
const ocPdf = P.normalizarOrdenCompra(Object.assign({}, BASE, { formaPago: 'Tarjeta de débito (en sitio)' }), PRO);
const htmlPdf = P.construirHtmlOrdenCompra(Object.assign({}, ocPdf, { folio: 'OC-2026-0001', fecha: '29/10/2026', proyectoFolio: 'PRY' }), cfg, '');
assert(/Forma de pago<\/td><td>Tarjeta de débito \(en sitio\)/.test(htmlPdf), 'el PDF lleva la forma de pago');

// Métodos del pago: tarjeta solo con autorización o ticket; nunca un número de tarjeta
assert.equal(P.pasaLuhn('4111111111111111'), true);
assert.equal(P.pasaLuhn('4111111111111112'), false);
for (const [ref, metodo, esperado] of [
  ['4111111111111111', 'Transferencia', true], ['4111 1111 1111 1111', 'Transferencia', true], ['tarjeta 5555-5555-5555-4444', 'Efectivo', true],
  // Revisión (29/10/2026): una sola regla para todo método (13–19 dígitos, empieza con 3–6 y pasa Luhn): un ticket de 13 dígitos ya no
  // se rechaza con tarjeta
  ['Pago con 4111111111111111 ok', 'Cheque', true], ['1234567890123', 'Tarjeta de crédito', false], ['1234 5678 9012 3', 'Tarjeta de débito', false],
  ['1234567890123', 'Transferencia', false], ['2019111940014', 'Transferencia', false], ['MBAN01002210290012345678', 'Transferencia', false],
  ['AUT 123456', 'Tarjeta de crédito', false], ['Ticket 0042 · caja 3', 'Tarjeta de débito', false], ['SPEI 123', 'Transferencia', false], ['', 'Transferencia', false]]) {
  assert.equal(P.pareceNumeroTarjeta(ref, metodo), esperado, ref + ' (' + metodo + ')');
}
const NP = (d, metodos) => P.normalizarPago(Object.assign({ fecha: HOY_ISO, monto: 100, etapaOrden: 1 }, d), { moneda: 'MXN', etapas: 1, hoy: HOY_ISO, metodos });
const MP = plain(correr('METODOS_PAGO'));
assert.equal(NP({ metodo: 'Tarjeta de crédito', referencia: 'AUT 778899' }, MP).metodo, 'Tarjeta de crédito');
assert.throws(() => NP({ metodo: 'Tarjeta de crédito', referencia: '' }, MP), /autorización o del ticket; nunca el número de la tarjeta/);
assert.throws(() => NP({ metodo: 'Tarjeta de débito', referencia: '4111 1111 1111 1111' }, MP), /parece un número de tarjeta/);
assert.throws(() => NP({ metodo: 'Transferencia', referencia: '5555555555554444' }, MP), /parece un número de tarjeta/);
assert.equal(NP({ metodo: 'Efectivo', referencia: '' }, MP).referencia, '', 'efectivo sin referencia');
assert.throws(() => NP({ metodo: 'Tarjeta de crédito', referencia: 'AUT 1' }), /Transferencia, Efectivo, Cheque/, 'cobranza sigue con sus tres métodos');

// CLABE: 18 dígitos y dígito verificador
assert.equal(P.validarClabe(' 0321 8000 0118 3597 19 '), CLABE1);
assert.equal(P.validarClabe(CLABE2), CLABE2);
assert.equal(P.validarClabe(''), '');
assert.throws(() => P.validarClabe('03218000011835971'), /18 dígitos/);
assert.throws(() => P.validarClabe('032180000118359718'), /dígito verificador/);
assert.throws(() => P.validarClabe('03218000011835971A'), /18 dígitos/);
assert.equal(P.ultimos4(CLABE1), '9719');
assert.equal(P.ultimos4(''), '');
assert.equal(P.listaConY(['a', 'b', 'c']), 'a, b y c');
assert.equal(P.sumarMeses('2026-01-31', 1), '2026-02-28');
assert.equal(P.sumarMeses('2024-01-31', 1), '2024-02-29');
assert.equal(P.sumarMeses('2026-11-15', 3), '2027-02-15');
assert.equal(P.sumarMeses('2026-03-31', -1), '2026-02-28');

// Ficha del proveedor
const FB = { razonSocial: 'Eléctrica del Centro', rfc: 'edc200101ab1' };
let fx = P.normalizarFichaProveedor(Object.assign({}, FB, { banco: ' BBVA  México ', clabe: CLABE1, cuenta: '0123-456789', diasCredito: '30',
  formaPagoHabitual: 'crédito del proveedor', activo: 'No' }));
assert.deepEqual([fx.rfc, fx.banco, fx.clabe, fx.cuenta, fx.diasCredito, fx.formaPagoHabitual, fx.activo],
  ['EDC200101AB1', 'BBVA México', CLABE1, '0123456789', 30, 'Crédito del proveedor', false]);
assert.equal(P.normalizarFichaProveedor(Object.assign({}, FB, { cuenta: 'ES91 2100 0418 4502 0005 1332', banco: 'CaixaBank' })).cuenta,
  'ES9121000418450200051332', 'IBAN de un proveedor extranjero');
assert.throws(() => P.normalizarFichaProveedor(Object.assign({}, FB, { cuenta: '4111111111111111', banco: 'BBVA' })), /parece un número de tarjeta/);
assert.throws(() => P.normalizarFichaProveedor(Object.assign({}, FB, { clabe: CLABE1 })), /Escribe el banco/);
assert.throws(() => P.normalizarFichaProveedor(Object.assign({}, FB, { clabe: '032180000118359718', banco: 'BBVA' })), /dígito verificador/);
assert.throws(() => P.normalizarFichaProveedor(Object.assign({}, FB, { formaPagoHabitual: 'Crédito del proveedor' })), /días de crédito habituales/);
assert.throws(() => P.normalizarFichaProveedor({ rfc: 'EDC200101AB1' }), /razón social/);
assert.equal(P.normalizarFichaProveedor(FB).activo, true, 'activo por omisión');
assert.deepEqual(plain(P.filaFichaProveedor_({ clabe: CLABE1, cuenta: '0123456789', activo: true }).slice(2, 4)), ["'" + CLABE1, "'0123456789"],
  'CLABE y cuenta con apóstrofo: Sheets no las convierte en número');
assert.equal(P.cambioDeBanco({ banco: 'BBVA', clabe: CLABE1 }, { banco: 'bbva', clabe: CLABE1, cuenta: '' }), false);
assert.equal(P.cambioDeBanco({ banco: 'BBVA', clabe: CLABE1 }, { banco: 'BBVA', clabe: CLABE2 }), true);
assert.equal(P.textoCambioBanco({ banco: 'BBVA', clabe: CLABE1 }, { banco: 'Banamex', clabe: CLABE2 }), 'banco BBVA → Banamex · CLABE ··9719 → ··7771');
// Avisos: faltan documentos, domicilio > 3 meses, CSF > 12 meses (no bloquean; el pago exige CSF y carátula)
let av = P.avisosProveedor({}, HOY_ISO);
assert.deepEqual(plain(av.faltan), ['csf', 'caratula', 'domicilio']);
assert.deepEqual(plain(av.faltanPago), ['csf', 'caratula']);
assert.deepEqual(plain(av.avisos), ['Falta la constancia de situación fiscal, la carátula bancaria y el comprobante de domicilio.']);
av = P.avisosProveedor({ csfId: 'a', csfFecha: meses(-13), caratulaId: 'b', caratulaFecha: HOY_ISO, domicilioId: 'c', domicilioFecha: masDias(-100) }, HOY_ISO);
assert.deepEqual(plain(av.faltan), []); assert.deepEqual(plain(av.faltanPago), []); assert.deepEqual(plain(av.vencidos).sort(), ['csf', 'domicilio']);
assert(/comprobante de domicilio tiene más de 3 meses/.test(av.avisos.join(' ')) && /constancia de situación fiscal tiene más de 12 meses/.test(av.avisos.join(' ')));
av = P.avisosProveedor({ csfId: 'a', csfFecha: meses(-11), caratulaId: 'b', domicilioId: 'c', domicilioFecha: masDias(-60) }, HOY_ISO);
assert.deepEqual(plain(av.avisos), [], 'documentos al día');
// Revisión (29/10/2026): solo la transferencia exige documentos; a un proveedor sin RFC nacional (extranjero) solo la carátula
assert(/Sin constancia de situación fiscal y carátula bancaria no se le podrá registrar un pago por transferencia: súbelas/.test(
  P.textoAvisoProveedor({ razonSocial: 'X' }, P.avisosProveedor({ rfc: 'EDC200101AB1' }, HOY_ISO))));
assert(/Sin carátula bancaria no se le podrá registrar un pago por transferencia: súbela/.test(P.textoAvisoProveedor({ razonSocial: 'X' }, P.avisosProveedor({}, HOY_ISO))));
assert.equal(P.textoAvisoProveedor({ razonSocial: 'X' }, P.avisosProveedor({ csfId: 1, caratulaId: 2, domicilioId: 3 }, HOY_ISO)), '');
assert.equal(P.nombreCarpetaProveedor('', 'Tubos: "SA"'), 'SIN-RFC — Tubos SA');
assert.equal(P.nombreDocProveedor('EDC200101AB1', 'caratula', 'pdf', 2), 'EDC200101AB1 — Carátula bancaria (2).pdf');
assert.equal(P.formaPagoHabitualDe({ diasCredito: 30 }), 'Crédito del proveedor');
assert.equal(P.formaPagoHabitualDe({ diasCredito: '' }), '');
assert.equal(P.formaPagoHabitualDe({ diasCredito: 0, formaPagoHabitual: 'Cheque' }), 'Cheque');

// Pendientes: con crédito del proveedor quien pidió confirma con la orden sin pagar (flujo de siempre)
const q = (estado, oc) => ({ folio: 'REQ-1', fecha: HOY_ISO, desde: HOY_ISO + ' 10:00', proyectoFolio: 'PRY-1', proyectoVisible: 'PRY-1-ABC',
  proyectoNombre: 'Obra', solicitanteEmail: 'obrero@helgen.tech', solicitante: 'Juan', estado: estado, motivo: '', sitio: '', prioridad: '',
  fechaRequerida: '', recibeEmail: '', elaboroEmail: '', propuesta: null, oc: oc });
const O = { yo: 'obrero@helgen.tech', roles: { requisicion: true }, flujo: false, hoy: HOY_ISO, cxp: [], nombres: {} };
const recibir = (estado, oc) => P.itemsPendientes([q(estado, oc)], O).filter(i => i.tipo === 'recibir').length;
const CRED = { folio: 'OC-1', estado: 'Emitida', proveedor: 'X', total: 1, moneda: 'MXN', formaPago: 'Crédito del proveedor', diasCredito: 30 };
assert.equal(recibir('Autorizada', CRED), 1, 'crédito: se confirma con la orden Emitida');
assert.equal(recibir('En camino', CRED), 1, 'crédito: en camino sin pagar también');
assert.equal(recibir('Autorizada', Object.assign({}, CRED, { formaPago: 'Transferencia' })), 0, 'de contado: primero se paga');
assert.equal(recibir('En camino', Object.assign({}, CRED, { formaPago: 'Transferencia' })), 0);
assert.equal(recibir('Autorizada', Object.assign({}, CRED, { formaPago: undefined, diasCredito: 15 })), 1, 'orden de antes con días de crédito');
assert.equal(recibir('Autorizada', Object.assign({}, CRED, { recibida: true })), 0, 'ya recibida: espera el pago');
assert.equal(recibir('Pagada', Object.assign({}, CRED, { estado: 'Pagada' })), 1, 'pagada: como siempre');
assert.equal(P.itemsPendientes([q('Autorizada', CRED)], Object.assign({}, O, { flujo: true })).filter(i => i.tipo === 'recibir').length, 1,
  'con aprobaciones ya se recibía antes de pagar');
const itC = P.itemsPendientes([q('Autorizada', CRED)], { yo: 'pedro@helgen.tech', roles: { compras: true }, flujo: false, hoy: HOY_ISO, cxp: [], nombres: {} });
assert(/Crédito del proveedor/.test(itC[0].detalle), 'compras ve la forma de pago: ' + itC[0].detalle);
assert(!/Crédito|OC-1|X/.test(JSON.stringify(P.itemsPendientes([q('Autorizada', CRED)], O))), 'quien pide no ve forma de pago, orden ni proveedor');

// Correo proveedor.banco: a compras, sin proveedor ni CLABE completa
assert.deepEqual(plain(P.destinatariosAviso('proveedor.banco', {}, {}, { compras: ['efrain@helgen.tech', 'pedro@helgen.tech'], aprobaciones: ['adri@helgen.tech'] })),
  [{ quien: 'compras', para: ['efrain@helgen.tech', 'pedro@helgen.tech'] }]);
const cb = P.contenidoAviso('proveedor.banco', 'compras', Object.assign({ actorNombre: 'Pedro', actorCorreo: 'pedro@helgen.tech', fecha: '2026-10-29 10:00:00' },
  P.datosAvisoBanco({ banco: 'Banamex', bancoAntes: 'BBVA', clabe4: CLABE2, clabeAntes4: CLABE1 })));
assert.equal(cb.asunto, '[CAPRI] Cambió la cuenta bancaria de un proveedor');
assert.deepEqual(plain(cb.filas.slice(0, 2)), [['Banco', 'Banamex (antes BBVA)'], ['CLABE', 'terminación 7771 (antes 9719)']]);
assert(/#proveedores$/.test(cb.boton.url));
assert(!new RegExp(CLABE1 + '|' + CLABE2).test(P.construirHtmlAviso(cb) + P.textoAviso(cb)), 'nunca la CLABE completa');

// ================= Servidor (doPost) =================
P.prepararCapri();
const pry = ok('leo', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Querétaro', cliente: { nombre: 'Cliente' }, idSolicitud: 'p1' }).folio;
let n = 0;
const req = () => ok('obrero', 'guardarRequisicion', { proyectoFolio: pry, renglones: [{ descripcion: 'Brida', cantidad: 4 }],
  cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: 'r' + (++n) }).folio;
const PROV = { razonSocial: 'Eléctrica del Centro', rfc: 'EDC200101AB1', correo: 'ventas@edc.mx' };
const OC = extra => Object.assign({ proveedor: PROV, fechaEntrega: masDias(2), formaPago: 'Transferencia', condicionesPago: 'Contado',
  diasCredito: 0, ivaTasa: 0.16, renglones: [{ descripcion: 'Brida', unidad: 'PZA', cantidad: 4, costo: 100 }], idSolicitud: 'oc' + (++n) }, extra || {});
const PAGO = (reqFolio, extra) => Object.assign({ reqFolio, fecha: HOY_ISO, monto: 464, monedaPago: 'MXN', metodo: 'Transferencia',
  referencia: 'SPEI 123', comprobante: { nombre: 's.pdf', datos: PDF }, idSolicitud: 'pg' + (++n) }, extra || {});
const LC = () => A.libros[props.COMPRAS_DB_ID].pest;
const filaOc = folio => LC().OrdenesCompra.m.find(r => r[0] === folio);
const colOc = nombre => LC().OrdenesCompra.m[0].indexOf(nombre);
const bitCompras = () => LC().Bitacora.m;
const bitAdmin = () => A.libros[props.ADMIN_DB_ID].pest.Bitacora.m;

// ---- Orden con forma de pago: obligatoria, en la hoja (por nombre, al final), en el PDF; el proveedor se da de alta solo ----
const r1 = req();
falla('pedro', 'autorizarRequisicion', [r1, OC({ formaPago: '' })], /Elige la forma de pago/);
falla('pedro', 'autorizarRequisicion', [r1, OC({ formaPago: 'Crédito del proveedor', diasCredito: 0 })], /días de crédito \(1 o más\)/);
const a1 = ok('pedro', 'autorizarRequisicion', r1, OC());
assert(/Proveedor Eléctrica del Centro: Falta la constancia de situación fiscal, la carátula bancaria y el comprobante de domicilio\./.test(a1.avisoProveedor),
  'la respuesta avisa lo que falta: ' + a1.avisoProveedor);
assert(/no se le podrá registrar un pago por transferencia/.test(a1.avisoProveedor));
assert.equal(LC().OrdenesCompra.m[0][LC().OrdenesCompra.m[0].length - 1], 'forma_pago', 'columna al final');
assert.equal(filaOc(a1.ocFolio)[colOc('forma_pago')], 'Transferencia');
const pdf1 = Object.values(A.archivos).find(x => x.nombre && x.nombre.indexOf(a1.ocFolio) === 0);
assert(/Forma de pago<\/td><td>Transferencia/.test(pdf1.blob.html), 'el PDF de la orden dice la forma de pago');
let v1 = ok('pedro', 'getRequisicion', r1);
assert.equal(v1.orden.formaPago, 'Transferencia', 'compras ve la forma de pago');
assert.deepEqual(plain(v1.formasPago), plain(correr('FORMAS_PAGO_OC')));
assert.deepEqual(plain(v1.metodos), plain(correr('METODOS_PAGO')));
const enLista = v1.proveedores.find(p => p.id === 'EDC200101AB1');
assert(enLista && enLista.faltan.length === 3 && !('clabe' in enLista) && !('banco' in enLista), 'para la orden, sin datos bancarios');
assert.deepEqual([v1.proveedorPago.registrado, plain(v1.proveedorPago.faltanPago)], [true, ['csf', 'caratula']]);
assert(!/Transferencia|formaPago/.test(JSON.stringify(ok('obrero', 'misRequisiciones'))), 'quien pidió nunca ve la forma de pago');
// Orden de antes (forma_pago vacía): se lee por sus días de crédito
const hO = LC().OrdenesCompra.m, iO = hO.indexOf(filaOc(a1.ocFolio));
hO[iO][colOc('forma_pago')] = ''; hO[iO][35] = 30;
assert.equal(ok('pedro', 'getRequisicion', r1).orden.formaPago, 'Crédito del proveedor');
hO[iO][35] = 0;
assert.equal(ok('pedro', 'getRequisicion', r1).orden.formaPago, 'Transferencia');
hO[iO][colOc('forma_pago')] = 'Transferencia';

// ---- Permisos: solo compras y super admin ----
for (const [f, args] of [['listarProveedores', [{}]], ['getProveedor', ['EDC200101AB1']], ['guardarProveedor', [Object.assign({}, PROV)]],
  ['subirDocumentoProveedor', ['EDC200101AB1', 'csf', { nombre: 'c.pdf', datos: PDF, fecha: HOY_ISO }]]]) {
  falla('obrero', f, args, /No tienes permiso de compras/, 'PERMISO');
}
assert.equal(ok('leo', 'listarProveedores', {}).proveedores.length, 1, 'super admin sí');
let lista = ok('efrain', 'listarProveedores', {});
assert.equal(lista.proveedores[0].razonSocial, 'Eléctrica del Centro');
assert.deepEqual(plain(lista.proveedores[0].faltan), ['csf', 'caratula', 'domicilio']);
assert(!('clabe' in lista.proveedores[0]), 'la lista no lleva la CLABE completa');
assert.equal(ok('efrain', 'listarProveedores', { estado: 'faltan' }).proveedores.length, 1);
assert.equal(ok('efrain', 'listarProveedores', { texto: 'zzz' }).proveedores.length, 0);

// ---- Pago bloqueado sin CSF y carátula; super admin con motivo ----
let e = falla('pedro', 'registrarPagoProveedor', [PAGO(r1)], /Falta la constancia de situación fiscal y la carátula bancaria de Eléctrica del Centro/, 'PERMISO');
assert(!/super admin/.test(e.error), 'a quien no es super admin no se le ofrece la excepción');
falla('pedro', 'registrarPagoProveedor', [PAGO(r1, { metodo: 'Tarjeta de crédito', referencia: '4111 1111 1111 1111' })], /parece un número de tarjeta/);
e = falla('leo', 'registrarPagoProveedor', [PAGO(r1)], /Como super admin puedes hacerlo/, 'PERMISO');
falla('leo', 'registrarPagoProveedor', [PAGO(r1), 'corto'], /Falta la constancia/, 'PERMISO');
// Integración: el bloqueo es para transferencias (tarjeta, efectivo y cheque solo avisan); extranjero: solo la carátula
assert.deepEqual(plain(P.documentosParaPagar('EDC200101AB1', 'Transferencia')), ['csf', 'caratula']);
assert.deepEqual(plain(P.documentosParaPagar('XEXX010101000', 'Transferencia')), ['caratula'], 'RFC genérico de extranjero');
assert.deepEqual(plain(P.documentosParaPagar('', 'Transferencia')), ['caratula'], 'sin RFC');
for (const m of ['Tarjeta de crédito', 'Tarjeta de débito', 'Efectivo', 'Cheque']) assert.deepEqual(plain(P.documentosParaPagar('EDC200101AB1', m)), [], m);
const pgLeo = ok('leo', 'registrarPagoProveedor', PAGO(r1, { metodo: 'Transferencia', referencia: 'SPEI 778899' }), 'Pago urgente: el proveedor manda la CSF mañana');
assert(/^PGP-/.test(pgLeo.folio));
assert.deepEqual(bitAdmin()[bitAdmin().length - 1].slice(2, 6), ['Excepción de super admin: pagar a un proveedor sin documentos (falta la constancia ' +
  'de situación fiscal y la carátula bancaria)', a1.ocFolio, '', 'Pago urgente: el proveedor manda la CSF mañana']);
assert.equal(LC().PagosProveedores.m.find(r => r[0] === pgLeo.folio)[11], 'Transferencia');

// ---- Ficha: banco, CLABE y documentos ----
const SIN = Object.assign({}, PROV, { id: 'EDC200101AB1', contacto: 'Luis Pérez', telefono: '+52 442 111 2233', direccion: 'Av. 5 de Febrero 100, Qro.' });
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { banco: 'BBVA México', clabe: '032180000118359718' })], /dígito verificador/);
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { banco: 'BBVA México', clabe: CLABE1 })], /Capturaste el banco, la CLABE o la cuenta: sube la carátula/);
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { documentos: { csf: { nombre: 'c.txt', datos: TXT, fecha: HOY_ISO } } })], /debe ser PDF o imagen/);
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { documentos: { csf: { nombre: 'c.pdf', datos: PDF, fecha: masDias(1) } } })], /no puede ser futura/);
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { documentos: { csf: { nombre: 'c.pdf', datos: PDF } } })], /fecha de la constancia/);
falla('efrain', 'guardarProveedor', [Object.assign({}, SIN, { id: 'NO-EXISTE' })], /No existe el proveedor/);
const nCorreos = A.correos.length;
let g = ok('efrain', 'guardarProveedor', Object.assign({}, SIN, { banco: 'BBVA México', clabe: CLABE1, titular: 'Eléctrica del Centro SA de CV',
  formaPagoHabitual: 'Transferencia', diasCredito: '0', idSolicitud: 'g1', documentos: {
    caratula: { nombre: 'caratula.pdf', datos: PDF, fecha: HOY_ISO }, csf: { nombre: 'csf.jpg', datos: JPG, fecha: masDias(-20) } } }));
assert.equal(ok('efrain', 'guardarProveedor', Object.assign({}, SIN, { idSolicitud: 'g1' })).proveedor.clabe, CLABE1, 'idempotencia');
assert.equal(g.nuevo, false);
assert.deepEqual([g.proveedor.banco, g.proveedor.clabe, g.proveedor.clabe4, g.proveedor.titular, g.proveedor.contacto],
  ['BBVA México', CLABE1, '9719', 'Eléctrica del Centro SA de CV', 'Luis Pérez']);
assert.deepEqual(plain(g.proveedor.faltan), ['domicilio']);
assert.deepEqual(plain(g.proveedor.faltanPago), []);
assert.equal(A.correos.length, nCorreos, 'la primera captura del banco no avisa por correo (solo un cambio)');
const filaProv = LC().Proveedores.m.find(r => r[0] === 'EDC200101AB1');
assert.equal(LC().Proveedores.m[0].length, 26, 'Proveedores con las columnas de la ficha');
assert.deepEqual(LC().Proveedores.m[0].slice(8, 11), ['direccion', 'banco', 'clabe']);
assert.equal(filaProv[10], CLABE1, 'CLABE como texto (con apóstrofo, no como número)');
assert.equal(filaProv[24], 'Sí');
assert(/^Alta de proveedor|^Editar proveedor/.test(bitCompras().find(r => r[3] === 'EDC200101AB1')[2]));
const bitBanco = bitCompras().filter(r => r[2] === 'Cambiar datos bancarios de proveedor');
assert.equal(bitBanco.length, 1);
assert(/CLABE \(sin\) → ··9719/.test(bitBanco[0][4]) && !bitBanco[0][4].includes(CLABE1), 'la bitácora no guarda la CLABE completa: ' + bitBanco[0][4]);
// Drive: Compras/Proveedores/<RFC> — <razón social>/, privados de arriba abajo
const cProv = Object.values(A.carpetas).find(c => c.nombre === 'EDC200101AB1 — Eléctrica del Centro');
assert(cProv && cProv.padre.nombre === 'Proveedores' && cProv.padre.padre.nombre === 'Cotizador Helgen — Compras');
assert.deepEqual([cProv.acceso, cProv.padre.acceso], ['PRIVATE', 'PRIVATE']);
assert.deepEqual(cProv.archivos.map(x => x.nombre).sort(), ['EDC200101AB1 — CSF.jpg', 'EDC200101AB1 — Carátula bancaria.pdf']);
assert(cProv.archivos.every(x => x.acceso === 'PRIVATE'));
// Documento suelto: reemplazar la carátula conserva la anterior ("(2)", "(3)")
falla('efrain', 'subirDocumentoProveedor', ['EDC200101AB1', 'ine', { nombre: 'x.pdf', datos: PDF, fecha: HOY_ISO }], /Tipo de documento no válido/);
falla('efrain', 'subirDocumentoProveedor', ['EDC200101AB1', 'caratula', {}], /Adjunta la carátula bancaria/);
ok('efrain', 'subirDocumentoProveedor', 'EDC200101AB1', 'caratula', { nombre: 'c2.pdf', datos: PDF, fecha: HOY_ISO });
let fp = ok('efrain', 'subirDocumentoProveedor', 'EDC200101AB1', 'domicilio', { nombre: 'dom.png', datos: PDF, fecha: masDias(-100) }).proveedor;
ok('efrain', 'subirDocumentoProveedor', 'EDC200101AB1', 'caratula', { nombre: 'c3.pdf', datos: PDF, fecha: HOY_ISO });
assert.deepEqual(cProv.archivos.map(x => x.nombre).filter(x => /Carátula/.test(x)).sort(),
  ['EDC200101AB1 — Carátula bancaria (2).pdf', 'EDC200101AB1 — Carátula bancaria (3).pdf', 'EDC200101AB1 — Carátula bancaria.pdf']);
assert.deepEqual(plain(fp.faltan), []);
assert(/comprobante de domicilio tiene más de 3 meses/.test(fp.avisos.join(' ')), 'domicilio viejo: aviso');
assert.equal(ok('efrain', 'listarProveedores', { estado: 'avisos' }).proveedores.length, 1);
assert.equal(ok('efrain', 'listarProveedores', { texto: '9719' }).proveedores.length, 1, 'se busca por la terminación de la CLABE');
const docsLista = ok('efrain', 'listarProveedores', {}).proveedores[0].documentos;
assert.deepEqual([docsLista.csf.tiene, docsLista.caratula.tiene, docsLista.domicilio.vencido], [true, true, true]);
assert.equal(ok('pedro', 'getProveedor', 'EDC200101AB1').clabe, CLABE1);

// ---- Cambio de banco: carátula nueva en el mismo guardado, Bitácora y correo a compras (últimos 4, sin el proveedor) ----
const SIN2 = Object.assign({}, SIN, { banco: 'Banamex', clabe: CLABE2, titular: 'Eléctrica del Centro SA de CV' });
falla('pedro', 'guardarProveedor', [SIN2], /Cambiaste el banco, la CLABE o la cuenta: sube la carátula/);
const c0 = A.correos.length;
g = ok('pedro', 'guardarProveedor', Object.assign({}, SIN2, { documentos: { caratula: { nombre: 'nueva.pdf', datos: PDF, fecha: HOY_ISO } } }));
assert.equal(g.proveedor.clabe, CLABE2);
const avisoBanco = A.correos.slice(c0);
assert.equal(avisoBanco.length, 1);
assert.deepEqual(avisoBanco[0].to.split(',').sort(), ['efrain@helgen.tech'], 'a compras, sin quien hizo el cambio');
const tB = [avisoBanco[0].subject, avisoBanco[0].htmlBody, avisoBanco[0].body].join('\n');
assert(/Cambió la cuenta bancaria de un proveedor/.test(tB) && /terminación 7771 \(antes 9719\)/.test(tB) && /Banamex \(antes BBVA México\)/.test(tB));
assert(!tB.includes(CLABE2) && !tB.includes(CLABE1) && !/Eléctrica|EDC200101AB1/.test(tB), 'sin CLABE completa ni proveedor');
const logC = A.libros[props.ADMIN_DB_ID].pest.Correos.m;
assert.deepEqual(logC[logC.length - 1].slice(3, 6), ['proveedor.banco', 'EDC200101AB1', 'Enviado']);
assert(/banco BBVA México → Banamex · CLABE ··9719 → ··7771 · carátula EDC200101AB1 — Carátula bancaria \(4\)\.pdf/
  .test(bitCompras().filter(r => r[2] === 'Cambiar datos bancarios de proveedor').pop()[4]));
// Cambiar otra cosa no pide carátula
assert.equal(ok('pedro', 'guardarProveedor', Object.assign({}, SIN2, { contacto: 'Ana Ruiz' })).proveedor.contacto, 'Ana Ruiz');
// Alta manual: no se repite un RFC; uno sin RFC toma el RFC al editarlo
falla('efrain', 'guardarProveedor', [{ razonSocial: 'Otra razón', rfc: 'EDC200101AB1' }], /Ya existe el proveedor "Eléctrica del Centro"/);
const tubos = ok('efrain', 'guardarProveedor', { razonSocial: 'Tubos del Bajío', formaPagoHabitual: 'Efectivo', idSolicitud: 'g9' }).proveedor;
assert.equal(tubos.id, 'SIN-RFC:tubos del bajio');
falla('efrain', 'guardarProveedor', [{ razonSocial: 'Tubos del Bajío', rfc: 'TBA200101AB1' }], /Ya existe el proveedor "Tubos del Bajío" sin RFC/);
assert.equal(ok('efrain', 'guardarProveedor', { id: tubos.id, razonSocial: 'Tubos del Bajío', rfc: 'TBA200101AB1', formaPagoHabitual: 'Efectivo',
  activo: false }).proveedor.id, 'TBA200101AB1', 'la edición reemplaza la ficha (lo que no se manda se borra)');
assert.equal(ok('efrain', 'listarProveedores', {}).proveedores.length, 1, 'inactivos fuera de la lista por omisión');
assert.equal(ok('efrain', 'listarProveedores', { estado: 'inactivos' }).proveedores[0].formaPagoHabitual, 'Efectivo');
// La orden sigue funcionando con el alta automática (guardarProveedor_) y no borra la ficha
const r2 = req();
const a2 = ok('pedro', 'autorizarRequisicion', r2, OC({ proveedor: { razonSocial: 'Eléctrica del Centro', rfc: 'EDC200101AB1', contacto: 'Ana Ruiz' } }));
assert.equal(a2.avisoProveedor, 'Proveedor Eléctrica del Centro: El comprobante de domicilio tiene más de 3 meses (' +
  masDias(-100).slice(8, 10) + '/' + masDias(-100).slice(5, 7) + '/' + masDias(-100).slice(0, 4) + ').', 'solo el aviso que queda');
assert.equal(ok('pedro', 'getProveedor', 'EDC200101AB1').clabe, CLABE2, 'la orden no borra la ficha');

// ---- Pago con documentos: banco y CLABE de la carátula en la vista; el pago pasa ----
const v2 = ok('pedro', 'getRequisicion', r2);
assert.deepEqual([v2.proveedorPago.banco, v2.proveedorPago.clabe, plain(v2.proveedorPago.faltanPago)], ['Banamex', CLABE2, []]);
assert(/^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/view$/.test(v2.proveedorPago.caratulaUrl));
falla('pedro', 'registrarPagoProveedor', [PAGO(r2, { referencia: '5555 5555 5555 4444' })], /parece un número de tarjeta/);
assert(/^PGP-/.test(ok('pedro', 'registrarPagoProveedor', PAGO(r2)).folio));

// ---- Crédito del proveedor en el flujo de siempre: se recibe antes de pagar ----
const r3 = req(), r4 = req();
const a3 = ok('pedro', 'autorizarRequisicion', r3, OC({ formaPago: 'Crédito del proveedor', diasCredito: 30, condicionesPago: 'Crédito 30 días' }));
ok('pedro', 'autorizarRequisicion', r4, OC());
const mia = folio => ok('obrero', 'misRequisiciones').find(x => x.folio === folio);
assert.deepEqual([mia(r3).estado, mia(r3).puedeCerrar], ['Autorizada', true], 'crédito: "Recibí el material" con la orden sin pagar');
assert.deepEqual([mia(r4).estado, mia(r4).puedeCerrar], ['Autorizada', false], 'de contado: primero el pago');
assert(!/Crédito del proveedor/.test(JSON.stringify(mia(r3))), 'sin la forma de pago');
const pend = ok('obrero', 'pendientes', false).items;
assert(pend.some(x => x.folio === r3 && x.tipo === 'recibir') && !pend.some(x => x.folio === r4 && x.tipo === 'recibir'), 'Pendientes con la misma regla');
let v3 = ok('pedro', 'getRequisicion', r3);
assert.deepEqual([v3.orden.formaPago, v3.puedeCerrar, v3.recibeAntesDePagar, v3.puedePagar], ['Crédito del proveedor', true, true, true]);
assert.deepEqual([ok('pedro', 'getRequisicion', r4).puedeCerrar], [false]);
falla('obrero', 'cerrarRequisicion', [r4, ''], /no se puede cerrar/);
const c3 = A.correos.length;
const l3 = ok('obrero', 'cerrarRequisicion', r3, 'Llegó completo', FOTOS); // H: una foto por renglón
assert.deepEqual([l3.find(x => x.folio === r3).estado, l3.find(x => x.folio === r3).puedeCerrar], ['Recibida', false]);
const fo3 = filaOc(a3.ocFolio);
assert.deepEqual([fo3[28], fo3[29], fo3[30]], ['Emitida', HOY_ISO, 'obrero@helgen.tech'], 'la orden sigue Emitida (sin pagar) con su recepción');
const aviso3 = A.correos.slice(c3).find(m => /pedro@helgen\.tech/.test(m.to));
assert(aviso3 && /Falta registrar el pago/.test(aviso3.body), 'compras sabe que falta pagar');
assert(/Recibir antes de pagar \(crédito del proveedor\)/.test(bitCompras().map(r => r[2]).join('|')));
falla('pedro', 'cancelarOrdenCompra', [a3.ocFolio, 'Ya no la queremos'], /ya se recibió \(falta pagarla\)|ya tiene material recibido/);
assert(!ok('obrero', 'pendientes', false).items.some(x => x.folio === r3), 'ya no espera a quien pidió');
assert(ok('pedro', 'pendientes', false).items.some(x => x.folio === r3 && x.tipo === 'pagarRecibida'), 'compras: recibida, falta pagar');
v3 = ok('pedro', 'getRequisicion', r3);
assert.deepEqual([v3.requisicion.estado, v3.puedeCerrar, v3.puedePagar], ['Recibida', false, true]);
ok('pedro', 'registrarPagoProveedor', PAGO(r3));
const fo3b = filaOc(a3.ocFolio);
assert.equal(fo3b[28], 'Recibida');
assert.equal(ok('pedro', 'getRequisicion', r3).requisicion.estado, 'Cerrada', 'el pago la cierra');
// Compras registra que llegó en lugar de quien pidió (con motivo): también queda Recibida
const r5 = req();
ok('pedro', 'autorizarRequisicion', r5, OC({ formaPago: 'Crédito del proveedor', diasCredito: 15 }));
const v5 = ok('efrain', 'cerrarRequisicionCompras', r5, 'Juan ya no está en la obra', 'Completo');
assert.deepEqual([v5.requisicion.estado, v5.orden.estado, v5.puedePagar], ['Recibida', 'Emitida', true]);
assert(/Recibida por compras: Juan ya no está en la obra · falta el pago al proveedor/.test(ok('obrero', 'misRequisiciones').find(x => x.folio === r5)
  .eventos.map(x => x.nota).join('|')));

// ---- sincronizar: la lista de proveedores para compras cuando cambia ----
const vers = ok('efrain', 'sincronizar', {}, {}).versiones;
ok('pedro', 'guardarProveedor', Object.assign({}, SIN2, { contacto: 'Luis Pérez' }));
let s = ok('efrain', 'sincronizar', vers, { comProveedores: true, provFiltro: { texto: 'eléctrica' } });
assert.equal(s.comProveedores.proveedores[0].contacto, 'Luis Pérez');
s = ok('obrero', 'sincronizar', vers, { comProveedores: true });
assert(!('comProveedores' in s), 'quien no es de compras no la recibe');

// ================= Propuesta (flujo con aprobaciones) =================
const B = require('./arnes')(dir, { props: { ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
B.P.prepararCapri();
B.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro']);
const pB = B.ok('leo', 'crearProyecto', { nombre: 'Obra B', ubicacion: 'Qro', cliente: { nombre: 'C' }, idSolicitud: 'pb' }).folio;
const rB = B.ok('obrero', 'guardarRequisicion', { proyectoFolio: pB, sitio: 'Querétaro', renglones: [{ descripcion: 'Tubo', cantidad: 2 }], idSolicitud: 'rb' }).folio;
B.ok('adri', 'aprobarRequisicion', rB, { version: 1, prioridad: 'Normal', renglones: [{ renglon: 1, aprobado: true, cantidad: 2 }] });
const PROPB = extra => Object.assign({ proveedor: { razonSocial: 'GNSS Store' }, fechaEntrega: masDias(2), condicionesPago: 'Crédito 15 días', diasCredito: 15,
  recibe: 'obrero@helgen.tech', renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 50 }], idSolicitud: 'pp' + (++n) }, extra || {});
B.falla('pedro', 'cotizarRequisicion', [rB, PROPB()], /Elige la forma de pago/);
const cz = B.ok('pedro', 'cotizarRequisicion', rB, PROPB({ formaPago: 'Crédito del proveedor' }));
assert(/^Proveedor GNSS Store: Falta la constancia de situación fiscal, la carátula bancaria y el comprobante de domicilio\./.test(cz.avisoProveedor),
  'la propuesta avisa (proveedor nuevo: todavía no está en la lista): ' + cz.avisoProveedor);
let vo = B.ok('adri', 'getRequisicionOperaciones', rB);
assert.equal(vo.propuesta.formaPago, 'Crédito del proveedor', 'aprobaciones ve la forma de pago');
// Propuesta guardada antes de este cambio (sin formaPago): se lee por sus días y la orden sale igual
const hR = B.libros[B.props.COMPRAS_DB_ID].pest.Requisiciones.m, iR = hR.findIndex(r => r[0] === rB);
const prop = JSON.parse(hR[iR][20]); delete prop.formaPago; hR[iR][20] = JSON.stringify(prop);
vo = B.ok('adri', 'getRequisicionOperaciones', rB);
assert.equal(vo.propuesta.formaPago, 'Crédito del proveedor');
const vb = B.ok('adri', 'autorizarPropuesta', rB, vo.propuesta.version, 'vb1', vo.propuesta.huella);
const LB = B.libros[B.props.COMPRAS_DB_ID].pest.OrdenesCompra.m;
assert.equal(LB.find(r => r[0] === vb.ocFolio)[LB[0].indexOf('forma_pago')], 'Crédito del proveedor');
assert.equal(B.ok('adri', 'getRequisicionOperaciones', rB).orden.formaPago, 'Crédito del proveedor', 'en la orden de aprobaciones');

// ================= Interfaz (mod-proveedores, con DOM simulado) =================
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
const modulo = scripts.find(x => x.id === 'mod-proveedores');
assert(modulo, 'existe <script id="mod-proveedores">');
assert(/id="comVistaProv"/.test(html) && /id="ocFormaPago"/.test(html) && /id="ppProveedor"/.test(html) && /id="prvAviso"/.test(html));
assert(/formaPago: \$\('ocFormaPago'\)\.value/.test(html), 'la orden y la propuesta mandan la forma de pago');
assert(/accionConExcepcion\('btnPagoProv', 'registrarPagoProveedor'/.test(html), 'el pago usa la excepción de super admin');
// DOM mínimo: elementos por id, clases, oyentes; el servidor responde con las funciones de esta prueba
function elemento() {
  const e = { value: '', textContent: '', innerHTML: '', checked: false, disabled: false, files: null, oyentes: {}, _c: new Set(), src: '',
    classList: { add: c => e._c.add(c), remove: c => e._c.delete(c), contains: c => e._c.has(c), toggle: (c, f) => (f === undefined ? !e._c.has(c) : f) ? e._c.add(c) : e._c.delete(c) },
    addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), insertAdjacentHTML: (p, h) => { e.innerHTML += h; } };
  return e;
}
const porId = {};
const $ = id => porId[id] || (porId[id] = elemento());
$('comVistaProv').classList.add('oculto');
const llamadas = [], respuestas = {};
const run = () => {
  let ok_, mal;
  const r = new Proxy({}, { get: (t, k) => k === 'withSuccessHandler' ? f => { ok_ = f; return r; } : k === 'withFailureHandler' ? f => { mal = f; return r; }
    : (...args) => { llamadas.push({ f: k, args }); const x = respuestas[k]; if (x instanceof Error) mal(x); else if (ok_) ok_(typeof x === 'function' ? x(...args) : x); } });
  return r;
};
const avisos = [];
const ui = { document: { getElementById: $ }, console, JSON, Promise, Date, Math, Object, Array, String, Number, Set, setTimeout: f => f(), Proxy,
  google: { script: { get run() { return run(); } } }, PERMISOS: { compras: true }, TAB: 'pend', REQC: null, BOOT: true,
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  nuevoId: () => 'id-' + Math.random(), mostrarError: err => avisos.push(['error', String(err && err.message || err)]), aviso: (t, h) => avisos.push([t, h]),
  fechaMx: s => s, leerArchivo: f => Promise.resolve(f.b64), MODS: [] };
ui.window = ui;
ui.$ = $;
ui.jsArg =s => ui.esc(JSON.stringify(String(s ?? '')));
ui.botonChico = (t, a) => '<button onclick="' + a + '">' + t + '</button>';
ui.registrarModulo = m => ui.MODS.push(m);
ui.verTab = t => { ui.TAB = t; };
ui.verListaCom = () => { ui.vistas = 'lista'; };
ui.verCxp = () => { ui.vistas = 'cxp'; };
ui.cerrarFormRecepcion = () => {};
vm.createContext(ui);
vm.runInContext('var TAB = "pend", REQC = null, BOOT = true, PERMISOS = { compras: true };', ui);
vm.runInContext(modulo.src, ui);
const U = c => vm.runInContext(c, ui);
assert.equal(ui.MODS[0].nombre, 'Proveedores');
// Subvista: lista con chips (con texto, no solo color)
respuestas.listarProveedores = ok('efrain', 'listarProveedores', {});
U('verProveedores()');
assert.equal(U('TAB'), 'com');
assert(!$('comVistaProv').classList.contains('oculto') && $('comVistaLista').classList.contains('oculto'));
assert.deepEqual(llamadas.pop(), { f: 'listarProveedores', args: [{ texto: '', estado: 'activos' }] });
assert(/Eléctrica del Centro/.test($('provLista').innerHTML) && /CLABE ··7771/.test($('provLista').innerHTML) && /Domicilio · vieja/.test($('provLista').innerHTML));
assert(!$('provLista').innerHTML.includes(CLABE2), 'la lista no muestra la CLABE completa');
assert.deepEqual(plain(U('MODS[0].contexto()')), { comProveedores: true, provFiltro: { texto: '', estado: 'activos' } });
// Ficha: valores, cambio de banco sin carátula se detiene antes de llamar al servidor
respuestas.getProveedor = ok('efrain', 'getProveedor', 'EDC200101AB1');
U('PROVEEDORES_F.abrir("EDC200101AB1")');
assert.equal($('pfClabe').value, CLABE2); assert.equal($('pfBanco').value, 'Banamex'); assert.equal($('pfActivo').checked, true);
assert(/Abrir<\/a>/.test($('provFicha').innerHTML));
$('pfClabe').value = CLABE1; $('pfClabe').oyentes.input.forEach(f => f());
assert(!$('pfBancoAviso').classList.contains('oculto'), 'avisa que hace falta la carátula');
assert.equal(U('PROVEEDORES_F.clabeValida("032180000118359718")'), 'La CLABE no es válida (no coincide su dígito verificador).');
assert.equal($('pfClabeNota').textContent, 'CLABE válida');
$('pfClabe').value = '012180001234567899'; $('pfClabe').oyentes.input.forEach(f => f());
assert.equal($('pfClabeNota').textContent, 'CLABE válida · banco BBVA México', 'sugiere el banco por los 3 primeros dígitos');
$('pfClabe').value = CLABE1; $('pfClabe').oyentes.input.forEach(f => f());
U('PROVEEDORES_F.guardar()');
assert(!llamadas.some(x => x.f === 'guardarProveedor') && /sube la carátula bancaria nueva/.test(avisos.pop()[1]));
$('pfArch-caratula').files = [{ name: 'c.pdf', size: 2000, b64: PDF }];
U('PROVEEDORES_F.guardar()');
assert(/fecha de carátula bancaria/.test(avisos.pop()[1]), 'la fecha del documento es obligatoria');
$('pfFecha-caratula').value = HOY_ISO;
respuestas.guardarProveedor = d => ({ proveedor: Object.assign({}, respuestas.getProveedor, { clabe: d.clabe }), nuevo: false });
U('PROVEEDORES_F.guardar()');
setImmediate(() => {
  const gp = llamadas.find(x => x.f === 'guardarProveedor');
  assert(gp, 'manda el guardado');
  assert.deepEqual([gp.args[0].id, gp.args[0].clabe, gp.args[0].documentos.caratula.fecha, gp.args[0].documentos.caratula.datos], ['EDC200101AB1', CLABE1, HOY_ISO, PDF]);
  // Pago: métodos del servidor, banco y CLABE con transferencia; aviso con tarjeta; documentos que faltan
  const vPago = Object.assign({}, v2, { puedePagar: true });
  $('ppMetodo').value = 'Transferencia';
  ui.MODS[0].alVistaReqCom(vPago, true);
  assert(/<option>Tarjeta de crédito<\/option>/.test($('ppMetodo').innerHTML));
  assert(/Transfiere a la CLABE de la carátula/.test($('ppProveedor').innerHTML) && $('ppProveedor').innerHTML.includes(CLABE2));
  assert(/Forma de pago<\/span><b[^>]*>Transferencia/.test($('rcOrden').innerHTML), 'la forma de pago en la orden');
  $('ppMetodo').value = 'Tarjeta de débito';
  $('ppMetodo').oyentes.change.forEach(f => { vm.runInContext('REQC = ' + JSON.stringify(vPago), ui); f(); });
  assert(/Nunca<\/b> escribas el número de la tarjeta/.test($('ppProveedor').innerHTML));
  // Revisión (29/10/2026): con tarjeta solo un aviso; con transferencia, el bloqueo (lo que dice faltanPorMetodo del servidor)
  const sinCsf = Object.assign({}, vPago, { proveedorPago: Object.assign({}, vPago.proveedorPago, { faltanPago: ['csf'],
    faltanPorMetodo: { Transferencia: ['csf'], 'Tarjeta de crédito': [], 'Tarjeta de débito': [], Efectivo: [], Cheque: [] } }) });
  ui.MODS[0].alVistaReqCom(sinCsf, false);
  assert(!/no se registra el pago/.test($('ppProveedor').innerHTML) &&
    /Aviso: al proveedor le falta la constancia de situación fiscal\. Con tarjeta de débito sí se registra el pago/.test($('ppProveedor').innerHTML),
    $('ppProveedor').innerHTML);
  $('ppMetodo').value = 'Transferencia';
  ui.MODS[0].alVistaReqCom(sinCsf, false);
  assert(/Falta la constancia de situación fiscal: no se registra el pago por transferencia hasta subirla/.test($('ppProveedor').innerHTML));
  // Extranjero sin carátula: nunca se le pide la CSF
  ui.MODS[0].alVistaReqCom(Object.assign({}, vPago, { proveedorPago: Object.assign({}, vPago.proveedorPago, { rfc: '', faltanPago: ['csf', 'caratula'],
    faltanPorMetodo: { Transferencia: ['caratula'], 'Tarjeta de crédito': [], 'Tarjeta de débito': [], Efectivo: [], Cheque: [] } }) }), false);
  assert(/Falta la carátula bancaria: no se registra/.test($('ppProveedor').innerHTML) && !/constancia/.test($('ppProveedor').innerHTML));
  // Formulario de la orden: el aviso dice "por transferencia" (y nunca pide la CSF a un extranjero)
  vm.runInContext('REQC = ' + JSON.stringify({ proveedores: [{ id: 'GNSS', razonSocial: 'GNSS Store', etiqueta: 'GNSS Store', avisos: ['Falta la carátula bancaria.'],
    faltan: ['csf', 'caratula', 'domicilio'], faltanPorMetodo: { Transferencia: ['caratula'] } }] }), ui);
  $('prvRazon').value = 'GNSS Store'; $('prvRazon').oyentes.input.forEach(f => f());
  assert(/Sin carátula bancaria no se le podrá pagar por transferencia \(con tarjeta, efectivo o cheque sí\)\./.test($('prvAviso').innerHTML) &&
    !/constancia/.test($('prvAviso').innerHTML.replace('Falta la carátula bancaria.', '')), $('prvAviso').innerHTML);
  vm.runInContext('REQC = ' + JSON.stringify(vPago), ui);
  // Crédito: el cierre de compras dice "Registrar que llegó"
  ui.MODS[0].alVistaReqCom(Object.assign({}, vPago, { recibeAntesDePagar: true, centroMando: null }), false);
  assert(/Registrar que llegó/.test($('btnCerrarCom').textContent));
  assert($('comVistaProv').classList.contains('oculto'), 'abrir una requisición esconde la subvista');
  console.log('OK proveedores');
});
