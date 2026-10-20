// Cobranza (fase 2): cotización aceptada, esquema de pagos, contrato firmado, desbloqueo, pagos con comprobante,
// monedas y permisos (ROL_COBRANZA validado en el servidor). Todo por doPost con tokens simulados.
// Uso: node tests/cobranza.test.js .   (carpeta con Code.js y Logo.js)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];
let src=fs.readFileSync(path.join(dir,'Logo.js'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'Code.js'),'utf8');
const CID='123-abc.apps.googleusercontent.com';
src=src.replace(/const CLIENT_ID_GOOGLE = '[^']*';/,"const CLIENT_ID_GOOGLE = '"+CID+"';");
const ANIO=String(new Date().getFullYear());
const pad=n=>String(n).padStart(2,'0');
const HOY=new Date(), HOY_ISO=HOY.getFullYear()+'-'+pad(HOY.getMonth()+1)+'-'+pad(HOY.getDate());

// ---- Hojas y libros simulados ----
function hoja(m){const h={m,getLastRow:()=>m.length,getMaxRows:()=>1000,setFrozenRows(){},setColumnWidth(){},
 getDataRange:()=>({getValues:()=>m.map(r=>r.slice()),getDisplayValues:()=>m.map(r=>r.map(x=>x instanceof Date?'20/10/2026':String(x??'')))}),
 appendRow:a=>m.push(a),deleteRow:n=>m.splice(n-1,1),
 getRange:(r,c=1,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this},setDataValidation(){return this}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>{const f=(m[r-1+i]||[]).slice(c-1,c-1+nc);while(f.length<nc)f.push('');return f}),
  setValue(v){m[r-1][c-1]=v;return this},
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setNumberFormat(){return this},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}})};
 return h}
const libros={};
function libro(id,nombre,pestanas){const L={id,nombre,pest:pestanas||{},getId:()=>id,getUrl:()=>'https://sheets/'+id,
 getSheetByName:n=>L.pest[n]||null,getSheets:()=>Object.values(L.pest),
 insertSheet:n=>{if(L.pest[n])throw new Error('ya existe');return L.pest[n]=hoja([])},
 deleteSheet:h=>{for(const k in L.pest)if(L.pest[k]===h)delete L.pest[k]}};
 libros[id]=L;return L}

// ---- Drive simulado ----
let nId=0; const carpetas={}, archivos={};
function carpeta(nombre,padre){const f={id:'F'+(++nId),nombre,padre,hijos:[],archivos:[],trashed:false,
 getId:()=>f.id,getName:()=>f.nombre,getUrl:()=>'https://drive/'+f.id,isTrashed:()=>f.trashed,
 getFoldersByName:n=>{const l=f.hijos.filter(h=>h.nombre===n);let i=0;return{hasNext:()=>i<l.length,next:()=>l[i++]}},
 createFolder:n=>{const h=carpeta(n,f);f.hijos.push(h);return h},
 createFile:b=>{const id='A'+(++nId);const a={id,blob:b,padre:f};archivos[id]=a;f.archivos.push(a);return{getId:()=>id,getUrl:()=>'https://drive/file/'+id}}};
 carpetas[f.id]=f;return f}
const miUnidad=carpeta('Mi unidad',null), maestra=miUnidad.createFolder('Cotizador Helgen'), pdfRaiz=maestra.createFolder('Cotizaciones Helgen (PDF)');
const ruta=f=>f.padre?ruta(f.padre)+'/'+f.nombre:f.nombre;
archivos.DB={id:'DB',padre:maestra};

const db=libro('DB','Base de datos',{Config:hoja([['Clave','Valor'],['PREFIJO_FOLIO','HLG'],['IVA_TASA',0.16]]),Cotizaciones:hoja([])});
libro('CAT','Catálogo',{Catalogo:hoja([['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó','Clave SAT','Unidad SAT']])});
const props={SPREADSHEET_ID:'DB',FOLDER_ID:pdfRaiz.id,CATALOGO_ID:'CAT',
  ROL_COBRANZA:'efrain@helgen.tech, Tania@helgen.tech; leo@helgen.tech, intruso@gmail.com',ADMIN_DESBLOQUEO:'efrain@helgen.tech'},cache={};

// ---- Tokens: efrain (cobranza + admin), tania (cobranza), ana (vendedora sin rol) ----
const ahora=Math.floor(Date.now()/1000);
const claims=(email,n,a)=>({aud:CID,iss:'https://accounts.google.com',exp:String(ahora+3000),email,email_verified:'true',hd:'helgen.tech',given_name:n,family_name:a});
const tokens={efrain:claims('efrain@helgen.tech','Efrain','Sosa'),tania:claims('tania@helgen.tech','Tania','R'),
  ana:claims('ana@helgen.tech','Ana','López'),intruso:{...claims('intruso@gmail.com','X','Y'),hd:undefined}};

const fmt=(d,tz,f)=>f.replace('yyyy',d.getFullYear()).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate()))
  .replace('HH',pad(d.getHours())).replace('mm',pad(d.getMinutes())).replace('ss',pad(d.getSeconds()));
const firmados=b=>[...b].map(x=>x>127?x-256:x); // Apps Script entrega bytes con signo
const ctx={console:{...console,warn(){}},Date,JSON,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>''})},
 Logger:{log(){}},
 Utilities:{formatDate:fmt,newBlob:(a,b,c)=>typeof a==='string'?{getAs:()=>({setName:n=>({name:n,html:a})})}:{bytes:a,mime:b,name:c},
  base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>firmados(Buffer.from(s,'base64')),
  DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,s)=>[...require('crypto').createHash('sha256').update(s).digest()]},
 UrlFetchApp:{fetch:url=>{const t=decodeURIComponent(url.split('id_token=')[1]);const c=tokens[t];
  return{getResponseCode:()=>c?200:400,getContentText:()=>JSON.stringify(c||{error:'invalid_token'})}}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({t,setMimeType(){return this}})},
 SpreadsheetApp:{flush(){},openById:id=>{if(!libros[id])throw new Error('No encontrado');return libros[id]},
  create:n=>{const L=libro('S'+(++nId),n,{'Hoja 1':hoja([])});archivos[L.id]={id:L.id,padre:miUnidad};return L},
  newDataValidation:()=>{const b={requireValueInList:()=>b,setAllowInvalid:()=>b,setHelpText:()=>b,build:()=>({})};return b}},
 DriveApp:{getFolderById:id=>{if(!carpetas[id])throw new Error('No se encontró');return carpetas[id]},
  createFolder:n=>miUnidad.createFolder(n),getRootFolder:()=>miUnidad,
  getFileById:id=>({getParents:()=>{let d=false;return{hasNext:()=>!d,next:()=>{d=true;return archivos[id].padre}}},
   moveTo:f=>{archivos[id].padre=f}})},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
const post=(quien,funcion,...args)=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({funcion,args,token:quien})}}).t);
const ok=(quien,funcion,...args)=>{const r=post(quien,funcion,...args);assert(r.ok,funcion+': '+r.error);return r.datos};
const falla=(quien,funcion,args,re,codigo)=>{const r=post(quien,funcion,...args);assert.equal(r.ok,false,funcion+' debía fallar');
  assert(re.test(r.error),funcion+': '+r.error);if(codigo)assert.equal(r.codigo,codigo,funcion+' codigo');return r};

// ================= Lógica pura =================
const P=ctx;
// Esquema
assert.deepEqual(P.esquemaPorOmision().map(e=>e.etapa+' '+e.porcentaje),['Anticipo 60','Instalación 30','Encendido del sistema 10']);
assert.deepEqual(P.validarEsquema([{etapa:' Anticipo ',porcentaje:'33.33'},{etapa:'Fin',porcentaje:66.67}]).map(e=>e.etapa+e.porcentaje),['Anticipo33.33','Fin66.67']);
for(const [mal,re] of [[[],/al menos una/],[[{etapa:'A',porcentaje:99}],/suman 99%/],[[{etapa:'',porcentaje:100}],/no tiene nombre/],
  [[{etapa:'A',porcentaje:50},{etapa:'a',porcentaje:50}],/repetida/],[[{etapa:'A',porcentaje:100},{etapa:'B',porcentaje:0}],/mayor a 0/],
  [[{etapa:'A',porcentaje:-10},{etapa:'B',porcentaje:110}],/mayor a 0/],[[{etapa:'A',porcentaje:33.333},{etapa:'B',porcentaje:66.667}],/2 decimales/],
  [Array.from({length:11},(_,i)=>({etapa:'E'+i,porcentaje:i?9:10})),/máximo 10/]]){
  assert.throws(()=>P.validarEsquema(mal),re,JSON.stringify(mal));
}
// Montos: la última etapa absorbe los centavos
assert.deepEqual(P.montosDeEsquema(P.esquemaPorOmision(),1000.01).map(e=>e.monto),[600.01,300,100]);
assert.deepEqual(P.montosDeEsquema([{etapa:'A',porcentaje:33.33},{etapa:'B',porcentaje:33.33},{etapa:'C',porcentaje:33.34}],100).map(e=>e.monto),[33.33,33.33,33.34]);
// Monedas
assert.equal(P.convertirMoneda(18500,'MXN','USD',18.5),1000); assert.equal(P.convertirMoneda(100,'USD','MXN',18.25),1825);
assert.equal(P.convertirMoneda(99.999,'MXN','MXN'),100); assert.throws(()=>P.convertirMoneda(1,'MXN','USD',''),/tipo de cambio/);
// Reparto: excedente a la siguiente; al final, a las anteriores
const E=[{monto:600,pagado:0},{monto:300,pagado:0},{monto:100,pagado:0}];
assert.deepEqual(P.repartirPago(E,0,700).aplicacion.map(a=>[a.orden,a.centavos]),[[1,60000],[2,10000]]);
assert.deepEqual(P.repartirPago(E,2,250).aplicacion.map(a=>[a.orden,a.centavos]),[[3,10000],[1,15000]]);
assert.equal(P.repartirPago(E,0,1000.5).sobranteCts,50);
// Resumen
const R=P.resumenCobranza({total:1000,subtotal:862.07,moneda:'MXN'},P.esquemaPorOmision(),
  [{estado:'Vigente',etapaOrden:1,montoAplicado:700},{estado:'Cancelado',etapaOrden:1,montoAplicado:300},{estado:'Vigente',etapaOrden:2,montoAplicado:250}]);
assert.deepEqual([R.contratado,R.pagado,R.saldo,R.avance],[1000,950,50,95]);
assert.deepEqual(R.etapas.map(e=>[e.pagado,e.saldo,e.avance]),[[600,0,100],[300,0,100],[50,50,50]]);
// Pago
const PR={moneda:'MXN',etapas:3,hoy:'2026-10-20'};
const pg=P.normalizarPago({fecha:'2026-10-19',monto:'1500.5',metodo:'transferencia',referencia:' ABC  123 ',etapaOrden:1},PR);
assert.deepEqual([pg.metodo,pg.referencia,pg.montoAplicado,pg.tipoCambio,pg.monedaPago],['Transferencia','ABC 123',1500.5,'','MXN']);
assert.equal(P.normalizarPago({fecha:'2026-10-19',monto:10,metodo:'Efectivo',etapaOrden:3},PR).referencia,'','efectivo sin referencia');
for(const [mal,re] of [[{fecha:'2026-10-21'},/futura/],[{fecha:'2026-02-30'},/no es válida/],[{fecha:''},/obligatoria/],[{monto:0},/mayor a 0/],
  [{monto:1.234},/2 decimales/],[{metodo:'Tarjeta'},/método/],[{referencia:''},/referencia/],[{metodo:'Cheque',referencia:''},/número de cheque/],
  [{etapaOrden:4},/etapa/],[{monedaPago:'USD'},/tipo de cambio/],[{monedaPago:'EUR'},/no válida/]]){
  assert.throws(()=>P.normalizarPago({fecha:'2026-10-19',monto:100,metodo:'Transferencia',referencia:'R',etapaOrden:1,...mal},PR),re,JSON.stringify(mal));
}
assert.equal(P.normalizarPago({fecha:'2026-10-19',monto:18500,monedaPago:'MXN',tipoCambio:'18.5',metodo:'Efectivo',etapaOrden:1},{...PR,moneda:'USD'}).montoAplicado,1000);
// Comprobante: por contenido, no por extensión
const PDF=Buffer.from('%PDF-1.7\n...'), JPG=Buffer.from([0xFF,0xD8,0xFF,0xE0,1,2]), PNG=Buffer.from([0x89,0x50,0x4E,0x47,13,10]),
  HEIC=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypheic')]), EXE=Buffer.from('MZ\x90\x00');
assert.equal(P.validarComprobante(firmados(PDF)).mime,'application/pdf'); assert.equal(P.validarComprobante(firmados(JPG)).ext,'jpg');
assert.equal(P.validarComprobante(firmados(PNG)).ext,'png'); assert.equal(P.validarComprobante(firmados(HEIC)).mime,'image/heic');
assert.throws(()=>P.validarComprobante(firmados(EXE)),/PDF o imagen/); assert.throws(()=>P.validarComprobante(null),/Adjunta/);
assert.throws(()=>P.validarComprobante({length:10*1024*1024+1}),/10 MB/);
assert.deepEqual([...P.correosDeLista('A@helgen.tech; b@helgen.tech,,a@helgen.tech x@gmail.com','helgen.tech')],['a@helgen.tech','b@helgen.tech']);
assert.equal(P.nombreComprobante('PAG-2026-0001','Transferencia','SPEI/123:"x"','pdf'),'PAG-2026-0001 — Transferencia SPEI 123 x.pdf');

// ================= Servidor (doPost) =================
// Proyectos y cotizaciones (los crea una vendedora)
const p1=ok('ana','crearProyecto',{nombre:'Techo solar',cliente:{nombre:'Luis',empresa:'Solar MX'},idSolicitud:'p1'}).folio;
const p2=ok('ana','crearProyecto',{nombre:'Planta Texas',cliente:{nombre:'Solar Corp'},idSolicitud:'p2'}).folio;
assert.equal(p1,'PRY-'+ANIO+'-0001');
const cot=(proyectoFolio,precio,extra)=>ok('ana','guardarCotizacion',{cliente:{nombre:'Luis',empresa:'Solar MX'},
  items:[{descripcion:'Servicio',cantidad:1,precio}],proyectoFolio,idSolicitud:'c'+(++nId),...extra}).folio;
const cH=cot(p1,1000);                               // Helgen MXN: total 1160
const cE=cot(p1,2000,{marca:'energy'});              // Energy MXN: total 2320
const cU=cot(p1,500,{moneda:'USD'});                 // USD en el mismo proyecto
const cBarata=cot(p1,100);                           // 116
const cE2=cot(p1,1000,{marca:'energy'});             // otra de Energy: total 1160
const cOtro=cot(p2,862.07,{moneda:'USD'});           // Proyecto USD: total 1000.00
const sinProy=cot('',50);

// --- Usuario sin rol (vendedora): no ve la pestaña ni recibe datos; el servidor rechaza todo con PERMISO ---
const dAna=ok('ana','getDatosIniciales');
assert.deepEqual({...dAna.permisos},{cobranza:false,desbloqueo:false});
assert(!/contrato|pagos|saldo/i.test(JSON.stringify(dAna)),'datos iniciales sin cobranza');
const COB=[['listarProyectosCobranza',['']],['getCobranzaProyecto',[p1]],['marcarAceptada',[p1,cH]],['guardarEsquema',[p1,P.esquemaPorOmision()]],
  ['firmarContrato',[p1,HOY_ISO]],['desbloquearContrato',[p1,'motivo largo']],['registrarPago',[{proyectoFolio:p1}]],['cancelarPago',['PAG-'+ANIO+'-0001','motivo']]];
for(const [f,args] of COB) falla('ana',f,args,/No tienes permiso de cobranza/,'PERMISO');
assert.equal(props.COBRANZA_DB_ID,undefined,'una llamada sin rol no crea nada');
for(const [f,args] of COB) falla('intruso',f,args,/@helgen.tech/,'SESION');
assert.throws(()=>ctx.getCobranzaProyecto(p1),/Inicia sesión/,'desde el editor (sin token) tampoco');

// --- Tania (rol de cobranza, sin desbloqueo) ---
assert.deepEqual({...ok('tania','getDatosIniciales').permisos},{cobranza:true,desbloqueo:false});
assert.deepEqual({...ok('efrain','getDatosIniciales').permisos},{cobranza:true,desbloqueo:true});
const lista=ok('tania','listarProyectosCobranza','');
assert.deepEqual(lista.map(p=>p.folio+':'+p.contrato),[p2+':',p1+':']);
// Carpeta y libro: fuera de "Cotizador Helgen", libro dentro de la carpeta de cobranza
const carpCob=carpetas[props.COBRANZA_FOLDER_ID];
assert.equal(ruta(carpCob),'Mi unidad/Cotizador Helgen — Cobranza');
const LC=libros[props.COBRANZA_DB_ID];
assert.equal(LC.nombre,'Cotizador Helgen — Cobranza (datos)'); assert.equal(archivos[LC.id].padre,carpCob);
assert.deepEqual(Object.keys(LC.pest).sort(),['Bitacora','Contratos','Esquemas','Pagos']);
const H=n=>LC.pest[n].m, bit=()=>H('Bitacora').slice(1);

let v=ok('tania','getCobranzaProyecto',p1.toLowerCase());
assert.equal(v.contrato,null); assert.deepEqual(v.cotizaciones.map(c=>c.folio),[cH,cE,cU,cBarata,cE2]);
assert.deepEqual(v.cotizaciones.map(c=>c.moneda+'/'+c.marca),['MXN/helgen','MXN/energy','USD/helgen','MXN/helgen','MXN/energy']);
assert.equal(v.puedePagar,false);
falla('tania','firmarContrato',[p1,HOY_ISO],/Primero marca la cotización aceptada/);
falla('tania','guardarEsquema',[p1,P.esquemaPorOmision()],/Primero marca/);
falla('tania','registrarPago',[{proyectoFolio:p1,comprobante:{datos:PDF.toString('base64')}}],/contrato firmado/);
falla('tania','marcarAceptada',[p1,cOtro],/no pertenece al proyecto/);

// Aceptada Helgen: esquema sugerido 60/30/10 sobre el total CON IVA
v=ok('tania','marcarAceptada',p1,cH);
assert.deepEqual([v.contrato.cotizacion,v.contrato.total,v.contrato.subtotal,v.contrato.moneda,v.contrato.estado],[cH,1160,1000,'MXN','Aceptada']);
assert.deepEqual(v.resumen.etapas.map(e=>e.monto),[696,348,116]); assert.equal(v.esquemaEditable,true);
assert.equal(H('Contratos').length,2); assert.equal(H('Contratos')[1][8],'tania@helgen.tech');
// Helgen: esquema editable (nombres, % y número de etapas)
v=ok('tania','guardarEsquema',p1,[{etapa:'Anticipo',porcentaje:50},{etapa:'Entrega',porcentaje:25},{etapa:'Cierre',porcentaje:20},{etapa:'Garantía',porcentaje:5}]);
assert.deepEqual(v.resumen.etapas.map(e=>e.etapa+':'+e.monto),['Anticipo:580','Entrega:290','Cierre:232','Garantía:58']);
assert.equal(H('Esquemas').length,5,'4 etapas, sin duplicar');
falla('tania','guardarEsquema',[p1,[{etapa:'A',porcentaje:50},{etapa:'B',porcentaje:49}]],/suman 99%/);
// Cambiar a Energy: pide confirmar porque reemplaza el esquema; sin confirmar no cambia nada
v=ok('tania','marcarAceptada',p1,cE);
assert.equal(v.confirmar,true); assert(/60% Anticipo/.test(v.mensaje));
assert.equal(H('Contratos')[1][1],cH,'sin confirmar no cambia');
v=ok('tania','marcarAceptada',p1,cE,true);
assert.deepEqual([v.contrato.cotizacion,v.contrato.marca,v.contrato.total],[cE,'energy',2320]);
assert.deepEqual(v.resumen.etapas.map(e=>e.etapa+':'+e.monto),['Anticipo:1392','Instalación:696','Encendido del sistema:232']);
assert.deepEqual([v.esquemaEditable,v.esquemaPideMotivo],[false,false],'Tania no edita el de Energy');
// Esquema de Energy: solo el administrador y con motivo (queda en la Bitacora)
falla('tania','guardarEsquema',[p1,[{etapa:'A',porcentaje:100}],'el cliente lo pidió'],/solo lo puede cambiar el administrador/,'PERMISO');
v=ok('efrain','getCobranzaProyecto',p1); assert.deepEqual([v.esquemaEditable,v.esquemaPideMotivo],[true,true]);
falla('efrain','guardarEsquema',[p1,[{etapa:'Anticipo',porcentaje:50},{etapa:'Cierre',porcentaje:50}]],/motivo del cambio/);
falla('efrain','guardarEsquema',[p1,[{etapa:'Anticipo',porcentaje:50},{etapa:'Cierre',porcentaje:40}],'negociado'],/suman 90%/);
v=ok('efrain','guardarEsquema',p1,[{etapa:'Anticipo',porcentaje:50},{etapa:'Cierre',porcentaje:50}],'El cliente negoció 50% de anticipo');
assert.deepEqual(v.resumen.etapas.map(e=>e.etapa+':'+e.monto),['Anticipo:1160','Cierre:1160']);
const be=bit().filter(b=>b[2]==='Editar esquema de pagos (Helgen Energy)').pop();
assert.deepEqual([be[1],be[5]],['efrain@helgen.tech','El cliente negoció 50% de anticipo']);
assert(/Anticipo 50% · Cierre 50% \(antes Anticipo 60% · Instalación 30% · Encendido del sistema 10%\)/.test(be[4]));
// Otra cotización de Energy: conserva el esquema que puso el administrador (sin pedir confirmación)
v=ok('tania','marcarAceptada',p1,cE2);
assert.equal(v.confirmar,undefined); assert.deepEqual(v.resumen.etapas.map(e=>e.monto),[580,580]);
// De regreso a Helgen: conserva el esquema (ahora editable por cobranza), sin pedir confirmación
v=ok('tania','marcarAceptada',p1,cH);
assert.equal(v.confirmar,undefined); assert.deepEqual(v.resumen.etapas.map(e=>e.monto),[580,580]);
assert.deepEqual([v.esquemaEditable,v.esquemaPideMotivo],[true,false]);
v=ok('tania','guardarEsquema',p1,P.esquemaPorOmision());
assert.deepEqual(v.resumen.etapas.map(e=>e.monto),[696,348,116]);
assert.equal(bit().pop()[5],'','en Helgen el cambio no pide motivo');
assert.equal(H('Contratos').length,2,'una sola aceptada por proyecto');

// Firma: fecha obligatoria y no futura
falla('tania','firmarContrato',[p1,'2099-01-01'],/no puede ser futura/);
falla('tania','firmarContrato',[p1,''],/obligatoria/);
v=ok('tania','firmarContrato',p1,HOY_ISO);
assert.deepEqual([v.contrato.estado,v.contrato.fechaFirma,v.contrato.firmadoPor],['Firmado',HOY_ISO,'tania@helgen.tech']);
assert.equal(v.puedePagar,true); assert.equal(v.esquemaEditable,false); assert.equal(v.puedeDesbloquear,false,'Tania no desbloquea');
falla('tania','firmarContrato',[p1,HOY_ISO],/ya está firmado/);
falla('tania','marcarAceptada',[p1,cBarata],/Contrato firmado/);
falla('tania','guardarEsquema',[p1,P.esquemaPorOmision()],/Contrato firmado/);

// Regla: un proyecto con contrato firmado no admite cotizaciones nuevas y sale del buscador de cotizaciones
const nCot=db.pest.Cotizaciones.m.length, consec=props['CONSECUTIVO_'+ANIO];
falla('ana','guardarCotizacion',[{cliente:{nombre:'Luis'},items:[{descripcion:'X',cantidad:1,precio:1}],proyectoFolio:p1,idSolicitud:'firm'}],
  /^Proyecto con contrato firmado: no admite cotizaciones nuevas/,'PROYECTO');
assert.equal(db.pest.Cotizaciones.m.length,nCot); assert.equal(props['CONSECUTIVO_'+ANIO],consec,'no gasta folio');
assert.deepEqual(ok('ana','listarProyectos','',false).map(p=>p.folio),[p2],'buscador de cotizaciones sin el firmado');
assert.deepEqual(ok('ana','getDatosIniciales').proyectos.map(p=>p.folio),[p2]);
assert.deepEqual(ok('ana','listarProyectos','',true).map(p=>p.folio),[p2,p1]);
assert.equal(ok('tania','listarProyectosCobranza','').find(p=>p.folio===p1).contrato,'Firmado');

// --- Pagos ---
const pago=(extra)=>({proyectoFolio:p1,fecha:HOY_ISO,monto:800,metodo:'Transferencia',referencia:'SPEI 123',etapaOrden:1,
  comprobante:{datos:PDF.toString('base64')},idSolicitud:'g'+(++nId),...extra});
falla('tania','registrarPago',[pago({comprobante:null})],/Adjunta el comprobante/);
falla('tania','registrarPago',[pago({comprobante:{datos:EXE.toString('base64')}})],/PDF o imagen/);
falla('tania','registrarPago',[pago({metodo:'Tarjeta'})],/método/);
let r=ok('tania','registrarPago',pago({idSolicitud:'pag1'}));
assert.equal(r.folio,'PAG-'+ANIO+'-0001');
// 800 sobre Anticipo de 696: el excedente (104) pasa a Instalación
assert.deepEqual(r.vista.resumen.etapas.map(e=>[e.pagado,e.saldo]),[[696,0],[104,244],[0,116]]);
assert.deepEqual([r.vista.resumen.pagado,r.vista.resumen.saldo],[800,360]);
const fp=H('Pagos')[1];
assert.deepEqual([fp[0],fp[1],fp[3],fp[4],fp[5],fp[7],fp[8],fp[9],fp[10],fp[11],fp[12],fp[16],fp[18]],
  [r.folio,HOY_ISO,p1,800,'MXN',800,'MXN','Transferencia','SPEI 123',1,'Anticipo','tania@helgen.tech','Vigente']);
assert.deepEqual(JSON.parse(fp[13]).map(a=>a.etapa+':'+a.monto),['Anticipo:696','Instalación:104']);
// Comprobante en Cotizador Helgen — Cobranza/AAAA/<folio del proyecto>/, ligado al folio
const comp=archivos[fp[14]];
assert.equal(ruta(comp.padre),'Mi unidad/Cotizador Helgen — Cobranza/'+ANIO+'/'+p1);
assert.equal(comp.blob.name,r.folio+' — Transferencia SPEI 123.pdf'); assert.equal(comp.blob.mime,'application/pdf');
assert.deepEqual(Buffer.from(comp.blob.bytes),PDF); assert.equal(fp[15],r.url);
assert(!Object.values(carpetas).some(f=>f.nombre==='Pagos')&&vivos(maestra).every(f=>!/Cobranza/.test(f.nombre)),'nada de cobranza en la carpeta maestra');
function vivos(f){return f.hijos.filter(h=>!h.trashed)}
// Idempotencia: el mismo envío devuelve el mismo folio sin duplicar
assert.equal(ok('tania','registrarPago',pago({idSolicitud:'pag1'})).folio,r.folio); assert.equal(H('Pagos').length,2);
// Excede el saldo (360) por más de la tolerancia (1.00): rechazado; dentro de la tolerancia: aceptado
falla('tania','registrarPago',[pago({monto:361.01})],/excede el saldo del proyecto \(\$360\.00 MXN\)/);
assert.equal(props['CONSECUTIVO_PAG_'+ANIO],'1','el rechazo no gasta folio');
r=ok('tania','registrarPago',pago({monto:360.5,etapaOrden:3,metodo:'Efectivo',referencia:'',
  comprobante:{datos:JPG.toString('base64')}}));
assert.equal(r.folio,'PAG-'+ANIO+'-0002'); assert.deepEqual([r.vista.resumen.pagado,r.vista.resumen.saldo],[1160.5,-0.5]);
assert.equal(archivos[H('Pagos')[2][14]].blob.name,r.folio+' — Efectivo.jpg');
// Cancelar: motivo obligatorio; nunca se borra
falla('tania','cancelarPago',[r.folio,''],/motivo/);
v=ok('tania','cancelarPago',r.folio,'Se capturó dos veces');
assert.deepEqual([v.resumen.pagado,v.resumen.saldo],[800,360]);
assert.deepEqual(H('Pagos')[2].slice(18,22).map((x,i)=>i===2?!!x:x),['Cancelado','tania@helgen.tech',true,'Se capturó dos veces']);
assert.equal(H('Pagos').length,3,'el pago cancelado sigue en la hoja');
falla('tania','cancelarPago',[r.folio,'otra vez'],/ya está cancelado/);
assert.equal(v.pagos[0].estado,'Cancelado','los pagos se listan del más reciente al más antiguo');

// --- Desbloqueo: solo el administrador y con motivo ---
falla('tania','desbloquearContrato',[p1,'error de captura'],/Solo el administrador/,'PERMISO');
falla('efrain','desbloquearContrato',[p1,''],/motivo/);
v=ok('efrain','desbloquearContrato',p1,'Se firmó con la cotización equivocada');
assert.deepEqual([v.contrato.estado,v.contrato.fechaFirma],['Aceptada','']); assert.equal(v.pagos.length,2,'los pagos se conservan');
const ub=bit().find(b=>b[2]==='Desbloquear contrato');
assert.deepEqual([ub[1],ub[3],ub[5]],['efrain@helgen.tech',p1,'Se firmó con la cotización equivocada']);
assert(ub[4].includes('tania@helgen.tech')&&ub[4].includes(HOY_ISO)&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(ub[0]),'quién, cuándo y qué estaba');
falla('tania','registrarPago',[pago()],/contrato firmado/,undefined);
// Con pagos en MXN no se puede aceptar una cotización en USD (nunca mezclar monedas)
falla('tania','marcarAceptada',[p1,cU],/pagos en MXN/);
// Aceptada más barata que lo pagado: se puede marcar, pero no firmar
ok('tania','marcarAceptada',p1,cBarata);
falla('tania','firmarContrato',[p1,HOY_ISO],/supera el monto contratado/);
ok('tania','marcarAceptada',p1,cH); ok('tania','firmarContrato',p1,HOY_ISO);
assert.equal(ok('ana','listarProyectos','',false).length,1);
// Bitácora completa, con quién y qué
const acciones=bit().map(b=>b[2]);
for(const a of ['Marcar cotización aceptada','Editar esquema de pagos','Cambiar cotización aceptada','Contrato firmado','Registrar pago','Cancelar pago','Desbloquear contrato'])
  assert(acciones.includes(a),'bitácora: '+a);
assert(bit().every(b=>/@helgen\.tech$/.test(b[1])));

// --- Proyecto en USD pagado en MXN: tipo de cambio obligatorio, saldo en USD ---
v=ok('efrain','marcarAceptada',p2,cOtro); assert.deepEqual([v.contrato.moneda,v.contrato.total],['USD',1000]);
ok('efrain','firmarContrato',p2,HOY_ISO);
falla('efrain','registrarPago',[pago({proyectoFolio:p2,monedaPago:'MXN',monto:18500})],/tipo de cambio/);
r=ok('efrain','registrarPago',pago({proyectoFolio:p2,monedaPago:'MXN',monto:18500,tipoCambio:18.5,comprobante:{datos:PNG.toString('base64')}}));
const fu=H('Pagos').find(x=>x[0]===r.folio);
assert.deepEqual([fu[4],fu[5],fu[6],fu[7],fu[8]],[18500,'MXN',18.5,1000,'USD']);
assert.deepEqual([r.vista.resumen.moneda,r.vista.resumen.pagado,r.vista.resumen.saldo],['USD',1000,0]);
falla('efrain','registrarPago',[pago({proyectoFolio:p2,monto:1.01,monedaPago:'USD'})],/excede el saldo/);
assert.equal(ruta(archivos[fu[14]].padre),'Mi unidad/Cotizador Helgen — Cobranza/'+ANIO+'/'+p2);
// Los datos de cobranza nunca van en la Base de datos (todo el dominio la puede leer)
assert.deepEqual(Object.keys(db.pest).sort(),['Config','Cotizaciones','Proyectos']);
assert(!JSON.stringify(db.pest).includes('PAG-'));
console.log('OK cobranza');
