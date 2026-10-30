// Revisión independiente del incremento 7 (entrada de datos y robustez). Utilidades comunes de las pruebas de concepto.
// Carga el arnés (tests/arnes.js) con los roles de las pruebas, Utilities.unzip simulado (zlib, como en facturas-clientes.test.js),
// constructores de CFDI y ZIP, y atajos para proyectos, requisiciones y órdenes.
'use strict';
const zlib = require('zlib'), path = require('path');
const DIR = path.join(__dirname, '..', '..');

const HELGEN = 'HSE240304PC1', URE = 'URE180429TM6', PROV = 'EKU9003173C9';
const NS4 = 'http://www.sat.gob.mx/cfd/4';
const U = n => ('0000000' + n).slice(-8) + '-AAAA-4BBB-8CCC-' + ('00000000000' + n).slice(-12);

function crearArnes(extra) {
  const A = require(path.join(DIR, 'tests/arnes'))(DIR, Object.assign({ props: {
    ROL_COBRANZA: 'tania@helgen.tech, efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
    ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech', ROL_OPERACIONES: 'adri@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech',
    SUPER_ADMIN: 'leo@helgen.tech' } }, extra || {}));
  A.ctx.Utilities.unzip = unzip;
  const getFile = A.ctx.DriveApp.getFileById;
  A.ctx.DriveApp.getFileById = id => Object.assign(getFile(id), { setTrashed: v => { A.archivos[id].trashed = !!v; } });
  return A;
}

/** Atributo XML seguro. */
const x = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * CFDI 4.0 mínimo (datos inventados, sin sellos reales). o: tipo, uuid, emisor, receptor, nombreReceptor, subtotal, iva, total, moneda,
 * metodo, fecha, serie, folio, ish (implocal), extra (XML dentro del Comprobante), pagos [{fecha, monto, moneda, docs: [...]}].
 */
function cfdi(o) {
  const a = Object.assign({ tipo: 'I', uuid: U(1), emisor: HELGEN, nombreEmisor: 'HELGEN SERVICIOS ESPECIALIZADOS', receptor: URE,
    nombreReceptor: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', subtotal: '1000.00', iva: '160.00', total: '1160.00', moneda: 'MXN', metodo: 'PUE',
    fecha: '2026-10-10T10:00:00', serie: 'A', folio: '1', ish: null, extra: '', pagos: null }, o || {});
  const P_ = a.tipo === 'P';
  const pagos = P_ ? '<pago20:Pagos Version="2.0"><pago20:Totales MontoTotalPagos="0"/>' + a.pagos.map(p =>
    `<pago20:Pago FechaPago="${p.fecha}T12:00:00" FormaDePagoP="03" MonedaP="${x(p.moneda || 'MXN')}" TipoCambioP="1" Monto="${p.monto}">` +
    p.docs.map(d => `<pago20:DoctoRelacionado IdDocumento="${d.uuid.toLowerCase()}" Serie="A" Folio="${d.folio || '1'}" MonedaDR="${x(d.moneda || 'MXN')}" ` +
      `EquivalenciaDR="1" NumParcialidad="${d.parc || 1}" ImpSaldoAnt="${d.ant}" ImpPagado="${d.pagado}" ImpSaldoInsoluto="${d.insoluto}" ObjetoImpDR="01"/>`).join('') +
    '</pago20:Pago>').join('') + '</pago20:Pagos>' : '';
  const ish = a.ish ? `<implocal:ImpuestosLocales xmlns:implocal="http://www.sat.gob.mx/implocal" version="1.0" TotaldeRetenciones="0.00" TotaldeTraslados="${a.ish}">` +
    `<implocal:TrasladosLocales ImpLocTrasladado="ISH" TasadeTraslado="3.00" Importe="${a.ish}"/></implocal:ImpuestosLocales>` : '';
  return '﻿<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<cfdi:Comprobante xmlns:cfdi="${NS4}"${P_ ? ' xmlns:pago20="http://www.sat.gob.mx/Pagos20"' : ''} Version="4.0" Serie="${a.serie}" Folio="${a.folio}" Fecha="${a.fecha}" ` +
    (P_ ? 'SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P"' : `SubTotal="${a.subtotal}" Moneda="${a.moneda}" Total="${a.total}" TipoDeComprobante="${a.tipo}" MetodoPago="${a.metodo}" FormaPago="03"`) +
    ` Exportacion="01" LugarExpedicion="76000">` +
    `<cfdi:Emisor Rfc="${a.emisor}" Nombre="${x(a.nombreEmisor)}" RegimenFiscal="601"/>` +
    `<cfdi:Receptor Rfc="${a.receptor}" Nombre="${x(a.nombreReceptor)}" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="${P_ ? 'CP01' : 'G03'}"/>` +
    `<cfdi:Conceptos><cfdi:Concepto ClaveProdServ="90111500" Cantidad="1" ClaveUnidad="E48" Descripcion="Servicio" ValorUnitario="${P_ ? 0 : a.subtotal}" Importe="${P_ ? 0 : a.subtotal}" ObjetoImp="02"/></cfdi:Conceptos>` +
    (P_ ? '' : `<cfdi:Impuestos TotalImpuestosTrasladados="${a.iva}"/>`) +
    `<cfdi:Complemento>${pagos}${ish}<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid.toLowerCase()}" FechaTimbrado="${a.fecha}"/></cfdi:Complemento>` +
    a.extra + '</cfdi:Comprobante>';
}

/** ZIP de verdad (deflate). entradas = [{nombre, datos: Buffer | null (carpeta)}]. (Copia de tests/facturas-clientes.test.js.) */
function crearZip(entradas) {
  const locales = [], centrales = [];
  let offset = 0;
  entradas.forEach(e => {
    const nombre = Buffer.from(e.nombre, 'utf8'), crudo = e.datos || Buffer.alloc(0), carpeta = !e.datos;
    const datos = carpeta ? crudo : zlib.deflateRawSync(crudo, { level: 9 }), metodo = carpeta ? 0 : 8, crc = zlib.crc32(crudo);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(metodo, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(datos.length, 18); h.writeUInt32LE(crudo.length, 22); h.writeUInt16LE(nombre.length, 26);
    locales.push(h, nombre, datos);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(metodo, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(datos.length, 20); c.writeUInt32LE(crudo.length, 24); c.writeUInt16LE(nombre.length, 28);
    c.writeUInt32LE(carpeta ? 0x10 : 0, 38); c.writeUInt32LE(offset, 42);
    centrales.push(c, nombre);
    offset += 30 + nombre.length + datos.length;
  });
  const cd = Buffer.concat(centrales), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat(locales.concat([cd, fin]));
}

/** Utilities.unzip simulado (como el de tests/facturas-clientes.test.js): infla TODO antes de devolver. A.inflado cuenta los bytes. */
let inflado = 0;
function unzip(blob) {
  const buf = Buffer.from(blob.getBytes().map(v => (v + 256) % 256));
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Invalid argument: blob');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const r = [];
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28), lx = buf.readUInt16LE(p + 30),
      lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42), nombre = buf.slice(p + 46, p + 46 + ln).toString('utf8');
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), datos = buf.slice(ini, ini + comp);
    const crudo = metodo === 8 ? zlib.inflateRawSync(datos) : datos;
    inflado += crudo.length;
    // Apps Script devuelve Byte[] (con signo); aquí un Int8Array sobre el mismo buffer para no medir la copia del simulacro
    r.push({ getName: () => nombre, getBytes: () => new Int8Array(crudo.buffer, crudo.byteOffset, crudo.length) });
    p += 46 + ln + lx + lc;
  }
  return r;
}

const b64 = s => Buffer.from(s).toString('base64');
let nId = 0;
const id = p => (p || 'x') + (++nId) + '-' + Date.now();

/** Proyecto con cotización aceptada (y firmada) por cobranza. */
function proyectoConContrato(A, nombre, precio, opciones) {
  const o = Object.assign({ moneda: 'MXN', firmar: true, cliente: { nombre: 'Cliente ' + nombre, empresa: 'SA', rfc: URE } }, opciones || {});
  const folio = A.ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: o.cliente, idSolicitud: id('p') }).folio;
  const cot = A.ok('ana', 'guardarCotizacion', { cliente: o.cliente, items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: folio,
    moneda: o.moneda, idSolicitud: id('c') }).folio;
  A.ok('efrain', 'marcarAceptada', folio, cot, true);
  if (o.firmar) A.ok('efrain', 'firmarContrato', folio, A.HOY_ISO);
  return folio;
}

/** Requisición → orden de compra autorizada (Compras = pedro). Devuelve el folio de la OC. */
function ordenDeCompra(A, proyectoFolio, costo) {
  const req = A.ok('obrero', 'guardarRequisicion', { proyectoFolio, renglones: [{ descripcion: 'Material', cantidad: 1, unidad: 'pza' }],
    cotizacion: { nombre: 'cot.pdf', datos: A.PDF }, idSolicitud: id('rq') }).folio;
  return A.ok('pedro', 'autorizarRequisicion', req, { proveedor: { razonSocial: 'Gasolinera del Bajío', rfc: PROV }, fechaEntrega: A.HOY_ISO,
    formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: '0', renglones: [{ descripcion: 'Material', unidad: 'pza', cantidad: 1, costo }],
    proyectoFolio, idSolicitud: id('oc') }).ocFolio;
}

module.exports = { DIR, HELGEN, URE, PROV, U, crearArnes, cfdi, crearZip, unzip, inflado: () => inflado, b64, id, proyectoConContrato, ordenDeCompra };
