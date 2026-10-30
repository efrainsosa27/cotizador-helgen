// Incremento 7 · módulo C (facturas de clientes, CFDI fase A): Helgen timbra en CONTALINK y CAPRI importa sus XML. Contrato:
// docs/incremento-7.md (C); detalle: docs/incremento-7-facturas.md.
//  1. Lógica pura: leerCfdiCliente (I PUE, I PPD, E relacionada 01, P con 2 pagos sobre 2 facturas; DTD, 3.3, Pagos 1.0, textos para
//     clientes), leerCfdi sin cambios, validarFacturaCliente (emisor = Helgen, tipos, moneda), tipo de archivo, lote (PDF por nombre y por
//     UUID, repetidas, orden, límite), calcularFacturasClientes (E proporcional, cobrado de la más vieja a la más nueva, REP, REP
//     pendiente, REP sin cobro, sustitución 04, E ligada a mano), facturasPorEtapa (forma exacta del contrato), armarLigaFactura,
//     sugerencias, claveEtapa (adicionales) y los pendientes de cobranza.
//  2. Servidor por doPost: ZIP como el de CONTALINK (XML + PDF en carpetas, basura de macOS, ZIP dentro de ZIP, otro archivo) junto con
//     XML y PDF sueltos; un XML de proveedor y un CFDI 3.3 rechazados sin detener a los demás; UUID repetido (otro envío, el mismo envío
//     y dos veces en el mismo); PDF que llega después; archivos privados en Cobranza/AAAA/Sin proyecto/Facturas y movidos al ligar;
//     sugerencias; ligar (reparto, montos, errores), cambiar liga, sin proyecto; REP pendiente con pagos de cobranza; vista del
//     proyecto; Pendientes; cancelar; carrera de dos envíos; tiempo; límites; permisos y fugas (cada función, bootstrap y sincronizar);
//     ninguna llamada HTTP dentro del candado (perfil).
//  3. Interfaz (mod-facturas + mod-pantallas sobre la app, conectada al servidor simulado): subir un ZIP, ver resultados, ligar con la
//     sugerencia, facturas por etapa en la vista del proyecto, Pendientes → la factura; otros roles sin nada.
// Datos inventados: RFC de Helgen el de Config; clientes con RFC de pruebas del SAT; ningún CFDI real va en el repositorio.
// Uso: node tests/facturas-clientes.test.js .
'use strict';
const assert = require('assert'), zlib = require('zlib'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const crear = op => require('./arnes')(dir, Object.assign({ props: {
  ROL_COBRANZA: 'tania@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: '' } }, op || {}));
const A = crear();
const { P, ok, falla, plain, props, libros, HOY_ISO, correr, ANIO, PDF } = A;

// ================= Fixtures: CFDI 4.0 como los de CONTALINK =================
const HELGEN = 'HSE240304PC1', URE = 'URE180429TM6', XIA = 'XIA190128J61', PROV = 'EKU9003173C9';
const NS4 = 'http://www.sat.gob.mx/cfd/4', NS3 = 'http://www.sat.gob.mx/cfd/3';
const U = n => ('0000000' + n).slice(-8) + '-AAAA-4BBB-8CCC-' + ('00000000000' + n).slice(-12); // UUID de prueba
const UU = { I1: U(101), I2: U(102), E1: U(501), P1: U(901), I3: U(103), I4: U(104), I5: U(105), P2: U(902), PROV: U(777), V33: U(333), I6: U(106) };

/** CFDI de Helgen a un cliente. o: tipo I/E/P, serie, folio, fecha, moneda, subtotal, iva, total, metodo, forma, receptor, nombre,
 *  uuid, rel: {tipo, uuids}, pagos: [{fecha, monto, moneda, docs: [{uuid, serie, folio, parc, ant, pagado, insoluto, moneda}]}],
 *  emisor, ns, version, pagosVersion. */
function cfdi(o) {
  const a = Object.assign({ ns: NS4, version: '4.0', tipo: 'I', serie: 'A', folio: '101', fecha: '2026-10-10T10:00:00', moneda: 'MXN',
    subtotal: '6000.00', iva: '960.00', total: '6960.00', metodo: 'PUE', forma: '03', emisor: HELGEN, nombreEmisor: 'HELGEN SERVICIOS ESPECIALIZADOS',
    receptor: URE, nombre: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', uso: 'G03', uuid: UU.I1, rel: null, pagos: null, pagosVersion: '2.0' }, o || {});
  const P_ = a.tipo === 'P';
  const rel = a.rel ? `\n  <cfdi:CfdiRelacionados TipoRelacion="${a.rel.tipo}">${a.rel.uuids.map(u => `<cfdi:CfdiRelacionado UUID="${u.toLowerCase()}"/>`).join('')}</cfdi:CfdiRelacionados>` : '';
  const pagos = P_ ? `<pago20:Pagos Version="${a.pagosVersion}"><pago20:Totales MontoTotalPagos="${(a.pagos || []).reduce((s, p) => s + Number(p.monto), 0).toFixed(2)}"/>` +
    (a.pagos || []).map(p => `<pago20:Pago FechaPago="${p.fecha}T12:00:00" FormaDePagoP="03" MonedaP="${p.moneda || 'MXN'}" TipoCambioP="1" Monto="${p.monto}">` +
      p.docs.map(d => `<pago20:DoctoRelacionado IdDocumento="${d.uuid.toLowerCase()}" Serie="${d.serie || 'A'}" Folio="${d.folio || '1'}" MonedaDR="${d.moneda || 'MXN'}" EquivalenciaDR="1" ` +
        `NumParcialidad="${d.parc}" ImpSaldoAnt="${d.ant}" ImpPagado="${d.pagado}" ImpSaldoInsoluto="${d.insoluto}" ObjetoImpDR="02">` +
        `<pago20:ImpuestosDR><pago20:TrasladosDR><pago20:TrasladoDR BaseDR="1.00" ImpuestoDR="002" TipoFactorDR="Tasa" TasaOCuotaDR="0.160000" ImporteDR="0.16"/></pago20:TrasladosDR></pago20:ImpuestosDR>` +
        `</pago20:DoctoRelacionado>`).join('') + `</pago20:Pago>`).join('') + `</pago20:Pagos>` : '';
  return '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<cfdi:Comprobante xmlns:cfdi="${a.ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"${P_ ? ' xmlns:pago20="http://www.sat.gob.mx/Pagos20"' : ''} ` +
    `Version="${a.version}" Serie="${a.serie}" Folio="${a.folio}" Fecha="${a.fecha}" ` +
    (P_ ? 'SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P"' : `SubTotal="${a.subtotal}" Moneda="${a.moneda}" Total="${a.total}" TipoDeComprobante="${a.tipo}" ` +
      `MetodoPago="${a.metodo}" FormaPago="${a.forma}"`) + ` Exportacion="01" LugarExpedicion="76000" NoCertificado="30001000000500003416">${rel}
  <!-- <cfdi:Emisor Rfc="AAA010101AAA" Nombre="FALSO"/> -->
  <cfdi:Emisor Rfc="${a.emisor}" Nombre="${a.nombreEmisor}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${a.receptor}" Nombre="${a.nombre}" DomicilioFiscalReceptor="86991" RegimenFiscalReceptor="601" UsoCFDI="${P_ ? 'CP01' : a.uso}"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="${P_ ? '84111506' : '81101500'}" Cantidad="1" ClaveUnidad="${P_ ? 'ACT' : 'E48'}" Descripcion="${P_ ? 'Pago' : 'Servicio de ingeniería &amp; puesta en marcha'}" ` +
    `ValorUnitario="${P_ ? '0' : a.subtotal}" Importe="${P_ ? '0' : a.subtotal}" ObjetoImp="${P_ ? '01' : '02'}"/></cfdi:Conceptos>` +
    (P_ ? '' : `\n  <cfdi:Impuestos TotalImpuestosTrasladados="${a.iva}"><cfdi:Traslados><cfdi:Traslado Base="${a.subtotal}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${a.iva}"/></cfdi:Traslados></cfdi:Impuestos>`) + `
  <cfdi:Complemento>${pagos}<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid.toLowerCase()}" FechaTimbrado="${a.fecha}" RfcProvCertif="SAT970701NN3" SelloCFD="abc" NoCertificadoSAT="00001000000505142236" SelloSAT="def"/></cfdi:Complemento>
</cfdi:Comprobante>`;
}
const X = {
  I1: cfdi({ uuid: UU.I1 }),                                                                          // Anticipo de P1: 6960 PUE
  I2: cfdi({ uuid: UU.I2, folio: '102', fecha: '2026-10-12T10:00:00', metodo: 'PPD', forma: '99', subtotal: '4000.00', iva: '640.00', total: '4640.00' }),
  E1: cfdi({ uuid: UU.E1, tipo: 'E', serie: 'NC', folio: '5', fecha: '2026-10-13T09:00:00', forma: '15', subtotal: '1000.00', iva: '160.00', total: '1160.00',
    rel: { tipo: '01', uuids: [UU.I2] } }),
  I3: cfdi({ uuid: UU.I3, serie: 'B', folio: '7', fecha: '2026-10-11T08:00:00', metodo: 'PPD', forma: '99', subtotal: '3000.00', iva: '480.00', total: '3480.00' }),
  P1: cfdi({ uuid: UU.P1, tipo: 'P', serie: 'P', folio: '12', fecha: '2026-10-23T08:00:00', pagos: [
    { fecha: '2026-10-15', monto: '3000.00', docs: [{ uuid: UU.I2, folio: '102', parc: 1, ant: '3480.00', pagado: '1500.00', insoluto: '1980.00' },
      { uuid: UU.I3, serie: 'B', folio: '7', parc: 1, ant: '3480.00', pagado: '1500.00', insoluto: '1980.00' }] },
    { fecha: '2026-10-22', monto: '2000.00', docs: [{ uuid: UU.I2, folio: '102', parc: 2, ant: '1980.00', pagado: '1000.00', insoluto: '980.00' },
      { uuid: UU.I3, serie: 'B', folio: '7', parc: 2, ant: '1980.00', pagado: '1000.00', insoluto: '980.00' }] }] }),
  I4: cfdi({ uuid: UU.I4, serie: 'C', folio: '1', moneda: 'USD', subtotal: '1000.00', iva: '160.00', total: '1160.00', receptor: XIA, nombre: 'XENON INDUSTRIAL ARTICLES' }),
  I5: cfdi({ uuid: UU.I5, serie: 'A', folio: '110', subtotal: '100.00', iva: '16.00', total: '116.00', receptor: 'XAXX010101000', nombre: 'PUBLICO EN GENERAL', uso: 'S01' }),
  PROV: cfdi({ uuid: UU.PROV, emisor: PROV, nombreEmisor: 'ESCUELA KEMPER URGATE', receptor: HELGEN, nombre: 'HELGEN SERVICIOS ESPECIALIZADOS' }),
  V33: cfdi({ uuid: UU.V33, ns: NS3, version: '3.3' }),
  P2: cfdi({ uuid: UU.P2, tipo: 'P', serie: 'P', folio: '13', fecha: '2026-10-28T08:00:00', pagos: [
    { fecha: '2026-10-27', monto: '980.00', docs: [{ uuid: UU.I2, folio: '102', parc: 3, ant: '980.00', pagado: '980.00', insoluto: '0.00' }] }] }),
};
const PDF_BUF = Buffer.from('%PDF-1.7 representación impresa CONTALINK');
const b64 = s => Buffer.from(s).toString('base64');

/** ZIP de verdad (deflate, con carpetas) como el que descarga CONTALINK. entradas = [{nombre, datos: Buffer | null (carpeta)}]. */
function crearZip(entradas) {
  const locales = [], centrales = [];
  let offset = 0;
  entradas.forEach(e => {
    const nombre = Buffer.from(e.nombre, 'utf8'), crudo = e.datos || Buffer.alloc(0), carpeta = !e.datos;
    const datos = carpeta ? crudo : zlib.deflateRawSync(crudo), metodo = carpeta ? 0 : 8, crc = zlib.crc32(crudo);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(metodo, 8);
    h.writeUInt16LE(0x6000, 10); h.writeUInt16LE(0x5B5A, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(datos.length, 18);
    h.writeUInt32LE(crudo.length, 22); h.writeUInt16LE(nombre.length, 26); h.writeUInt16LE(0, 28);
    locales.push(h, nombre, datos);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(metodo, 10);
    c.writeUInt16LE(0x6000, 12); c.writeUInt16LE(0x5B5A, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(datos.length, 20);
    c.writeUInt32LE(crudo.length, 24); c.writeUInt16LE(nombre.length, 28); c.writeUInt32LE(carpeta ? 0x10 : 0, 38); c.writeUInt32LE(offset, 42);
    centrales.push(c, nombre);
    offset += 30 + nombre.length + datos.length;
  });
  const cd = Buffer.concat(centrales), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat(locales.concat([cd, fin]));
}
/** Utilities.unzip simulado: lee el directorio central del ZIP de verdad (como Apps Script: también trae las carpetas, con "/"). */
function unzip(blob) {
  const buf = Buffer.from(blob.getBytes().map(x => (x + 256) % 256));
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
    r.push({ getName: () => nombre, getBytes: () => [...crudo].map(x => x > 127 ? x - 256 : x) });
    p += 46 + ln + lx + lc;
  }
  return r;
}
A.ctx.Utilities.unzip = unzip;
// La Papelera de Drive (setTrashed) para los archivos que sobran
const getFile = A.ctx.DriveApp.getFileById;
A.ctx.DriveApp.getFileById = id => Object.assign(getFile(id), { setTrashed: v => { A.archivos[id].trashed = !!v; } });
const carpetaDe = folio => 'Cotizador Helgen — Cobranza/' + folio.split('-')[1] + '/' + folio + '/Facturas';
const rutaDe = id => { const partes = []; for (let f = A.archivos[id].padre; f; f = f.padre) partes.unshift(f.nombre); return partes.slice(1).join('/'); };
const firmados = s => [...Buffer.from(s)].map(x => x > 127 ? x - 256 : x);

// ================= 1. Lógica pura =================
{
  // ---- leerCfdiCliente ----
  const i1 = plain(P.leerCfdiCliente(X.I1));
  assert.deepEqual([i1.tipoComprobante, i1.uuid, i1.serieFolio, i1.fecha, i1.metodoPago, i1.moneda, i1.total, i1.trasladados, i1.emisor.rfc, i1.receptor.rfc],
    ['I', UU.I1, 'A-101', '2026-10-10', 'PUE', 'MXN', 6960, 960, HELGEN, URE]);
  assert.deepEqual([i1.relacionados, i1.pagos], [[], []]);
  // leerCfdi no cambia (lo usan las facturas de proveedor y G): mismas llaves, sin relacionados ni pagos
  const base = plain(P.leerCfdi(X.I1));
  assert.deepEqual(Object.keys(base).sort(), ['descuento', 'emisor', 'fecha', 'fechaTimbrado', 'folio', 'formaPago', 'metodoPago', 'moneda', 'receptor',
    'retenidos', 'serie', 'serieFolio', 'subtotal', 'tipo', 'tipoComprobante', 'total', 'trasladados', 'usoCfdi', 'uuid', 'version']);
  Object.keys(base).forEach(k => assert.deepEqual(i1[k], base[k], 'leerCfdiCliente = leerCfdi + lo suyo: ' + k));
  assert.equal(P.leerCfdiCliente(X.I2).metodoPago, 'PPD');
  const e1 = plain(P.leerCfdiCliente(X.E1));
  assert.deepEqual([e1.tipoComprobante, e1.total, e1.relacionados], ['E', 1160, [{ uuid: UU.I2, tipoRelacion: '01' }]], 'nota de crédito relacionada 01');
  const p1 = plain(P.leerCfdiCliente(X.P1));
  assert.deepEqual([p1.tipoComprobante, p1.moneda, p1.total, p1.metodoPago], ['P', 'XXX', 0, '']);
  assert.deepEqual(p1.pagos.map(p => [p.fecha, p.monto, p.moneda, p.forma, p.documentos.length]), [['2026-10-15', 3000, 'MXN', '03', 2], ['2026-10-22', 2000, 'MXN', '03', 2]]);
  assert.deepEqual(p1.pagos[1].documentos[0], { uuid: UU.I2, serieFolio: 'A-102', parcialidad: 2, saldoAnterior: 1980, pagado: 1000, saldoInsoluto: 980, moneda: 'MXN' });
  // Varias relaciones y sustitución (04)
  const sus = plain(P.leerCfdiCliente(cfdi({ uuid: UU.I6, rel: { tipo: '04', uuids: [UU.I1, UU.I1] } })));
  assert.deepEqual(sus.relacionados, [{ uuid: UU.I1, tipoRelacion: '04' }], 'una relación repetida se cuenta una vez');
  // Seguridad y textos para clientes (nunca "al proveedor")
  const fallaCli = (xml, re) => assert.throws(() => P.leerCfdiCliente(xml), e => re.test(e.message) && !/proveedor/i.test(e.message), String(re));
  fallaCli('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>' + X.I1.slice(1), /no permitidas/);
  fallaCli(X.V33, /CFDI 3\.3.*pide a quien factura en CONTALINK el XML en versión 4\.0/);
  fallaCli(cfdi({ total: '99999.00' }), /no cuadra.*Pide a quien factura en CONTALINK el XML correcto/);
  fallaCli(X.I1.replace(/<tfd:TimbreFiscalDigital[^>]*\/>/, ''), /no está timbrado.*CONTALINK/);
  fallaCli(cfdi({ tipo: 'P', uuid: UU.P1, pagos: [{ fecha: '2026-10-15', monto: '1.00', docs: [] }], pagosVersion: '1.0' }), /versión 1\.0: con CFDI 4\.0 debe ser Pagos 2\.0/);
  fallaCli(X.P1.replace(/<pago20:Pagos[\s\S]*<\/pago20:Pagos>/, ''), /no trae el complemento Pagos/);
  fallaCli(X.P1.replace('ImpPagado="1500.00"', 'ImpPagado="-5"'), /importe pagado no válido/);
  assert.equal(P.textoErrorCfdiCliente('Es un CFDI 3.3, que ya no es vigente: pide al proveedor la versión 4.0.'),
    'Es un CFDI 3.3, que ya no es vigente: pide a quien factura en CONTALINK el XML en versión 4.0.');

  // ---- validarFacturaCliente: de Helgen, 4.0, I/E/P, MXN o USD ----
  const val = (xml, re) => assert.throws(() => P.validarFacturaCliente(P.leerCfdiCliente(xml), { rfcHelgen: HELGEN }), re);
  assert.equal(P.validarFacturaCliente(P.leerCfdiCliente(X.P1), { rfcHelgen: HELGEN }), true);
  val(X.PROV, /lo emitió ESCUELA KEMPER URGATE \(EKU9003173C9\), no Helgen \(HSE240304PC1\): parece la factura de un proveedor/);
  val(cfdi({ tipo: 'T' }), /traslado \(tipo T\)/);
  val(cfdi({ tipo: 'N' }), /nómina \(tipo N\)/);
  val(cfdi({ moneda: 'EUR' }), /es en EUR: CAPRI solo maneja MXN y USD/);
  val(cfdi({ metodo: '=HYPERLINK(1)' }), /PUE o PPD/);
  val(cfdi({ version: '4.1' }), /versión 4\.0/);
  assert.throws(() => P.validarFacturaCliente(P.leerCfdiCliente(X.I1), { rfcHelgen: '' }), /EMPRESA_RFC/);

  // ---- Tipo de archivo y nombre base ----
  assert.deepEqual(['zip', 'xml', 'pdf', ''], [crearZip([{ nombre: 'a.xml', datos: Buffer.from('<a/>') }]), Buffer.from(X.I1), PDF_BUF, Buffer.from('hola')]
    .map(b => P.tipoArchivoFactura(firmados(b))));
  assert.equal(P.nombreBaseArchivo('Facturas/2026-10/A-101.XML'), 'a-101');
  assert.equal(P.nombreBaseArchivo('C:\\x\\' + UU.I2 + '.pdf'), UU.I2.toLowerCase());
  assert.equal(P.nombreArchivoFacturaCliente({ tipoComprobante: 'E', serieFolio: 'NC/5', uuid: UU.E1, receptor: { nombre: 'A: "B"' } }, 'xml'),
    'Nota de crédito NC 5 — A B — 00000501.xml');

  // ---- Lote: emparejar PDF, repetidas, orden I → E → P ----
  const ent = (nombre, s, tipo) => ({ nombre: nombre, base: P.nombreBaseArchivo(nombre), tipo: tipo, bytes: firmados(s) });
  const lote = plain(P.prepararLoteFacturasCliente([ent('P-12.xml', X.P1, 'xml'), ent('NC-5.xml', X.E1, 'xml'), ent('A-101.xml', X.I1, 'xml'),
    ent('A-101.pdf', PDF_BUF, 'pdf'), ent('otra/A-101.xml', X.I1, 'xml'), ent('CFDI_' + UU.I2 + '.pdf', PDF_BUF, 'pdf'), ent('A-102.xml', X.I2, 'xml'),
    ent('suelto.pdf', PDF_BUF, 'pdf'), ent('ya.xml', X.I3, 'xml'), ent('B-7.pdf', PDF_BUF, 'pdf'), ent('prov.xml', X.PROV, 'xml'), ent('A-101 (2).pdf', Buffer.from('no pdf'), 'pdf')],
    { rfcHelgen: HELGEN, existentes: { [UU.I3]: { uuid: UU.I3, serieFolio: 'B-7', pdfId: '', archivoXml: 'B-7.xml', estado: 'Vigente' } }, idSolicitud: 'x' }));
  assert.deepEqual(lote.nuevas.map(x => x.f.tipoComprobante + ' ' + x.f.serieFolio + (x.pdf ? ' +pdf' : '')), ['I A-101 +pdf', 'I A-102 +pdf', 'E NC-5', 'P P-12'],
    'facturas primero; PDF por nombre y por UUID');
  const est = n => lote.resultados.find(r => r.archivo === n);
  assert.deepEqual(['otra/A-101.xml', 'ya.xml', 'suelto.pdf', 'B-7.pdf', 'prov.xml', 'A-101 (2).pdf'].map(n => est(n).estado),
    ['repetida', 'repetida', 'rechazada', 'pdf', 'rechazada', 'rechazada']);
  assert(/dos veces en este envío/.test(est('otra/A-101.xml').mensaje) && /Ya estaba importada \(B-7\) y está sin ligar/.test(est('ya.xml').mensaje));
  assert(/PDF sin su XML/.test(est('suelto.pdf').mensaje) && /debe ser PDF/.test(est('A-101 (2).pdf').mensaje));
  assert.deepEqual(lote.adjuntar.map(x => x.uuid), [UU.I3], 'el PDF de una ya importada sin PDF (por el nombre de su XML)');
  assert.equal(lote.resultados.length, 12, 'un resultado por archivo');
  // El mismo envío otra vez (reintento): "importada", no "repetida"
  const otraVez = plain(P.prepararLoteFacturasCliente([ent('A-101.xml', X.I1, 'xml')], { rfcHelgen: HELGEN, idSolicitud: 'x',
    existentes: { [UU.I1]: { uuid: UU.I1, idSolicitud: 'x', estado: 'Vigente' } } }));
  assert.deepEqual([otraVez.resultados[0].estado, otraVez.nuevas.length], ['importada', 0]);
  // Más de MAX_XML_LOTE nuevas en un envío: las demás quedan pendientes
  const muchas = Array.from({ length: 102 }, (_, i) => ent('f' + i + '.xml', cfdi({ uuid: U(2000 + i), folio: String(2000 + i), subtotal: '1.00', iva: '0.16', total: '1.16' }), 'xml'));
  const lm = plain(P.prepararLoteFacturasCliente(muchas, { rfcHelgen: HELGEN, existentes: {} }));
  assert.deepEqual([lm.nuevas.filter(x => !x.omitida).length, lm.resultados.filter(r => r.estado === 'pendiente').length], [100, 2]);

  // ---- Claves de etapa (contrato y adicionales del módulo A) ----
  assert.deepEqual([P.claveEtapa({}, 0), P.claveEtapa({ orden: 3 }, 0), P.claveEtapa({ adicional: 'hlg-2026-0012', orden: 2 }, 5)], ['1', '3', 'HLG-2026-0012/2']);
  assert.deepEqual(plain(P.etapasParaFacturas({ etapas: [{ etapa: 'Anticipo', monto: 600, pagado: 100 }, { etapa: 'Extra', monto: 50, pagado: 0, adicional: 'HLG-2026-0012', orden: 1 }] })),
    [{ clave: '1', etapa: 'Anticipo', monto: 600, cobrado: 100, adicional: '' }, { clave: 'HLG-2026-0012/1', etapa: 'Extra', monto: 50, cobrado: 0, adicional: 'HLG-2026-0012' }]);

  // ---- calcularFacturasClientes ----
  const F = (uuid, tipo, extra) => Object.assign({ uuid, tipo, serieFolio: uuid.slice(0, 4), fecha: '2026-10-10', metodo: 'PUE', moneda: 'MXN', total: 0,
    proyectoFolio: '', etapas: [], relacionadas: [], pagos: [], estado: 'Vigente', sinProyecto: '' }, extra || {});
  const COB = { 'PRY-1': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 6960, cobrado: 6960 }, { clave: '2', etapa: 'Instalación', monto: 3480, cobrado: 3000 },
    { clave: '3', etapa: 'Encendido', monto: 1160, cobrado: 870 }] }, 'PRY-2': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 3480, cobrado: 0 }] } };
  const fs1 = [
    F(UU.I1, 'I', { total: 6960, proyectoFolio: 'PRY-1', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 6960 }] }),
    F(UU.I2, 'I', { total: 4640, metodo: 'PPD', fecha: '2026-10-12', proyectoFolio: 'PRY-1', etapas: [{ clave: '2', etapa: 'Instalación', monto: 3480 }, { clave: '3', etapa: 'Encendido', monto: 1160 }] }),
    F(UU.E1, 'E', { total: 1160, relacionadas: [{ uuid: UU.I2, tipoRelacion: '01' }] }),
    F(UU.I3, 'I', { total: 3480, metodo: 'PPD', proyectoFolio: 'PRY-2', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 3480 }] }),
    F(UU.P1, 'P', { pagos: p1.pagos }),
    F(UU.I4, 'I', { total: 100, proyectoFolio: 'PRY-1', etapas: [{ clave: '9', etapa: 'X', monto: 100 }] }),         // etapa que ya no existe
    F(UU.I5, 'I', { total: 50, estado: 'Cancelada', proyectoFolio: 'PRY-1', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 50 }] }),
  ];
  const c1 = plain(P.calcularFacturasClientes(fs1, COB));
  const i2 = c1.facturas[UU.I2];
  assert.deepEqual([i2.netoCts, i2.partes.map(p => p.cts), i2.notas.map(n => n.monto)], [348000, [261000, 87000], [1160]], 'la E resta en proporción');
  assert.deepEqual(c1.facturas[UU.E1].aplicadaA, [{ uuid: UU.I2, serieFolio: UU.I2.slice(0, 4), monto: 1160 }]);
  assert.equal(c1.facturas[UU.E1].proyectoArchivos, 'PRY-1', 'la E va donde su factura');
  assert.deepEqual([i2.cobradoCts, i2.repCts, i2.porCubrirRepCts, i2.repPendiente], [348000, 250000, 98000, true], 'REP pendiente: cobrado 3480, con REP 2500');
  assert.deepEqual(i2.reps.map(r => [r.fecha, r.parcialidad, r.pagado]), [['2026-10-15', 1, 1500], ['2026-10-22', 2, 1000]]);
  assert.equal(i2.saldoSegunRep, 980);
  const i3 = c1.facturas[UU.I3];
  assert.deepEqual([i3.cobradoCts, i3.repCts, i3.repPendiente, i3.repSinCobro], [0, 250000, false, true], 'REP sin cobro registrado');
  assert.equal(c1.facturas[UU.I1].repPendiente, false, 'PUE no pide REP');
  assert.equal(c1.facturas[UU.P1].proyectoArchivos, '', 'un REP de dos proyectos se queda donde está');
  assert(/etapa de la liga ya no existe/.test(c1.facturas[UU.I4].revisar));
  assert.deepEqual([c1.proyectos['PRY-1']['2'].facturado, c1.proyectos['PRY-1']['2'].porFacturar, c1.proyectos['PRY-1']['3'].facturado, c1.proyectos['PRY-1']['1'].facturado],
    [2610, 870, 870, 6960], 'la cancelada no cuenta');
  // Cobrado de la más vieja a la más nueva, hasta lo facturado de cada una
  const dos = plain(P.calcularFacturasClientes([F('A', 'I', { total: 500, fecha: '2026-10-02', metodo: 'PPD', proyectoFolio: 'PRY-2', etapas: [{ clave: '1', monto: 500 }] }),
    F('B', 'I', { total: 500, fecha: '2026-10-01', metodo: 'PPD', proyectoFolio: 'PRY-2', etapas: [{ clave: '1', monto: 500 }] })],
    { 'PRY-2': { moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 3480, cobrado: 700 }] } }));
  assert.deepEqual([dos.facturas.B.cobradoCts, dos.facturas.A.cobradoCts], [50000, 20000]);
  // Moneda distinta del proyecto, proyecto sin aceptada, sustitución, E ligada a mano, E mayor que su factura
  const c2 = plain(P.calcularFacturasClientes([F('U', 'I', { moneda: 'USD', total: 10, proyectoFolio: 'PRY-1', etapas: [{ clave: '1', monto: 10 }] }),
    F('S', 'I', { total: 10, proyectoFolio: 'PRY-9', etapas: [{ clave: '1', monto: 10 }] }),
    F('N', 'I', { total: 10, relacionadas: [{ uuid: 'U', tipoRelacion: '04' }] }),
    F('M', 'E', { total: 100, proyectoFolio: 'PRY-2', etapas: [{ clave: '1', etapa: 'Anticipo', monto: 100 }] }),
    F('G', 'E', { moneda: 'USD', total: 25, relacionadas: [{ uuid: 'U', tipoRelacion: '01' }] })], COB));
  assert(/es en USD y el proyecto en MXN/.test(c2.facturas.U.revisar) || /La sustituye/.test(c2.facturas.U.revisar));
  assert(/ya no tiene cotización aceptada/.test(c2.facturas.S.revisar));
  assert.deepEqual([c2.facturas.U.sustituidaPor, c2.facturas.N.sustituye], ['N', ['U']]);
  assert.deepEqual([c2.facturas.M.manual, c2.proyectos['PRY-2']['1'].facturado], [true, -100], 'E ligada a mano resta de su etapa');
  assert(/mayor que lo que queda de sus facturas \(sobran \$15\.00 USD\)/.test(c2.facturas.G.revisar));

  // ---- facturasPorEtapa: forma exacta del contrato (§1) ----
  const fe = plain(P.facturasPorEtapa(fs1, COB));
  assert.deepEqual(Object.keys(fe).sort(), ['PRY-1', 'PRY-2']);
  assert.deepEqual(Object.keys(fe['PRY-1']).sort(), ['1', '2', '3', '9']);
  assert.deepEqual(fe['PRY-1']['2'], [{ uuid: UU.I2, serieFolio: UU.I2.slice(0, 4), fecha: '2026-10-12', metodo: 'PPD', total: 2610, moneda: 'MXN', repPendiente: true }]);
  assert.deepEqual(Object.keys(fe['PRY-1']['1'][0]), ['uuid', 'serieFolio', 'fecha', 'metodo', 'total', 'moneda', 'repPendiente']);
  assert.equal(plain(P.facturasPorEtapa(fs1))['PRY-1']['2'][0].repPendiente, false, 'sin cobranza: lo que traiga la factura');
  assert.equal(plain(P.facturasPorEtapa(fs1.map(f => Object.assign({}, f, { repPendiente: f.uuid === UU.I2 }))))['PRY-1']['2'][0].repPendiente, true);
  assert.deepEqual(plain(P.facturasPorEtapa([])), {});

  // ---- armarLigaFactura ----
  const etapasP1 = c1.proyectos['PRY-1'];
  const liga = (f, elegidas, extra) => plain(P.armarLigaFactura(Object.assign({ factura: f, neto: f.total, proyecto: { folio: 'PRY-1', estado: 'Activo' },
    cobranza: COB['PRY-1'], etapas: etapasP1, elegidas: elegidas }, extra || {})));
  const nueva = F('Z', 'I', { total: 1100 });
  assert.deepEqual(liga(nueva, [{ clave: '3', monto: null }, { clave: '2', monto: null }]).partes,
    [{ clave: '2', etapa: 'Instalación', monto: 870 }, { clave: '3', etapa: 'Encendido', monto: 230 }], 'en el orden del esquema; la última con el resto');
  assert.deepEqual(liga(nueva, [{ clave: '2', monto: 820 }, { clave: '3', monto: 280 }]).partes.map(p => p.monto), [820, 280]);
  assert.throws(() => liga(nueva, [{ clave: '2', monto: 600 }, { clave: '3', monto: 500 }]), /La etapa Encendido solo tiene \$290\.00 MXN por facturar/);
  assert.deepEqual(liga(nueva, [{ clave: '2', monto: 600 }, { clave: '3', monto: 500 }], { neto: 550 }).partes.map(p => p.monto), [600, 500],
    'con una nota de crédito se compara la parte neta');
  assert.throws(() => liga(nueva, [{ clave: '2', monto: 600 }, { clave: '3', monto: 400 }]), /suman \$1,000\.00 MXN y la factura es por \$1,100\.00 MXN/);
  assert.throws(() => liga(nueva, [{ clave: '2', monto: 600 }, { clave: '3', monto: null }]), /de todas las etapas elegidas o de ninguna/);
  assert.throws(() => liga(nueva, [{ clave: '2', monto: null }]), /mayor que lo que falta facturar de la etapa elegida \(\$870\.00 MXN\)/);
  assert.equal(liga(F('Z', 'I', { total: 871 }), [{ clave: '2', monto: null }]).partes[0].monto, 871, 'tolerancia de 1.00');
  assert.throws(() => liga(nueva, [{ clave: '7', monto: null }]), /La etapa 7 no existe/);
  assert.throws(() => liga(F('Z', 'I', { total: 10, moneda: 'USD' }), [{ clave: '2', monto: null }]), /es en USD y el proyecto PRY-1 en MXN/);
  assert.throws(() => liga(nueva, [{ clave: '2' }], { cobranza: undefined }), /no tiene cotización aceptada/);
  assert.throws(() => liga(nueva, [{ clave: '2' }], { proyecto: { folio: 'PRY-1', folioVisible: 'PRY-1-ABC', estado: 'Cancelado' } }), /PRY-1-ABC está cancelado/);
  // Nota de crédito ligada a mano (su factura no está en CAPRI): cabe en lo ya facturado, no en lo que falta
  assert.deepEqual(liga(F('NE', 'E', { total: 1000 }), [{ clave: '2', monto: null }]).partes, [{ clave: '2', etapa: 'Instalación', monto: 1000 }]);
  assert.throws(() => liga(F('NE', 'E', { total: 1000 }), [{ clave: '3', monto: null }]),
    /La nota de crédito \(\$1,000\.00 MXN\) es mayor que lo facturado de la etapa elegida \(\$870\.00 MXN\): elige las etapas que corrige/);
  assert.throws(() => P.normalizarEtapasElegidas([]), /al menos una etapa/);
  assert.throws(() => P.normalizarEtapasElegidas([{ clave: '1' }, { clave: '1' }]), /repetida/);
  assert.throws(() => P.normalizarEtapasElegidas([{ clave: '1', monto: '1.234' }]), /no es válido/);

  // ---- Sugerencias ----
  const cand = [{ folio: 'PRY-1', folioVisible: 'PRY-1-PLN', nombre: 'Planta', cliente: 'Ing. Pérez — Universidad Robótica Española SA de CV', clienteId: URE,
    estadoProyecto: 'Activo', moneda: 'MXN', etapas: [{ clave: '1', etapa: 'Anticipo', porFacturar: 6960 }, { clave: '2', etapa: 'Instalación', porFacturar: 3480 }, { clave: '3', etapa: 'Encendido', porFacturar: 1160 }] },
    { folio: 'PRY-2', folioVisible: 'PRY-2-TER', nombre: 'Terminal', cliente: 'Otra — Otra SA', clienteId: 'SIN-RFC:otra|otra', estadoProyecto: 'Activo', moneda: 'MXN',
      etapas: [{ clave: '1', etapa: 'Anticipo', porFacturar: 4640 }] },
    { folio: 'PRY-3', folioVisible: 'PRY-3-CAN', nombre: 'Cancelado', cliente: 'X', clienteId: URE, estadoProyecto: 'Cancelado', moneda: 'MXN', etapas: [{ clave: '1', etapa: 'A', porFacturar: 4640 }] },
    { folio: 'PRY-4', folioVisible: 'PRY-4-USD', nombre: 'Dólares', cliente: 'Y', clienteId: URE, estadoProyecto: 'Activo', moneda: 'USD', etapas: [{ clave: '1', etapa: 'A', porFacturar: 4640 }] }];
  const s1 = plain(P.sugerirLigaFactura({ receptorRfc: URE, receptorNombre: 'UNIVERSIDAD ROBOTICA ESPAÑOLA', total: 4640, moneda: 'MXN' }, cand));
  assert.deepEqual(s1.map(s => [s.proyectoFolio, s.porRfc, s.porMonto, s.etapas.join('+')]), [['PRY-1', true, 'exacto', '2+3'], ['PRY-2', false, 'exacto', '1']],
    'RFC + monto primero; solo monto después; nunca cancelados ni otra moneda');
  assert(/mismo RFC del cliente · el total coincide con lo que falta facturar de Instalación \+ Encendido/.test(s1[0].razon));
  const s2 = plain(P.sugerirLigaFactura({ receptorRfc: 'XAXX010101000', receptorNombre: 'Universidad Robótica Española, S.A. de C.V.', total: 100, moneda: 'MXN' }, cand));
  assert.deepEqual(s2.map(s => [s.proyectoFolio, s.porNombre, s.porMonto, s.etapas.join('+')]), [['PRY-1', true, 'cabe', '1']], 'RFC genérico: por razón social');
  assert.deepEqual(plain(P.sugerirLigaFactura({ receptorRfc: 'AAA010101AAA', receptorNombre: 'Nadie', total: 7, moneda: 'MXN' }, cand)), [], 'sin RFC, nombre ni monto exacto: nada');
  assert.equal(P.nombreFiscalNormal('Antenas del Golfo, S.A. de C.V.'), 'antenas del golfo');

  // ---- Pendientes de cobranza (lógica pura) ----
  const vista = plain(P.vistaFacturasClientes({ facturas: fs1.concat([F(UU.I6, 'I', { total: 116, receptorNombre: 'PUBLICO EN GENERAL', fechaRegistro: '28/10/2026 09:15' })]),
    cobranza: Object.assign({}, COB, { 'PRY-1': Object.assign({ ultimoPago: '2026-09-01' }, COB['PRY-1']) }),
    proyectos: { 'PRY-1': { folio: 'PRY-1', folioVisible: 'PRY-1-PLN', nombre: 'Planta', cliente: 'C', clienteId: URE, estado: 'Activo' },
      'PRY-2': { folio: 'PRY-2', folioVisible: 'PRY-2-TER', nombre: 'Terminal', cliente: 'C', clienteId: URE, estado: 'Activo' } } }, '2026-10-29'));
  assert.deepEqual(vista.conteos, { facturas: 8, sinLigar: 1, repPendientes: 1, revisar: 1 });
  const items = plain(P.itemsFacturasCliPendientes(vista, { hoy: '2026-10-29' }));
  assert.deepEqual(items.map(i => [i.tipo, i.titulo, i.seccion, i.destino, i.req]), [['facRep', 'REP pendiente', 'cobranza', 'fac', UU.I2],
    ['facRevisar', 'Factura por revisar', 'cobranza', 'fac', UU.I4], ['facSinLigar', 'XML sin ligar', 'cobranza', 'fac', UU.I6]]);
  assert.deepEqual([items[0].desde, items[0].dias, items[0].urgente], ['2026-09-01', 58, true], 'REP desde el último pago del proyecto');
  assert(/PRY-1-PLN · Planta · .*cobrado \$3,480\.00 MXN · con REP \$2,500\.00 MXN · falta REP por \$980\.00 MXN/.test(items[0].detalle), items[0].detalle);
  assert.equal(items[2].desde, '2026-10-28', 'XML sin ligar: desde que se importó');
  const basePend = { yo: 'tania@helgen.tech', hoy: '2026-10-29', facturasCli: vista };
  assert.equal(P.itemsPendientes([], Object.assign({ roles: { compras: true, requisicion: true } }, basePend)).length, 0, 'sin cobranza no se ven');
  assert.equal(P.itemsPendientes([], Object.assign({ roles: { cobranza: true } }, basePend)).length, 3);
  assert(P.itemsPendientes([], Object.assign({ roles: {}, todos: true }, basePend)).every(i => i.para === 'Cobranza'));
}

// ================= 2. Servidor (doPost) =================
P.exigirDocumentosParaPagar_ = function () {};
correr(`enviarCorreosPendientes_ = function () { MEMO_.correos = []; }; avisarPortal_ = function () { return ''; };`);
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri();
let nId = 0;
const id = p => (p || 'x') + (++nId);
const UREC = { nombre: 'Ing. Pérez', empresa: 'Universidad Robótica Española SA de CV', rfc: URE };
const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente, idSolicitud: id('p') }).folio;
const cot = (proyectoFolio, cliente, precio, extra) => ok('ana', 'guardarCotizacion', Object.assign({ cliente, items: [{ descripcion: 'Servicio', cantidad: 1, precio }],
  proyectoFolio, idSolicitud: id('c') }, extra || {})).folio;
const cobrar = (proyectoFolio, monto, etapaOrden) => ok('tania', 'registrarPago', { proyectoFolio, fecha: HOY_ISO, monto, metodo: 'Transferencia',
  referencia: 'SPEI ' + monto, etapaOrden, comprobante: { datos: PDF }, idSolicitud: id('g') }).folio;
const p1 = pry('Planta Norte', UREC), p2 = pry('Terminal Sur', UREC), p3 = pry('Antenas USD', { nombre: 'Xenon', empresa: 'Xenon Industrial Articles', rfc: XIA });
const p4 = pry('Sin contrato', UREC);
ok('tania', 'marcarAceptada', p1, cot(p1, UREC, 10000), true); ok('tania', 'firmarContrato', p1, HOY_ISO);   // 6960 / 3480 / 1160
ok('tania', 'marcarAceptada', p2, cot(p2, UREC, 5000), true); ok('tania', 'firmarContrato', p2, HOY_ISO);    // 3480 / 1740 / 580
ok('tania', 'marcarAceptada', p3, cot(p3, { nombre: 'Xenon', rfc: XIA }, 1000, { moneda: 'USD', tipoCambio: 18 }), true); // por firmar, USD
const LC = () => libros[props.COBRANZA_DB_ID];
const filasFC = () => LC().pest.FacturasClientes.m.slice(1);
const ENC_FC = plain(correr('HOJAS_COBRANZA.FacturasClientes.enc'));
const col = n => ENC_FC.indexOf(n);
const fila = u => filasFC().find(r => r[0] === u);

// ---- Importar: ZIP de CONTALINK + sueltos ----
const zip = crearZip([
  { nombre: 'Facturas Octubre/', datos: null },
  { nombre: 'Facturas Octubre/A-101.xml', datos: Buffer.from(X.I1) }, { nombre: 'Facturas Octubre/A-101.pdf', datos: PDF_BUF },
  { nombre: 'Facturas Octubre/A-102.xml', datos: Buffer.from(X.I2) }, { nombre: 'Facturas Octubre/PDF/' + UU.I2.toLowerCase() + '.pdf', datos: PDF_BUF },
  { nombre: 'Notas/NC-5.xml', datos: Buffer.from(X.E1) }, { nombre: 'Pagos/P-12.xml', datos: Buffer.from(X.P1) },
  { nombre: 'Compras/prov.xml', datos: Buffer.from(X.PROV) }, { nombre: 'viejas/A-33.xml', datos: Buffer.from(X.V33) },
  { nombre: 'leeme.txt', datos: Buffer.from('Descarga CONTALINK') }, { nombre: '__MACOSX/Facturas Octubre/._A-101.xml', datos: Buffer.from('junk') },
  { nombre: 'Facturas Octubre/.DS_Store', datos: Buffer.from('junk') }, { nombre: 'otro.zip', datos: crearZip([{ nombre: 'x.xml', datos: Buffer.from(X.I3) }]) },
]);
const ID1 = 'envio-1';
const envio = (archivos, idSolicitud) => ok('tania', 'importarFacturasClientes', { archivos, idSolicitud: idSolicitud || id('imp') });
const vAntes = props.VER_facturasClientes;
let r = envio([{ nombre: 'CONTALINK_2026-10.zip', datos: zip.toString('base64') }, { nombre: 'B-7.xml', datos: b64(X.I3) }, { nombre: 'C-1.xml', datos: b64(X.I4) },
  { nombre: 'A-110.xml', datos: b64(X.I5) }, { nombre: 'sin-xml.pdf', datos: PDF_BUF.toString('base64') }, { nombre: 'foto.png', datos: b64('\x89PNG....') },
  { nombre: 'vacio.xml', datos: '' }], ID1);
const res = n => r.resultados.find(x => x.archivo === n) || assert.fail('sin resultado: ' + n + ' en ' + r.resultados.map(x => x.archivo).join(' | '));
const Z = 'CONTALINK_2026-10.zip › ';
assert.deepEqual([Z + 'Facturas Octubre/A-101.xml', Z + 'Facturas Octubre/A-102.xml', Z + 'Notas/NC-5.xml', Z + 'Pagos/P-12.xml', 'B-7.xml', 'C-1.xml', 'A-110.xml']
  .map(n => res(n).estado), Array(7).fill('importada'));
assert.deepEqual([res(Z + 'Facturas Octubre/A-101.pdf').estado, res(Z + 'Facturas Octubre/PDF/' + UU.I2.toLowerCase() + '.pdf').estado], ['pdf', 'pdf'], 'PDF por nombre y por UUID');
assert(/lo emitió ESCUELA KEMPER URGATE \(EKU9003173C9\), no Helgen/.test(res(Z + 'Compras/prov.xml').mensaje) && res(Z + 'Compras/prov.xml').estado === 'rechazada');
assert(/3\.3.*CONTALINK/.test(res(Z + 'viejas/A-33.xml').mensaje));
assert.deepEqual([res(Z + 'leeme.txt').estado, res(Z + 'otro.zip').estado, res('sin-xml.pdf').estado, res('foto.png').estado, res('vacio.xml').estado],
  ['ignorada', 'rechazada', 'rechazada', 'rechazada', 'rechazada']);
assert(!r.resultados.some(x => /__MACOSX|DS_Store|Facturas Octubre\/$/.test(x.archivo)), 'carpetas y basura del sistema no salen');
assert.deepEqual(r.conteos, { importadas: 7, repetidas: 0, rechazadas: 6, pendientes: 0, pdfs: 2, ignoradas: 1 });
assert.equal(res(Z + 'Pagos/P-12.xml').total, 5000, 'REP: total de sus pagos (una moneda)');
assert.equal(filasFC().length, 7, 'siete CFDI en FacturasClientes');
assert.notEqual(props.VER_facturasClientes, vAntes, 'sube la versión de facturasClientes');
const fI1 = fila(UU.I1), fP1 = fila(UU.P1);
assert.deepEqual([fI1[col('tipo')], fI1[col('serie_folio')], fI1[col('metodo')], fI1[col('forma')], fI1[col('moneda')], fI1[col('subtotal')], fI1[col('iva')],
  fI1[col('total')], fI1[col('receptor_rfc')], fI1[col('estado')], fI1[col('proyecto_folio')], fI1[col('etapas (JSON)')], fI1[col('id_solicitud')], fI1[col('archivo_xml')]],
  ['I', 'A-101', 'PUE', '03', 'MXN', 6000, 960, 6960, URE, 'Vigente', '', '[]', ID1, 'A-101.xml'], 'forma "03" se queda como texto');
assert.equal(fI1[col('fecha')], '2026-10-10', 'fecha con apóstrofo: texto, no Date');
assert.deepEqual(JSON.parse(fila(UU.E1)[col('relacionadas (JSON)')]), [{ uuid: UU.I2, tipoRelacion: '01' }]);
assert.equal(JSON.parse(fP1[col('pagos (JSON)')]).length, 2);
assert.deepEqual([fP1[col('moneda')], fP1[col('total')]], ['MXN', 5000]);
// Archivos privados en Cobranza/<año de la factura>/Sin proyecto/Facturas
const xmlI1 = fI1[col('xml_id')], pdfI1 = fI1[col('pdf_id')], pdfI2 = fila(UU.I2)[col('pdf_id')];
assert(xmlI1 && pdfI1 && pdfI2 && !fila(UU.I3)[col('pdf_id')]);
assert.equal(rutaDe(xmlI1), 'Cotizador Helgen — Cobranza/2026/Sin proyecto/Facturas');
assert(/^Factura A-101 — UNIVERSIDAD ROBOTICA ESPAÑOLA — 00000101\.xml$/.test(A.archivos[xmlI1].nombre), A.archivos[xmlI1].nombre);
assert.equal(A.archivos[pdfI1].blob.mime, 'application/pdf');
filasFC().forEach(f => [f[col('xml_id')], f[col('pdf_id')]].filter(Boolean).forEach(i => assert.equal(A.archivos[i].acceso, 'PRIVATE', 'privado: ' + i)));
['2026', 'Sin proyecto', 'Facturas'].forEach(n => Object.values(A.carpetas).filter(c => c.nombre === n && /Cobranza/.test(rutaDe2(c))).forEach(c => assert.equal(c.acceso, 'PRIVATE')));
function rutaDe2(c) { const p = []; for (let f = c; f; f = f.padre) p.unshift(f.nombre); return p.join('/'); }
assert(LC().pest.Bitacora.m.some(b => b[2] === 'Importar facturas de clientes' && /^7 nuevas \(I 5, E 1, P 1\): A-101 0000/.test(b[4])), 'Bitácora');
assert.equal(r.lista.conteos.sinLigar, 5, 'la lista al día viene con la respuesta');

// ---- Repetidas: otro envío (repetida), el mismo envío (importada) y un PDF que llega después ----
r = envio([{ nombre: 'CONTALINK_2026-10.zip', datos: zip.toString('base64') }]);
assert.deepEqual([r.conteos.importadas, r.conteos.repetidas], [0, 4]);
assert(/Ya estaba importada \(A-101\) y está sin ligar: no se duplicó/.test(res(Z + 'Facturas Octubre/A-101.xml').mensaje));
assert.equal(res(Z + 'Facturas Octubre/A-101.pdf').estado, 'ignorada', 'ya tenía su PDF');
r = envio([{ nombre: 'B-7.xml', datos: b64(X.I3) }], ID1);
assert.deepEqual([r.resultados[0].estado, r.resultados[0].mensaje], ['importada', 'Importada (este mismo envío ya la había guardado).'], 'reintento del mismo envío');
r = envio([{ nombre: 'B-7.pdf', datos: PDF_BUF.toString('base64') }]);
assert.deepEqual([r.resultados[0].estado, r.conteos.pdfs], ['pdf', 1], 'PDF de una factura ya importada (por el nombre de su XML)');
assert(fila(UU.I3)[col('pdf_id')]);
assert.equal(filasFC().length, 7, 'nada se duplicó');

// ---- Límites y errores del envío ----
falla('tania', 'importarFacturasClientes', [{ archivos: [] }], /Adjunta uno o varios XML, o el ZIP/);
falla('tania', 'importarFacturasClientes', [{ archivos: Array(61).fill({ nombre: 'a.xml', datos: b64(X.I1) }) }], /máximo 60 archivos/);
falla('tania', 'importarFacturasClientes', [{ archivos: [{ nombre: 'grande.pdf', datos: Buffer.alloc(21 * 1024 * 1024, 65).toString('base64') }] }], /más de 20 MB/);
r = envio([{ nombre: 'enorme.zip', datos: crearZip(Array.from({ length: 401 }, (_, i) => ({ nombre: 'f' + i + '.xml', datos: Buffer.from('<a/>') }))).toString('base64') },
  { nombre: 'roto.zip', datos: Buffer.from('PK\x03\x04 dañado').toString('base64') }, { nombre: 'vacio.zip', datos: crearZip([{ nombre: 'carpeta/', datos: null }]).toString('base64') }]);
assert(/trae 401 archivos \(máximo 400\)/.test(res('enorme.zip').mensaje) && /No se pudo abrir el ZIP/.test(res('roto.zip').mensaje) && /no trae archivos/.test(res('vacio.zip').mensaje));

// ---- Lista y sugerencias ----
let L = ok('tania', 'listarFacturasClientes');
const enLista = u => L.facturas.find(f => f.uuid === u);
assert.deepEqual(L.conteos, { facturas: 7, sinLigar: 5, repPendientes: 0, revisar: 0 });
assert.deepEqual(L.facturas.filter(f => f.sinLigar).map(f => f.serieFolio).sort(), ['A-101', 'A-102', 'A-110', 'B-7', 'C-1'], 'la E resta de A-102: no está sin ligar');
assert.deepEqual(enLista(UU.E1).aplicadaA, [{ uuid: UU.I2, serieFolio: 'A-102', monto: 1160 }]);
const sg = enLista(UU.I1).sugerencias;
assert.deepEqual([sg[0].proyectoFolio, sg[0].porRfc, sg[0].porMonto, sg[0].etapas], [p1, true, 'exacto', ['1']], JSON.stringify(sg));
assert.deepEqual(enLista(UU.I2).sugerencias[0].etapas, ['2', '3'], 'A-102 (4,640) = Instalación + Encendido');
assert.deepEqual(enLista(UU.I4).sugerencias.map(s => s.proyectoFolio), [p3], 'USD: solo proyectos en USD (por firmar también)');
assert.deepEqual(enLista(UU.I5).sugerencias, [], 'público en general: sin sugerencia');
assert.deepEqual(L.proyectos.map(p => p.folio).sort(), [p1, p2, p3].sort(), 'proyectos con cotización aceptada (sin el que no tiene)');
assert.deepEqual(L.proyectos.find(p => p.folio === p1).etapas.map(e => [e.clave, e.etapa, e.monto, e.porFacturar]),
  [['1', 'Anticipo', 6960, 6960], ['2', 'Instalación', 3480, 3480], ['3', 'Encendido del sistema', 1160, 1160]]);
assert(!JSON.stringify(L).includes('xmlId') && !JSON.stringify(L.proyectos).includes('clienteId'), 'sin ids de Drive ni cliente_id');

// ---- Pendientes de cobranza: XML sin ligar ----
let pd = ok('tania', 'pendientes');
assert.deepEqual(pd.items.filter(i => i.seccion === 'cobranza').map(i => i.titulo + ' ' + i.folio).sort(),
  ['XML sin ligar A-101', 'XML sin ligar A-102', 'XML sin ligar A-110', 'XML sin ligar B-7', 'XML sin ligar C-1']);
assert(/sugerido: PRY-\d{4}-\d{4}-PLN/.test(pd.items.find(i => i.folio === 'A-101').detalle));

// ---- Ligar ----
const ligar = (uuid, proyectoFolio, etapas, extra) => ok('tania', 'ligarFacturaCliente', Object.assign({ uuid, proyectoFolio, etapas }, extra || {}));
const vLigar = props.VER_facturasClientes;
r = ligar(UU.I1, p1, [{ clave: '1' }]);
assert.notEqual(props.VER_facturasClientes, vLigar);
assert.deepEqual(JSON.parse(fila(UU.I1)[col('etapas (JSON)')]), [{ clave: '1', etapa: 'Anticipo', monto: 6960 }]);
assert.deepEqual([fila(UU.I1)[col('proyecto_folio')], fila(UU.I1)[col('carpeta_proyecto')], fila(UU.I1)[col('ligo_email')]], [p1, p1, 'tania@helgen.tech']);
assert.equal(rutaDe(xmlI1), carpetaDe(p1), 'el XML se mueve a la carpeta del proyecto');
assert.equal(rutaDe(pdfI1), carpetaDe(p1));
assert.equal(A.archivos[xmlI1].acceso, 'PRIVATE');
r = ligar(UU.I2, p1, [{ clave: '3' }, { clave: '2' }]);
assert.deepEqual(JSON.parse(fila(UU.I2)[col('etapas (JSON)')]).map(e => [e.clave, e.monto]), [['2', 3480], ['3', 1160]]);
assert.deepEqual([fila(UU.E1)[col('proyecto_folio')], fila(UU.E1)[col('carpeta_proyecto')], rutaDe(fila(UU.E1)[col('xml_id')])],
  [p1, p1, carpetaDe(p1)], 'su nota de crédito se va con ella');
assert.equal(rutaDe(fP1[col('xml_id')]), 'Cotizador Helgen — Cobranza/2026/Sin proyecto/Facturas', 'el REP todavía toca otra factura sin ligar');
// Errores al ligar
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I4, proyectoFolio: p1, etapas: [{ clave: '1' }] }], /es en USD y el proyecto PRY-\d{4}-\d{4}-PLN en MXN/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I5, proyectoFolio: p4, etapas: [{ clave: '1' }] }], /no tiene cotización aceptada/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I3, proyectoFolio: p1, etapas: [{ clave: '1' }] }], /mayor que lo que falta facturar de la etapa elegida \(\$0\.00 MXN\)/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.E1, proyectoFolio: p1, etapas: [{ clave: '1' }] }], /ya resta de su factura relacionada \(A-102\)/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.P1, proyectoFolio: p1, etapas: [{ clave: '1' }] }], /complemento de pago no se liga/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I3, proyectoFolio: p2, etapas: [{ clave: '1', monto: 1000 }, { clave: '2', monto: 1000 }] }], /suman \$2,000\.00 MXN y la factura es por \$3,480\.00 MXN/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I3, proyectoFolio: '' }], /Elige el proyecto \(o marca la factura como "sin proyecto"/);
falla('tania', 'ligarFacturaCliente', [{ uuid: 'nada' }], /Elige la factura/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I3, proyectoFolio: 'PRY-2099-0001', etapas: [{ clave: '1' }] }], /No existe el proyecto/);
// B-7 (3,480) en P2 con montos explícitos (3000 + 480)
ligar(UU.I3, p2, [{ clave: '1', monto: 3000 }, { clave: '2', monto: 480 }]);
assert.deepEqual(JSON.parse(fila(UU.I3)[col('etapas (JSON)')]).map(e => e.monto), [3000, 480]);
assert.equal(rutaDe(fP1[col('xml_id')]), 'Cotizador Helgen — Cobranza/2026/Sin proyecto/Facturas', 'un REP de dos proyectos no se mueve');
ligar(UU.I4, p3, [{ clave: '1' }, { clave: '2' }, { clave: '3' }]); // USD por firmar: 696 + 348 + 116
// Cambiar la liga (queda en la Bitácora); con montos, cada etapa hasta lo que le falta
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I1, proyectoFolio: p1, etapas: [{ clave: '1', monto: 5000 }, { clave: '3', monto: 1960 }] }],
  /La etapa Encendido del sistema solo tiene \$290\.00 MXN por facturar \(le asignaste \$1,960\.00 MXN\)/);
ligar(UU.I1, p1, [{ clave: '1', monto: 6000 }, { clave: '2', monto: 870 }, { clave: '3', monto: 90 }]);
const bitLiga = LC().pest.Bitacora.m.filter(b => /liga de factura de cliente|Ligar factura/.test(b[2]));
assert.deepEqual(bitLiga.map(b => b[2]), ['Ligar factura de cliente', 'Ligar factura de cliente', 'Ligar factura de cliente', 'Ligar factura de cliente', 'Cambiar liga de factura de cliente']);
assert(/antes: PRY-\d{4}-\d{4} Anticipo \$6,960\.00/.test(bitLiga[4][4]));
ligar(UU.I1, p1, [{ clave: '1' }]);
// Sin proyecto (con motivo); se puede ligar después
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.I5, sinProyecto: 'no' }], /Escribe por qué/);
ok('tania', 'ligarFacturaCliente', { uuid: UU.I5, sinProyecto: 'Venta de mostrador, no se lleva en CAPRI' });
assert.equal(fila(UU.I5)[col('sin_proyecto')], 'Venta de mostrador, no se lleva en CAPRI');
L = ok('tania', 'listarFacturasClientes');
assert.deepEqual([L.conteos.sinLigar, enLista(UU.I5).sinLigar, enLista(UU.I5).sinProyecto], [0, false, 'Venta de mostrador, no se lleva en CAPRI']);
assert.equal(ok('tania', 'pendientes').items.filter(i => i.seccion === 'cobranza').length, 0, 'ya nada por atender');

// ---- Cobros de cobranza y REP pendiente ----
cobrar(p1, 6960, 1); cobrar(p1, 3000, 2); cobrar(p1, 870, 3);
L = ok('tania', 'listarFacturasClientes');
const a102 = enLista(UU.I2);
assert.deepEqual([a102.neto, a102.cobrado, a102.repCubierto, a102.porCubrirRep, a102.repPendiente, a102.saldoSegunRep], [3480, 3480, 2500, 980, true, 980]);
assert.deepEqual(a102.etapas.map(e => [e.clave, e.monto]), [['2', 2610], ['3', 870]], 'la nota de crédito resta en proporción');
assert.deepEqual([enLista(UU.I3).repSinCobro, enLista(UU.I3).repPendiente], [true, false], 'B-7: REP sin cobro registrado en P2');
assert.deepEqual([enLista(UU.I1).cobrado, enLista(UU.I1).repPendiente], [6960, false], 'PUE');
assert.deepEqual(L.conteos, { facturas: 7, sinLigar: 0, repPendientes: 1, revisar: 0 });
pd = ok('tania', 'pendientes');
const itRep = pd.items.find(i => i.tipo === 'facRep');
assert.deepEqual([itRep.titulo, itRep.folio, itRep.req, itRep.destino, itRep.seccion, itRep.desde], ['REP pendiente', 'A-102', UU.I2, 'fac', 'cobranza', HOY_ISO]);
assert(pd.conteos.total >= 1);
// Vista del proyecto: facturas por etapa
let v = ok('tania', 'getCobranzaProyecto', p1);
assert.deepEqual(v.facturas.etapas.map(e => [e.clave, e.etapa, e.monto, e.facturado, e.cobrado, e.porFacturar, e.facturas.map(x => x.serieFolio + ' ' + x.total + (x.repPendiente ? ' REP' : '')).join(',')]),
  [['1', 'Anticipo', 6960, 6960, 6960, 0, 'A-101 6960'], ['2', 'Instalación', 3480, 2610, 3000, 870, 'A-102 2610 REP'], ['3', 'Encendido del sistema', 1160, 870, 870, 290, 'A-102 870 REP']]);
assert.deepEqual([v.facturas.repPendientes, v.facturas.totales.facturado, v.facturas.totales.cobrado, v.facturas.sinLigarCliente], [1, 10440, 10830, 0]);
assert(v.facturas.etapas[1].facturas[0].pdfUrl && v.facturas.etapas[1].facturas[0].xmlUrl);
assert.equal(ok('tania', 'getCobranzaProyecto', p4).facturas.etapas.length, 0, 'sin aceptada: sin etapas');
// facturasPorEtapa con las filas de la hoja (para el integrador)
const deHoja = plain(correr(`facturasPorEtapa(facturasClientesDelLibro_(libroCobranza_()), contextoFacturasCli_().cobranza)`));
assert.deepEqual(Object.keys(deHoja).sort(), [p1, p2, p3].sort());
assert.deepEqual(deHoja[p1]['2'], [{ uuid: UU.I2, serieFolio: 'A-102', fecha: '2026-10-12', metodo: 'PPD', total: 2610, moneda: 'MXN', repPendiente: true }]);
// El REP que falta llega: ya no hay REP pendiente
envio([{ nombre: 'P-13.xml', datos: b64(X.P2) }]);
L = ok('tania', 'listarFacturasClientes');
assert.deepEqual([enLista(UU.I2).repCubierto, enLista(UU.I2).repPendiente, L.conteos.repPendientes], [3480, false, 0]);
assert.equal(fila(UU.P2)[col('proyecto_folio')], p1, 'un REP que solo toca un proyecto ligado va a ese proyecto');
assert.equal(rutaDe(fila(UU.P2)[col('xml_id')]), carpetaDe(p1));
assert.equal(ok('tania', 'pendientes').items.filter(i => i.tipo === 'facRep').length, 0);

// ---- Cancelar (cuando se canceló en CONTALINK) ----
falla('tania', 'cancelarFacturaCliente', [UU.E1, 'no'], /motivo de la cancelación/);
r = ok('tania', 'cancelarFacturaCliente', UU.E1, 'Cancelada en CONTALINK por error de captura', p1);
assert.deepEqual([fila(UU.E1)[col('estado')], fila(UU.E1)[col('cancelado_por')], fila(UU.E1)[col('motivo_cancelacion')]],
  ['Cancelada', 'tania@helgen.tech', 'Cancelada en CONTALINK por error de captura']);
assert.deepEqual(r.vista.facturas.etapas.map(e => e.facturado), [6960, 3480, 1160], 'sin la nota de crédito, A-102 vuelve completa');
falla('tania', 'cancelarFacturaCliente', [UU.E1, 'Otra vez la misma'], /ya está cancelada/);
falla('tania', 'cancelarFacturaCliente', [U(99999), 'No existe esta factura'], /No existe la factura/);
falla('tania', 'ligarFacturaCliente', [{ uuid: UU.E1, proyectoFolio: p1, etapas: [{ clave: '1' }] }], /está cancelada/);
assert(LC().pest.Bitacora.m.some(b => b[2] === 'Cancelar factura de cliente' && /Nota de crédito NC-5/.test(b[4])));
r = envio([{ nombre: 'NC-5.xml', datos: b64(X.E1) }]);
assert(/está marcada Cancelada: no se duplicó/.test(r.resultados[0].mensaje), 'reimportar una cancelada no la revive');

// ---- Sincronizar: la lista, la vista abierta y los pendientes cuando cambian las facturas ----
const vs = ok('tania', 'bootstrap').versiones;
assert(ok('tania', 'bootstrap').facturasCli, 'en caché: va en la carga inicial');
let sy = ok('tania', 'sincronizar', vs, { facturasCli: true, cobProyecto: p1 });
assert.equal(sy.facturasCli, undefined, 'sin cambios no se manda');
ligar(UU.I1, p1, [{ clave: '1' }, { clave: '3', monto: null }].map(e => ({ clave: e.clave })));
sy = ok('tania', 'sincronizar', vs, { facturasCli: true, cobProyecto: p1 });
assert(sy.facturasCli && sy.cobranzaProyecto && sy.cobranzaProyecto.facturas && sy.pendientes, 'lista, vista del proyecto y pendientes');
ligar(UU.I1, p1, [{ clave: '1' }]);
const vs2 = ok('tania', 'bootstrap').versiones;
cobrar(p2, 100, 1);
sy = ok('tania', 'sincronizar', vs2, { facturasCli: true });
assert(sy.facturasCli && sy.pendientes, 'un pago de cobranza cambia lo cobrado de las facturas');
assert.deepEqual(plain(correr('CAMBIOS_API.importarFacturasClientes.concat(CAMBIOS_API.ligarFacturaCliente, CAMBIOS_API.cancelarFacturaCliente)')),
  ['facturasClientes', 'facturasClientes', 'facturasClientes']);
assert.equal(plain(correr('COLECCIONES'))[plain(correr('COLECCIONES')).length - 1], 'facturasClientes', 'al final de COLECCIONES');

// ---- Permisos: solo cobranza y super admin; nada sale a ventas, compras ni a quien pide ----
const API = ['importarFacturasClientes', 'listarFacturasClientes', 'ligarFacturaCliente', 'cancelarFacturaCliente'];
const ARGS = { importarFacturasClientes: [{ archivos: [{ nombre: 'a.xml', datos: b64(X.I1) }] }], listarFacturasClientes: [],
  ligarFacturaCliente: [{ uuid: UU.I1, proyectoFolio: p1, etapas: [{ clave: '1' }] }], cancelarFacturaCliente: [UU.I1, 'Motivo suficiente'] };
const filasAntes = JSON.stringify(filasFC());
['ana', 'pedro', 'obrero', 'rosa'].forEach(q => API.forEach(f => falla(q, f, ARGS[f], /permiso de cobranza|solo tiene acceso a Requisiciones/, 'PERMISO')));
assert.equal(JSON.stringify(filasFC()), filasAntes, 'nadie sin cobranza cambió nada');
assert(ok('leo', 'listarFacturasClientes').facturas.length === 8, 'el super admin sí');
falla('efrain', 'listarFacturasClientes', [], /permiso de cobranza/, 'PERMISO'); // solo tiene desbloqueo
const secretos = [UU.I1, UU.I2, UU.E1, UU.P1, 'A-102', 'FacturasClientes', 'REP pendiente', 'XML sin ligar', 'UNIVERSIDAD ROBOTICA'];
['ana', 'pedro', 'obrero', 'rosa'].forEach(q => {
  const bt = ok(q, 'bootstrap');
  assert.strictEqual(bt.facturasCli, undefined, q + ': bootstrap sin facturas');
  const s = ok(q, 'sincronizar', {}, { facturasCli: true, cobProyecto: p1, pendTodos: true });
  assert.strictEqual(s.facturasCli, undefined, q); assert.strictEqual(s.cobranzaProyecto, undefined, q);
  assert(!(bt.errores || []).concat(s.errores || []).some(e => /Facturas|cobranza/i.test(e)), q + ': ni siquiera lo intenta: ' + (bt.errores || []).concat(s.errores || []));
  const txt = JSON.stringify(bt) + JSON.stringify(s) + JSON.stringify(ok(q, 'pendientes'));
  secretos.forEach(x => assert(!txt.includes(x), q + ' no debe ver ' + x));
});
falla('pedro', 'getCobranzaProyecto', [p1], /permiso de cobranza/, 'PERMISO');
assert(ok('leo', 'pendientes', true).items.every(i => i.seccion !== 'cobranza' || i.para === 'Cobranza'));

// ---- Carrera: otro envío guarda el mismo UUID mientras este creaba sus archivos ----
const I7 = cfdi({ uuid: U(107), folio: '107', subtotal: '10.00', iva: '1.60', total: '11.60' });
A.ctx.__otro = () => {
  const m = LC().pest.FacturasClientes.m, n = m[0].map(() => '');
  n[0] = U(107); n[1] = 'I'; n[col('estado')] = 'Vigente'; n[col('id_solicitud')] = 'otro-envio';
  m.push(n);
};
correr('var __conCandado = conCandado_; conCandado_ = function (f) { __otro(); conCandado_ = __conCandado; return __conCandado(f); };');
const antesArchivos = Object.keys(A.archivos).length;
r = envio([{ nombre: 'A-107.xml', datos: b64(I7) }, { nombre: 'A-107.pdf', datos: PDF_BUF.toString('base64') }]);
assert.deepEqual([r.resultados[0].estado, filasFC().filter(f => f[0] === U(107)).length], ['repetida', 1], 'no se duplica');
const nuevosArch = Object.keys(A.archivos).slice(antesArchivos);
assert.equal(nuevosArch.length, 2);
assert(nuevosArch.every(i => A.archivos[i].trashed), 'sus archivos van a la Papelera');

// ---- Tiempo: después de TIEMPO_MAX_IMPORTAR ya no se crean archivos (lo demás queda pendiente) ----
const realNow = Date.now;
A.ctx.__saltar = () => { Date.now = () => realNow() + 300000; };
correr('var __arch = archivoPrivado_, __n = 0; archivoPrivado_ = function () { if (++__n === 1) __saltar(); return __arch.apply(null, arguments); };');
try {
  r = envio([{ nombre: 'A-108.xml', datos: b64(cfdi({ uuid: U(108), folio: '108', subtotal: '10.00', iva: '1.60', total: '11.60' })) },
    { nombre: 'A-109.xml', datos: b64(cfdi({ uuid: U(109), folio: '109', subtotal: '10.00', iva: '1.60', total: '11.60' })) }]);
} finally { Date.now = realNow; correr('archivoPrivado_ = __arch;'); }
assert.deepEqual(r.resultados.map(x => x.estado), ['importada', 'pendiente']);
assert(/No alcanzó el tiempo/.test(r.resultados[1].mensaje));
assert(fila(U(108)) && !fila(U(109)));

// ---- Nota de crédito cuya factura no está en CAPRI: se liga a mano y resta de sus etapas ----
const E2 = cfdi({ uuid: U(502), tipo: 'E', serie: 'NC', folio: '6', fecha: '2026-10-25T10:00:00', forma: '15', subtotal: '500.00', iva: '80.00', total: '580.00',
  rel: { tipo: '01', uuids: [U(9999)] } });
r = envio([{ nombre: 'NC-6.xml', datos: b64(E2) }]);
assert.equal(r.resultados[0].mensaje, 'Nota de crédito importada.');
L = ok('tania', 'listarFacturasClientes');
assert.deepEqual([enLista(U(502)).sinLigar, enLista(U(502)).relacionadas], [true, [{ uuid: U(9999), tipoRelacion: '01', serieFolio: '', enCapri: false }]]);
falla('tania', 'ligarFacturaCliente', [{ uuid: U(502), proyectoFolio: p2, etapas: [{ clave: '3' }] }],
  /La nota de crédito \(\$580\.00 MXN\) es mayor que lo facturado de la etapa elegida \(\$0\.00 MXN\)/);
ligar(U(502), p2, [{ clave: '1' }]);
v = ok('tania', 'getCobranzaProyecto', p2);
assert.deepEqual(v.facturas.etapas.map(e => e.facturado), [2420, 480, 0], 'B-7 (3000 + 480) menos la nota de crédito en el Anticipo');
assert.equal(v.facturas.etapas[0].facturas.find(x => x.uuid === U(502)).total, -580, 'sale con total negativo');
L = ok('tania', 'listarFacturasClientes');
assert.deepEqual([enLista(U(502)).sinLigar, enLista(U(502)).ligada, enLista(U(502)).etapas], [false, true, [{ clave: '1', etapa: 'Anticipo', monto: -580 }]]);

// ---- Rapidez: ninguna llamada HTTP (privado_) dentro del candado al importar ni al ligar (perfil del arnés) ----
{
  const B = crear({ perfil: true });
  B.ctx.Utilities.unzip = unzip;
  B.P.exigirDocumentosParaPagar_ = function () {};
  const q = B.ok('ana', 'crearProyecto', { nombre: 'Planta Norte', ubicacion: 'Qro', cliente: UREC, idSolicitud: 'pp' }).folio;
  const c = B.ok('ana', 'guardarCotizacion', { cliente: UREC, items: [{ descripcion: 'S', cantidad: 1, precio: 10000 }], proyectoFolio: q, idSolicitud: 'cc' }).folio;
  B.ok('tania', 'marcarAceptada', q, c, true);
  let n0 = B.perfil.ops.length;
  B.ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'z.zip', datos: crearZip([{ nombre: 'A-101.xml', datos: Buffer.from(X.I1) },
    { nombre: 'A-101.pdf', datos: PDF_BUF }]).toString('base64') }], idSolicitud: 'i1' });
  const opsImp = B.perfil.ops.slice(n0);
  assert(opsImp.some(o => o.tipo === 'urlfetch'), 'privado_ sí se llama (fuera del candado)');
  assert.deepEqual(opsImp.filter(o => o.tipo === 'urlfetch' && o.candado), [], 'importar: sin HTTP dentro del candado');
  assert(opsImp.some(o => o.tipo === 'escribe' && o.candado && /FacturasClientes/.test(o.hoja)), 'la escritura sí va con el candado');
  n0 = B.perfil.ops.length;
  B.ok('tania', 'ligarFacturaCliente', { uuid: UU.I1, proyectoFolio: q, etapas: [{ clave: '1' }] });
  assert.deepEqual(B.perfil.ops.slice(n0).filter(o => o.tipo === 'urlfetch' && o.candado), [], 'ligar: sin HTTP dentro del candado');
  assert(B.perfil.ops.slice(n0).some(o => o.tipo === 'drive' && o.que === 'moveTo' && o.candado), 'mover el archivo (DriveApp) sí');
  // Sin facturas importadas, la vista de cobranza no lee más que la pestaña (y no la crea)
  const C = crear({ perfil: true });
  const q2 = C.ok('ana', 'crearProyecto', { nombre: 'Otro', ubicacion: 'Qro', cliente: UREC, idSolicitud: 'pp' }).folio;
  C.ok('tania', 'listarProyectosCobranza', '');
  assert.equal(C.ok('tania', 'getCobranzaProyecto', q2).facturas, null);
  assert(!C.libros[C.props.COBRANZA_DB_ID].pest.FacturasClientes || C.libros[C.props.COBRANZA_DB_ID].pest.FacturasClientes.m.length <= 1);
}

// ================= 3. Interfaz (mod-facturas + mod-pantallas) =================
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
assert(scripts.some(s => s.id === 'mod-facturas'), 'existe <script id="mod-facturas">');
assert(/<div id="cobModFacturas" class="modulo oculto"><\/div>/.test(html) && /<div id="cobFacturas" class="oculto"><\/div>/.test(html));
function montar(quien) {
  const tok = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + tok({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h),
      prepend: h => e.hijos.unshift(h), contains: () => false, querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')),
      querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: x => { h = x; if (x === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: i => porId[i] || (porId[i] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['tabCob', 'cobModFacturas', 'cobFacturas', 'cobVistaProyecto'].forEach(i => document.getElementById(i).classList.add('oculto')); // como en el HTML
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [], dialogos = { prompt: null, mensajes: [] };
  async function fetch(url, o) { const c = JSON.parse(o.body); llamadas.push(c); return { ok: true, json: async () => A.post(quien, c.funcion, ...c.args) }; }
  class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, x) => almacen[k] = x, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true,
    prompt: m => { dialogos.mensajes.push(String(m)); return dialogos.prompt; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-pantallas', 'mod-facturas'].forEach(n => vm.runInContext(scripts.find(s => s.id === n).src, ctx));
  return { ctx, $: i => document.getElementById(i), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(res2 => setImmediate(res2)); };
(async () => {
  // Facturas nuevas para la interfaz: un ZIP con A-201 (PPD, para P2) y su PDF
  const I201 = cfdi({ uuid: U(201), folio: '201', fecha: '2026-10-20T10:00:00', metodo: 'PPD', subtotal: '300.00', iva: '48.00', total: '348.00' });
  const zipUi = crearZip([{ nombre: 'Octubre/A-201.xml', datos: Buffer.from(I201) }, { nombre: 'Octubre/A-201.pdf', datos: PDF_BUF }]);
  const T = montar('tania');
  await esperar();
  T.run("verTab('cob')"); await esperar();
  assert(T.run('FACTURAS_CLI.estado().lista'), 'la lista llegó con la carga inicial (en caché: Pendientes la calcula)');
  assert(!T.llamadas.some(c => c.funcion === 'listarFacturasClientes'), 'y no se vuelve a pedir');
  assert(!T.$('cobModFacturas').classList.contains('oculto'), 'cobranza ve el bloque');
  assert(/3 · Facturas de clientes \(CFDI\)/.test(T.$('cobModFacturas').innerHTML) && /id="facArchivos" type="file" multiple/.test(T.$('cobModFacturas').innerHTML));
  assert(/XML sin ligar/.test(T.$('facConteos').innerHTML) && /Por atender \(\d+\)/.test(T.$('facFiltros').innerHTML));
  // Subir: sin archivos avisa; con el ZIP, un envío con su base64
  T.run('FACTURAS_CLI.importar()'); await esperar();
  assert(/Elige los XML/.test(T.$('aviso').innerHTML));
  T.$('facArchivos').files = [{ name: 'CONTALINK.zip', type: 'application/zip', size: zipUi.length, b64: zipUi.toString('base64') },
    { name: 'B-7.xml', type: 'text/xml', size: 100, b64: b64(X.I3) }, { name: 'gigante.pdf', type: 'application/pdf', size: 30 * 1024 * 1024, b64: '' }];
  T.run('FACTURAS_CLI.importar()'); await esperar();
  assert(/gigante\.pdf pesa más de 20 MB/.test(T.$('aviso').innerHTML), 'se revisa antes de mandar');
  T.$('facArchivos').files = T.$('facArchivos').files.slice(0, 2);
  T.run('FACTURAS_CLI.importar()'); await esperar(60);
  const imps = T.llamadas.filter(c => c.funcion === 'importarFacturasClientes');
  assert.equal(imps.length, 2, 'el ZIP en su propio envío');
  assert.deepEqual(imps.map(c => c.args[0].archivos.map(a => a.nombre)), [['CONTALINK.zip'], ['B-7.xml']]);
  assert(/^id-.*-1$/.test(imps[0].args[0].idSolicitud) && /-2$/.test(imps[1].args[0].idSolicitud));
  assert(/Importada/.test(T.$('facResultados').innerHTML) && /Ya estaba/.test(T.$('facResultados').innerHTML) && /CONTALINK\.zip › Octubre\/A-201\.xml/.test(T.$('facResultados').innerHTML));
  assert(/Facturas de clientes: 1 importada · 1 PDF · 1 ya estaba/.test(T.$('aviso').innerHTML), T.$('aviso').innerHTML);
  assert.equal(T.$('facArchivos').value, '', 'se limpia el selector');
  assert(/A-201/.test(T.$('facTabla').innerHTML) && /Sin ligar/.test(T.$('facTabla').innerHTML), 'en "Por atender"');
  // Ligar con la sugerencia (por RFC y monto: Encendido de P2, 348)
  const u201 = U(201);
  T.run('FACTURAS_CLI.abrirLiga(' + JSON.stringify(u201) + ')');
  let tb = T.$('facTabla').innerHTML;
  assert(/Ligar Factura A-201/.test(tb) && /Sugerencias/.test(tb) && /mismo RFC del cliente/.test(tb) && /id="facProy-/.test(tb), 'formulario de liga');
  const L0 = plain(T.run('FACTURAS_CLI.estado().liga'));
  assert.deepEqual([L0.proyecto, L0.claves], [p2, ['1']], 'precargado con la sugerencia (cabe en lo que falta del Anticipo)');
  assert(/Sin montos se reparte así: Anticipo \$348\.00 MXN/.test(tb), tb);
  T.run('FACTURAS_CLI.proyecto(' + JSON.stringify(u201) + ',' + JSON.stringify(p1) + ')');
  assert.deepEqual(plain(T.run('FACTURAS_CLI.estado().liga.claves')), ['3'], 'proyecto ya facturado: la última etapa (el servidor dirá que no cabe)');
  T.run('FACTURAS_CLI.sugerencia(' + JSON.stringify(u201) + ',0)');
  T.run('FACTURAS_CLI.ligar(' + JSON.stringify(u201) + ')'); await esperar();
  const lg = T.llamadas.find(c => c.funcion === 'ligarFacturaCliente');
  assert.deepEqual(lg.args, [{ uuid: u201, proyectoFolio: p2, etapas: [{ clave: '1', monto: '' }] }]);
  assert(/Factura A-201 ligada a <b>PRY-\d{4}-\d{4}-TES<\/b> \(Anticipo\)\./.test(T.$('aviso').innerHTML), T.$('aviso').innerHTML);
  assert.deepEqual(JSON.parse(fila(u201)[col('etapas (JSON)')]), [{ clave: '1', etapa: 'Anticipo', monto: 348 }]);
  // Todas · buscar · cancelar (con motivo; sin motivo no llama)
  T.run("FACTURAS_CLI.vista('todas')"); T.run("FACTURAS_CLI.buscar('a-201')");
  assert(/A-201/.test(T.$('facTabla').innerHTML) && !/A-102/.test(T.$('facTabla').innerHTML));
  T.dialogos.prompt = 'no';
  T.run('FACTURAS_CLI.cancelar(' + JSON.stringify(u201) + ')'); await esperar();
  assert(/Escribe el motivo/.test(T.$('aviso').innerHTML) && !T.llamadas.some(c => c.funcion === 'cancelarFacturaCliente'));
  // Vista del proyecto P1: facturas por etapa con REP
  T.run('abrirProyectoCob(' + JSON.stringify(p1) + ')'); await esperar();
  const bloque = T.$('cobFacturas');
  assert(!bloque.classList.contains('oculto') && /Facturas por etapa \(CONTALINK\)/.test(bloque.innerHTML) && /A-102/.test(bloque.innerHTML) && /Anticipo/.test(bloque.innerHTML));
  // Pendientes → la factura sin ligar (se abre su liga)
  const I202 = cfdi({ uuid: U(202), folio: '202', subtotal: '50.00', iva: '8.00', total: '58.00' });
  envio([{ nombre: 'A-202.xml', datos: b64(I202) }]);
  T.run('actualizarPend()'); await esperar();
  assert(/<h3>Cobranza<span class="cuenta">\d+<\/span><\/h3>/.test(T.$('pendLista').innerHTML) && /XML sin ligar/.test(T.$('pendLista').innerHTML), T.$('pendLista').innerHTML.slice(0, 300));
  T.run('irPendiente(PEND_VISTOS.findIndex(x => x.tipo === "facSinLigar" && x.req === ' + JSON.stringify(U(202)) + '))'); await esperar();
  assert.equal(T.run('TAB'), 'cob');
  assert.equal(T.run('FACTURAS_CLI.estado().abierta'), U(202), 'abre la liga de esa factura');
  assert(/Ligar Factura A-202/.test(T.$('facTabla').innerHTML));
  // Sin proyecto desde la interfaz
  T.run('FACTURAS_CLI.motivo(' + JSON.stringify(U(202)) + ', "Refacturación de otra empresa")');
  T.run('FACTURAS_CLI.sinProyecto(' + JSON.stringify(U(202)) + ')'); await esperar();
  assert.equal(fila(U(202))[col('sin_proyecto')], 'Refacturación de otra empresa');
  assert.equal(T.run('FACTURAS_CLI.estado().abierta'), '');
  // Contexto de la sincronización
  assert.equal(plain(T.run('contextoSync()')).facturasCli, true);

  // ---- Otros roles: nada de facturas de clientes ----
  for (const q of ['ana', 'pedro', 'obrero']) {
    const O = montar(q);
    await esperar();
    O.run("verTab('cob')"); await esperar();
    assert(O.$('cobModFacturas').classList.contains('oculto'), q + ': sin bloque');
    assert(!O.llamadas.some(c => /Facturas?Clientes?|FacturaCliente/.test(c.funcion)), q + ': no pide nada');
    assert(!/Cobranza<span/.test(O.$('pendLista').innerHTML), q + ': sin sección Cobranza en Pendientes');
    assert.equal(plain(O.run('contextoSync()')).facturasCli, undefined);
  }
  console.log('OK facturas de clientes (CFDI fase A: parser, ZIP, importar, ligar, REP pendiente, vista, pendientes, cancelar, permisos, interfaz)');
})().catch(e => { console.error(e); process.exit(1); });
