// Sonda 2: el UUID de un gasto se revisa contra las facturas de proveedor, pero NO al revés: compras puede registrar como factura
// de proveedor (de una orden del mismo proyecto) el mismo CFDI que ya es un gasto aprobado → la misma compra cuenta dos veces en
// el margen (Órdenes de compra + Gastos). docs/incremento-7-gastos.md §4.3: "la misma factura no puede contar dos veces".
'use strict';
const assert = require('assert');
const S = require('./comun')(process.argv[2] || '.', { ROL_OPERACIONES: '' }); // sin flujo de operaciones: la orden sale directo
const { ok, falla, pry, cotizar, firmar, id, PDF, HOY_ISO, masDias, FOTO } = S;
const HELGEN = 'HSE240304PC1', PROV = 'EKU9003173C9', UUID = '7A1C3A0E-5B2D-4C8A-9E7F-1A2B3C4D5E71';
const cfdi = () => '<?xml version="1.0" encoding="UTF-8"?>\n' +
  `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="G" Folio="77" Fecha="${HOY_ISO}T10:15:00" SubTotal="1000.00" Moneda="MXN" Total="1160.00" TipoDeComprobante="I" MetodoPago="PUE" FormaPago="04" Exportacion="01" LugarExpedicion="76000">
  <cfdi:Emisor Rfc="${PROV}" Nombre="ELECTRICA DEL CENTRO" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${HELGEN}" Nombre="HELGEN" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="G03"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="15101514" Cantidad="1" ClaveUnidad="H87" Descripcion="Cable" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02"/></cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${UUID}" FechaTimbrado="${HOY_ISO}T10:16:00"/></cfdi:Complemento>
</cfdi:Comprobante>`;
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

const pA = pry('Planta');
firmar(pA, cotizar(pA, 10000));
// 1) Compras hace la requisición y la orden del cable
const req = ok('obrero', 'guardarRequisicion', { proyectoFolio: pA, sitio: 'Querétaro', renglones: [{ descripcion: 'Cable', cantidad: 1, unidad: 'pza' }],
  cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: id('r') }).folio;
const oc = ok('pedro', 'autorizarRequisicion', req, { proveedor: { razonSocial: 'Eléctrica del Centro' }, fechaEntrega: masDias(1),
  formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0, ivaTasa: 0.16,
  renglones: [{ descripcion: 'Cable', unidad: 'PZA', cantidad: 1, costo: 1000 }], idSolicitud: id('o') }).ocFolio;
// 2) El trabajador lo paga con su dinero y lo captura como gasto con el CFDI; el super admin lo aprueba (no es suyo)
const g = ok('obrero', 'guardarGasto', { proyectoFolio: pA, fecha: HOY_ISO, categoria: 'Herramientas', concepto: 'Cable', monto: 1, moneda: 'MXN',
  ivaIncluido: 'Sí', ticket: { nombre: 't.jpg', datos: FOTO }, xml: { nombre: 'f.xml', datos: b64(cfdi()) }, idSolicitud: id('gas') }).folio;
ok('leo', 'aprobarGasto', g, null);
// 3) Compras registra como factura de proveedor de la orden EL MISMO CFDI
let r;
try {
  r = ok('pedro', 'registrarFacturaProveedor', { ocFolio: oc, xml: { datos: b64(cfdi()) }, idSolicitud: id('f') });
  console.log('factura de proveedor registrada con el UUID del gasto ' + g + ':', r.folio);
} catch (e) { console.log('rechazada (correcto):', e.message); }
const m = ok('tania', 'getCobranzaProyecto', pA).margen;
console.log('margen pA:', JSON.stringify(m.costos.map(c => [c.concepto, c.monto])), 'total costos', m.totalCostos);
assert(!r, 'DEFECTO: el mismo CFDI (UUID ' + UUID + ') quedó como gasto aprobado Y como factura de proveedor; el margen cuenta 2,000 en lugar de 1,000');
