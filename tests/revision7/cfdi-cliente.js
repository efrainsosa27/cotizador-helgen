// CFDI 4.0 de Helgen a un cliente (I, E o P), versión corta del de tests/facturas-clientes.test.js. Datos inventados.
'use strict';
const HELGEN = 'HSE240304PC1', URE = 'URE180429TM6';
const U = n => ('0000000' + n).slice(-8) + '-AAAA-4BBB-8CCC-' + ('00000000000' + n).slice(-12);
function cfdi(o) {
  const a = Object.assign({ tipo: 'I', serie: 'A', folio: '101', fecha: '2026-10-10T10:00:00', moneda: 'MXN', subtotal: '1000.00', iva: '160.00',
    total: '1160.00', metodo: 'PPD', forma: '99', receptor: URE, nombre: 'UNIVERSIDAD ROBOTICA', uuid: U(1), rel: null, pagos: null }, o || {});
  const P_ = a.tipo === 'P';
  const rel = a.rel ? `<cfdi:CfdiRelacionados TipoRelacion="${a.rel.tipo}">${a.rel.uuids.map(u => `<cfdi:CfdiRelacionado UUID="${u}"/>`).join('')}</cfdi:CfdiRelacionados>` : '';
  const pagos = P_ ? `<pago20:Pagos Version="2.0"><pago20:Totales MontoTotalPagos="0"/>` + a.pagos.map(p => `<pago20:Pago FechaPago="${p.fecha}T12:00:00" FormaDePagoP="03" MonedaP="${p.moneda || 'MXN'}" TipoCambioP="1" Monto="${p.monto}">` +
    p.docs.map(d => `<pago20:DoctoRelacionado IdDocumento="${d.uuid}" Serie="A" Folio="1" MonedaDR="${d.moneda || 'MXN'}" EquivalenciaDR="1" NumParcialidad="${d.parc || 1}" ImpSaldoAnt="${d.ant}" ImpPagado="${d.pagado}" ImpSaldoInsoluto="${d.insoluto}" ObjetoImpDR="01"/>`).join('') +
    `</pago20:Pago>`).join('') + `</pago20:Pagos>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"${P_ ? ' xmlns:pago20="http://www.sat.gob.mx/Pagos20"' : ''} Version="4.0" Serie="${a.serie}" Folio="${a.folio}" Fecha="${a.fecha}" ` +
    (P_ ? 'SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P"' : `SubTotal="${a.subtotal}" Moneda="${a.moneda}" Total="${a.total}" TipoDeComprobante="${a.tipo}" MetodoPago="${a.metodo}" FormaPago="${a.forma}"`) +
    ` Exportacion="01" LugarExpedicion="76000">${rel}
  <cfdi:Emisor Rfc="${HELGEN}" Nombre="HELGEN" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${a.receptor}" Nombre="${a.nombre}" DomicilioFiscalReceptor="86991" RegimenFiscalReceptor="601" UsoCFDI="${P_ ? 'CP01' : 'G03'}"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="81101500" Cantidad="1" ClaveUnidad="E48" Descripcion="Servicio" ValorUnitario="${P_ ? '0' : a.subtotal}" Importe="${P_ ? '0' : a.subtotal}" ObjetoImp="${P_ ? '01' : '02'}"/></cfdi:Conceptos>` +
    (P_ ? '' : `<cfdi:Impuestos TotalImpuestosTrasladados="${a.iva}"><cfdi:Traslados><cfdi:Traslado Base="${a.subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${a.iva}"/></cfdi:Traslados></cfdi:Impuestos>`) +
    `<cfdi:Complemento>${pagos}<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid.toLowerCase()}" FechaTimbrado="${a.fecha}"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
module.exports = { cfdi, U, b64, HELGEN, URE };
