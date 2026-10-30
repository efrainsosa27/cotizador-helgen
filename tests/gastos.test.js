// Incremento 7 · módulo G (gastos por proyecto). Lógica pura: transiciones, normalizarGasto (IVA incluido o no, monedas y tipo de
// cambio, CFDI que manda sobre lo capturado), validarCfdiGasto, reembolso, costoGastosPorProyecto (contrato §1), acciones por rol,
// filtro, totales por moneda, Pendientes y el texto de los correos. Por doPost: permisos por rol (Requisiciones, Solo requisiciones,
// @helgen.services con sesión de CAPRI, Aprobaciones, Compras, super admin, ventas sin acceso), cada quien solo ve lo suyo, cada
// transición y sus rechazos, separación de funciones y excepción de super admin, CFDI (prellenado, receptor ajeno, UUID repetido en
// gastos o en facturas de proveedor), monedas y tipo de cambio, ticket obligatorio, archivos privados en Drive, idempotencia que
// sobrevive al caché vacío, Pendientes, bootstrap y sincronizar, Anular (solo y en cascada del proyecto) y correos sin montos.
// Uso: node tests/gastos.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech, tania@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech, tania@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech, jesus@helgen.services',
  ROL_COBRANZA: 'efrain@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
const { P, ok, falla, plain, props, libros, archivos, carpetas, HOY_ISO, masDias, correr, ANIO, PDF, FOTO } = A;
const TXT = Buffer.from('hola, no soy un ticket').toString('base64');
const HELGEN = 'HSE240304PC1', PROV = 'EKU9003173C9';
const UUID1 = '6F1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E61', UUID2 = '6F1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E62', UUID3 = '6F1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E63';
let nId = 0;
const id = p => (p || 'x') + (++nId);
const ruta = c => { const n = []; for (let x = c; x; x = x.padre) n.unshift(x.nombre); return n.join('/'); };

/** CFDI 4.0 de prueba (o = cambios). */
function cfdi(o) {
  const a = Object.assign({ version: '4.0', tipo: 'I', fecha: '2026-10-20T10:15:00', moneda: 'MXN', subtotal: '1000.00', descuento: null,
    tras: '160.00', total: '1160.00', emisor: PROV, nombreEmisor: 'GASOLINERA DEL BAJIO &amp; CIA', receptor: HELGEN, uuid: UUID1.toLowerCase() }, o || {});
  return '﻿<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="${a.version}" Serie="G" Folio="77" Fecha="${a.fecha}" SubTotal="${a.subtotal}"` +
    `${a.descuento != null ? ` Descuento="${a.descuento}"` : ''} Moneda="${a.moneda}" Total="${a.total}" TipoDeComprobante="${a.tipo}" MetodoPago="PUE" FormaPago="04" Exportacion="01" LugarExpedicion="76000">
  <cfdi:Emisor Rfc="${a.emisor}" Nombre="${a.nombreEmisor}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${a.receptor}" Nombre="HELGEN SERVICIOS ESPECIALIZADOS" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="15101514" Cantidad="1" ClaveUnidad="LTR" Descripcion="Magna" ValorUnitario="${a.subtotal}" Importe="${a.subtotal}" ObjetoImp="02"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${a.tras}"><cfdi:Traslados><cfdi:Traslado Base="${a.subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${a.tras}"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid}" FechaTimbrado="2026-10-20T10:16:00"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

// ================= 0. Lógica pura =================
// Transiciones
assert.equal(P.transicionGasto('Enviado', 'aprobar'), 'Aprobado');
assert.equal(P.transicionGasto('Enviado', 'rechazar'), 'Rechazado');
assert.equal(P.transicionGasto('Enviado', 'cancelar'), 'Cancelado');
assert.equal(P.transicionGasto('Aprobado', 'reembolsar'), 'Reembolsado');
for (const [e, a, re] of [['Aprobado', 'aprobar', /aprobado: no se puede aprobar/], ['Rechazado', 'reembolsar', /rechazado: no se puede reembolsar/],
  ['Enviado', 'reembolsar', /enviado \(por aprobar\): no se puede reembolsar/], ['Reembolsado', 'cancelar', /reembolsado: no se puede cancelar/],
  ['Aprobado', 'cancelar', /aprobado: no se puede cancelar/], ['Anulada', 'aprobar', /anulado/], ['Cancelado', 'rechazar', /cancelado/]]) {
  assert.throws(() => P.transicionGasto(e, a), re, e + ' → ' + a);
}
assert.throws(() => P.transicionGasto('Enviado', 'borrar'), /Acción no válida/);
assert.deepEqual(plain(correr('CATEGORIAS_GASTO')), ['Viáticos', 'Combustible', 'Hospedaje', 'Casetas', 'Herramientas', 'Otros']);
// normalizarGasto: el servidor calcula; IVA incluido o no
const BASE = { fecha: HOY_ISO, categoria: 'combustible', concepto: '  Gasolina   camioneta ', monto: 116, moneda: 'mxn', ivaIncluido: 'Sí' };
const N = (d, c) => plain(P.normalizarGasto(Object.assign({}, BASE, d), Object.assign({ hoy: HOY_ISO, ivaTasa: 0.16 }, c)));
let n = N({}, { monedaProyecto: 'MXN' });
assert.deepEqual([n.categoria, n.concepto, n.moneda, n.ivaIncluido, n.subtotal, n.iva, n.total, n.tipoCambio, n.monedaProyecto],
  ['Combustible', 'Gasolina camioneta', 'MXN', true, 100, 16, 116, '', 'MXN']);
n = N({ monto: 100, ivaIncluido: 'No' });
assert.deepEqual([n.subtotal, n.iva, n.total, n.ivaIncluido], [100, 0, 100, false], 'sin IVA: el subtotal es todo');
n = N({ monto: 108, ivaIncluido: true }, { ivaTasa: 0.08 });
assert.deepEqual([n.subtotal, n.iva], [100, 8], 'la tasa de Config');
n = N({ monto: 99.99 });
assert.equal(Math.round((n.subtotal + n.iva) * 100), 9999, 'subtotal + IVA = total, al centavo');
for (const [d, re] of [[{ monto: 0 }, /mayor a 0/], [{ monto: -5 }, /mayor a 0/], [{ monto: '' }, /mayor a 0/], [{ monto: 10.123 }, /2 decimales/],
  [{ ivaIncluido: '' }, /incluye IVA/], [{ ivaIncluido: 'quizá' }, /incluye IVA/], [{ categoria: 'Comida rara' }, /Elige la categoría: Viáticos, Combustible/],
  [{ concepto: '   ' }, /concepto/], [{ concepto: 'x'.repeat(201) }, /máximo 200/], [{ fecha: masDias(1) }, /no puede ser futura/],
  [{ fecha: '2026-02-30' }, /no es válida/], [{ fecha: '' }, /obligatoria/], [{ moneda: 'EUR' }, /Moneda no válida: EUR/]]) {
  assert.throws(() => N(d), re, JSON.stringify(d));
}
// Tipo de cambio: solo si la moneda del gasto no es la del proyecto (sin la moneda del proyecto no se revisa)
assert.throws(() => N({ moneda: 'USD' }, { monedaProyecto: 'MXN' }), /El proyecto es en MXN y el gasto en USD: captura el tipo de cambio/);
assert.throws(() => N({ tipoCambio: 0 }, { monedaProyecto: 'USD' }), /El proyecto es en USD y el gasto en MXN/);
assert.throws(() => N({ tipoCambio: 5000 }, { monedaProyecto: 'USD' }), /tipo de cambio/);
assert.equal(N({ moneda: 'USD', tipoCambio: '18.51239' }, { monedaProyecto: 'MXN' }).tipoCambio, 18.5124);
assert.equal(N({ tipoCambio: 18.5 }, { monedaProyecto: 'MXN' }).tipoCambio, '', 'misma moneda: el tipo de cambio se ignora');
assert.equal(N({ moneda: 'USD' }).tipoCambio, '', 'antes del candado (sin moneda del proyecto) no se revisa');
// Con CFDI: moneda, total, subtotal (− descuento) e IVA salen del XML; lo capturado se ignora
const C1 = P.leerCfdi(cfdi({ subtotal: '1000.00', descuento: '50.00', tras: '152.00', total: '1102.00' }));
n = N({ monto: 1, moneda: 'USD', ivaIncluido: 'No' }, { cfdi: C1, monedaProyecto: 'MXN' });
assert.deepEqual([n.moneda, n.total, n.subtotal, n.iva, n.ivaIncluido, n.uuid, n.rfcEmisor, n.emisor, n.tipoCambio],
  ['MXN', 1102, 950, 152, true, UUID1, PROV, 'GASOLINERA DEL BAJIO & CIA', '']);
assert.throws(() => N({}, { cfdi: P.leerCfdi(cfdi({ moneda: 'EUR' })) }), /El CFDI es en EUR: los gastos solo pueden ser en MXN o USD/);
assert.throws(() => N({}, { cfdi: P.leerCfdi(cfdi({ moneda: 'USD' })), monedaProyecto: 'MXN' }), /captura el tipo de cambio/, 'CFDI en USD en proyecto MXN');
// validarCfdiGasto
const VC = (o, usados) => P.validarCfdiGasto(P.leerCfdi(cfdi(o)), HELGEN, usados);
assert.equal(VC({}).uuid, UUID1);
assert.throws(() => VC({ tipo: 'E' }), /nota de crédito \(CFDI tipo E\)/);
assert.throws(() => VC({ tipo: 'P' }), /complemento de pago \(CFDI tipo P\)/);
assert.throws(() => VC({ tipo: 'T' }), /no es una factura de ingreso/);
assert.throws(() => VC({ version: '4.1' }), /versión 4.0/);
assert.throws(() => VC({ uuid: 'no-es-uuid' }), /UUID\) del CFDI no es válido/);
assert.throws(() => VC({ receptor: 'XAXX010101000' }), /está a nombre del RFC XAXX010101000, no de Helgen \(HSE240304PC1\)/);
assert.throws(() => P.validarCfdiGasto(P.leerCfdi(cfdi()), '', null), /no de Helgen/, 'sin RFC de Helgen no se acepta');
assert.throws(() => VC({}, { [UUID1]: 'GAS-2026-0009' }), /ya está registrada \(GAS-2026-0009\)/);
// Reembolso
const R = d => plain(P.normalizarReembolsoGasto(Object.assign({ fecha: HOY_ISO, metodo: 'transferencia', referencia: 'SPEI 123' }, d), HOY_ISO));
assert.deepEqual(R({}), { fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 123' });
assert.equal(R({ metodo: 'Efectivo', referencia: '' }).referencia, '', 'efectivo sin referencia');
assert.throws(() => R({ referencia: '' }), /clave de rastreo o folio/);
assert.throws(() => R({ metodo: 'Cheque', referencia: '' }), /número de cheque/);
assert.throws(() => R({ metodo: 'Tarjeta de crédito' }), /Transferencia, Efectivo, Cheque/);
assert.throws(() => R({ referencia: '4111 1111 1111 1111' }), /parece un número de tarjeta/);
assert.throws(() => R({ referencia: 'x'.repeat(101) }), /máximo 100/);
assert.throws(() => R({ fecha: masDias(2) }), /no puede ser futura/);
// costoGastosPorProyecto (contrato §1)
const GS = [
  { proyectoFolio: 'pry-2026-0001', estado: 'Aprobado', moneda: 'MXN', subtotal: 100, total: 116, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Reembolsado', moneda: 'MXN', subtotal: 0.1, total: 0.12, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Reembolsado', moneda: 'MXN', subtotal: 0.2, total: 0.23, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Aprobado', moneda: 'USD', subtotal: 10, total: 10, tipoCambio: 18.5 },  // se convierte
  { proyectoFolio: 'PRY-2026-0001', estado: 'Aprobado', moneda: 'USD', subtotal: 7, total: 7, tipoCambio: '' },      // no se puede: USD
  { proyectoFolio: 'PRY-2026-0001', estado: 'Enviado', moneda: 'MXN', subtotal: 999, total: 999, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Rechazado', moneda: 'MXN', subtotal: 999, total: 999, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Cancelado', moneda: 'MXN', subtotal: 999, total: 999, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0001', estado: 'Anulada', moneda: 'MXN', subtotal: 999, total: 999, tipoCambio: '' },
  { proyectoFolio: 'PRY-2026-0002', estado: 'Reembolsado', moneda: 'MXN', subtotal: 185, total: 214.6, tipoCambio: 18.5 }, // MXN → USD
  { proyectoFolio: 'PRY-2026-0002', estado: 'Aprobado', moneda: 'USD', subtotal: 3, total: 3.48, tipoCambio: '' },
];
const MON = { 'PRY-2026-0001': 'MXN', 'PRY-2026-0002': { moneda: 'USD' } };
const esperado = { 'PRY-2026-0001': [{ concepto: 'Gastos', moneda: 'MXN', monto: 285.3, cantidad: 4 }, { concepto: 'Gastos', moneda: 'USD', monto: 7, cantidad: 1 }],
  'PRY-2026-0002': [{ concepto: 'Gastos', moneda: 'USD', monto: 13, cantidad: 2 }] };
assert.deepEqual(plain(P.costoGastosPorProyecto(GS, MON)), esperado, 'sin IVA, solo Aprobado y Reembolsado, por moneda, centavos exactos');
assert.deepEqual(plain(P.costoGastosPorProyecto(GS, f => ({ 'PRY-2026-0001': 'MXN', 'PRY-2026-0002': 'USD' }[f]))), esperado, 'con una función');
assert.deepEqual(plain(P.costoGastosPorProyecto(GS.slice(0, 5), 'MXN'))['PRY-2026-0001'], esperado['PRY-2026-0001'], 'con un texto');
assert.deepEqual(plain(P.costoGastosPorProyecto([GS[3]], {})), { 'PRY-2026-0001': [{ concepto: 'Gastos', moneda: 'USD', monto: 10, cantidad: 1 }] },
  'proyecto sin moneda conocida: el gasto se queda en su moneda (nunca se inventa una conversión)');
assert.deepEqual(plain(P.costoGastosPorProyecto([GS[3]], 'USD'))['PRY-2026-0001'], [{ concepto: 'Gastos', moneda: 'USD', monto: 10, cantidad: 1 }]);
assert.deepEqual(plain(P.costoGastosPorProyecto([], 'MXN')), {});
assert.deepEqual(plain(P.costoGastosPorProyecto(null)), {});
// El margen (incremento 6) ya acepta estos costos: el renglón en otra moneda lo marca (no se suma)
const mg = plain(P.margenPorProyecto({ contratos: [{ proyectoFolio: 'PRY-2026-0002', cotizacion: 'HLG-1', marca: 'helgen', moneda: 'USD', subtotal: 1000, estado: 'Firmado' }],
  proyectos: [{ folio: 'PRY-2026-0002', estado: 'Activo' }], ordenes: [], prueba: [], costosExtra: P.costoGastosPorProyecto(GS, MON) }));
assert.deepEqual([mg.proyectos[0].margen, mg.conceptos], [987, ['Órdenes de compra', 'Gastos']]);
const mg2 = plain(P.margenPorProyecto({ contratos: [{ proyectoFolio: 'PRY-2026-0001', cotizacion: 'HLG-2', marca: 'helgen', moneda: 'MXN', subtotal: 1000, estado: 'Firmado' }],
  proyectos: [{ folio: 'PRY-2026-0001', estado: 'Activo' }], ordenes: [], prueba: [], costosExtra: P.costoGastosPorProyecto(GS, MON) }));
// Integración (§6.I, contrato §1): el gasto en USD sin tipo de cambio no se suma ni anula el margen: va aparte (sinSumar, "Revisar")
assert.deepEqual([mg2.proyectos[0].margenError, mg2.proyectos[0].margen, mg2.proyectos[0].sinSumar],
  ['', 714.7, [{ concepto: 'Gastos', moneda: 'USD', monto: 7, cantidad: 1 }]], 'un gasto en USD sin tipo de cambio en un proyecto MXN: no se suma');
// Acciones por rol, filtro y totales
const g0 = { folio: 'GAS-1', estado: 'Enviado', solicitanteEmail: 'obrero@helgen.tech' };
assert.deepEqual(plain(P.accionesGasto(g0, { yo: 'obrero@helgen.tech' })), { propio: true, puedeCancelar: true, puedeAprobar: false, puedeRechazar: false, puedeReembolsar: false });
assert.deepEqual(plain(P.accionesGasto(g0, { yo: 'adri@helgen.tech', aprobaciones: true })).puedeAprobar, true);
assert.equal(P.accionesGasto(Object.assign({}, g0, { solicitanteEmail: 'adri@helgen.tech' }), { yo: 'adri@helgen.tech', aprobaciones: true }).puedeAprobar, false, 'nunca lo suyo');
assert.equal(P.accionesGasto(Object.assign({}, g0, { solicitanteEmail: 'leo@helgen.tech' }), { yo: 'leo@helgen.tech', aprobaciones: true, superadmin: true }).puedeAprobar,
  true, 'el super admin sí (con motivo)');
assert.equal(P.accionesGasto(Object.assign({}, g0, { estado: 'Aprobado' }), { yo: 'p@helgen.tech', compras: true }).puedeReembolsar, true);
const L = [{ folio: 'GAS-1', estado: 'Enviado', propio: true, concepto: 'Gasolina', moneda: 'MXN', total: 10 }, { folio: 'GAS-2', estado: 'Enviado', propio: false, concepto: 'Hotel', moneda: 'USD', total: 5 },
  { folio: 'GAS-3', estado: 'Aprobado', propio: false, concepto: 'Caseta', moneda: 'MXN', total: 0.1 }, { folio: 'GAS-4', estado: 'Reembolsado', propio: false, concepto: 'Casetá', moneda: 'MXN', total: 0.2 }];
const F = (f, r) => plain(P.filtrarGastos(L, f, r)).map(x => x.folio);
assert.deepEqual(F({ estado: 'porAprobar' }, {}), ['GAS-2'], 'sin los propios');
assert.deepEqual(F({ estado: 'porAprobar' }, { superadmin: true }), ['GAS-1', 'GAS-2']);
assert.deepEqual(F({ estado: 'porReembolsar' }), ['GAS-3']);
assert.deepEqual(F({ estado: 'pendientes' }), ['GAS-1', 'GAS-2', 'GAS-3']);
assert.deepEqual(F({ estado: '' }), ['GAS-1', 'GAS-2', 'GAS-3', 'GAS-4']);
assert.deepEqual(F({ estado: 'Reembolsado' }), ['GAS-4']);
assert.deepEqual(F({ estado: '', buscar: 'CASETA' }), ['GAS-3', 'GAS-4'], 'sin acentos ni mayúsculas');
assert.deepEqual(plain(P.totalesGastos(L)), [{ moneda: 'MXN', total: 10.3, gastos: 3 }, { moneda: 'USD', total: 5, gastos: 1 }]);
// Pendientes (puros)
const pend = [{ folio: 'GAS-1', estado: 'Enviado', solicitanteEmail: 'obrero@helgen.tech', solicitante: 'Juan Obrero', categoria: 'Combustible', total: 116,
  moneda: 'MXN', proyectoVisible: 'PRY-2026-0001-PLA', proyectoNombre: 'Planta', desde: '2026-10-20 10:00' },
{ folio: 'GAS-2', estado: 'Aprobado', solicitanteEmail: 'adri@helgen.tech', solicitante: 'Adriana', categoria: 'Hospedaje', total: 50, moneda: 'USD',
  proyectoVisible: 'PRY-2026-0002-TER', proyectoNombre: 'Terminal', desde: '2026-10-21 09:00' }];
let it = plain(P.itemsGastoPendientes(pend, { yo: 'adri@helgen.tech', roles: { aprobaciones: true }, hoy: '2026-10-25' }));
assert.deepEqual(it.map(x => [x.tipo, x.seccion, x.folio, x.destino, x.accion, x.desde, x.dias]), [['gastoAprobar', 'aprobaciones', 'GAS-1', 'gas', 'Revisar', '2026-10-20', 5]]);
assert(/PRY-2026-0001-PLA · Planta · Combustible · capturó Juan Obrero · \$116\.00 MXN/.test(it[0].detalle) && !('para' in it[0]));
assert.deepEqual(plain(P.itemsGastoPendientes(pend, { yo: 'obrero@helgen.tech', roles: { aprobaciones: true }, hoy: '2026-10-25' })).map(x => x.folio), [], 'lo propio no');
assert.deepEqual(plain(P.itemsGastoPendientes(pend, { yo: 'p@helgen.tech', roles: { compras: true }, hoy: '2026-10-25' })).map(x => x.tipo + ':' + x.folio),
  ['gastoReembolsar:GAS-2']);
assert.deepEqual(plain(P.itemsGastoPendientes(pend, { yo: 'leo@helgen.tech', roles: {}, todos: true, hoy: '2026-10-25' })).map(x => x.folio + ':' + x.para),
  ['GAS-1:Aprobaciones', 'GAS-2:Compras']);
assert.deepEqual(plain(P.itemsGastoPendientes(pend, { yo: 'obrero@helgen.tech', roles: { requisicion: true }, hoy: '2026-10-25' })), [], 'quien pide: nada');
assert.deepEqual(plain(P.conteosPendientes([{ seccion: 'aprobaciones', destino: 'gas' }, { seccion: 'compras', destino: 'gas' }, { seccion: 'mias', destino: 'req' }])),
  { total: 3, aprobaciones: 1, compras: 1, mias: 1, ops: 0, com: 0, req: 1, gas: 2 });
// Correos (puros): destinatarios y texto sin montos ni concepto
const info = Object.assign({ fecha: '2026-10-29 10:00:00', actorCorreo: 'obrero@helgen.tech', actorNombre: 'Juan Obrero', proyectoVisible: 'PRY-2026-0001-PLA',
  proyectoNombre: 'Planta', nota: '' }, plain(P.datosAvisoGasto({ gasto: 'gas-2026-0001', solicitante: 'Obrero@helgen.tech', solicitanteNombre: 'Juan  Obrero', categoria: 'combustible' })));
assert.deepEqual([info.folio, info.categoria, info.solicitanteEmail, info.solicitante], ['GAS-2026-0001', 'Combustible', 'obrero@helgen.tech', 'Juan Obrero']);
assert.equal(P.datosAvisoGasto({ gasto: 'OC-2026-0001', categoria: 'Inventada' }).folio, '', 'solo folios GAS');
const roles = { aprobaciones: ['adri@helgen.tech', 'obrero@helgen.tech'], compras: ['pedro@helgen.tech'] };
assert.deepEqual(plain(P.destinatariosGasto('gasto.enviado', info, roles)), [{ quien: 'aprobaciones', para: ['adri@helgen.tech'] }]);
assert.deepEqual(plain(P.destinatariosGasto('gasto.aprobado', info, roles)), [{ quien: 'solicitante', para: ['obrero@helgen.tech'] }]);
assert.deepEqual(plain(P.destinatariosGasto('gasto.rechazado', info, roles)), [{ quien: 'solicitante', para: ['obrero@helgen.tech'] }]);
assert.deepEqual(plain(P.destinatariosGasto('gasto.reembolsar', info, roles)), [{ quien: 'compras', para: ['pedro@helgen.tech'] }]);
for (const tipo of ['gasto.enviado', 'gasto.aprobado', 'gasto.rechazado', 'gasto.reembolsar']) {
  const x = plain(P.contenidoAviso(tipo, tipo === 'gasto.reembolsar' ? 'compras' : 'solicitante', Object.assign({}, info, { nota: 'Pagué $500 en la Pemex' })));
  const todo = JSON.stringify(x);
  assert(/^\[CAPRI\] GAS-2026-0001 · Gasto/.test(x.asunto) && /Planta/.test(x.asunto), x.asunto);
  assert(!/\$|500|Pemex|MXN|USD/.test(todo), tipo + ': sin montos ni texto libre: ' + todo);
  assert.equal(x.boton.url, 'https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/#gas=GAS-2026-0001');
  assert(/Hay una nota/.test(x.nota));
}
assert(['gasto.enviado', 'gasto.aprobado', 'gasto.rechazado', 'gasto.reembolsar'].every(e => correr('EVENTOS_CORREO').includes(e)));

// ================= 1. Servidor (doPost) =================
P.prepararCapri(); // Permisos en el libro de Administración (la excepción de super admin queda en su Bitacora)
const LA = libros[props.ADMIN_DB_ID];
const pry = nombre => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: 'Cliente ' + nombre, empresa: 'SA' }, idSolicitud: id('p') });
const p1o = pry('Planta Norte'), p2o = pry('Terminal Sur'), p3o = pry('Obra Cerrada'), p4o = pry('Obra Cancelada');
const [p1, p2, p3, p4] = [p1o.folio, p2o.folio, p3o.folio, p4o.folio];
// p2 en USD (cotización aceptada); p3 Cerrado y p4 Cancelado (a mano en la hoja)
const cUsd = ok('ana', 'guardarCotizacion', { cliente: { nombre: 'Cliente Terminal Sur', empresa: 'SA' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 1000 }],
  proyectoFolio: p2, moneda: 'USD', idSolicitud: id('c') }).folio;
ok('efrain', 'marcarAceptada', p2, cUsd, true);
const HP = libros.DB.pest.Proyectos.m;
HP.find(r => r[0] === p3)[6] = 'Cerrado';
HP.find(r => r[0] === p4)[6] = 'Cancelado';
Object.keys(A.cache).forEach(k => delete A.cache[k]); // cambio a mano en la hoja: las listas se vuelven a armar

const ticket = (nombre, datos) => ({ nombre: nombre || 'ticket.jpg', datos: datos || FOTO });
const gasto = (d) => Object.assign({ proyectoFolio: p1, fecha: HOY_ISO, categoria: 'Combustible', concepto: 'Gasolina camioneta', monto: 1160, moneda: 'MXN',
  ivaIncluido: 'Sí', ticket: ticket(), idSolicitud: id('g') }, d);
const enviar = (quien, d) => ok(quien, 'guardarGasto', gasto(d));
const LC = () => libros[props.COMPRAS_DB_ID];
const HG = () => LC().pest.Gastos.m;
const fila = folio => { const h = HG(), c = h[0]; const r = h.find(x => x[0] === folio); const o = {}; c.forEach((k, i) => { o[k] = r[i]; }); return o; };
const correosDe = re => A.correos.filter(m => re.test(m.subject));
const ultimoCorreo = re => correosDe(re).slice(-1)[0];
const nCorreos = () => A.correos.length;

// ---- Permisos: ventas sin Requisiciones no entra ----
falla('ana', 'listarGastos', [null], /No tienes acceso a Gastos/, 'PERMISO');
falla('ana', 'guardarGasto', [gasto()], /rol de Requisiciones/, 'PERMISO');
falla('ana', 'aprobarGasto', ['GAS-' + ANIO + '-0001'], /rol de Aprobaciones/, 'PERMISO');
falla('obrero', 'reembolsarGasto', [{ folio: 'GAS-' + ANIO + '-0001' }], /permiso de compras/, 'PERMISO');
falla('', 'listarGastos', [null], /Inicia sesión/, 'SESION');

// ---- Capturar: validación antes de gastar folio ----
falla('obrero', 'guardarGasto', [gasto({ ticket: null })], /Adjunta la foto o el PDF del ticket/);
falla('obrero', 'guardarGasto', [gasto({ ticket: ticket('t.txt', TXT) })], /El ticket debe ser PDF o imagen/);
falla('obrero', 'guardarGasto', [gasto({ fecha: masDias(1) })], /no puede ser futura/);
falla('obrero', 'guardarGasto', [gasto({ proyectoFolio: '' })], /Elige el proyecto del gasto/);
falla('obrero', 'guardarGasto', [gasto({ proyectoFolio: 'PRY-' + ANIO + '-0099' })], /No existe el proyecto/);
falla('obrero', 'guardarGasto', [gasto({ proyectoFolio: p4 })], /está cancelado: no admite gastos/);
falla('obrero', 'guardarGasto', [gasto({ categoria: '' })], /Elige la categoría/);
falla('obrero', 'guardarGasto', [gasto({ proyectoFolio: p2 })], /El proyecto es en USD y el gasto en MXN: captura el tipo de cambio/);
assert(!LC() || !LC().pest.Gastos || HG().length <= 1, 'ningún gasto escrito');
assert.equal(props['CONSECUTIVO_GAS_' + ANIO], undefined, 'ningún folio gastado');

// ---- Capturar (obrero, MXN, IVA incluido): fila, archivo privado, bitácora y aviso a Aprobaciones ----
let n0 = nCorreos();
const r1 = enviar('obrero', { concepto: '=Gasolina "Magna"', idSolicitud: 'gas-uno' });
const G1 = 'GAS-' + ANIO + '-0001';
assert.deepEqual([r1.folio, r1.repetido, r1.gasto.estado, r1.gasto.subtotal, r1.gasto.iva, r1.gasto.total, r1.gasto.proyectoVisible],
  [G1, false, 'Enviado', 1000, 160, 1160, p1o.folioVisible]);
let f1 = fila(G1);
assert.deepEqual([f1.fecha, f1.proyecto_folio, f1.solicitante_email, f1.solicitante_nombre, f1.categoria, f1.concepto, f1.moneda, f1.iva_incluido,
  f1.subtotal, f1.iva, f1.total, f1.tipo_cambio, f1.moneda_proyecto, f1.estado, f1.id_solicitud],
[HOY_ISO, p1, 'obrero@helgen.tech', 'Juan Obrero', 'Combustible', '=Gasolina "Magna"', 'MXN', 'Sí', 1000, 160, 1160, '', 'MXN', 'Enviado', 'gas-uno']);
assert(typeof f1.fecha === 'string' && typeof f1.fecha_registro === 'string', 'fechas como texto (textoFecha_), no Date');
assert(f1.huella_solicitud.length > 10);
const aTicket = archivos[f1.ticket_id];
assert.equal(aTicket.nombre, G1 + ' — Ticket.jpg');
assert.equal(ruta(aTicket.padre), 'Mi unidad/Cotizador Helgen — Compras/' + ANIO + '/' + p1 + '/Gastos');
for (let c = aTicket; c && c.nombre !== 'Mi unidad'; c = c.padre) assert.equal(c.acceso, 'PRIVATE', 'privado de arriba abajo: ' + c.nombre);
assert.equal(f1.ticket_url, A.urlArchivo(f1.ticket_id));
const bitC = () => LC().pest.Bitacora.m.slice(1);
assert.deepEqual(bitC().slice(-1)[0].slice(2, 4), ['Registrar gasto', p1]);
assert(/GAS-.* · Combustible · \$1,160\.00 MXN \(IVA \$160\.00\)/.test(bitC().slice(-1)[0][4]));
let m = ultimoCorreo(new RegExp(G1));
assert.equal(nCorreos(), n0 + 1);
assert.deepEqual(m.to.split(',').sort(), ['adri@helgen.tech', 'tania@helgen.tech'], 'a Aprobaciones');
assert(/Gasto por aprobar · Planta Norte/.test(m.subject) && m.replyTo === 'obrero@helgen.tech');
const sinMontos = x => { const t = x.subject + x.body + x.htmlBody; return !/\$|1,160|1160|MXN|USD|Gasolina|Magna/.test(t); };
assert(sinMontos(m), 'el correo no lleva montos ni el concepto');
assert(/#gas=GAS-/.test(m.htmlBody));
assert.equal(props.VER_gastos != null, true, 'sube la versión de gastos');

// ---- Idempotencia: el mismo envío regresa el mismo folio, también con el caché vacío; otro contenido con el mismo id se rechaza ----
const filas0 = HG().length;
let rr = ok('obrero', 'guardarGasto', gasto({ concepto: '=Gasolina "Magna"', idSolicitud: 'gas-uno' }));
assert.deepEqual([rr.folio, rr.repetido, HG().length], [G1, true, filas0]);
Object.keys(A.cache).forEach(k => delete A.cache[k]);
rr = ok('obrero', 'guardarGasto', gasto({ concepto: '=Gasolina "Magna"', idSolicitud: 'gas-uno' }));
assert.deepEqual([rr.folio, rr.repetido, HG().length], [G1, true, filas0], 'sin caché: la hoja lo sabe');
falla('obrero', 'guardarGasto', [gasto({ concepto: '=Gasolina "Magna"', monto: 999, idSolicitud: 'gas-uno' })], new RegExp('ya se registró como ' + G1 + ' con otros datos'));
falla('obrero', 'guardarGasto', [gasto({ concepto: '=Gasolina "Magna"', ticket: ticket('t.pdf', PDF), idSolicitud: 'gas-uno' })], /con otros datos/); // otro ticket
falla('tania', 'guardarGasto', [gasto({ concepto: '=Gasolina "Magna"', idSolicitud: 'gas-uno' })], /ya se registró con otra cuenta/);
assert.equal(nCorreos(), n0 + 1, 'un reintento no vuelve a avisar');

// ---- Monedas y tipo de cambio ----
const r2 = enviar('obrero', { proyectoFolio: p2, moneda: 'MXN', monto: 1850, ivaIncluido: 'No', tipoCambio: 18.5, categoria: 'Hospedaje', concepto: 'Hotel Veracruz' });
const G2 = r2.folio;
assert.deepEqual([fila(G2).tipo_cambio, fila(G2).moneda_proyecto, fila(G2).subtotal, fila(G2).iva], [18.5, 'USD', 1850, 0]);
const r3 = enviar('obrero', { proyectoFolio: p3, moneda: 'USD', monto: 58, tipoCambio: 18, categoria: 'Casetas', concepto: 'Caseta' });
assert.deepEqual([fila(r3.folio).moneda, fila(r3.folio).moneda_proyecto, fila(r3.folio).tipo_cambio], ['USD', 'MXN', 18], 'proyecto Cerrado sí admite gastos');
const r4 = enviar('obrero', { proyectoFolio: p2, moneda: 'USD', monto: 20, tipoCambio: 18, categoria: 'Viáticos', concepto: 'Comida' });
assert.equal(fila(r4.folio).tipo_cambio, '', 'misma moneda que el proyecto: sin tipo de cambio');

// ---- Cada quien solo ve lo suyo; @helgen.services y Solo requisiciones capturan ----
const secreto = correr("secretoSesion_(true)");
assert(secreto);
const jesus = correr("emitirSesionCapri_('jesus@helgen.services', 'Jesús Honorato')");
let b = ok(jesus, 'bootstrap');
assert.deepEqual([b.soloRequisicion, b.permisos.requisicion, b.permisos.compras], [true, true, false]);
let vj = ok(jesus, 'listarGastos', null);
assert.deepEqual([vj.mios.length, vj.equipo, vj.puede.enviar, vj.puede.aprobar, vj.puede.reembolsar], [0, null, true, false, false]);
assert(vj.proyectos.some(x => x.folio === p2 && x.moneda === 'USD') && vj.proyectos.some(x => x.folio === p3) && !vj.proyectos.some(x => x.folio === p4),
  'proyectos Activo y Cerrado con su moneda; Cancelado no');
assert(!/obrero|1160|Gasolina/.test(JSON.stringify(vj)), 'nada de otras personas');
const rj = ok(jesus, 'guardarGasto', gasto({ categoria: 'Viáticos', concepto: 'Comida en sitio', monto: 250, ticket: ticket('t.pdf', PDF) }));
const GJ = rj.folio;
assert.deepEqual([fila(GJ).solicitante_email, fila(GJ).solicitante_nombre, archivos[fila(GJ).ticket_id].nombre], ['jesus@helgen.services', 'Jesús Honorato', GJ + ' — Ticket.pdf']);
assert.deepEqual(ok(jesus, 'listarGastos', null).mios.map(g => g.folio), [GJ]);
falla(jesus, 'aprobarGasto', [G1], /rol de Aprobaciones/, 'PERMISO');
falla(jesus, 'reembolsarGasto', [{ folio: G1 }], /solo tiene acceso a Requisiciones/, 'PERMISO');
const rr1 = ok('rosa', 'guardarGasto', gasto({ categoria: 'Herramientas', concepto: 'Pinzas', monto: 300 }));
const GR = rr1.folio;
let vo = ok('obrero', 'listarGastos', null);
assert.deepEqual(vo.mios.map(g => g.folio), [r4.folio, r3.folio, G2, G1], 'los suyos, más recientes primero');
assert.equal(vo.equipo, null, 'quien solo captura no ve los del equipo');
assert(!/rosa@|jesus@|Pinzas|Comida en sitio/.test(JSON.stringify(vo)), 'ni rastro de los demás');
assert.deepEqual(plain(vo.mios[3]).puedeCancelar, true);
assert(!('ticketId' in vo.mios[0]) && !('huella' in vo.mios[0]) && !('idSolicitud' in vo.mios[0]), 'sin ids de archivos ni idempotencia');
// Aprobaciones (también Solo requisiciones) y Compras ven todos; su filtro por omisión es lo suyo pendiente
let va = ok('adri', 'listarGastos', null);
assert.deepEqual([va.puede.aprobar, va.puede.reembolsar, va.equipo.filtro.estado], [true, false, 'porAprobar']);
assert.deepEqual(va.equipo.gastos.map(g => g.folio).sort(), [G1, G2, r3.folio, r4.folio, GJ, GR].sort());
assert.deepEqual(plain(va.equipo.totales), [{ moneda: 'MXN', total: 1160 + 1850 + 250 + 300, gastos: 4 }, { moneda: 'USD', total: 58 + 20, gastos: 2 }],
  'totales por moneda (nunca se suman MXN y USD)');
let vp = ok('pedro', 'listarGastos', null);
assert.deepEqual([vp.puede.reembolsar, vp.puede.aprobar, vp.equipo.filtro.estado, vp.equipo.gastos.length], [true, false, 'porReembolsar', 0]);
assert.equal(ok('pedro', 'listarGastos', { estado: '', buscar: 'pinzas' }).equipo.gastos[0].folio, GR, 'búsqueda');

// ---- Cancelar: solo quien lo capturó, solo Enviado, con motivo ----
falla('rosa', 'cancelarGasto', [G1, 'No es mío pero lo cancelo'], /Solo quien capturó el gasto/, 'PERMISO');
falla('obrero', 'cancelarGasto', [r4.folio, 'no'], /motivo/);
let rc = ok('obrero', 'cancelarGasto', r4.folio, 'Lo capturé dos veces', null);
assert.equal(fila(r4.folio).estado, 'Cancelado');
assert.deepEqual([fila(r4.folio).cancelado_por, fila(r4.folio).motivo_cancelacion], ['obrero@helgen.tech', 'Lo capturé dos veces']);
assert.equal(rc.datos.mios.find(g => g.folio === r4.folio).motivo, 'Lo capturé dos veces');
falla('obrero', 'cancelarGasto', [r4.folio, 'Otra vez cancelado'], /cancelado: no se puede cancelar/);

// ---- Aprobar: Aprobaciones; nunca lo propio; avisa a quien lo capturó y a Compras (sin montos) ----
n0 = nCorreos();
let ra = ok('adri', 'aprobarGasto', G1, null);
assert.deepEqual([fila(G1).estado, fila(G1).reviso_email], ['Aprobado', 'adri@helgen.tech']);
assert(typeof fila(G1).fecha_revision === 'string');
assert.equal(ra.datos.equipo.gastos.some(g => g.folio === G1), false, 'ya no está por aprobar');
assert.equal(nCorreos(), n0 + 2);
const mA = ultimoCorreo(/Gasto aprobado/), mR = ultimoCorreo(/Gasto por reembolsar/);
assert.deepEqual([mA.to, mR.to], ['obrero@helgen.tech', 'pedro@helgen.tech']);
assert(sinMontos(mA) && sinMontos(mR) && /Juan Obrero/.test(mR.body));
falla('tania', 'aprobarGasto', [G1], /aprobado: no se puede aprobar/);
falla('obrero', 'aprobarGasto', [G2], /rol de Aprobaciones/, 'PERMISO');
// Tania (Requisiciones + Aprobaciones) no aprueba ni rechaza lo suyo; adri sí
const GT = enviar('tania', { concepto: 'Taxi', monto: 200, categoria: 'Viáticos' }).folio;
assert.equal(ultimoCorreo(new RegExp(GT)).to, 'adri@helgen.tech', 'el aviso no le llega a quien lo capturó');
falla('tania', 'aprobarGasto', [GT], /No puedes aprobar tu propio gasto/, 'PERMISO');
assert(!/super admin/.test(A.post('tania', 'aprobarGasto', GT).error), 'sin la pista de super admin');
falla('tania', 'rechazarGasto', [GT, 'Me equivoqué de proyecto'], /No puedes rechazar tu propio gasto/, 'PERMISO');
assert.equal(ok('tania', 'listarGastos', null).equipo.gastos.some(g => g.folio === GT), false, 'en "por aprobar" no ve lo suyo');
ok('adri', 'aprobarGasto', GT, null);
// Super admin: lo suyo solo con motivo (≥ 10), que queda en la Bitacora de Administración
const GL = enviar('leo', { concepto: 'Vuelo a Veracruz', monto: 4000, categoria: 'Viáticos' }).folio;
const e1 = falla('leo', 'aprobarGasto', [GL, null], /No puedes aprobar tu propio gasto.*Como super admin puedes hacerlo/, 'PERMISO');
falla('leo', 'aprobarGasto', [GL, null, 'corto'], /Como super admin/, 'PERMISO');
assert.equal(fila(GL).estado, 'Enviado');
ok('leo', 'aprobarGasto', GL, null, 'Viaje urgente autorizado por dirección');
assert.equal(fila(GL).estado, 'Aprobado');
assert.deepEqual(LA.pest.Bitacora.m.slice(-1)[0].slice(2, 6), ['Excepción de super admin: aprobar su propio gasto', GL, '', 'Viaje urgente autorizado por dirección']);
assert(/Excepción de super admin/.test(bitC().slice(-1)[0][5]));

// ---- Rechazar: con motivo; el correo no lleva el motivo ----
falla('adri', 'rechazarGasto', [GR, ''], /motivo del rechazo/);
n0 = nCorreos();
ok('adri', 'rechazarGasto', GR, 'Ticket ilegible, vuelve a capturarlo', null);
assert.deepEqual([fila(GR).estado, fila(GR).motivo, fila(GR).reviso_email], ['Rechazado', 'Ticket ilegible, vuelve a capturarlo', 'adri@helgen.tech']);
m = ultimoCorreo(/Gasto rechazado/);
assert.equal(m.to, 'rosa@helgen.tech');
assert(/Hay una nota/.test(m.body) && !/ilegible/.test(m.body + m.htmlBody) && sinMontos(m));
assert.equal(ok('rosa', 'listarGastos', null).mios[0].motivo, 'Ticket ilegible, vuelve a capturarlo', 'quien lo capturó ve el motivo');
falla('adri', 'aprobarGasto', [GR], /rechazado: no se puede aprobar/);
falla('pedro', 'reembolsarGasto', [{ folio: GR, fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 1', comprobante: { datos: PDF } }], /rechazado: no se puede reembolsar/);

// ---- Reembolsar: Compras, con comprobante; idempotente por la hoja ----
const reem = d => Object.assign({ folio: G1, fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 998877', comprobante: { nombre: 'r.pdf', datos: PDF },
  idSolicitud: 're-uno' }, d);
falla('adri', 'reembolsarGasto', [reem()], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla('tania', 'reembolsarGasto', [reem()], /permiso de compras/, 'PERMISO');
falla('pedro', 'reembolsarGasto', [reem({ comprobante: null })], /Adjunta el comprobante del reembolso/);
falla('pedro', 'reembolsarGasto', [reem({ referencia: '' })], /clave de rastreo/);
falla('pedro', 'reembolsarGasto', [reem({ folio: G2 })], /enviado \(por aprobar\): no se puede reembolsar/);
falla('pedro', 'reembolsarGasto', [reem({ fecha: '2026-01-01' })], /no puede ser anterior a la del gasto/);
assert.equal(fila(G1).estado, 'Aprobado');
n0 = nCorreos();
let rre = ok('pedro', 'reembolsarGasto', reem());
const f1r = fila(G1);
assert.deepEqual([rre.folio, rre.repetido, f1r.estado, f1r.reembolso_fecha, f1r.reembolso_metodo, f1r.reembolso_referencia, f1r.reembolso_email],
  [G1, false, 'Reembolsado', HOY_ISO, 'Transferencia', 'SPEI 998877', 'pedro@helgen.tech']);
assert.equal(archivos[f1r.reembolso_id].nombre, G1 + ' — Reembolso.pdf');
assert.equal(archivos[f1r.reembolso_id].acceso, 'PRIVATE');
assert.equal(nCorreos(), n0, 'el reembolso no manda correo (no está en el contrato)');
Object.keys(A.cache).forEach(k => delete A.cache[k]);
rre = ok('pedro', 'reembolsarGasto', reem());
assert.deepEqual([rre.folio, rre.repetido], [G1, true], 'reintento sin caché: el mismo');
falla('pedro', 'reembolsarGasto', [reem({ referencia: 'SPEI 111' })], /ya se registró con otros datos/);
falla('pedro', 'reembolsarGasto', [reem({ idSolicitud: 're-dos' })], /reembolsado: no se puede reembolsar/);
const vr = ok('obrero', 'listarGastos', null).mios.find(g => g.folio === G1);
assert.deepEqual(plain(vr.reembolso), { fecha: HOY_ISO, metodo: 'Transferencia', referencia: 'SPEI 998877', quien: 'pedro@helgen.tech', conComprobante: true });

// ---- Archivos: quien lo capturó ve su ticket (no el comprobante); Aprobaciones y Compras todos; los demás no ----
const at = ok('obrero', 'archivoGasto', G1, 'ticket');
assert.deepEqual([at.nombre, at.mime, at.datos], [G1 + ' — Ticket.jpg', 'image/jpeg', FOTO]);
falla('obrero', 'archivoGasto', [G1, 'reembolso'], /No tienes acceso a ese archivo/, 'PERMISO');
falla('rosa', 'archivoGasto', [G1, 'ticket'], /No tienes acceso a ese archivo/, 'PERMISO');
falla('obrero', 'archivoGasto', [G1, 'xml'], /no tiene XML/);
assert.equal(ok('pedro', 'archivoGasto', G1, 'reembolso').datos, PDF);
assert.equal(ok('adri', 'archivoGasto', GJ, 'ticket').mime, 'application/pdf');

// ---- CFDI: prellenado desde el XML, receptor ajeno, no-XML, tipo E, UUID repetido (gastos y facturas de proveedor) ----
const conXml = (o, d) => gasto(Object.assign({ categoria: 'Combustible', concepto: 'Gasolina con factura', monto: 1, moneda: 'USD', ivaIncluido: 'No',
  xml: { nombre: 'f.xml', datos: b64(cfdi(o)) } }, d));
const rx = ok('obrero', 'guardarGasto', conXml({ subtotal: '500.00', tras: '80.00', total: '580.00' }));
const fx = fila(rx.folio);
assert.deepEqual([fx.moneda, fx.total, fx.subtotal, fx.iva, fx.iva_incluido, fx.uuid, fx.rfc_emisor, fx.emisor],
  ['MXN', 580, 500, 80, 'Sí', UUID1, PROV, 'GASOLINERA DEL BAJIO & CIA'], 'monto, moneda e IVA del XML (no lo capturado)');
assert.equal(archivos[fx.xml_id].nombre, rx.folio + ' — CFDI.xml');
assert.equal(archivos[fx.xml_id].acceso, 'PRIVATE');
assert(sinMontos(ultimoCorreo(new RegExp(rx.folio))) && !/GASOLINERA/.test(JSON.stringify(ultimoCorreo(new RegExp(rx.folio)))), 'sin el proveedor en el correo');
assert.equal(ok('obrero', 'archivoGasto', rx.folio, 'xml').mime, 'application/xml');
falla('obrero', 'guardarGasto', [conXml({ uuid: UUID1 })], new RegExp('ya está registrada \\(' + rx.folio + '\\)'));
falla('rosa', 'guardarGasto', [conXml({ uuid: UUID1.toLowerCase() })], /ya está registrada/); // otra persona, mismo UUID
falla('obrero', 'guardarGasto', [conXml({ uuid: UUID2, receptor: 'XAXX010101000' })], /está a nombre del RFC XAXX010101000, no de Helgen/);
falla('obrero', 'guardarGasto', [conXml({ uuid: UUID2, tipo: 'E' })], /nota de crédito/);
falla('obrero', 'guardarGasto', [gasto({ xml: { nombre: 'f.xml', datos: PDF } })], /no es un XML/);
falla('obrero', 'guardarGasto', [conXml({ uuid: UUID2, moneda: 'USD', total: '1160.00' }, { proyectoFolio: p1 })], /El proyecto es en MXN y el gasto en USD/);
const rxu = ok('obrero', 'guardarGasto', conXml({ uuid: UUID2, moneda: 'USD', subtotal: '100.00', tras: '16.00', total: '116.00' }, { proyectoFolio: p2 }));
assert.deepEqual([fila(rxu.folio).moneda, fila(rxu.folio).tipo_cambio], ['USD', ''], 'CFDI en USD en el proyecto USD');
// Un gasto cancelado libera su UUID (se puede volver a capturar con otro proyecto)
ok('obrero', 'cancelarGasto', rxu.folio, 'Era de otro proyecto', null);
const rxu2 = ok('obrero', 'guardarGasto', conXml({ uuid: UUID2, moneda: 'USD', subtotal: '100.00', tras: '16.00', total: '116.00' }, { proyectoFolio: p3, tipoCambio: 18 }));
assert.equal(fila(rxu2.folio).uuid, UUID2);
// El UUID de una factura de proveedor vigente tampoco se puede usar como gasto (se contaría dos veces en el margen)
correr(`(() => { const h = hojaCompras_(libroCompras_(), 'FacturasProveedor'); const f = HOJAS_COMPRAS.FacturasProveedor.enc.map(() => '');
  f[0] = 'FPR-${ANIO}-0001'; f[1] = 'CFDI'; f[2] = '${UUID3}'; f[29] = 'Vigente'; escribe_(h).appendRow(f); MEMO_ = {}; })()`);
falla('obrero', 'guardarGasto', [conXml({ uuid: UUID3 })], new RegExp('ya está registrada \\(FPR-' + ANIO + '-0001\\)'));
LC().pest.FacturasProveedor.m.pop(); // la factura sembrada no sigue en el libro (no es de una orden)

// ---- Pendientes: por aprobar (Aprobaciones, nunca lo propio) y por reembolsar (Compras) ----
const tiposPend = (quien, todos) => ok(quien, 'pendientes', todos).items.filter(x => x.destino === 'gas').map(x => x.tipo + ':' + x.folio);
assert.deepEqual(tiposPend('adri').sort(), ['gastoAprobar:' + G2, 'gastoAprobar:' + r3.folio, 'gastoAprobar:' + GJ, 'gastoAprobar:' + rx.folio,
  'gastoAprobar:' + rxu2.folio].sort());
assert(tiposPend('tania').every(x => x !== 'gastoAprobar:' + GT));
assert.deepEqual(tiposPend('pedro').sort(), ['gastoReembolsar:' + GT, 'gastoReembolsar:' + GL].sort());
assert.deepEqual(tiposPend('obrero'), [], 'quien pide no tiene pendientes de gastos');
assert.equal(ok('pedro', 'pendientes', false).conteos.gas, 2);
const todosLeo = ok('leo', 'pendientes', true).items.filter(x => x.destino === 'gas');
assert(todosLeo.some(x => x.folio === G2 && x.para === 'Aprobaciones') && todosLeo.some(x => x.folio === GT && x.para === 'Compras'));
const itP = ok('pedro', 'pendientes', false).items.find(x => x.folio === GT);
assert(/Taxi/.test(JSON.stringify(itP)) === false && /\$200\.00 MXN/.test(itP.detalle), 'compras ve el monto (no el concepto)');

// ---- bootstrap (solo si está en caché) y sincronizar (solo con la pestaña cargada y si cambió algo) ----
Object.keys(A.cache).forEach(k => delete A.cache[k]);
ok('obrero', 'sincronizar', {}, {}); // revisa las hojas editadas a mano antes de tomar las versiones
const vb = ok('obrero', 'bootstrap').versiones;
Object.keys(A.cache).forEach(k => delete A.cache[k]);
assert.equal(ok('obrero', 'bootstrap').gastos, null, 'con el caché vacío no se lee la hoja en la carga inicial');
ok('obrero', 'listarGastos', null);
assert.deepEqual(ok('obrero', 'bootstrap').gastos.mios.map(g => g.folio), ok('obrero', 'listarGastos', null).mios.map(g => g.folio));
assert.equal(ok('ana', 'bootstrap').gastos, undefined, 'ventas sin Gastos: nada');
let s = ok('obrero', 'sincronizar', vb, { gastos: true });
assert.equal(s.gastos, undefined, 'sin cambios: nada');
const GNUEVO = enviar('rosa', { concepto: 'Brocas', monto: 90, categoria: 'Herramientas' }).folio;
s = ok('obrero', 'sincronizar', vb, { gastos: true });
assert(s.cambios.includes('gastos') && s.gastos && !JSON.stringify(s.gastos).includes(GNUEVO), 'lo vuelve a mandar, sin los de otros');
assert.equal(ok('obrero', 'sincronizar', vb, {}).gastos, undefined, 'sin la pestaña cargada no se manda');
s = ok('pedro', 'sincronizar', vb, { gastos: true, gastosFiltro: { estado: '', buscar: 'brocas' } });
assert.deepEqual(s.gastos.equipo.gastos.map(g => g.folio), [GNUEVO], 'con el filtro de su página');
assert.equal(ok('ana', 'sincronizar', vb, { gastos: true }).gastos, undefined, 'ventas: nada aunque lo pida');
assert.equal(ok('adri', 'sincronizar', vb, { gastos: true }).pendientes.conteos.gas >= 1, true, 'Pendientes se vuelve a mandar al cambiar un gasto');

// ---- Para el margen (integrador): gastosDelLibro_ + costoGastosPorProyecto ----
const costo = () => plain(P.costoGastosPorProyecto(correr('MEMO_ = {}; gastosDelLibro_(libroCompras_())'), { [p1]: 'MXN', [p2]: 'USD', [p3]: 'MXN' }));
// Aprobados/Reembolsados: G1 (1000 MXN sin IVA, p1), GT (200/1.16, p1), GL (4000/1.16, p1)
const c1 = costo();
assert.deepEqual(c1[p1], [{ concepto: 'Gastos', moneda: 'MXN', monto: Math.round((1000 + 172.41 + 3448.28) * 100) / 100, cantidad: 3 }]);
ok('adri', 'aprobarGasto', G2, null); // 1850 MXN con TC 18.5 en p2 (USD) = 100 USD
assert.deepEqual(costo()[p2], [{ concepto: 'Gastos', moneda: 'USD', monto: 100, cantidad: 1 }]);

// ---- Anular (super admin): solo y en cascada del proyecto ----
const pv = ok('leo', 'previsualizarAnulacion', G1);
assert.deepEqual(pv.registros.map(r => r.tipo + ':' + r.folio), ['Gasto:' + G1]);
assert(pv.efectos.some(e => /se recalculan sin GAS-.*el reembolso ya pagado no se deshace/.test(e)), JSON.stringify(pv.efectos));
assert.equal(pv.archivos, 2, 'ticket y comprobante');
falla('pedro', 'anular', [G1, 'Registro duplicado por error'], /Solo un super admin/, 'PERMISO');
const verAntes = props.VER_gastos;
const an = ok('leo', 'anular', G1, 'Registro duplicado por error de captura', id('anu'));
assert.deepEqual(an.registros.map(r => r.folio), [G1]);
assert.notEqual(props.VER_gastos, verAntes, 'anular sube la versión de gastos');
assert.deepEqual([fila(G1).estado, fila(G1).cancelado_por], ['Anulada', 'leo@helgen.tech']);
assert(/^ANULADA — /.test(archivos[fila(G1).ticket_id].nombre) && /^ANULADA — /.test(archivos[fila(G1).reembolso_id].nombre));
assert.deepEqual(LA.pest.Anulaciones.m.slice(-1)[0].slice(2, 4), ['Gasto', G1]);
assert(bitC().some(r => r[2] === 'Anular gasto' && /GAS-/.test(r[4])));
assert(!ok('obrero', 'listarGastos', null).mios.some(g => g.folio === G1), 'sale de mis gastos');
assert(!ok('pedro', 'listarGastos', { estado: '', buscar: '' }).equipo.gastos.some(g => g.folio === G1), 'y de los del equipo');
assert.equal(costo()[p1][0].cantidad, 2, 'y del costo del margen');
falla('pedro', 'reembolsarGasto', [reem({ idSolicitud: 're-tres' })], /está anulado/);
falla('obrero', 'archivoGasto', [G1, 'ticket'], /está anulado/);
falla('leo', 'anular', [G1, 'Otra vez el mismo registro'], /ya está anulado/);
// Proyecto → sus gastos
const p5 = pry('Obra Equivocada').folio;
const G5 = enviar('obrero', { proyectoFolio: p5, concepto: 'Peaje', monto: 120, categoria: 'Casetas' }).folio;
const an5 = ok('leo', 'anular', p5, 'Proyecto creado por error de captura', id('anu'));
assert(an5.registros.some(r => r.tipo === 'Gasto' && r.folio === G5), JSON.stringify(an5.registros));
assert.equal(fila(G5).estado, 'Anulada');
assert(!tiposPend('adri').includes('gastoAprobar:' + G5), 'sale de Pendientes');
falla('adri', 'aprobarGasto', [G5], /está anulado/);
falla('obrero', 'guardarGasto', [gasto({ proyectoFolio: p5 })], /anulado/);
assert.deepEqual(plain(P.folioParaAnular('gas-2026-0003')), { clave: 'gasto', folio: 'GAS-2026-0003' });
falla('leo', 'previsualizarAnulacion', ['GAS-' + ANIO + '-0999'], /No existe el gasto/);

// ---- Correos de gastos: ninguno lleva montos ni el concepto ----
const deGastos = A.correos.filter(x => /GAS-/.test(x.subject) && !/Anulado/.test(x.subject));
assert(deGastos.length >= 8, 'se mandaron avisos de gastos');
for (const x of deGastos) assert(sinMontos(x) && !/Vuelo|Taxi|Pinzas|Brocas|Hotel|GASOLINERA/.test(x.subject + x.body + x.htmlBody), x.subject);

console.log('gastos.test.js: todo bien');
