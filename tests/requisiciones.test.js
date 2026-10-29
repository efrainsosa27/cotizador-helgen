// Requisiciones de materiales y pago a proveedores: el solicitante (ROL_REQUISICION / SOLO_REQUISICION) solo ve las suyas y
// nunca montos, cliente, margen, pagos ni órdenes; compras (ROL_COMPRAS) autoriza (genera la OC), rechaza, devuelve, paga y
// puede cerrar con motivo. Estados válidos e inválidos, folios REQ/PGP, conversión a OC, pago (comprobante, monto = total de la
// OC, tipo de cambio), cancelar el pago y cierre. Todo por doPost con tokens simulados (mismos simulacros que compras.test.js).
// Uso: node tests/requisiciones.test.js .   (carpeta con Code.js y Logo.js)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];
let src=fs.readFileSync(path.join(dir,'Logo.js'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'Code.js'),'utf8');
const CID='123-abc.apps.googleusercontent.com';
src=src.replace(/const CLIENT_ID_GOOGLE = '[^']*';/,"const CLIENT_ID_GOOGLE = '"+CID+"';");
const ANIO=String(new Date().getFullYear());
const pad=n=>String(n).padStart(2,'0');
const HOY=new Date(), HOY_ISO=HOY.getFullYear()+'-'+pad(HOY.getMonth()+1)+'-'+pad(HOY.getDate());

// ---- Hojas y libros simulados ----
// Como Sheets: un texto que parece fecha ("2026-10-20", "2026-10-20 17:30") se guarda como fecha; con apóstrofo
// inicial se guarda como texto (y getValues lo devuelve sin el apóstrofo).
const comoSheets=v=>{if(typeof v!=='string')return v;if(v[0]==="'")return v.slice(1);
  const x=v.match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d)(?::(\d\d))?)?$/);
  return x?new Date(+x[1],+x[2]-1,+x[3],+(x[4]||0),+(x[5]||0),+(x[6]||0)):v};
function hoja(m){const h={m,getLastRow:()=>m.length,getMaxRows:()=>1000,setFrozenRows(){},setColumnWidth(){},
 getDataRange:()=>({getValues:()=>m.map(r=>r.slice()),getDisplayValues:()=>m.map(r=>r.map(x=>x instanceof Date?'20/10/2026':String(x??'')))}),
 appendRow:a=>m.push(a.map(comoSheets)),deleteRow:n=>m.splice(n-1,1),
 getRange:(r,c=1,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this},setDataValidation(){return this}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>{const f=(m[r-1+i]||[]).slice(c-1,c-1+nc);while(f.length<nc)f.push('');return f}),
  setValue(v){m[r-1][c-1]=comoSheets(v);return this},
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=comoSheets(y))});return this},
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
// Como Workspace de helgen.tech: todo lo nuevo nace compartido con el dominio (acceso 'DOMAIN')
// DriveApp.setSharing da "Access denied" en helgen.tech: el código usa la API de Drive (permissions) con el token del script
const compartible=o=>Object.assign(o,{acceso:'DOMAIN',setSharing:()=>{throw new Error('Access denied: DriveApp.')}});
function apiDrive(url,op){const m=url.match(/drive\/v3\/files\/([^/?]+)\/permissions(?:\/([^?]+))?/);
 const it=carpetas[decodeURIComponent(m[1])]||archivos[decodeURIComponent(m[1])];
 assert(op&&op.headers&&op.headers.Authorization==='Bearer TOKEN-SCRIPT','API de Drive con el token del script');
 const resp=(c,b)=>({getResponseCode:()=>c,getContentText:()=>JSON.stringify(b||{})});
 if(!it)return resp(404);
 // Como Drive: el acceso del dominio se hereda de las carpetas y no se puede quitar en el hijo mientras el padre lo tenga
 let heredado=false;for(let f=it.padre;f;f=f.padre)if(f.acceso==='DOMAIN')heredado=true;
 if(op.method==='delete'){assert.equal(m[2],'dom');if(heredado)return resp(403,{error:{reason:'cannotDeletePermission'}});it.acceso='PRIVATE';return resp(204)}
 return resp(200,{permissions:[{id:'own',type:'user'}].concat(it.acceso==='DOMAIN'||heredado?[{id:'dom',type:'domain'}]:[])})}
function carpeta(nombre,padre){const f=compartible({id:'F'+(++nId),nombre,padre,hijos:[],archivos:[],trashed:false}); Object.assign(f,{
 getId:()=>f.id,getName:()=>f.nombre,getUrl:()=>'https://drive/'+f.id,isTrashed:()=>f.trashed,
 getFoldersByName:n=>{const l=f.hijos.filter(h=>h.nombre===n);let i=0;return{hasNext:()=>i<l.length,next:()=>l[i++]}},
 createFolder:n=>{const h=carpeta(n,f);f.hijos.push(h);return h},
 createFile:b=>{const id='A'+(++nId);const a=compartible({id,blob:b,padre:f});archivos[id]=a;f.archivos.push(a);return Object.assign(a,{getId:()=>id,getUrl:()=>'https://drive/file/'+id})}});
 carpetas[f.id]=f;return f}
const miUnidad=carpeta('Mi unidad',null), maestra=miUnidad.createFolder('Cotizador Helgen'), pdfRaiz=maestra.createFolder('Cotizaciones Helgen (PDF)');
miUnidad.acceso='PRIVATE'; // la raíz de Mi unidad no se comparte; la carpeta maestra sí (todo el dominio, §6.11)
const ruta=f=>f.padre?ruta(f.padre)+'/'+f.nombre:f.nombre;
archivos.DB={id:'DB',padre:maestra};

const db=libro('DB','Base de datos',{Config:hoja([['Clave','Valor'],['PREFIJO_FOLIO','HLG'],['IVA_TASA',0.16]]),Cotizaciones:hoja([])});
libro('CAT','Catálogo',{Catalogo:hoja([['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó','Clave SAT','Unidad SAT'],['PAN-550','Panel solar 550 W','PZA',4100,'','','','']])});
const props={SPREADSHEET_ID:'DB',FOLDER_ID:pdfRaiz.id,CATALOGO_ID:'CAT',
  ROL_COBRANZA:'efrain@helgen.tech, tania@helgen.tech',ADMIN_DESBLOQUEO:'efrain@helgen.tech',
  ROL_COMPRAS:'efrain@helgen.tech, pedro@helgen.tech',ROL_REQUISICION:'obrero@helgen.tech, rosa@helgen.tech, pedro@helgen.tech',
  SOLO_REQUISICION:'luis@helgen.tech, rosa@helgen.tech'},cache={};

// ---- Tokens: efrain (cobranza + compras + admin), tania (cobranza), pedro (compras + requisiciones), ana (vendedora sin rol),
// obrero (ROL_REQUISICION), rosa y luis (SOLO_REQUISICION: solo la pestaña Requisiciones; luis no está en ROL_REQUISICION) ----
const ahora=Math.floor(Date.now()/1000);
const claims=(email,n,a)=>({aud:CID,iss:'https://accounts.google.com',exp:String(ahora+3000),email,email_verified:'true',hd:'helgen.tech',given_name:n,family_name:a});
const tokens={efrain:claims('efrain@helgen.tech','Efrain','Sosa'),tania:claims('tania@helgen.tech','Tania','R'),
  ana:claims('ana@helgen.tech','Ana','López'),obrero:claims('obrero@helgen.tech','Juan','Obrero'),rosa:claims('rosa@helgen.tech','Rosa','Mena'),luis:claims('luis@helgen.tech','Luis','Campo'),pedro:claims('pedro@helgen.tech','Pedro','Ruiz'),intruso:{...claims('intruso@gmail.com','X','Y'),hd:undefined}};

const fmt=(d,tz,f)=>f.replace('yyyy',d.getFullYear()).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate()))
  .replace('HH',pad(d.getHours())).replace('mm',pad(d.getMinutes())).replace('ss',pad(d.getSeconds()));
const firmados=b=>[...b].map(x=>x>127?x-256:x); // Apps Script entrega bytes con signo
const ctx={console:{...console,warn(){}},Date,JSON,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v,getProperties:()=>Object.assign({},props),setProperties:o=>Object.assign(props,o)})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v,getAll:ks=>Object.fromEntries(ks.filter(k=>k in cache).map(k=>[k,cache[k]])),putAll:o=>Object.assign(cache,o)})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>''})},
 Logger:{log(){}},
 Utilities:{formatDate:fmt,newBlob:(a,b,c)=>typeof a==='string'?{getAs:()=>({setName:n=>({name:n,html:a})})}:{bytes:a,mime:b,name:c},
  base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>firmados(Buffer.from(s,'base64')),
  DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),computeDigest:(a,s)=>[...require('crypto').createHash(a||'sha256').update(s).digest()]},
 ScriptApp:{getOAuthToken:()=>'TOKEN-SCRIPT'},
 UrlFetchApp:{fetch:(url,op)=>{if(/googleapis\.com\/drive\//.test(url))return apiDrive(url,op);const t=decodeURIComponent(url.split('id_token=')[1]);const c=tokens[t];
  return{getResponseCode:()=>c?200:400,getContentText:()=>JSON.stringify(c||{error:'invalid_token'})}}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({t,setMimeType(){return this}})},
 SpreadsheetApp:{flush(){},openById:id=>{if(!libros[id])throw new Error('No encontrado');return libros[id]},
  create:n=>{const L=libro('S'+(++nId),n,{'Hoja 1':hoja([])});archivos[L.id]=compartible({id:L.id,padre:miUnidad});return L},
  newDataValidation:()=>{const b={requireValueInList:()=>b,setAllowInvalid:()=>b,setHelpText:()=>b,build:()=>({})};return b}},
 DriveApp:{getFolderById:id=>{if(!carpetas[id])throw new Error('No se encontró');return carpetas[id]},
  createFolder:n=>miUnidad.createFolder(n),getRootFolder:()=>miUnidad,
  getFileById:id=>({getParents:()=>{let d=false;return{hasNext:()=>!d,next:()=>{d=true;return archivos[id].padre}}},
   moveTo:f=>{archivos[id].padre=f},setSharing:()=>archivos[id].setSharing(),getId:()=>id,getUrl:()=>'https://drive/file/'+id}),
  Access:{PRIVATE:'PRIVATE',DOMAIN:'DOMAIN'},Permission:{NONE:'NONE',VIEW:'VIEW'}},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
const post=(quien,funcion,...args)=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({funcion,args,token:quien})}}).t);
const ok=(quien,funcion,...args)=>{const r=post(quien,funcion,...args);assert(r.ok,funcion+': '+r.error);return r.datos};
const falla=(quien,funcion,args,re,codigo)=>{const r=post(quien,funcion,...args);assert.equal(r.ok,false,funcion+' debía fallar');
  assert(re.test(r.error),funcion+': '+r.error);if(codigo)assert.equal(r.codigo,codigo,funcion+' codigo');return r};

const MANANA=(()=>{const d=new Date(HOY.getTime()+86400000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())})();
const AYER=(()=>{const d=new Date(HOY.getTime()-86400000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())})();
function vivos(f){return f.hijos.filter(h=>!h.trashed)}


const PDF=Buffer.from('%PDF-1.4 cotizacion del proveedor').toString('base64');
const JPG=Buffer.from([0xFF,0xD8,0xFF,0xE0,1,2,3]).toString('base64');
const REQ=f=>'REQ-'+ANIO+'-'+f, OC=f=>'OC-'+ANIO+'-'+f, PGP=f=>'PGP-'+ANIO+'-'+f;

// ================= Lógica pura =================
const P=ctx;
// F (incremento 5): sin CSF y carátula del proveedor no se registra un pago; estas pruebas no son de documentos (eso va en
// tests/proveedores.test.js), así que aquí se salta ese bloqueo
P.exigirDocumentosParaPagar_=function(){};
const rl=P.normalizarRequisicion({renglones:[{descripcion:'  Cable  THW 10 ',cantidad:'25.5',unidad:'m',notas:' rojo '},{descripcion:'',cantidad:3}]});
assert.deepEqual(rl.map(r=>({...r})),[{descripcion:'Cable THW 10',cantidad:25.5,unidad:'M',notas:'rojo'}],'limpia y quita renglones vacíos');
assert.equal(P.normalizarRequisicion({renglones:[{descripcion:'Tornillo',cantidad:1}]})[0].unidad,'PZA','unidad por omisión');
for(const [mal,re] of [[[],/al menos un renglón/],[[{descripcion:'A',cantidad:0}],/cantidad de "A" debe ser mayor a 0/],
  [[{descripcion:'A',cantidad:-1}],/mayor a 0/],[[{descripcion:'A',cantidad:''}],/mayor a 0/],[[{descripcion:'A',cantidad:'x'}],/mayor a 0/],
  [[{descripcion:'A'.repeat(501),cantidad:1}],/500 caracteres/],[[{descripcion:'A',cantidad:1,notas:'n'.repeat(301)}],/300 caracteres/],
  [Array.from({length:101},()=>({descripcion:'A',cantidad:1})),/máximo 100 renglones/]]){
  assert.throws(()=>P.normalizarRequisicion({renglones:mal}),re,JSON.stringify(mal).slice(0,60));
}
// Estados: todas las transiciones válidas y algunas inválidas
const validas={autorizar:['Solicitada','Autorizada'],rechazar:['Solicitada','Rechazada'],devolver:['Solicitada','Devuelta'],
  reenviar:['Devuelta','Solicitada'],cancelar:['Solicitada','Cancelada'],pagar:['Autorizada','Pagada'],cancelarPago:['Pagada','Autorizada'],
  cerrar:['Pagada','Cerrada'],cancelarOc:['Autorizada','Solicitada']};
for(const [acc,[de,a]] of Object.entries(validas)) assert.equal(P.transicionReq(de,acc),a,acc);
assert.equal(P.transicionReq('Devuelta','cancelar'),'Cancelada','también se cancela una devuelta');
const ESTADOS=['Solicitada','Autorizada','Pagada','Cerrada','Rechazada','Devuelta','Cancelada'];
for(const acc of Object.keys(validas)) for(const e of ESTADOS){
  let paso=true; try{P.transicionReq(e,acc)}catch(x){paso=false;assert(/no se puede/.test(x.message),x.message)}
  const esperado=e===validas[acc][0]||(acc==='cancelar'&&e==='Devuelta');
  assert.equal(paso,esperado,acc+' desde '+e);
}
for(const e of ['Cerrada','Rechazada','Cancelada']) for(const acc of Object.keys(validas)) assert.throws(()=>P.transicionReq(e,acc),/no se puede/,'final: '+e);
assert.throws(()=>P.transicionReq('Solicitada','borrar'),/Acción no válida/);
// Pago a proveedor: total de la OC ±1.00, tipo de cambio si la moneda es otra
const ORDEN={moneda:'MXN',total:2320,fechaOrden:'2026-10-20',hoy:'2026-10-22'};
const pp=P.normalizarPagoProveedor({fecha:'2026-10-21',monto:'2320.9',metodo:'transferencia',referencia:' SPEI 9 '},ORDEN);
assert.deepEqual([pp.fecha,pp.monto,pp.monedaPago,pp.tipoCambio,pp.montoAplicado,pp.metodo,pp.referencia],['2026-10-21',2320.9,'MXN','',2320.9,'Transferencia','SPEI 9']);
assert.equal(P.normalizarPagoProveedor({fecha:'2026-10-21',monto:2319,metodo:'Efectivo'},ORDEN).referencia,'','efectivo sin referencia');
assert.equal(P.normalizarPagoProveedor({fecha:'2026-10-21',monto:125.41,monedaPago:'USD',tipoCambio:18.5,metodo:'Cheque',referencia:'1'},ORDEN).montoAplicado,2320.09);
for(const [mal,re] of [[{monto:2321.01},/debe ser igual al total de la orden \(\$2,320\.00 MXN\)/],[{monto:2318.99},/igual al total/],
  [{monto:0},/mayor a 0/],[{monedaPago:'USD',monto:125.41},/La orden es en MXN y el pago en USD: captura el tipo de cambio/],[{metodo:'Bitcoin'},/método de pago/],
  [{referencia:''},/referencia/],[{fecha:'2026-10-23'},/no puede ser futura/],[{fecha:'2026-10-19'},/anterior a la orden/],[{fecha:''},/obligatoria/]]){
  assert.throws(()=>P.normalizarPagoProveedor({fecha:'2026-10-21',monto:2320,metodo:'Transferencia',referencia:'R',...mal},ORDEN),re,JSON.stringify(mal));
}
// Total de sus facturas (ya cubren la orden): se acepta si es menor (retenciones); nunca más que el total de la orden
assert.equal(P.normalizarPagoProveedor({fecha:'2026-10-21',monto:2088,metodo:'Transferencia',referencia:'R'},{...ORDEN,totalFacturado:2088}).montoAplicado,2088);
assert.throws(()=>P.normalizarPagoProveedor({fecha:'2026-10-21',monto:2900,metodo:'Transferencia',referencia:'R'},{...ORDEN,totalFacturado:2900}),
  /igual al total de la orden \(\$2,320\.00 MXN\)\.$/,'un total de facturas mayor que el de la orden no se acepta');
assert.throws(()=>P.normalizarPagoProveedor({fecha:'2026-10-21',monto:1740,metodo:'Transferencia',referencia:'R'},{...ORDEN,facturadoParcial:1740}),
  /todavía no cubren la orden/);
assert.deepEqual([P.nombreArchivoReq(REQ('0001'),'Cotización','pdf',1),P.nombreArchivoReq(REQ('0001'),'Comprobante pago','jpg',2)],
  [REQ('0001')+' — Cotización.pdf',REQ('0001')+' — Comprobante pago (2).jpg']);
assert.throws(()=>P.validarArchivo([],'la cotización del proveedor','La cotización'),/Adjunta la cotización del proveedor/);
assert.throws(()=>P.validarArchivo([1,2,3,4,5,6,7,8,9,10,11,12],'la cotización del proveedor','La cotización'),/La cotización debe ser PDF o imagen/);
assert.throws(()=>P.validarComprobante([]),/Adjunta el comprobante de pago/,'el mensaje de cobranza no cambia');

// ================= Servidor (doPost) =================
const proy=(nombre,id,ubicacion)=>ok('ana','crearProyecto',{nombre,ubicacion,cliente:{nombre:'Cliente Secreto',empresa:'Empresa Oculta SA'},idSolicitud:id}).folio;
const p1=proy('Techo solar','p1','Querétaro, Qro.'), p2=proy('Planta Texas','p2','Austin, TX'), p3=proy('Sin firmar','p3','');
const cot=(proyectoFolio,precio,extra)=>ok('ana','guardarCotizacion',{cliente:{nombre:'Cliente Secreto',empresa:'Empresa Oculta SA'},
  items:[{descripcion:'Servicio',cantidad:1,precio}],proyectoFolio,idSolicitud:'c'+(++nId),...extra}).folio;
const c1=cot(p1,98765), c2=cot(p2,5000,{moneda:'USD'}), c3=cot(p3,100);
for(const [p,c] of [[p1,c1],[p2,c2]]){ok('efrain','marcarAceptada',p,c,true);ok('efrain','firmarContrato',p,HOY_ISO)}
ok('efrain','marcarAceptada',p3,c3);

// --- Permisos de la pestaña ---
assert.deepEqual({...ok('obrero','getDatosIniciales').permisos},{cobranza:false,desbloqueo:false,compras:false,requisicion:true,operaciones:false,flujoOperaciones:false,ventas:true,superadmin:false});
assert.deepEqual({...ok('pedro','getDatosIniciales').permisos},{cobranza:false,desbloqueo:false,compras:true,requisicion:true,operaciones:false,flujoOperaciones:false,ventas:true,superadmin:false});
assert.equal(ok('ana','getDatosIniciales').permisos.requisicion,false);
const TRAB=[['listarProyectosRequisicion',['']],['misRequisiciones',[]],['guardarRequisicion',[{}]],['cancelarRequisicion',[REQ('0001'),'motivo largo']],
  ['cerrarRequisicion',[REQ('0001'),'']]];
for(const quien of ['ana','tania']) for(const [f,args] of TRAB) falla(quien,f,args,/No tienes permiso para hacer requisiciones/,'PERMISO');
for(const [f,args] of TRAB) falla('intruso',f,args,/@helgen.tech/,'SESION');

// --- SOLO_REQUISICION: solo su pestaña; el servidor le niega todo lo demás ---
const dl=ok('luis','getDatosIniciales');
assert.deepEqual([dl.soloRequisicion,dl.permisos.requisicion,dl.permisos.compras,dl.clientes.length,dl.proyectos.length,dl.tipoCambio],[true,true,false,0,0,null]);
assert.deepEqual(dl.catalogo.map(p=>({...p})),[{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA'}],'catálogo sin precios');
assert(!/Cliente Secreto|Empresa Oculta|4100|98765/.test(JSON.stringify(dl)),'sin clientes, precios ni montos');
for(const [f,args] of [['getClientes',[]],['listarCotizaciones',['']],['getCatalogo',[]],['guardarProducto',[{}]],['guardarCotizacion',[{}]],
  ['sugerirClavesSat',['panel']],['listarProyectos',['']],['crearProyecto',[{}]],['listarProyectosCompras',['']],['getCobranzaProyecto',[p1]],
  ['registrarFacturaProveedor',[{}]],['cancelarFacturaProveedor',['FPR-2026-0001','motivo largo']],['cambiarDiasCreditoFactura',['FPR-2026-0001','30','motivo largo']],['cuentasPorPagar',[]]]){
  falla('luis',f,args,/solo tiene acceso a Requisiciones/,'PERMISO');
  falla('rosa',f,args,/solo tiene acceso a Requisiciones/,'PERMISO');
}
assert.equal(ok('obrero','listarCotizaciones','').length>0,true,'ROL_REQUISICION sin SOLO usa el cotizador como siempre');

// --- Proyectos para pedir: Activos y Cerrados, con o sin contrato; solo folio, clave y nombre ---
const lp=ok('luis','listarProyectosRequisicion','');
assert.deepEqual(lp.map(p=>({...p})),[
  {folio:p3,clave:'SIF',folioVisible:p3+'-SIF',nombre:'Sin firmar',estado:'Activo'},
  {folio:p2,clave:'PLT',folioVisible:p2+'-PLT',nombre:'Planta Texas',estado:'Activo'},
  {folio:p1,clave:'TES',folioVisible:p1+'-TES',nombre:'Techo solar',estado:'Activo'}]);
assert.deepEqual(ok('luis','listarProyectosRequisicion','texas').map(p=>p.folio),[p2]);
assert.deepEqual(ok('luis','listarProyectosRequisicion','plt').map(p=>p.folio),[p2],'por clave');
assert.deepEqual(ok('luis','listarProyectosRequisicion',p2+'-PLT').map(p=>p.folio),[p2],'por folio con clave');
assert.deepEqual(ok('luis','listarProyectosRequisicion','Cliente Secreto'),[],'no busca por cliente');

// --- Crear: cotización obligatoria (PDF, JPG, PNG o HEIC, máx. 10 MB); folio REQ; carpeta privada; Solicitada ---
const nueva=(quien,extra)=>({proyectoFolio:p1,renglones:[{descripcion:'Cable THW 10',cantidad:100,unidad:'m',notas:'rojo'},
  {descripcion:'Tubo conduit 3/4',cantidad:'12',unidad:'pza'}],cotizacion:{nombre:'cot.pdf',datos:PDF},idSolicitud:'r'+(++nId),...extra});
falla('obrero','guardarRequisicion',[nueva('obrero',{cotizacion:null})],/Adjunta la cotización del proveedor/);
falla('obrero','guardarRequisicion',[nueva('obrero',{cotizacion:{datos:Buffer.from('hola mundo txt').toString('base64')}})],/La cotización debe ser PDF o imagen/);
falla('obrero','guardarRequisicion',[nueva('obrero',{cotizacion:{datos:Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(10*1024*1024)]).toString('base64')}})],/pesa más de 10 MB/);
falla('obrero','guardarRequisicion',[nueva('obrero',{renglones:[{descripcion:'A',cantidad:0}]})],/mayor a 0/);
const filaP3=db.pest.Proyectos.m.findIndex(x=>x[0]===p3);
db.pest.Proyectos.m[filaP3][6]='Cancelado';
falla('obrero','guardarRequisicion',[nueva('obrero',{proyectoFolio:p3})],/está cancelado: no se piden materiales/);
db.pest.Proyectos.m[filaP3][6]='Activo';
falla('obrero','guardarRequisicion',[nueva('obrero',{proyectoFolio:'PRY-2000-0001'})],/No existe el proyecto/);
assert.equal(props['CONSECUTIVO_REQ_'+ANIO],undefined,'los rechazos no gastan folio');
let r=ok('obrero','guardarRequisicion',nueva('obrero',{idSolicitud:'rq1'}));
assert.equal(r.folio,REQ('0001'));
assert.equal(ok('obrero','guardarRequisicion',nueva('obrero',{idSolicitud:'rq1'})).folio,REQ('0001'),'idempotencia');
const LC=libros[props.COMPRAS_DB_ID], H=n=>LC.pest[n].m;
assert.equal(H('Requisiciones').length,2,'una sola requisición');
let f=H('Requisiciones')[1];
assert.deepEqual([f[0],f[1],f[2],f[3],f[4],f[5],f[9]],[REQ('0001'),HOY_ISO,p1,'obrero@helgen.tech','Juan Obrero','Solicitada','']);
assert.deepEqual(H('RequisicionesRenglones').slice(1).map(x=>x.join('|')),[REQ('0001')+'|1|1|Cable THW 10|100|M|rojo',REQ('0001')+'|1|2|Tubo conduit 3/4|12|PZA|'],'sin costo');
const cot1=archivos[f[7]];
assert.equal(ruta(cot1.padre),'Mi unidad/Cotizador Helgen — Compras/'+ANIO+'/'+p1+'/Requisiciones');
assert.equal(cot1.blob.name,REQ('0001')+' — Cotización.pdf'); assert.equal(cot1.blob.mime,'application/pdf');
assert.deepEqual([cot1.acceso,cot1.padre.acceso,cot1.padre.padre.acceso,cot1.padre.padre.padre.acceso],['PRIVATE','PRIVATE','PRIVATE','PRIVATE'],'restringido de arriba abajo');
// Otra de rosa (JPG) y otra de luis (SOLO_REQUISICION sin ROL_REQUISICION: también puede)
const rRosa=ok('rosa','guardarRequisicion',nueva('rosa',{proyectoFolio:p2,cotizacion:{nombre:'foto.jpg',datos:JPG}})).folio;
assert.equal(archivos[H('Requisiciones')[2][7]].blob.name,rRosa+' — Cotización.jpg');
const rLuis=ok('luis','guardarRequisicion',nueva('luis')).folio;
assert.deepEqual([rRosa,rLuis],[REQ('0002'),REQ('0003')]);

// --- El solicitante solo ve SUS requisiciones, sin montos, cliente, margen, pagos ni órdenes ---
let mias=ok('obrero','misRequisiciones');
assert.deepEqual(mias.map(x=>x.folio),[REQ('0001')]);
assert.deepEqual(ok('rosa','misRequisiciones').map(x=>x.folio),[rRosa]);
assert.deepEqual([mias[0].proyectoNombre,mias[0].estado,mias[0].renglones.length,mias[0].puedeCancelar,mias[0].puedeEditar,mias[0].puedeCerrar],
  ['Techo solar','Solicitada',2,true,false,false]);
assert.deepEqual(mias[0].eventos.map(e=>e.estado+':'+e.correo),['Solicitada:obrero@helgen.tech']);
falla('rosa','cancelarRequisicion',[REQ('0001'),'No es mía pero la cancelo'],/Solo quien hizo la requisición/,'PERMISO');
falla('rosa','guardarRequisicion',[{folio:REQ('0001'),renglones:[{descripcion:'X',cantidad:1}]}],/Solo quien hizo la requisición/,'PERMISO');
falla('rosa','cerrarRequisicion',[REQ('0001'),''],/Solo quien hizo la requisición/,'PERMISO');

// --- Compras ve todas ---
let lr=ok('pedro','listarRequisiciones','');
assert.deepEqual(lr.map(x=>x.folio+':'+x.estado+':'+x.renglones),[rLuis+':Solicitada:2',rRosa+':Solicitada:2',REQ('0001')+':Solicitada:2']);
assert.deepEqual(ok('pedro','listarRequisiciones','rosa').map(x=>x.folio),[rRosa]);
assert.deepEqual(ok('pedro','listarRequisiciones','','Autorizada'),[]);
let vr=ok('pedro','getRequisicion',REQ('0001'));
assert.deepEqual([vr.requisicion.estado,vr.moneda,vr.renglones.length,vr.puedeAutorizar,vr.puedeRevisar,vr.puedePagar,vr.orden,vr.requisicion.cotizacionId],
  ['Solicitada','MXN',2,true,true,false,null,f[7]]);

// --- Devolver → corregir y reenviar (mismo folio; versión nueva de renglones; cotización nueva opcional) ---
falla('pedro','devolverRequisicion',[REQ('0001'),'no'],/motivo/);
vr=ok('pedro','devolverRequisicion',REQ('0001'),'Falta el calibre del tubo');
assert.deepEqual([vr.requisicion.estado,vr.requisicion.motivo,vr.requisicion.reviso],['Devuelta','Falta el calibre del tubo','pedro@helgen.tech']);
falla('pedro','autorizarRequisicion',[REQ('0001'),{}],/está devuelta: no se puede autorizar/);
mias=ok('obrero','misRequisiciones');
assert.deepEqual([mias[0].estado,mias[0].motivo,mias[0].puedeEditar,mias[0].puedeCancelar],['Devuelta','Falta el calibre del tubo',true,true]);
assert.deepEqual(mias[0].eventos.map(e=>e.estado+':'+e.nota),['Solicitada:','Devuelta:Falta el calibre del tubo']);
r=ok('obrero','guardarRequisicion',{folio:REQ('0001'),proyectoFolio:p2,renglones:[{descripcion:'Tubo conduit 3/4 cédula 40',cantidad:12,unidad:'pza'}],idSolicitud:'rq-re1'});
assert.equal(r.folio,REQ('0001'));
mias=r.requisiciones;
assert.deepEqual([mias[0].estado,mias[0].motivo,mias[0].proyectoFolio,mias[0].renglones.map(x=>x.descripcion)],['Solicitada','',p1,['Tubo conduit 3/4 cédula 40']],'mismo proyecto; renglones nuevos');
assert.equal(H('RequisicionesRenglones').filter(x=>x[0]===REQ('0001')).length,3,'la versión anterior se conserva');
assert.equal(H('Requisiciones')[1][7],f[7],'sin cotización nueva se conserva la anterior');
falla('obrero','guardarRequisicion',[{folio:REQ('0001'),renglones:[{descripcion:'X',cantidad:1}]}],/está solicitada: no se puede reenviar/);
ok('pedro','devolverRequisicion',REQ('0001'),'Ahora falta la cotización firmada');
ok('obrero','guardarRequisicion',{folio:REQ('0001'),renglones:[{descripcion:'Tubo conduit 3/4 cédula 40',cantidad:12}],cotizacion:{datos:JPG},idSolicitud:'rq-re2'});
f=H('Requisiciones')[1];
assert.equal(archivos[f[7]].blob.name,REQ('0001')+' — Cotización (3).jpg','cotización nueva; la anterior no se borra');
assert(archivos[cot1.id],'la cotización anterior sigue en Drive');

// --- Rechazar (final) y cancelar (el solicitante) ---
falla('pedro','rechazarRequisicion',[rRosa,''],/motivo/);
ok('pedro','rechazarRequisicion',rRosa,'El material no corresponde al proyecto');
falla('pedro','autorizarRequisicion',[rRosa,{}],/está rechazada: no se puede autorizar/);
falla('rosa','cancelarRequisicion',[rRosa,'Ya no la necesito'],/está rechazada: no se puede cancelar/);
assert.deepEqual(ok('rosa','misRequisiciones').map(x=>x.estado+':'+x.motivo+':'+x.puedeEditar),['Rechazada:El material no corresponde al proyecto:false']);
falla('luis','cancelarRequisicion',[rLuis,''],/motivo/);
ok('luis','cancelarRequisicion',rLuis,'Se consiguió en la obra');
falla('pedro','devolverRequisicion',[rLuis,'Revisa cantidades'],/está cancelada: no se puede devolver/);
assert.equal(H('Requisiciones').length,4,'nada se borra');

// --- Autorizar: genera la OC con los datos de compras ---
const oc=(extra)=>({proveedor:{razonSocial:'Eléctrica del Centro',rfc:'EDC200101AB1'},fechaEntrega:MANANA,formaPago: 'Transferencia', condicionesPago:'Contado',diasCredito:0,
  ivaTasa:0.16,renglones:[{descripcion:'Tubo conduit 3/4 cédula 40',unidad:'PZA',cantidad:12,costo:100}],idSolicitud:'o'+(++nId),...extra});
r=ok('pedro','autorizarRequisicion',REQ('0001'),oc({idSolicitud:'au1'}));
assert.deepEqual([r.folio,r.ocFolio,r.total,r.moneda,r.vista.requisicion.estado,r.vista.orden.folio,r.vista.orden.reqFolio,r.vista.puedePagar],
  [REQ('0001'),OC('0001'),1392,'MXN','Autorizada',OC('0001'),REQ('0001'),true]);
assert.equal(ok('pedro','autorizarRequisicion',REQ('0001'),oc({idSolicitud:'au1'})).ocFolio,OC('0001'),'idempotencia');
assert.equal(H('OrdenesCompra').length,2);
assert.equal(H('OrdenesCompra')[1][34],REQ('0001'),'la OC guarda su requisición');
mias=ok('obrero','misRequisiciones');
assert.equal(mias[0].estado,'Autorizada');
assert(!/OC-|1392|1,392|98765|Cliente Secreto|Empresa Oculta|Eléctrica|margen|pago|comprobante/i.test(JSON.stringify(mias)),
  'el solicitante no ve orden, montos, cliente, proveedor, margen ni pagos');
falla('obrero','cerrarRequisicion',[REQ('0001'),''],/está autorizada: no se puede cerrar \(solo si está pagada\)/);

// --- Pago a proveedor: comprobante obligatorio, monto = total de la OC, tipo de cambio si es otra moneda ---
const pago=(extra)=>({reqFolio:REQ('0001'),fecha:HOY_ISO,monto:1392,monedaPago:'MXN',metodo:'Transferencia',referencia:'SPEI 55',
  comprobante:{nombre:'spei.pdf',datos:PDF},idSolicitud:'pg'+(++nId),...extra});
falla('pedro','registrarPagoProveedor',[pago({comprobante:null})],/Adjunta el comprobante de pago/);
falla('pedro','registrarPagoProveedor',[pago({monto:1000})],/debe ser igual al total de la orden \(\$1,392\.00 MXN\)/);
falla('pedro','registrarPagoProveedor',[pago({monto:75.25,monedaPago:'USD'})],/tipo de cambio/);
falla('pedro','registrarPagoProveedor',[pago({referencia:''})],/referencia/);
falla('pedro','registrarPagoProveedor',[pago({reqFolio:'',ocFolio:'OC-2000-0001'})],/No existe la orden/);
falla('obrero','registrarPagoProveedor',[pago()],/No tienes permiso de compras/,'PERMISO');
assert.equal(props['CONSECUTIVO_PGP_'+ANIO],undefined,'los rechazos no gastan folio');
// Desde la OC (mismo registro), en dólares con tipo de cambio: 75.25 × 18.5 = 1392.13 (dentro de ±1.00)
r=ok('pedro','registrarPagoProveedor',pago({reqFolio:'',ocFolio:OC('0001'),monto:75.25,monedaPago:'USD',tipoCambio:18.5,idSolicitud:'pg-ok'}));
assert.equal(r.folio,PGP('0001'));
assert.equal(ok('pedro','registrarPagoProveedor',pago({idSolicitud:'pg-ok'})).folio,PGP('0001'),'idempotencia');
assert.deepEqual([r.vista.requisicion.estado,r.vista.orden.estado,r.vista.pagos.length,r.vista.puedeCerrar,r.vista.puedeCancelarPago],['Pagada','Pagada',1,true,true]);
let fp=H('PagosProveedores')[1];
assert.deepEqual([fp[0],fp[1],fp[3],fp[4],fp[5],fp[6],fp[7],fp[8],fp[9],fp[10],fp[11],fp[12],fp[17]],
  [PGP('0001'),HOY_ISO,OC('0001'),REQ('0001'),p1,75.25,'USD',18.5,1392.13,'MXN','Transferencia','SPEI 55','Vigente']);
const comp=archivos[fp[13]];
assert.equal(ruta(comp.padre),'Mi unidad/Cotizador Helgen — Compras/'+ANIO+'/'+p1+'/Requisiciones');
assert.equal(comp.blob.name,REQ('0001')+' — Comprobante pago.pdf'); assert.equal(comp.acceso,'PRIVATE');
falla('pedro','registrarPagoProveedor',[pago()],/está pagada: no se puede pagar/,'');
falla('pedro','cancelarOrdenCompra',[OC('0001'),'Ya no se necesita'],/ya está pagada: no se puede cancelar/);
assert.deepEqual(Object.keys(libros[props.COBRANZA_DB_ID].pest).sort(),['Bitacora','Contratos','Esquemas','Pagos'],'los pagos a proveedores no van a cobranza');
assert.equal(libros[props.COBRANZA_DB_ID].pest.Pagos.m.length<=1,true,'ni se mezclan con PAG-');
// El solicitante ve "Pagada" y la fecha, nunca el comprobante ni el monto
mias=ok('obrero','misRequisiciones');
assert.deepEqual([mias[0].estado,mias[0].puedeCerrar,mias[0].eventos[mias[0].eventos.length-1].estado],['Pagada',true,'Pagada']);
assert(!/PGP-|1392|75\.25|SPEI|drive\/file|comprobante/i.test(JSON.stringify(mias)),'sin comprobante ni monto pagado');

// --- Cancelar el pago: requisición a Autorizada y OC a Emitida; nunca se borra ---
falla('pedro','cancelarPagoProveedor',[PGP('0001'),''],/motivo/);
vr=ok('pedro','cancelarPagoProveedor',PGP('0001'),'Se capturó con el tipo de cambio equivocado');
assert.deepEqual([vr.requisicion.estado,vr.orden.estado,vr.pagos[0].estado,vr.pagos[0].motivoCancelacion,vr.puedePagar],
  ['Autorizada','Emitida','Cancelado','Se capturó con el tipo de cambio equivocado',true]);
falla('pedro','cancelarPagoProveedor',[PGP('0001'),'Otra vez por error'],/ya está cancelado/);
mias=ok('obrero','misRequisiciones');
assert.deepEqual([mias[0].estado,mias[0].eventos[mias[0].eventos.length-1].nota],['Autorizada','Se canceló el pago.']);
assert(!/tipo de cambio equivocado/.test(JSON.stringify(mias)),'el motivo del pago no se le muestra');
falla('obrero','cerrarRequisicion',[REQ('0001'),''],/está autorizada: no se puede cerrar/);
// Se vuelve a pagar (MXN): segundo comprobante con (2)
r=ok('pedro','registrarPagoProveedor',pago({monto:1392}));
assert.equal(r.folio,PGP('0002'));
assert.equal(archivos[H('PagosProveedores')[2][13]].blob.name,REQ('0001')+' — Comprobante pago (2).pdf');

// --- Cierre: solo el solicitante, o compras con motivo; solo si está Pagada ---
falla('rosa','cerrarRequisicion',[REQ('0001'),''],/Solo quien hizo la requisición/,'PERMISO');
falla('pedro','cerrarRequisicion',[REQ('0001'),''],/Solo quien hizo la requisición/,'PERMISO');
falla('obrero','cerrarRequisicionCompras',[REQ('0001'),'Lo cierro yo'],/No tienes permiso de compras/,'PERMISO');
falla('pedro','cerrarRequisicionCompras',[REQ('0001'),''],/Escribe por qué cierras/);
falla('obrero','cerrarRequisicion',[REQ('0001'),'n'.repeat(501)],/500 caracteres/);
mias=ok('obrero','cerrarRequisicion',REQ('0001'),'Faltó 1 pieza');
assert.deepEqual([mias[0].estado,mias[0].notasRecepcion,mias[0].puedeCerrar,mias[0].eventos[mias[0].eventos.length-1].nota],['Cerrada','Faltó 1 pieza',false,'Material recibido · Faltó 1 pieza']);
let fo=H('OrdenesCompra')[1];
assert.deepEqual([fo[28],fo[29],fo[30]],['Recibida',HOY_ISO,'obrero@helgen.tech']);
falla('obrero','cerrarRequisicion',[REQ('0001'),''],/está cerrada: no se puede cerrar/);
falla('pedro','cancelarPagoProveedor',[PGP('0002'),'Se pagó doble por error'],/ya está cerrada \(material recibido\): el pago no se puede cancelar/);
falla('pedro','cancelarOrdenCompra',[OC('0001'),'Ya no se necesita'],/ya se recibió/);

// Compras cierra en lugar del solicitante (con motivo); la OC queda recibida con el correo de compras
ok('pedro','guardarRequisicion',nueva('pedro',{proyectoFolio:p2,idSolicitud:'rq-p'}));
const R5=REQ('0004');
falla('pedro','cerrarRequisicionCompras',[R5,'El trabajador ya no está'],/está solicitada: no se puede cerrar/);
// Nadie autoriza lo que pidió (decisión de Leo, 29/10/2026): pedro pidió, lo autoriza efrain
falla('pedro','autorizarRequisicion',[R5,oc({moneda:'USD',ivaTasa:0,renglones:[{descripcion:'Cable',cantidad:1,costo:50}]})],/No puedes autorizar tu propia requisición/);
r=ok('efrain','autorizarRequisicion',R5,oc({moneda:'USD',ivaTasa:0,renglones:[{descripcion:'Cable',cantidad:1,costo:50}]}));
assert.deepEqual([r.ocFolio,r.total,r.moneda],[OC('0002'),50,'USD']);
ok('pedro','registrarPagoProveedor',{reqFolio:R5,fecha:HOY_ISO,monto:925,monedaPago:'MXN',tipoCambio:18.5,metodo:'Efectivo',comprobante:{datos:JPG}});
vr=ok('efrain','cerrarRequisicionCompras',R5,'El trabajador ya no está en la obra','Llegó completo');
assert.deepEqual([vr.requisicion.estado,vr.orden.estado,vr.orden.recibio,vr.requisicion.notasRecepcion],['Cerrada','Recibida','efrain@helgen.tech','Llegó completo']);
assert(/^Cerrada por compras: El trabajador ya no está en la obra · Llegó completo$/.test(vr.eventos[vr.eventos.length-1].nota));
const fp3=H('PagosProveedores')[3]; assert.deepEqual([fp3[0],fp3[6],fp3[7],fp3[8],fp3[9],fp3[10],fp3[12]],[PGP('0003'),925,'MXN',18.5,50,'USD','']);

// --- Cancelar la OC de una requisición autorizada: vuelve a Solicitada y se autoriza de nuevo con otra OC ---
const R6=ok('obrero','guardarRequisicion',nueva('obrero',{idSolicitud:'rq-6'})).folio;
r=ok('pedro','autorizarRequisicion',R6,oc());
ok('pedro','cancelarOrdenCompra',r.ocFolio,'El proveedor subió el precio');
vr=ok('pedro','getRequisicion',R6);
assert.deepEqual([vr.requisicion.estado,vr.requisicion.ocFolio,vr.puedeAutorizar],['Solicitada','',true]);
assert.equal(ok('obrero','misRequisiciones')[0].estado,'Solicitada');
r=ok('pedro','autorizarRequisicion',R6,oc({proveedor:{razonSocial:'Otro proveedor'}}));
assert.equal(r.ocFolio,OC('0004'),'otra OC con su folio normal');

// --- Folios y bitácora ---
assert.deepEqual([props['CONSECUTIVO_REQ_'+ANIO],props['CONSECUTIVO_PGP_'+ANIO],props['CONSECUTIVO_OC_'+ANIO]],['5','3','4']);
const acciones=H('Bitacora').slice(1).map(b=>b[2]);
for(const a of ['Solicitar requisición','Devolver requisición','Reenviar requisición','Rechazar requisición','Cancelar requisición',
  'Autorizar requisición','Registrar pago a proveedor','Cancelar pago a proveedor','Cerrar requisición','Requisición a Solicitada'])
  assert(acciones.includes(a),'bitácora: '+a);
assert.equal(H('Bitacora').slice(1).find(b=>b[2]==='Cancelar pago a proveedor')[5],'Se capturó con el tipo de cambio equivocado');
assert.deepEqual(Object.keys(db.pest).sort(),['Config','Cotizaciones','Proyectos'],'nada de requisiciones en la Base de datos');
assert(!JSON.stringify(db.pest).includes('REQ-')&&!JSON.stringify(db.pest).includes('PGP-'));

// ================= Carga inicial (bootstrap) y sincronización sin recargar =================
// bootstrap: una sola llamada con los roles y las listas que necesita cada rol
const bE=ok('efrain','bootstrap'), bP=ok('pedro','bootstrap'), bA=ok('ana','bootstrap'), bL=ok('luis','bootstrap');
assert.deepEqual([!!bE.cob,!!bE.com,!!bE.req],[true,true,false],'efrain: cobranza y compras');
assert(Array.isArray(bE.cob.proyectos)&&Array.isArray(bE.com.proyectos));
// Las listas pesadas solo van si ya están en caché (con el caché vacío, la interfaz las pide al abrir la pestaña)
assert.equal(bE.com.requisiciones,null,'en frío: sin la lista de requisiciones');
ok('efrain','listarRequisiciones','','');
assert(Array.isArray(ok('efrain','bootstrap').com.requisiciones),'ya en caché: viene en el bootstrap');
assert.deepEqual([!!bP.cob,!!bP.com,!!bP.req],[false,true,true],'pedro: compras y requisiciones');
assert.deepEqual([!!bA.cob,!!bA.com,!!bA.req,bA.proyectos.length>0,bA.catalogo[0].precio],[false,false,false,true,4100],'ana: solo cotizar');
assert.deepEqual([bL.soloRequisicion,!!bL.req,!!bL.com,!!bL.cob,bL.clientes.length,bL.proyectos.length,bL.tipoCambio],[true,true,false,false,0,0,null]);
assert(!/Cliente Secreto|Empresa Oculta|4100|98765/.test(JSON.stringify(bL)),'SOLO_REQUISICION: sin clientes, precios ni montos');
assert.deepEqual(Object.keys(bE.versiones).sort(),['anulaciones','catalogo','contratos','cotizaciones','facturasProveedor','oc','pagosCobranza','pagosProveedores','permisos','proyectos','requisiciones']);
// Sin cambios: solo versiones y permisos (ninguna lista)
let sP=ok('pedro','sincronizar',bP.versiones,{});
assert.deepEqual([sP.cambios.length,'comRequisiciones' in sP,'reqProyectos' in sP,sP.permisos.compras],[0,false,false,true]);
// Ana crea un proyecto: los demás lo ven en su siguiente consulta, cada quien en sus listas
const p9=proy('Nave Industrial','p9','');
sP=ok('pedro','sincronizar',bP.versiones,{});
assert.deepEqual([...sP.cambios],['proyectos']);
assert(sP.comProyectos.some(p=>p.folio===p9&&p.folioVisible===p9+'-NAI'&&p.sinContrato),'compras: el proyecto nuevo, sin contrato');
assert(sP.reqProyectos.some(p=>p.folio===p9),'requisiciones: el proyecto nuevo');
assert(!('cobProyectos' in sP)&&!('proyectos' in sP&&sP.proyectos==null),'pedro no recibe cobranza');
const sE=ok('efrain','sincronizar',bE.versiones,{cobResumen:true});
assert(sE.cobProyectos.some(p=>p.folio===p9)&&sE.comProyectos.some(p=>p.folio===p9));
const sA=ok('ana','sincronizar',bA.versiones,{});
assert(sA.proyectos.some(p=>p.folio===p9)&&!('comProyectos' in sA)&&!('misReq' in sA)&&!('cobProyectos' in sA));
const sL=ok('luis','sincronizar',bL.versiones,{req:REQ('0001'),cobProyecto:p1,comProyecto:p1});
assert(sL.reqProyectos.some(p=>p.folio===p9)&&!('proyectos' in sL)&&!('comRequisiciones' in sL)&&!('requisicion' in sL)&&!('cobranzaProyecto' in sL),
  'SOLO_REQUISICION: aunque pida otras vistas, solo recibe lo suyo');
assert(!/Cliente Secreto|Empresa Oculta/.test(JSON.stringify(sL)));
// Una requisición nueva: compras recibe su lista y la requisición abierta; el solicitante solo las suyas
const vAntes=ok('pedro','sincronizar',{},{}).versiones;
const rq9=ok('obrero','guardarRequisicion',{proyectoFolio:p9+'-NAI',renglones:[{descripcion:'Lámina',cantidad:3}],
  cotizacion:{nombre:'c.pdf',datos:PDF},idSolicitud:'rq9'}).folio;
assert.equal(H('Requisiciones').find(x=>x[0]===rq9)[2],p9,'con el folio visible se guarda la llave interna');
const sP2=ok('pedro','sincronizar',vAntes,{req:rq9,rcEstado:'Solicitada'});
assert.deepEqual([...sP2.cambios],['requisiciones']);
assert(sP2.comRequisiciones.some(r=>r.folio===rq9&&r.proyectoVisible===p9+'-NAI')&&sP2.comRequisiciones.every(r=>r.estado==='Solicitada'));
assert.equal(sP2.requisicion.requisicion.folio,rq9);
const sO=ok('obrero','sincronizar',vAntes,{});
assert(sO.misReq.some(r=>r.folio===rq9)&&!('comRequisiciones' in sO));
assert(!ok('rosa','sincronizar',vAntes,{}).misReq.some(r=>r.folio===rq9),'rosa no ve la requisición de obrero');
// Las listas salen del caché hasta que algo cambia (y la escritura sube la versión)
assert(Object.keys(cache).some(k=>k.startsWith('K_reqs_')),'lista de requisiciones en caché');
// Cambio a mano en la hoja (Estado): la carga inicial no relee la hoja; la consulta de fondo sí, cada 5 min
const fila9=db.pest.Proyectos.m.findIndex(x=>x[0]===p9); db.pest.Proyectos.m[fila9][6]='Cancelado';
const vMan=ok('pedro','sincronizar',{},{}).versiones;
assert(ok('pedro','bootstrap').com.proyectos.some(p=>p.folio===p9),'antes de la revisión sigue el dato en caché');
delete cache['R_proyectos']; // pasan los 5 min de la revisión
const sMan=ok('pedro','sincronizar',vMan,{});
assert.deepEqual([...sMan.cambios],['proyectos'],'la huella cambió: sube la versión');
assert(!sMan.comProyectos.some(p=>p.folio===p9)&&!sMan.reqProyectos.some(p=>p.folio===p9),'cancelado a mano: sale de las listas');
assert.deepEqual([...ok('pedro','sincronizar',sMan.versiones,{}).cambios],[],'una vez avisado, no se repite');
// Cambio de rol sin recargar la página: la siguiente consulta trae los permisos nuevos
props.ROL_COMPRAS+=', tania@helgen.tech';
assert.equal(ok('tania','sincronizar',vAntes,{}).permisos.compras,true);
falla('intruso','sincronizar',[{},{}],/@helgen.tech/,'SESION');
console.log('OK requisiciones');
