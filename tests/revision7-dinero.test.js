// Incremento 7 · revisión independiente (dinero, monedas y estados), 29/10/2026: un caso por hallazgo. Cada sección reproduce el
// escenario de las sondas de la revisión (tests/revision7/: terminaban en error mientras el defecto existía) y comprueba lo corregido:
//  1. La liga de una factura de cliente guarda el número de la etapa Y su nombre: si en ese número ahora hay otra etapa (o ya no
//     existe) la factura queda "Por revisar" (vistas y Pendientes) y no cuenta ahí; y no se puede cambiar un esquema (contrato tras
//     un desbloqueo, adicional, cancelar una adicional, cambiar la aceptada a Helgen Energy) si renumera, renombra o quita una etapa
//     con facturas Vigentes ligadas (error con la lista). Agregar etapas al final o cambiar porcentajes sí se puede.
//  2. El mismo CFDI no cuenta dos veces: registrarFacturaProveedor rechaza (dentro del candado) un UUID que ya es un gasto vivo
//     (Enviado, Aprobado, Reembolsado); uno Cancelado o Rechazado no lo impide.
//  3. registrarPago (cobranza): idempotencia en la hoja (Pagos.id_solicitud + huella_solicitud, por nombre): el mismo envío sin caché
//     (o con la vista de más de 100 KB) regresa el mismo PAG; el mismo id con otros datos se rechaza; nada en el caché.
//  4. Resumen de cobranza: "Por cobrar" solo suma saldos positivos; el saldo a favor de un proyecto va aparte (aFavor por moneda y
//     por renglón, en la pantalla); la vista previa de Anular una adicional cobrada lo dice.
//  5. marcarAceptada no cambia la moneda con gastos vivos en la otra; el resumen y el reporte de margen dicen cuántos proyectos
//     tienen costos en otra moneda que no suman.
//  6. REP de una factura USD cobrada en MXN: con el saldo insoluto del último REP en cero ya no queda "REP pendiente".
//  7. Costos de nómina: "45.000" son 45,000 (no 45); "45.000,50" es ambiguo; menos de 1,000 MXN se confirma (a mano) y en el CSV
//     menos de 100 se rechaza.
//  8. Un REP o una nota de crédito sustituida (04) ya no suma a lo cubierto ni resta; el par queda por revisar.
// Uso: node tests/revision7-dinero.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const crearArnes = require('./arnes');
const { cfdi: cfdiCliente, U, b64 } = require('./revision7/cfdi-cliente');
const SRC = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');

/** Arnés con los roles de la revisión, CAPRI preparado y PRY-AAAA-0001 de relleno (folio de prueba en los reportes). */
function nuevo(extra) {
  const A = crearArnes(dir, { props: Object.assign({ ROL_COBRANZA: 'tania@helgen.tech, leo@helgen.tech', ADMIN_DESBLOQUEO: 'leo@helgen.tech',
    ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech, ana@helgen.tech', ROL_OPERACIONES: 'adri@helgen.tech',
    SUPER_ADMIN: 'leo@helgen.tech' }, extra || {}) });
  const { ok, HOY_ISO, PDF } = A;
  A.P.prepararCapri();
  let n = 0;
  const id = p => (p || 'x') + (++n) + '-' + Math.random().toString(36).slice(2, 8);
  const pry = nombre => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: 'Cliente ' + nombre, empresa: 'SA' }, idSolicitud: id('p') }).folio;
  const cotizar = (pf, precio, extraC) => ok('ana', 'guardarCotizacion', Object.assign({ cliente: { nombre: 'Cliente', empresa: 'SA' },
    items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: 'MXN', idSolicitud: id('c') }, extraC || {})).folio;
  const firmar = (pf, cot) => { ok('tania', 'marcarAceptada', pf, cot, true); return ok('tania', 'firmarContrato', pf, HOY_ISO); };
  const pagar = (pf, monto, etapaOrden, etapaAdicional, extraP) => ok('tania', 'registrarPago', Object.assign({ proyectoFolio: pf, fecha: HOY_ISO, monto,
    metodo: 'Transferencia', referencia: 'SPEI ' + id('r'), etapaOrden: etapaOrden || 1, etapaAdicional: etapaAdicional || '',
    comprobante: { datos: PDF }, idSolicitud: id('g') }, extraP || {}));
  const importar = (uuid, folio, montos) => ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'A-' + folio + '.xml',
    datos: b64(cfdiCliente(Object.assign({ uuid, folio: String(folio) }, montos || {}))) }], idSolicitud: id('imp') });
  pry('Relleno');
  return Object.assign(A, { id, pry, cotizar, firmar, pagar, importar });
}
const limpiarCache = A => Object.keys(A.cache).forEach(k => delete A.cache[k]);

// ================= 1. Liga de facturas de clientes por etapa (número + nombre) =================
{
  const A = crearArnes(dir, {});
  const { P, plain } = A;
  // ---- Lógica pura: lo calculado ----
  const F = (uuid, tipo, extra) => Object.assign({ uuid, tipo, serieFolio: uuid, fecha: '2026-10-10', metodo: 'PPD', moneda: 'MXN', total: 0,
    proyectoFolio: '', etapas: [], relacionadas: [], pagos: [], estado: 'Vigente', sinProyecto: '' }, extra || {});
  const COB = { 'PRY-1': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 580, cobrado: 0 }, { clave: '2', etapa: 'Finiquito', monto: 580, cobrado: 580 }] } };
  const c = plain(P.calcularFacturasClientes([
    F('R', 'I', { total: 1160, proyectoFolio: 'PRY-1', etapas: [{ clave: '1', etapa: 'Pago único', monto: 1160 }] }), // renombrada
    F('S', 'I', { total: 500, proyectoFolio: 'PRY-1', etapas: [{ clave: '2', etapa: 'finiquito ', monto: 500 }] }),   // mismo nombre (mayúsculas)
    F('V', 'I', { total: 50, proyectoFolio: 'PRY-1', etapas: [{ clave: '2', monto: 50 }] }),                         // liga sin nombre (de antes)
    F('X', 'I', { total: 10, proyectoFolio: 'PRY-1', etapas: [{ clave: '3', etapa: 'Extra', monto: 10 }] }),          // ya no existe
  ], COB));
  assert(/La etapa «Pago único» de la liga ya no está.*ahora está «Anticipo»/.test(c.facturas.R.revisar), c.facturas.R.revisar);
  assert.deepEqual([c.proyectos['PRY-1']['1'].facturado, c.proyectos['PRY-1']['1'].porFacturar], [0, 580], 'no cuenta en la etapa que ahora tiene su número');
  assert.deepEqual([c.facturas.S.revisar, c.facturas.V.revisar, c.proyectos['PRY-1']['2'].facturado], ['', '', 550], 'mismo nombre (sin mayúsculas) y liga sin nombre: cuentan');
  assert(/ya no existe/.test(c.facturas.X.revisar));
  // ---- Lógica pura: qué cambios de esquema se impiden ----
  const fs1 = [F('A-1', 'I', { proyectoFolio: 'PRY-1', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1 }] }),
    F('A-2', 'E', { proyectoFolio: 'PRY-1', etapas: [{ clave: '2', etapa: 'Instalación', monto: 1 }] }),       // E ligada a mano
    F('A-3', 'I', { proyectoFolio: 'PRY-1', etapas: [{ clave: 'HLG-2026-0009/1', etapa: 'Pago único', monto: 1 }] }),
    F('A-4', 'I', { proyectoFolio: 'PRY-2', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1 }] }),            // otro proyecto
    F('A-5', 'I', { estado: 'Cancelada', proyectoFolio: 'PRY-1', etapas: [{ clave: '3', etapa: 'Encendido', monto: 1 }] }),
    F('A-6', 'I', { proyectoFolio: 'PRY-1', etapas: [{ clave: '3', etapa: 'Viejo', monto: 1 }] })];             // ya estaba por revisar
  const E = (...ns) => ns.map(n => ({ etapa: n }));
  const hoy = E('Anticipo', 'Instalación', 'Encendido');
  const bloquea = (nuevas, adic, actuales) => plain(P.facturasQueImpidenCambiarEsquema(fs1, 'pry-1', adic || '', actuales || hoy, nuevas)).map(x => x.serieFolio + ' ' + x.ahora);
  assert.deepEqual(bloquea(E('Anticipo', 'Instalación', 'Encendido', 'Extra')), [], 'agregar al final');
  assert.deepEqual(bloquea(E('ANTICIPO', 'instalacion', 'Otra')), [], 'mismo nombre sin acentos ni mayúsculas; la 3 no tiene facturas Vigentes');
  assert.deepEqual(bloquea(E('Anticipo inicial', 'Instalación', 'Encendido')), ['A-1 Anticipo inicial'], 'renombrar');
  assert.deepEqual(bloquea(E('Instalación', 'Anticipo', 'Encendido')), ['A-1 Instalación', 'A-2 Anticipo'], 'renumerar (también la E ligada a mano)');
  assert.deepEqual(bloquea(E('Anticipo')), ['A-2 '], 'quitar');
  assert.deepEqual(bloquea(E('Mitad', 'Mitad 2'), 'HLG-2026-0009', E('Pago único')), ['A-3 Mitad'], 'adicional: solo sus etapas');
  assert.deepEqual(bloquea([], 'HLG-2026-0009', E('Pago único')), ['A-3 '], 'cancelar la adicional');
  assert(/No se puede cambiar el esquema de pagos: estas facturas de clientes están ligadas.*A-1 \(etapa 1 «Anticipo» → «Instalación»\), nota de crédito A-2 \(etapa 2 «Instalación» → «Anticipo»\)/
    .test(P.errorFacturasLigadasEsquema(P.facturasQueImpidenCambiarEsquema(fs1, 'PRY-1', '', hoy, E('Instalación', 'Anticipo', 'Encendido')), 'cambiar el esquema de pagos')));

  // ---- Servidor: contrato desbloqueado ----
  const S = nuevo();
  const { ok, falla } = S;
  const pC = S.pry('Contrato');
  S.firmar(pC, S.cotizar(pC, 10000)); // 11,600: Anticipo 6,960 · Instalación 3,480 · Encendido del sistema 1,160
  const UC = U(7001);
  S.importar(UC, 301, { subtotal: '6000.00', iva: '960.00', total: '6960.00' });
  ok('tania', 'ligarFacturaCliente', { uuid: UC, proyectoFolio: pC, etapas: [{ clave: '1' }] });
  ok('leo', 'desbloquearContrato', pC, 'Corregir el esquema de pagos');
  falla('tania', 'guardarEsquema', [pC, [{ etapa: 'Anticipo inicial', porcentaje: 60 }, { etapa: 'Instalación', porcentaje: 30 }, { etapa: 'Encendido del sistema', porcentaje: 10 }]],
    /No se puede cambiar el esquema de pagos: esta factura de cliente está ligada.*A-301 \(etapa 1 «Anticipo» → «Anticipo inicial»\).*vuelve a ligarlas.*Agregar etapas al final/);
  falla('tania', 'guardarEsquema', [pC, [{ etapa: 'Instalación', porcentaje: 30 }, { etapa: 'Anticipo', porcentaje: 60 }, { etapa: 'Encendido del sistema', porcentaje: 10 }]],
    /A-301 \(etapa 1 «Anticipo» → «Instalación»\)/);
  let v = ok('tania', 'guardarEsquema', pC, [{ etapa: 'Anticipo', porcentaje: 60 }, { etapa: 'Instalación', porcentaje: 25 }, { etapa: 'Encendido del sistema', porcentaje: 10 },
    { etapa: 'Garantía', porcentaje: 5 }]);
  assert.deepEqual(v.esquema.map(e => e.etapa), ['Anticipo', 'Instalación', 'Encendido del sistema', 'Garantía'], 'agregar al final y cambiar porcentajes sí');
  assert.deepEqual(v.facturas.porRevisar, [], 'la factura sigue bien ligada');
  // Con la factura marcada Cancelada (se canceló en CONTALINK), ya se puede renombrar
  ok('tania', 'cancelarFacturaCliente', UC, 'Cancelada en CONTALINK');
  v = ok('tania', 'guardarEsquema', pC, [{ etapa: 'Anticipo inicial', porcentaje: 100 }]);
  assert.deepEqual(v.esquema.map(e => e.etapa), ['Anticipo inicial']);

  // ---- Servidor: adicional (sonda p3) ----
  const pA = S.pry('Planta');
  S.firmar(pA, S.cotizar(pA, 10000));
  const ad = S.cotizar(pA, 1000, { adicional: true }); // 1,160, "Pago único" 100 %
  ok('tania', 'aceptarAdicional', pA, ad);
  const UF = U(4401);
  S.importar(UF, 201);
  ok('tania', 'ligarFacturaCliente', { uuid: UF, proyectoFolio: pA, etapas: [{ clave: ad + '/1' }] });
  falla('tania', 'guardarEsquemaAdicional', [pA, ad, [{ etapa: 'Anticipo', porcentaje: 50 }, { etapa: 'Finiquito', porcentaje: 50 }]],
    new RegExp('No se puede cambiar el esquema de la adicional ' + ad + ': .*A-201 \\(etapa 1 «Pago único» → «Anticipo»\\)'));
  falla('tania', 'cancelarAdicional', [pA, ad, 'El cliente ya no la quiere'], new RegExp('No se puede cancelar la adicional ' + ad + ': .*A-201 \\(etapa 1 «Pago único» → se quitaría\\)'));
  ok('tania', 'guardarEsquemaAdicional', pA, ad, [{ etapa: 'Pago único', porcentaje: 50 }, { etapa: 'Finiquito', porcentaje: 50 }]); // al final: sí
  // Renombrada a mano en la hoja: "Por revisar" en la vista, la lista y Pendientes; no se reasigna sola
  const esq = S.libros[S.props.COBRANZA_DB_ID].pest.Esquemas.m;
  esq.find(x => String(x[6]) === ad && Number(x[1]) === 1)[2] = 'Anticipo';
  limpiarCache(S);
  v = ok('tania', 'getCobranzaProyecto', pA);
  assert.deepEqual(v.facturas.etapas.filter(e => e.clave.indexOf(ad) === 0).map(e => [e.etapa, e.facturado]), [['Anticipo', 0], ['Finiquito', 0]]);
  assert.deepEqual(v.facturas.porRevisar.map(x => x.serieFolio), ['A-201']);
  const fl = ok('tania', 'listarFacturasClientes').facturas.find(f => f.uuid === UF);
  assert(/«Pago único».*«Anticipo»/.test(fl.revisar) && fl.etapas[0].etapa === 'Pago único', 'la liga guardada no cambia');
  assert(ok('tania', 'pendientes', false).items.some(x => x.tipo === 'facRevisar' && x.uuid === UF), 'Pendientes de cobranza');
  // Se vuelve a ligar y deja de estar por revisar
  ok('tania', 'ligarFacturaCliente', { uuid: UF, proyectoFolio: pA, etapas: [{ clave: ad + '/1' }, { clave: ad + '/2' }] });
  assert.deepEqual(ok('tania', 'getCobranzaProyecto', pA).facturas.porRevisar, []);
  // marcarAceptada (cambiar a Helgen Energy) usa la misma regla: el source la llama solo cuando reemplaza el esquema
  assert(/if \(etapas !== d\.etapas\) exigirEsquemaSinFacturasLigadas_\(/.test(SRC));
  console.log('OK 1 · liga por número y nombre de etapa; esquemas que la moverían');
}

// ================= 2. El mismo CFDI no cuenta dos veces (gasto ↔ factura de proveedor) =================
{
  const S = nuevo({ ROL_OPERACIONES: '' }); // sin operaciones: la orden sale directo al autorizar
  const { ok, post, PDF, HOY_ISO, masDias, FOTO, P } = S;
  const HELGEN = 'HSE240304PC1', PROV = 'EKU9003173C9';
  const cfdiProv = uuid => '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="G" Folio="77" Fecha="${HOY_ISO}T10:15:00" SubTotal="1000.00" Moneda="MXN" Total="1160.00" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="04" Exportacion="01" LugarExpedicion="76000">
  <cfdi:Emisor Rfc="${PROV}" Nombre="ELECTRICA DEL CENTRO" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${HELGEN}" Nombre="HELGEN" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="15101514" Cantidad="1" ClaveUnidad="H87" Descripcion="Cable" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="${HOY_ISO}T10:16:00"/></cfdi:Complemento>
</cfdi:Comprobante>`;
  const pA = S.pry('Planta');
  S.firmar(pA, S.cotizar(pA, 10000));
  const req = ok('obrero', 'guardarRequisicion', { proyectoFolio: pA, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1, unidad: 'pza' }],
    cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: S.id('r') }).folio;
  const oc = ok('pedro', 'autorizarRequisicion', req, { proveedor: { razonSocial: 'Eléctrica del Centro' }, fechaEntrega: masDias(1),
    formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, ivaTasa: 0.16,
    renglones: [{ descripcion: 'Cable', unidad: 'PZA', cantidad: 1, costo: 1000 }], idSolicitud: S.id('o') }).ocFolio;
  const gasto = uuid => ok('obrero', 'guardarGasto', { proyectoFolio: pA, fecha: HOY_ISO, categoria: 'Herramientas', concepto: 'Cable', monto: 1, moneda: 'MXN',
    ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'f.xml', datos: b64(cfdiProv(uuid)) }, idSolicitud: S.id('gas') }).folio;
  const factura = uuid => post('pedro', 'registrarFacturaProveedor', { ocFolio: oc, xml: { datos: b64(cfdiProv(uuid)) }, idSolicitud: S.id('f') });
  // Aprobado (sonda p2) y Enviado (tercera revisión, p5): se rechaza, con el folio del gasto
  const U1 = '7A1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E71', U2 = '7A1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E72';
  const g1 = gasto(U1);
  ok('leo', 'aprobarGasto', g1, null);
  let r = factura(U1);
  assert(!r.ok && new RegExp('ya está registrado como el gasto ' + g1 + ': la misma factura no puede contar dos veces').test(r.error), r.error);
  const g2 = gasto(U2);
  r = factura(U2);
  assert(!r.ok && new RegExp(g2).test(r.error), 'gasto Enviado: ' + r.error);
  // Cancelado (o Rechazado) ya no cuenta: la factura se registra
  ok('obrero', 'cancelarGasto', g2, 'Lo pagó compras con la orden');
  r = factura(U2);
  assert(r.ok, r.error);
  // Lógica pura: validarFacturaProveedor con ctx.gastos
  const f = P.leerCfdi(cfdiProv(U1));
  const orden = { folio: 'OC-1', estado: 'Emitida', moneda: 'MXN', subtotal: 1000, total: 1160, rfc: PROV };
  assert.throws(() => P.validarFacturaProveedor(f, orden, { rfcHelgen: HELGEN, hoy: HOY_ISO, facturas: [], gastos: { [U1]: 'GAS-2026-0009' } }), /GAS-2026-0009/);
  assert.equal(P.validarFacturaProveedor(f, orden, { rfcHelgen: HELGEN, hoy: HOY_ISO, facturas: [], gastos: {} }).neto, 1000);
  // Dentro del candado (como guardarGasto contra las facturas)
  const fn = SRC.slice(SRC.indexOf('function registrarFacturaProveedor('), SRC.indexOf('function cancelarFacturaProveedor('));
  assert(fn.indexOf('gastos: uuidsDeGastosVivos_(libro)') > fn.indexOf('return conCandado_('), 'la revisión va dentro del candado');
  console.log('OK 2 · el mismo CFDI no cuenta como gasto y como factura de proveedor');
}

// ================= 3. registrarPago: idempotencia en la hoja (sonda p4) =================
{
  const S = nuevo();
  const { ok, falla, HOY_ISO, PDF, cache, libros, props } = S;
  const pA = S.pry('Planta');
  S.firmar(pA, S.cotizar(pA, 100000));
  // Muchas facturas ligadas y pagos: {folio, url, vista} pasaba de los 100 KB y el caché no lo guardaba
  const N = 140, archivos = [];
  for (let i = 0; i < N; i++) archivos.push({ nombre: 'A-' + (300 + i) + '.xml', datos: b64(cfdiCliente({ uuid: U(5000 + i), folio: String(300 + i), subtotal: '100.00', iva: '16.00', total: '116.00' })) });
  for (let k = 0; k < N; k += 50) ok('tania', 'importarFacturasClientes', { archivos: archivos.slice(k, k + 50), idSolicitud: S.id('imp') });
  for (let i = 0; i < N; i++) ok('tania', 'ligarFacturaCliente', { uuid: U(5000 + i), proyectoFolio: pA, etapas: [{ clave: '1' }] });
  const pago = (idSol, monto) => ({ proyectoFolio: pA, fecha: HOY_ISO, monto: monto || 116, metodo: 'Transferencia', referencia: 'SPEI ' + idSol, etapaOrden: 1,
    comprobante: { datos: PDF }, idSolicitud: idSol });
  for (let i = 0; i < N; i++) ok('tania', 'registrarPago', pago(S.id('g')));
  const r1 = ok('tania', 'registrarPago', pago('reintento-1'));
  assert(Buffer.byteLength(JSON.stringify(r1), 'utf8') > 100 * 1024, 'la vista pasa de 100 KB (el caso de la revisión)');
  assert(!Object.keys(cache).some(k => /PAG_/.test(k)), 'nada de idempotencia en el caché');
  const hP = libros[props.COBRANZA_DB_ID].pest.Pagos.m;
  assert.deepEqual(hP[0].slice(-3), ['etapa_adicional', 'id_solicitud', 'huella_solicitud'], 'columnas nuevas al final, por nombre');
  const filas = () => hP.filter(x => String(x[10]) === 'SPEI reintento-1');
  assert.deepEqual([filas().length, filas()[0][23], filas()[0][24].length > 10], [1, 'reintento-1', true]);
  // El mismo envío otra vez (sin caché): el mismo PAG, con la vista de ahora, sin otra fila ni otro folio
  limpiarCache(S);
  const consecutivo = props['CONSECUTIVO_PAG_' + S.ANIO];
  const r2 = ok('tania', 'registrarPago', pago('reintento-1'));
  assert.deepEqual([r2.folio, r2.url, filas().length, props['CONSECUTIVO_PAG_' + S.ANIO]], [r1.folio, r1.url, 1, consecutivo]);
  assert(r2.vista && r2.vista.pagos.length === N + 1, 'con la vista de ahora');
  // El mismo id con otros datos: se rechaza (como pagoYaRegistrado_ con los pagos a proveedores)
  falla('tania', 'registrarPago', [pago('reintento-1', 117)], new RegExp('Este envío ya se registró como ' + r1.folio + ' con otros datos'));
  assert.equal(filas().length, 1);
  // La huella se escribe con textoCelda (puede empezar con "-": se leería como fórmula)
  assert(/etapaAdic, \/\/ A \(incremento 7\): etapa_adicional\s+t\(idSolicitud\), t\(huella\),/.test(SRC));
  console.log('OK 3 · idempotencia de registrarPago en la hoja');
}

// ================= 4. Saldo a favor aparte en el resumen de cobranza (sonda p1) =================
{
  const S = nuevo();
  const { ok, id } = S;
  const pA = S.pry('Planta'), pX = S.pry('Otro cliente');
  S.firmar(pA, S.cotizar(pA, 10000)); // 11,600
  S.firmar(pX, S.cotizar(pX, 1000));  // 1,160, sin pagos
  const ad = S.cotizar(pA, 1000, { adicional: true });
  ok('tania', 'aceptarAdicional', pA, ad);
  S.pagar(pA, 11600, 1, '');
  S.pagar(pA, 1160, 1, ad);
  // La vista previa de Anular la adicional cobrada: los pagos se quedan y el proyecto queda con saldo a favor
  const pv = JSON.stringify(ok('leo', 'previsualizarAnulacion', ad));
  assert(new RegExp('La adicional ' + ad + ' ya tiene \\$1,160\\.00 MXN cobrados: esos pagos se quedan \\(no se anulan\\).*quedará con un saldo a favor del cliente de \\$1,160\\.00 MXN').test(pv), pv);
  ok('leo', 'anular', ad, 'Se cotizó dos veces', id('a'));
  const rs = ok('tania', 'resumenCobranzaGeneral');
  const tot = rs.totales.find(t => t.moneda === 'MXN'), fila = f => rs.proyectos.find(p => p.folio === f);
  assert.deepEqual([fila(pA).saldo, fila(pA).aFavor, fila(pX).saldo, fila(pX).aFavor], [-1160, true, 1160, false]);
  assert.deepEqual([tot.porCobrar, tot.conSaldo, tot.aFavor, tot.conSaldoAFavor], [1160, 1, 1160, 1], 'Por cobrar sin restar el saldo a favor; éste aparte');
  assert.equal(ok('tania', 'reporteCxc').totales.find(t => t.moneda === 'MXN').total, tot.porCobrar, 'la misma cifra que CxC');
  // Sin pagos en la adicional, la vista previa no dice nada de saldo a favor. (En pA no: lo pagado de más se le aplicaría a una
  // adicional nueva, que quedaría cobrada)
  const ad2 = S.cotizar(pX, 500, { adicional: true });
  ok('tania', 'aceptarAdicional', pX, ad2);
  assert(!/saldo a favor|cobrados/.test(JSON.stringify(ok('leo', 'previsualizarAnulacion', ad2))));
  // Interfaz: el resumen lo muestra aparte
  const UI = require('./montar-interfaz')(S, dir);
  (async () => {
    const T = UI.montar('tania', { cobranza: true, ventas: true });
    await UI.esperar();
    T.run('RESUMEN = ' + JSON.stringify(rs) + '; pintarResumenCob()');
    assert(/Saldo a favor de clientes<\/span><b>\$1,160\.00 MXN · 1 proyecto/.test(T.$('resTotales').innerHTML), T.$('resTotales').innerHTML);
    assert(/Por cobrar<\/span><b>\$1,160\.00 MXN/.test(T.$('resTotales').innerHTML));
    assert(/\$1,160\.00 MXN a favor del cliente/.test(T.$('resLista').innerHTML), 'renglón del proyecto');
    console.log('OK 4 · saldo a favor aparte (resumen, pantalla y vista previa de Anular)');
  })().catch(e => { console.error(e); process.exit(1); });
}

// ================= 5. Moneda con gastos (sonda p5) y costos en otra moneda en los totales =================
{
  const S = nuevo({ ROL_OPERACIONES: '' });
  const { ok, falla, HOY_ISO, FOTO, P, plain } = S;
  const pA = S.pry('Planta');
  const g = ok('obrero', 'guardarGasto', { proyectoFolio: pA, fecha: HOY_ISO, categoria: 'Viáticos', concepto: 'Visita de levantamiento', monto: 5800,
    moneda: 'MXN', ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: S.id('gas') }).folio;
  // Enviado ya cuenta (es un gasto vivo); también Aprobado
  falla('tania', 'marcarAceptada', [pA, S.cotizar(pA, 1000, { moneda: 'USD' }), true], /El proyecto ya tiene gastos en MXN: la cotización aceptada debe ser en MXN\./);
  ok('leo', 'aprobarGasto', g, null);
  falla('tania', 'marcarAceptada', [pA, S.cotizar(pA, 1000, { moneda: 'USD' }), true], /ya tiene gastos en MXN/);
  S.firmar(pA, S.cotizar(pA, 1000));
  assert.equal(ok('tania', 'getCobranzaProyecto', pA).margen.totalCostos, 5000, 'en MXN el gasto entra al margen');
  // Un gasto cancelado no impide nada
  const pB = S.pry('Bodega');
  const gB = ok('obrero', 'guardarGasto', { proyectoFolio: pB, fecha: HOY_ISO, categoria: 'Viáticos', concepto: 'Visita', monto: 100,
    moneda: 'MXN', ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, idSolicitud: S.id('gas') }).folio;
  ok('obrero', 'cancelarGasto', gB, 'Me equivoqué de proyecto');
  ok('tania', 'marcarAceptada', pB, S.cotizar(pB, 1000, { moneda: 'USD' }), true);
  // Totales del resumen y del reporte de margen: cuántos proyectos tienen costos que no suman (otra moneda)
  const PRY = folio => ({ folio, folioVisible: folio, nombre: 'P ' + folio, cliente: 'C', estado: 'Activo' });
  const CON = folio => ({ proyectoFolio: folio, cotizacion: 'HLG-' + folio, marca: 'helgen', moneda: 'USD', subtotal: 1000, total: 1160, estado: 'Firmado' });
  const d = { proyectos: ['PRY-9-0001', 'PRY-9-0002', 'PRY-9-0003'].map(PRY), contratos: ['PRY-9-0001', 'PRY-9-0002', 'PRY-9-0003'].map(CON), esquemas: [],
    pagos: [], ordenes: [], prueba: [], costosExtra: { 'PRY-9-0001': [{ concepto: 'Gastos', moneda: 'MXN', monto: 5000, cantidad: 1 }],
      'PRY-9-0002': [{ concepto: 'Nómina', moneda: 'MXN', monto: 800, horas: 10, sinCostear: 0 }], 'PRY-9-0003': [{ concepto: 'Gastos', moneda: 'USD', monto: 100, cantidad: 1 }] } };
  const rg = plain(P.resumenGeneralCobranza(d)), mg = plain(P.margenPorProyecto(d));
  assert.deepEqual([rg.totales[0].sinSumar, rg.totales[0].margen, mg.totales[0].sinSumar, mg.totales[0].margen], [2, 2900, 2, 2900],
    'dos proyectos con costos en MXN que no suman; el margen USD solo con lo de USD');
  const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
  assert(/t\.sinSumar \? ' · ' \+ t\.sinSumar \+ \(t\.sinSumar === 1 \? ' proyecto' : ' proyectos'\) \+ ' con costos en otra moneda \(no suman al margen\)'/.test(html), 'resumen');
  assert(/t\.sinSumar \? ' · ' \+ t\.sinSumar \+ ' con gastos o nómina en otra moneda \(no suman\)'/.test(html), 'reporte de margen');
  console.log('OK 5 · moneda con gastos; costos en otra moneda contados en los totales');
}

// ================= 6. REP de factura USD cobrada en MXN (sonda p6) =================
{
  const A = crearArnes(dir, {});
  const { P, plain } = A;
  const UI = '00000001-AAAA-4BBB-8CCC-000000000001', UP = '00000002-AAAA-4BBB-8CCC-000000000002';
  const aplicado = P.convertirMoneda(200000, 'MXN', 'USD', 18.00); // 11,111.11 USD con el tipo de cambio de cobranza
  const factura = { uuid: UI, tipo: 'I', estado: 'Vigente', metodo: 'PPD', moneda: 'USD', total: 11111.11, fecha: '2026-10-01', serieFolio: 'A-1',
    proyectoFolio: 'PRY-2026-0005', etapas: [{ clave: '1', etapa: 'Total', monto: 11111.11 }] };
  const rep = (docs, extra) => Object.assign({ uuid: UP, tipo: 'P', estado: 'Vigente', moneda: 'MXN', total: 200000, fecha: '2026-10-20', serieFolio: 'P-1',
    pagos: [{ fecha: '2026-10-20', monto: 200000, moneda: 'MXN', documentos: docs }] }, extra || {});
  const cob = cobrado => ({ 'PRY-2026-0005': { moneda: 'USD', etapas: [{ clave: '1', etapa: 'Total', monto: 11111.11, cobrado }] } });
  // El REP (TipoCambioP 18.05) paga 11,080.33 USD y deja el saldo insoluto en 0: ya no hay REP pendiente
  let x = plain(P.calcularFacturasClientes([factura, rep([{ uuid: UI, parcialidad: 1, saldoAnterior: 11080.33, pagado: 11080.33, saldoInsoluto: 0, moneda: 'USD' }])], cob(aplicado))).facturas[UI];
  assert.deepEqual([x.repPendiente, x.porCubrirRepCts, x.saldoSegunRep, x.repSinCobro], [false, 0, 0, false]);
  // Con saldo insoluto en el último REP (por fecha y parcialidad), sigue pendiente
  x = plain(P.calcularFacturasClientes([factura, rep([{ uuid: UI, parcialidad: 1, saldoAnterior: 11111.11, pagado: 5000, saldoInsoluto: 6111.11, moneda: 'USD' }])], cob(aplicado))).facturas[UI];
  assert.deepEqual([x.repPendiente, x.porCubrirRepCts], [true, 611111]);
  // Al revés (el REP con más USD que lo cobrado en CAPRI) con la factura ya cobrada completa: no pregunta "¿falta registrar un pago?"
  x = plain(P.calcularFacturasClientes([Object.assign({}, factura, { total: 11000, etapas: [{ clave: '1', etapa: 'Total', monto: 11000 }] }),
    rep([{ uuid: UI, parcialidad: 1, saldoAnterior: 11050, pagado: 11050, saldoInsoluto: 0, moneda: 'USD' }])], cob(11000))).facturas[UI];
  assert.deepEqual([x.repPendiente, x.repSinCobro], [false, false]);
  console.log('OK 6 · REP con saldo insoluto en cero cubre la factura');
}

// ================= 7. Costos de nómina: "45.000" y el mínimo =================
{
  const A = crearArnes(dir, {});
  const { P, plain } = A;
  assert.deepEqual(['45.000', '1.250.000', '45,000', '45000', '45.5', '45.00', '45,5', '45.000,50', '1.250.000,00', '45,000.50'].map(P.importeDeTexto),
    [45000, 1250000, 45000, 45000, 45.5, 45, 45.5, null, null, 45000.5]);
  assert.deepEqual(['45.000,50', '1.250.000,', '45.000', '45,000.50', 45000].map(P.importeAmbiguo), [true, true, false, false, false]);
  const C = (costo, extra, op) => P.normalizarCostoPersonal(Object.assign({ correo: 'ana@helgen.tech', mes: '2026-10', costo }, extra || {}), op);
  assert.throws(() => C('45.000,50'), /es ambiguo \(punto y coma a la vez\): escribe 45000 o 45,000\.00/);
  assert.equal(C('45.000').costo, 45000);
  let e = null;
  try { C(500); } catch (x) { e = x; }
  assert(e && e.codigo === 'CONFIRMAR' && /menor a \$1,000\.00 MXN\. ¿Es correcto\?/.test(e.message), e && e.message);
  assert.deepEqual([C(500, { confirmado: true }).costo, C(1000).costo], [500, 1000]);
  assert.throws(() => C(99, {}, { sinConfirmar: true }), /menor a \$100\.00 MXN: revisa la cifra/);
  assert.equal(C(450, {}, { sinConfirmar: true }).costo, 450, 'en el CSV (no se puede confirmar) desde 100');
  const csv = plain(P.leerCsvCostos('correo;mes;costo\nana@helgen.tech;2026-10;45.000\nluis@helgen.tech;2026-10;45\nleo@helgen.tech;2026-10;45.000,50\n'));
  assert.deepEqual(csv.map(r => [r.correo, r.costo, !!r.error]), [['ana@helgen.tech', 45000, false], ['luis@helgen.tech', 45, true], ['leo@helgen.tech', 0, true]]);
  assert(/ambiguo/.test(csv[2].error) && /menor a \$100\.00/.test(csv[1].error));

  // Servidor e interfaz (Nómina): a mano, menos de 1,000 pide confirmar; el CSV con "45.000" guarda 45,000
  const S = nuevo();
  const { ok, falla, libros, props } = S;
  S.tokens.nora = S.claims('nora@helgen.tech', 'Nora', 'Nómina');
  ok('leo', 'guardarUsuario', { nuevo: true, correo: 'nora@helgen.tech', nombre: 'Nora Nómina', roles: ['ventas', 'nomina'] });
  const MES = S.HOY_ISO.slice(0, 7);
  falla('nora', 'guardarCostoPersonal', [{ correo: 'obrero@helgen.tech', mes: MES, costo: 500 }], /¿Es correcto\?/, 'CONFIRMAR');
  ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes: MES, costo: 500, confirmado: true });
  const imp = ok('nora', 'importarCostosPersonal', 'correo;mes;costo\nana@helgen.tech;' + MES + ';45.000\n');
  assert.deepEqual([imp.resumen.nuevos, imp.resultados[0].costo], [1, 45000]);
  const costos = libros[props.NOMINA_DB_ID].pest.CostosPersonal.m.slice(1).map(r => [r[0], r[3]]).sort();
  assert.deepEqual(costos, [['ana@helgen.tech', 45000], ['obrero@helgen.tech', 500]]);
  // Interfaz (mod-horas): el error CONFIRMAR abre window.confirm y vuelve a mandar con confirmado; si dice que no, no se guarda
  const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
  const llamadas = [], dialogos = { confirmar: false, mensajes: [] }, valores = { nomPersona: 'luis@helgen.tech', nomMes: MES, nomCosto: '45', nomNotas: '' };
  const errores = [];
  const ctx = { console, JSON, Promise, Error, Object, Array, String, Number, Math, Date, setTimeout, window: null,
    confirm: m => { dialogos.mensajes.push(m); return dialogos.confirmar; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  // Lo mínimo que usa guardarCosto: $, google.script.run (con el servidor simulado), mostrarError, aviso y lo que pinta al guardar
  vm.runInContext('var $ = id => ({ value: VALORES[id] || "", disabled: false }); var mostrarError = e => ERRORES.push(String(e && e.message || e)); var aviso = () => {};', Object.assign(ctx, { VALORES: valores, ERRORES: errores }));
  ctx.google = { script: { run: (function corredor(ok_, mal) {
    return new Proxy({}, { get: (_, n) => n === 'withSuccessHandler' ? f => corredor(f, mal) : n === 'withFailureHandler' ? f => corredor(ok_, f)
      : (...args) => { llamadas.push({ funcion: n, args }); const r = S.post('nora', n, ...args);
        Promise.resolve().then(() => { if (r.ok) ok_(r.datos); else { const er = new Error(r.error); er.codigo = r.codigo; mal(er); } }); } });
  })(null, null) } };
  const src = scripts.find(s => s.id === 'mod-horas').src;
  const ini = src.indexOf('    function guardarCosto(confirmado) {'), fin = src.indexOf('    function quitarCosto(');
  assert(ini > 0 && fin > ini, 'guardarCosto en mod-horas');
  vm.runInContext('var st = {}; var recibirCostos = () => {}; var cargarReporte = () => {};\n' + src.slice(ini, fin), ctx);
  (async () => {
    const esperar = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
    vm.runInContext('guardarCosto()', ctx); await esperar();
    assert.deepEqual([llamadas.length, dialogos.mensajes.length, errores.length], [1, 1, 0], 'preguntó y, con "no", no volvió a mandar');
    assert(/¿Es correcto\?/.test(dialogos.mensajes[0]));
    dialogos.confirmar = true;
    vm.runInContext('guardarCosto()', ctx); await esperar();
    assert.deepEqual(llamadas.map(c => c.args[0].confirmado === true), [false, false, true], 'con "sí", lo vuelve a mandar con confirmado');
    assert(libros[props.NOMINA_DB_ID].pest.CostosPersonal.m.some(r => r[0] === 'luis@helgen.tech' && r[3] === 45));
    console.log('OK 7 · importes de nómina ("45.000", ambiguos, mínimo con confirmación)');
  })().catch(e => { console.error(e); process.exit(1); });
}

// ================= 8. REP o nota de crédito sustituida (04) =================
{
  const A = crearArnes(dir, {});
  const { P, plain } = A;
  const I = { uuid: U(1), tipo: 'I', estado: 'Vigente', metodo: 'PPD', moneda: 'MXN', total: 1000, fecha: '2026-10-01', serieFolio: 'A-1',
    proyectoFolio: 'PRY-2026-0001', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1000 }], relacionadas: [] };
  const rep = (u, pagado, rel, estado) => ({ uuid: u, tipo: 'P', estado: estado || 'Vigente', moneda: 'MXN', total: pagado, fecha: '2026-10-20', serieFolio: 'P-' + u.slice(-1),
    relacionadas: rel ? [{ uuid: rel, tipoRelacion: '04' }] : [], pagos: [{ fecha: '2026-10-15', monto: pagado, moneda: 'MXN',
      documentos: [{ uuid: I.uuid, parcialidad: 1, saldoAnterior: 1000, pagado, saldoInsoluto: 1000 - pagado, moneda: 'MXN' }] }] });
  const cob = { 'PRY-2026-0001': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 1000, cobrado: 1000 }] } };
  // Sonda p11 de la tercera revisión: REP1 1,000 (por error) y REP2 400 que lo sustituye: lo cubierto es 400 y faltan 600
  let r = plain(P.calcularFacturasClientes([I, rep(U(901), 1000), rep(U(902), 400, U(901))], cob));
  assert.deepEqual([r.facturas[I.uuid].repCts, r.facturas[I.uuid].repPendiente, r.facturas[I.uuid].porCubrirRepCts, r.facturas[I.uuid].saldoSegunRep], [40000, true, 60000, 600]);
  assert(/Lo sustituye el REP P-2 \(relación 04\): ya no cuenta como REP/.test(r.facturas[U(901)].revisar), r.facturas[U(901)].revisar);
  assert(/Sustituye al REP P-1 \(relación 04\), que sigue Vigente en CAPRI: márcalo Cancelado/.test(r.facturas[U(902)].revisar), r.facturas[U(902)].revisar);
  assert.equal(r.facturas[U(901)].documentos.length, 1, 'sus documentos se siguen viendo');
  // Con el REP1 marcado Cancelado: el par deja de estar por revisar
  r = plain(P.calcularFacturasClientes([I, rep(U(901), 1000, null, 'Cancelada'), rep(U(902), 400, U(901))], cob));
  assert.deepEqual([r.facturas[I.uuid].repCts, r.facturas[U(902)].revisar], [40000, '']);
  // Nota de crédito E2 (300) que sustituye a E1 (500): solo resta E2
  const NC = (u, total, rels) => ({ uuid: u, tipo: 'E', estado: 'Vigente', metodo: 'PUE', moneda: 'MXN', total, fecha: '2026-10-05', serieFolio: 'NC-' + u.slice(-1),
    proyectoFolio: '', etapas: [], relacionadas: rels });
  r = plain(P.calcularFacturasClientes([I, NC(U(801), 500, [{ uuid: I.uuid, tipoRelacion: '01' }]),
    NC(U(802), 300, [{ uuid: I.uuid, tipoRelacion: '01' }, { uuid: U(801), tipoRelacion: '04' }])], cob));
  assert.deepEqual([r.facturas[I.uuid].netoCts, r.facturas[I.uuid].notas.map(n => n.monto), r.proyectos['PRY-2026-0001']['1'].facturado], [70000, [300], 700]);
  assert(/La sustituye la nota de crédito NC-2 \(relación 04\): ya no cuenta \(no resta\); márcala Cancelada/.test(r.facturas[U(801)].revisar), r.facturas[U(801)].revisar);
  assert(/Sustituye a la nota de crédito NC-1 .*márcala Cancelada/.test(r.facturas[U(802)].revisar), r.facturas[U(802)].revisar);
  // En la lista y en Pendientes (factura por revisar)
  const vista = plain(P.vistaFacturasClientes({ facturas: [I, rep(U(901), 1000), rep(U(902), 400, U(901))], cobranza: cob,
    proyectos: { 'PRY-2026-0001': { folio: 'PRY-2026-0001', folioVisible: 'PRY-2026-0001-ABC', nombre: 'P', cliente: 'C', estado: 'Activo' } } }, '2026-10-29'));
  const items = plain(P.itemsFacturasCliPendientes(vista, { hoy: '2026-10-29' }));
  assert.deepEqual(items.map(i => i.tipo + ' ' + i.folio).sort(), ['facRep A-1', 'facRevisar P-1', 'facRevisar P-2']);
  console.log('OK 8 · REP y nota de crédito sustituidos (04)');
}
