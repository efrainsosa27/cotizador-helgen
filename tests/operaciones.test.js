// Requisiciones con operaciones (incremento 3): ROL_OPERACIONES activa el flujo nuevo. Sitio obligatorio de la lista de
// Config, cotización opcional, aprobación de operaciones renglón por renglón (nadie aprueba lo que pidió), propuesta de compras
// (exacto / sustituto / no disponible / adicional, versiones), visto bueno sobre la última versión (nadie aprueba lo que preparó)
// que emite la orden, separar renglones, recepción renglón por renglón antes o después del pago con entradas de inventario,
// cancelar recepción, archivos sin acceso a Drive y sincronización. Quien pide o recibe nunca ve proveedor ni montos.
// Uso: node tests/operaciones.test.js .   (carpeta con Code.js y Logo.js)
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
  ROL_COMPRAS:'efrain@helgen.tech, pedro@helgen.tech, leo@helgen.tech',
  ROL_REQUISICION:'obrero@helgen.tech, rosa@helgen.tech, pedro@helgen.tech, leo@helgen.tech',
  SOLO_REQUISICION:'luis@helgen.tech, rosa@helgen.tech, adri@helgen.tech',ROL_OPERACIONES:''},cache={};

// ---- Tokens: efrain (cobranza + compras + admin), tania (cobranza), pedro (compras + requisiciones), ana (vendedora sin rol),
// obrero (ROL_REQUISICION), rosa y luis (SOLO_REQUISICION: solo la pestaña Requisiciones; luis no está en ROL_REQUISICION) ----
const ahora=Math.floor(Date.now()/1000);
const claims=(email,n,a)=>({aud:CID,iss:'https://accounts.google.com',exp:String(ahora+3000),email,email_verified:'true',hd:'helgen.tech',given_name:n,family_name:a});
const tokens={adri:claims('adri@helgen.tech','Adriana','Del Ángel'),leo:claims('leo@helgen.tech','Leo','Rodríguez'),
  efrain:claims('efrain@helgen.tech','Efrain','Sosa'),tania:claims('tania@helgen.tech','Tania','R'),
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
   moveTo:f=>{archivos[id].padre=f},setSharing:()=>archivos[id].setSharing(),getId:()=>id,getUrl:()=>'https://drive/file/'+id,
   getBlob:()=>({getName:()=>archivos[id].blob.name,getContentType:()=>archivos[id].blob.mime,getBytes:()=>archivos[id].blob.bytes})}),
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
const REQ=f=>'REQ-'+ANIO+'-'+f, OC=f=>'OC-'+ANIO+'-'+f, PGP=f=>'PGP-'+ANIO+'-'+f;const REC=f=>'REC-'+ANIO+'-'+f;
const plain=x=>JSON.parse(JSON.stringify(x));

// ================= Lógica pura =================
const P=ctx;
assert.deepEqual(plain(P.sitiosDeTexto('Querétaro\nManzanillo (TIMSA),  Ensenada  (EIT);querétaro\n\n')),['Querétaro','Manzanillo (TIMSA)','Ensenada (EIT)']);
const SIT=plain(P.sitiosDeTexto('Querétaro\nManzanillo (TIMSA)\nEnsenada (EIT)\nLázaro Cárdenas (LCT)\nVeracruz (ICAVE)'));
assert.equal(P.sitioDeLista('lazaro cardenas (lct)',SIT,true),'Lázaro Cárdenas (LCT)','sin acentos ni mayúsculas');
assert.equal(P.sitioDeLista('',SIT,false),'');
assert.throws(()=>P.sitioDeLista('',SIT,true),/Elige el sitio/);
assert.throws(()=>P.sitioDeLista('Monterrey',SIT,true),/no está en la lista de sitios/);
assert.equal(P.fechaRequeridaValida('',HOY_ISO),'');
assert.equal(P.fechaRequeridaValida(MANANA,HOY_ISO),MANANA);
assert.throws(()=>P.fechaRequeridaValida(AYER,HOY_ISO),/no puede ser anterior a hoy/);
assert.throws(()=>P.fechaRequeridaValida('31/12/2026',HOY_ISO),/AAAA-MM-DD/);

// Aprobación renglón por renglón
const RL=[{renglon:1,descripcion:'Cable THW 10',cantidad:100,unidad:'M',notas:''},{renglon:2,descripcion:'Pintura',cantidad:2,unidad:'CUBETA',notas:''},
  {renglon:3,descripcion:'Tubo conduit 3/4',cantidad:12,unidad:'PZA',notas:''}];
const ap=P.normalizarAprobacion({prioridad:'urgente',renglones:[{renglon:1,aprobado:true,cantidad:'80'},{renglon:2,aprobado:false,comentario:' Ya hay en  almacén '},{renglon:3,aprobado:true,cantidad:''}]},RL);
assert.deepEqual(plain(ap),{prioridad:'Urgente',nota:'',renglones:[{renglon:1,aprobado:true,cantidad:80,comentario:''},
  {renglon:2,aprobado:false,cantidad:0,comentario:'Ya hay en almacén'},{renglon:3,aprobado:true,cantidad:12,comentario:''}]});
for(const [mal,re] of [
  [{renglones:[{renglon:1,aprobado:true}]},/Aprueba o rechaza el renglón 2/],
  [{renglones:[{renglon:1,aprobado:true},{renglon:2,aprobado:false},{renglon:3,aprobado:true}]},/por qué rechazas el renglón 2/],
  [{renglones:[{renglon:1,aprobado:true,cantidad:101},{renglon:2,aprobado:true},{renglon:3,aprobado:true}]},/no puede ser mayor a la pedida \(100\)/],
  [{renglones:[{renglon:1,aprobado:true,cantidad:0},{renglon:2,aprobado:true},{renglon:3,aprobado:true}]},/mayor a 0/],
  [{renglones:[1,2,3].map(n=>({renglon:n,aprobado:false,comentario:'No va'}))},/No aprobaste ningún renglón/],
  [{prioridad:'Ya',renglones:[1,2,3].map(n=>({renglon:n,aprobado:true}))},/Prioridad no válida/],
  [{renglones:[{renglon:1,aprobado:'si'},{renglon:2,aprobado:true},{renglon:3,aprobado:true}]},/Aprueba o rechaza el renglón 1/]]){
  assert.throws(()=>P.normalizarAprobacion(mal,RL),re,JSON.stringify(mal).slice(0,80));
}
const APR=plain(P.renglonesAprobados(RL,ap));
assert.deepEqual(APR.map(a=>a.renglon+':'+a.cantidad+'/'+a.pedida),['1:80/100','3:12/12']);

// Propuesta de compras
const CTXP={aprobados:APR,moneda:'MXN',ubicacion:'Manzanillo, Col.',hoy:HOY_ISO,ivaTasa:0.16,solicitante:'obrero@helgen.tech',receptores:['obrero@helgen.tech','rosa@helgen.tech']};
const BASEP={proveedor:{razonSocial:'Ferretera del Puerto'},fechaEntrega:MANANA,condicionesPago:'Contado',diasCredito:0,
  renglones:[{renglon:1,disponibilidad:'exacto',costo:10},{renglon:3,disponibilidad:'Sustituto',descripcion:'Tubo conduit 1"',costo:50},
    {renglon:0,disponibilidad:'Adicional',descripcion:'Flete',unidad:'SERV',cantidad:1,costo:200,recibir:false}]};
const pr=P.normalizarPropuesta(BASEP,CTXP);
assert.deepEqual(plain(pr.renglones).map(r=>[r.renglon,r.disponibilidad,r.descripcion,r.unidad,r.cantidad,r.costo,r.importe,r.recibir]),
  [[1,'Exacto','Cable THW 10','M',80,10,800,true],[3,'Sustituto','Tubo conduit 1"','PZA',12,50,600,true],[0,'Adicional','Flete','SERV',1,200,200,false]]);
assert.deepEqual([pr.subtotal,pr.iva,pr.total,pr.recibe,pr.lugarEntrega],[1600,256,1856,'obrero@helgen.tech','Manzanillo, Col.'],'por omisión recibe quien pidió');
assert.deepEqual(plain(P.renglonesSinRecepcion(pr)),[3],'el flete (renglón 3 de la orden) no se recibe');
const pr2=P.normalizarPropuesta({...BASEP,recibe:'Rosa@Helgen.tech',renglones:[{renglon:1,disponibilidad:'No disponible',nota:'Agotado'},{renglon:3,disponibilidad:'Exacto',costo:5}]},CTXP);
assert.deepEqual(plain(pr2.renglones).map(r=>r.disponibilidad+':'+r.cantidad+':'+r.importe+':'+r.nota),['No disponible:0:0:Agotado','Exacto:12:60:']);
assert.deepEqual([pr2.subtotal,pr2.recibe],[60,'rosa@helgen.tech']);
assert.deepEqual(plain(P.ordenDePropuesta(pr2).renglones),[{clave:'',descripcion:'Tubo conduit 3/4',unidad:'PZA',cantidad:12,costo:5}],'la orden solo lleva lo que se compra');
for(const [mal,re] of [
  [{renglones:[{renglon:1,disponibilidad:'Exacto',costo:1}]},/Falta la propuesta del renglón 3/],
  [{renglones:[...BASEP.renglones,{renglon:2,disponibilidad:'Exacto',costo:1}]},/renglón 2 no está aprobado/],
  [{renglones:[{renglon:1,disponibilidad:'Exacto',costo:1},{renglon:1,disponibilidad:'Exacto',costo:1},{renglon:3,disponibilidad:'Exacto',costo:1}]},/viene dos veces/],
  [{renglones:[{renglon:1,disponibilidad:'Exacto',costo:1},{renglon:3,disponibilidad:'Sustituto',costo:1}]},/qué se comprará en lugar del renglón 3/],
  [{renglones:[{renglon:1,disponibilidad:'Quizá',costo:1},{renglon:3,disponibilidad:'Exacto',costo:1}]},/exacto, sustituto o no disponible/],
  [{renglones:[{renglon:1,disponibilidad:'No disponible'},{renglon:3,disponibilidad:'No disponible'}]},/Ningún renglón se puede comprar/],
  [{renglones:[{renglon:1,disponibilidad:'No disponible'},{renglon:3,disponibilidad:'No disponible'},{disponibilidad:'Adicional',descripcion:'Flete',cantidad:1,costo:1,recibir:false}]},/Al menos un renglón debe recibirse/],
  [{renglones:[{renglon:1,disponibilidad:'Exacto'},{renglon:3,disponibilidad:'Exacto',costo:1}]},/Captura el costo unitario de "Cable THW 10"/],
  [{recibe:'ana@helgen.tech'},/Quien recibe \(ana@helgen.tech\) debe tener acceso a Requisiciones/],
  [{proveedor:{}},/razón social del proveedor/],
  [{fechaEntrega:AYER},/no puede ser anterior a hoy/]]){
  assert.throws(()=>P.normalizarPropuesta({...BASEP,...mal},CTXP),re,JSON.stringify(mal).slice(0,80));
}

// Avance y recepción
const OCR=[{clave:'',descripcion:'Cable THW 10',unidad:'M',cantidad:80},{descripcion:'Tubo',unidad:'PZA',cantidad:12},{descripcion:'Flete',unidad:'SERV',cantidad:1}];
const av=P.avanceRecepcion(OCR,[{renglon:1,cantidad:50,estado:'Vigente'},{renglon:1,cantidad:30,estado:'Cancelado'}],[3]);
assert.deepEqual(plain(av.lineas).map(l=>l.renglon+':'+l.recibido+'/'+l.pedido+'→'+l.pendiente),['1:50/80→30','2:0/12→12'],'solo cuentan las vigentes');
assert.deepEqual([av.completo,av.algo],[false,true]);
const rc=P.normalizarRecepcion({sitio:'manzanillo (timsa)',renglones:[{renglon:1,cantidad:'30'},{renglon:2,cantidad:''}],notas:' ok '},av.lineas,SIT);
assert.deepEqual(plain(rc),{renglones:[{renglon:1,clave:'',descripcion:'Cable THW 10',unidad:'M',cantidad:30}],sitio:'Manzanillo (TIMSA)',notas:'ok',completo:false});
assert.equal(P.normalizarRecepcion({sitio:'Querétaro',renglones:[{renglon:1,cantidad:30},{renglon:2,cantidad:12}]},av.lineas,SIT).completo,true);
assert.equal(P.normalizarRecepcion({sitio:'Querétaro',final:true,notas:'El tubo ya no llegará',renglones:[{renglon:1,cantidad:30}]},av.lineas,SIT).completo,true);
for(const [mal,re] of [[{renglones:[{renglon:1,cantidad:31}]},/solo faltan 30 M por recibir/],[{renglones:[{renglon:1,cantidad:0}]},/al menos un renglón/],
  [{renglones:[{renglon:1,cantidad:-1}]},/no es válida/],[{renglones:[{renglon:3,cantidad:1}]},/no tiene el renglón 3/],[{sitio:''},/Elige el sitio/],
  [{final:true,renglones:[{renglon:1,cantidad:1}]},/qué faltó/]]){
  assert.throws(()=>P.normalizarRecepcion({sitio:'Querétaro',renglones:[{renglon:1,cantidad:1}],...mal},av.lineas,SIT),re,JSON.stringify(mal));
}

// Estados nuevos
for(const [acc,de,a] of [['aprobar','Solicitada','Aprobada'],['cotizar','Aprobada','Cotizada'],['cotizar','Cotizada','Cotizada'],
  ['regresarACompras','Cotizada','Aprobada'],['visto','Cotizada','Autorizada'],['recibir','Autorizada','Recibida'],['recibirPagada','Pagada','Cerrada'],
  ['pagarRecibida','Recibida','Cerrada'],['cancelarOcAprobada','Autorizada','Aprobada'],['cancelarRecepcion','Recibida','Autorizada'],
  ['rechazar','Cotizada','Rechazada'],['rechazar','Aprobada','Rechazada'],['devolver','Aprobada','Devuelta']]) assert.equal(P.transicionReq(de,acc),a,acc+' desde '+de);
for(const [acc,de] of [['aprobar','Aprobada'],['visto','Aprobada'],['cotizar','Solicitada'],['recibir','Pagada'],['pagar','Recibida'],
  ['devolver','Cotizada'],['cancelar','Aprobada'],['cerrar','Recibida']]) assert.throws(()=>P.transicionReq(de,acc),/no se puede/,acc+' desde '+de);

// ================= Servidor (doPost) =================
const p1=ok('ana','crearProyecto',{nombre:'HBOX Manzanillo',ubicacion:'Manzanillo, Col.',cliente:{nombre:'Cliente Secreto',empresa:'Empresa Oculta SA'},idSolicitud:'p1'}).folio;
const c1=ok('ana','guardarCotizacion',{cliente:{nombre:'Cliente Secreto',empresa:'Empresa Oculta SA'},items:[{descripcion:'Servicio',cantidad:1,precio:98765}],proyectoFolio:p1,idSolicitud:'c1'}).folio;
ok('efrain','marcarAceptada',p1,c1,true); ok('efrain','firmarContrato',p1,HOY_ISO);

// --- Sin ROL_OPERACIONES: todo como antes ---
let dA=ok('adri','getDatosIniciales');
assert.deepEqual([dA.soloRequisicion,dA.permisos.operaciones,dA.permisos.flujoOperaciones],[true,false,false]);
assert.deepEqual(plain(dA.sitios),SIT,'sitios de Config (la clave SITIOS se agrega sola)');
assert(db.pest.Config.m.some(r=>r[0]==='SITIOS'));
falla('adri','listarOperaciones',[],/No tienes permiso de operaciones/,'PERMISO');
falla('obrero','guardarRequisicion',[{proyectoFolio:p1,renglones:[{descripcion:'A',cantidad:1}]}],/Adjunta la cotización/);
falla('obrero','registrarRecepcion',[{reqFolio:'REQ-'+ANIO+'-0001'}],/usa "Recibí el material"/);

// --- Con ROL_OPERACIONES: flujo nuevo (sin publicar nada) ---
props.ROL_OPERACIONES='adri@helgen.tech, leo@helgen.tech';
dA=ok('adri','getDatosIniciales');
assert.deepEqual([dA.soloRequisicion,dA.permisos.requisicion,dA.permisos.operaciones,dA.permisos.flujoOperaciones,dA.permisos.compras],[true,true,true,true,false]);
assert.equal(dA.ops.requisiciones,null,'sin caché: la interfaz la pide al abrir la pestaña');
assert.deepEqual(ok('adri','listarOperaciones'),[]);
assert.deepEqual([ok('obrero','getDatosIniciales').permisos.operaciones,ok('obrero','getDatosIniciales').permisos.flujoOperaciones],[false,true]);
falla('obrero','listarOperaciones',[],/permiso de operaciones/,'PERMISO');
for(const [f,args] of [['getClientes',[]],['listarRequisiciones',['']],['cuentasPorPagar',[]]]) falla('adri',f,args,/solo tiene acceso a Requisiciones/,'PERMISO');

// Pedir: sitio obligatorio (de la lista), fecha opcional no anterior a hoy, cotización opcional
const nuevaReq=extra=>({proyectoFolio:p1,sitio:'manzanillo (timsa)',fechaRequerida:MANANA,renglones:[{descripcion:'Cable THW 10',cantidad:100,unidad:'m'},
  {descripcion:'Pintura',cantidad:2,unidad:'cubeta'},{descripcion:'Tubo conduit 3/4',cantidad:12,unidad:'pza'}],idSolicitud:'q'+(++nId),...extra});
falla('obrero','guardarRequisicion',[nuevaReq({sitio:''})],/Elige el sitio/);
falla('obrero','guardarRequisicion',[nuevaReq({sitio:'Monterrey'})],/no está en la lista de sitios/);
falla('obrero','guardarRequisicion',[nuevaReq({fechaRequerida:AYER})],/anterior a hoy/);
const r1=ok('obrero','guardarRequisicion',nuevaReq()).folio;
const LC=libros[props.COMPRAS_DB_ID], H=n=>LC.pest[n].m;
assert.deepEqual(H('Requisiciones')[0].slice(14),['sitio','fecha_requerida','prioridad','aprobacion (JSON)','aprobo_email','fecha_aprobacion',
  'propuesta (JSON)','vobo_email','fecha_vobo','recibe_email','origen_folio']);
let fr=H('Requisiciones').find(x=>x[0]===r1);
assert.deepEqual([fr[5],fr[7],fr[14],fr[15]],['Solicitada','','Manzanillo (TIMSA)',MANANA],'sin cotización; sitio como está en la lista');

// Compras ya no autoriza ni revisa la Solicitada
falla('pedro','autorizarRequisicion',[r1,{}],/visto bueno de operaciones/);
falla('pedro','devolverRequisicion',[r1,'Falta algo importante'],/permiso de operaciones/,'PERMISO');
falla('pedro','rechazarRequisicion',[r1,'No se compra esto'],/permiso de operaciones/,'PERMISO');
let vc=ok('pedro','getRequisicion',r1);
assert.deepEqual([vc.flujoOperaciones,vc.puedeAutorizar,vc.puedeRevisar,vc.puedeCotizar,vc.puedeDevolver],[true,false,false,false,false]);

// Operaciones: lista y vista (sin cliente ni montos del contrato)
assert.deepEqual(ok('adri','listarOperaciones').map(x=>x.folio+':'+x.estado+':'+x.sitio+':'+x.renglones),[r1+':Solicitada:Manzanillo (TIMSA):3']);
let vo=ok('adri','getRequisicionOperaciones',r1);
assert.deepEqual([vo.puedeAprobar,vo.puedeDevolver,vo.puedeRechazar,vo.puedeVisto,vo.esPropia,vo.renglones.length],[true,true,true,false,false,3]);
assert(!/Cliente Secreto|Empresa Oculta|98765/.test(JSON.stringify(vo)),'operaciones no ve cliente ni montos del contrato');

// Aprobar renglón por renglón
falla('adri','aprobarRequisicion',[r1,{renglones:[{renglon:1,aprobado:true}]}],/Aprueba o rechaza el renglón 2/);
falla('pedro','aprobarRequisicion',[r1,{}],/permiso de operaciones/,'PERMISO');
vo=ok('adri','aprobarRequisicion',r1,{prioridad:'Urgente',renglones:[{renglon:1,aprobado:true,cantidad:80},{renglon:2,aprobado:false,comentario:'Ya hay en almacén'},{renglon:3,aprobado:true}]});
assert.deepEqual([vo.requisicion.estado,vo.requisicion.prioridad,vo.requisicion.aproboEmail,vo.puedeAprobar,vo.puedeRechazar],['Aprobada','Urgente','adri@helgen.tech',false,true]);
let mo=ok('obrero','misRequisiciones').find(x=>x.folio===r1);
assert.deepEqual(mo.renglones.map(x=>x.decision+':'+x.cantidadAprobada+':'+(x.comentario||'')),['Aprobado:80:','Rechazado:0:Ya hay en almacén','Aprobado:12:']);
assert(/2 de 3 renglón\(es\) aprobado\(s\) · prioridad Urgente · cantidad ajustada: 1 \(80 de 100\) · rechazado\(s\): 2 \(Ya hay en almacén\)/.test(mo.eventos.at(-1).nota),mo.eventos.at(-1).nota);
falla('adri','aprobarRequisicion',[r1,{}],/está aprobada: no se puede aprobar/);

// Nadie aprueba lo que pidió (adri pide; leo aprueba)
const todo=n=>({renglones:Array.from({length:n},(_,i)=>({renglon:i+1,aprobado:true}))});
const rA=ok('adri','guardarRequisicion',nuevaReq({renglones:[{descripcion:'Brida',cantidad:4},{descripcion:'Tornillo',cantidad:10}]})).folio;
falla('adri','aprobarRequisicion',[rA,todo(2)],/tu propia requisición/,'PERMISO');
assert.deepEqual([ok('adri','getRequisicionOperaciones',rA).puedeAprobar,ok('adri','getRequisicionOperaciones',rA).esPropia],[false,true]);
assert.equal(ok('leo','aprobarRequisicion',rA,todo(2)).requisicion.estado,'Aprobada');

// Compras propone sobre lo aprobado
vc=ok('pedro','getRequisicion',r1);
assert.deepEqual([vc.puedeCotizar,vc.puedeDevolver,vc.puedeSeparar,vc.aprobados.map(a=>a.renglon+':'+a.cantidad).join()],[true,true,true,'1:80,3:12']);
assert.deepEqual(plain(vc.sitios),SIT); assert(vc.receptores.includes('rosa@helgen.tech')&&!vc.receptores.includes('ana@helgen.tech'));
const PROP=extra=>({proveedor:{razonSocial:'Ferretera del Puerto',rfc:''},fechaEntrega:MANANA,condicionesPago:'Contado',diasCredito:0,recibe:'rosa@helgen.tech',
  renglones:[{renglon:1,disponibilidad:'Exacto',costo:10},{renglon:3,disponibilidad:'Sustituto',descripcion:'Tubo conduit 1"',costo:50},
    {renglon:0,disponibilidad:'Adicional',descripcion:'Flete',unidad:'SERV',cantidad:1,costo:200,recibir:false}],idSolicitud:'pp'+(++nId),...extra});
falla('pedro','cotizarRequisicion',[r1,PROP({recibe:'ana@helgen.tech'})],/debe tener acceso a Requisiciones/);
falla('adri','cotizarRequisicion',[r1,PROP()],/solo tiene acceso a Requisiciones/,'PERMISO');
let rp=ok('pedro','cotizarRequisicion',r1,PROP({cotizacion:{nombre:'cot.pdf',datos:PDF},idSolicitud:'prop1'}));
assert.deepEqual([rp.version,rp.vista.requisicion.estado,rp.vista.requisicion.propuesta.total,rp.vista.requisicion.recibeEmail],[1,'Cotizada',1856,'rosa@helgen.tech']);
assert.equal(ok('pedro','cotizarRequisicion',r1,PROP({idSolicitud:'prop1'})).version,1,'idempotencia');
const archProp=rp.vista.requisicion.propuesta.archivos[0];
assert.deepEqual([archivos[archProp.id].blob.name,archivos[archProp.id].acceso],[r1+' — Cotización de compras.pdf','PRIVATE']);
// Quien pidió no ve proveedor ni montos; el historial tampoco
mo=ok('obrero','misRequisiciones').find(x=>x.folio===r1);
assert.deepEqual([mo.estado,mo.compra],['Cotizada',null]);
assert(!/Ferretera|1856|1,856|costo/.test(JSON.stringify(ok('obrero','misRequisiciones'))),'sin proveedor ni montos');
assert(/Propuesta de compra: 1 exacto\(s\), 1 sustituto\(s\), 1 adicional\(es\)/.test(mo.eventos.at(-1).nota),mo.eventos.at(-1).nota);

// Operaciones ve la propuesta con costos; corregida = versión 2; el visto bueno es sobre la última
vo=ok('adri','getRequisicionOperaciones',r1);
assert.deepEqual([vo.puedeVisto,vo.propuesta.version,vo.propuesta.total,vo.propuesta.proveedor.razonSocial,vo.propuesta.archivos.length,vo.propuesta.archivos[0].url],
  [true,1,1856,'Ferretera del Puerto',1,undefined]);
const lineas=c=>[{renglon:1,disponibilidad:'Exacto',costo:c},{renglon:3,disponibilidad:'Sustituto',descripcion:'Tubo conduit 1"',costo:50},
  {renglon:0,disponibilidad:'Adicional',descripcion:'Flete',unidad:'SERV',cantidad:1,costo:200,recibir:false}];
rp=ok('pedro','cotizarRequisicion',r1,PROP({renglones:lineas(9)}));
assert.deepEqual([rp.version,rp.vista.requisicion.propuesta.archivos.length],[2,1],'conserva los archivos');
falla('adri','autorizarPropuesta',[r1,1,'v1'],/cambió la propuesta \(ahora es la versión 2\)/);
// Regresar a compras
falla('adri','regresarACompras',[r1,'no'],/qué debe cambiar/);
vo=ok('adri','regresarACompras',r1,'El cable cuesta menos con otro proveedor');
assert.deepEqual([vo.requisicion.estado,vo.requisicion.motivo],['Aprobada','El cable cuesta menos con otro proveedor']);
assert.equal(ok('obrero','misRequisiciones').find(x=>x.folio===r1).motivo,'','quien pidió no ve lo que operaciones le dijo a compras');
rp=ok('pedro','cotizarRequisicion',r1,PROP({renglones:lineas(8)}));
assert.equal(rp.version,3);

// Quien preparó no da el visto bueno (leo: compras y operaciones) y nadie a su propia requisición
ok('leo','cotizarRequisicion',rA,{proveedor:{razonSocial:'Tornillos SA'},fechaEntrega:MANANA,condicionesPago:'Contado',diasCredito:0,
  renglones:[{renglon:1,disponibilidad:'Exacto',costo:5},{renglon:2,disponibilidad:'Exacto',costo:1}],idSolicitud:'pa'});
let voA=ok('leo','getRequisicionOperaciones',rA);
assert.deepEqual([voA.preparoPropuesta,voA.puedeVisto],[true,false]);
falla('leo','autorizarPropuesta',[rA,1,'x1'],/una propuesta que tú preparaste/,'PERMISO');
falla('adri','autorizarPropuesta',[rA,1,'x2'],/tu propia requisición/,'PERMISO');
voA=ok('leo','rechazarRequisicion',rA,'Se compró con otro proyecto');
assert.equal(voA.requisicion.estado,'Rechazada','operaciones rechaza también en Cotizada');

// Visto bueno → orden de compra (Elaboró = compras; Autorizó = operaciones)
const nOC=H('OrdenesCompra').length;
const vb=ok('adri','autorizarPropuesta',r1,3,'vb1');
assert.equal(ok('adri','autorizarPropuesta',r1,3,'vb1').ocFolio,vb.ocFolio,'idempotencia');
assert.equal(H('OrdenesCompra').length,nOC+1);
const ocF=vb.ocFolio, filaOc=H('OrdenesCompra').find(x=>x[0]===ocF);
assert.deepEqual([vb.vista.requisicion.estado,vb.vista.requisicion.voboEmail,filaOc[17],filaOc[25],filaOc[34],filaOc[28]],
  ['Autorizada','adri@helgen.tech',1670.4,'pedro@helgen.tech',r1,'Emitida']);
assert.deepEqual(JSON.parse(filaOc[21]).map(r=>r.descripcion+':'+r.cantidad+':'+r.costo),['Cable THW 10:80:8','Tubo conduit 1":12:50','Flete:1:200']);
assert(/Elaboró: Pedro Ruiz \(pedro@helgen.tech\) &nbsp;·&nbsp; Autorizó: Adriana Del Ángel \(adri@helgen.tech\)/.test(archivos[filaOc[23]].blob.html),'PDF con quién elaboró y quién autorizó');

// Quien pidió ve lo que se compra (sin costos) y quién recibe; quien recibe también la ve
mo=ok('obrero','misRequisiciones').find(x=>x.folio===r1);
assert.deepEqual(mo.compra.map(c=>c.disponibilidad+':'+c.descripcion+':'+c.cantidad+':'+c.recibir),['Exacto:Cable THW 10:80:true','Sustituto:Tubo conduit 1":12:true','Adicional:Flete:1:false']);
assert.deepEqual(mo.avance.map(l=>l.renglon+':'+l.pendiente),['1:80','2:12'],'el flete no se recibe');
assert.deepEqual([mo.recibe,mo.esReceptor,mo.puedeRecibir,mo.puedeCerrar],['rosa@helgen.tech',false,true,false]);
assert(!/Ferretera|1670|costo|OC-/.test(JSON.stringify(mo)),'sin proveedor, montos ni folio de la orden');
let mr=ok('rosa','misRequisiciones').find(x=>x.folio===r1);
assert.deepEqual([mr.esReceptor,mr.puedeRecibir,mr.puedeCancelar,mr.puedeEditar],[true,true,false,false]);

// Recepción parcial (rosa) con foto; luis y ana no pueden; compras en su lugar con notas
const recibir=(quien,extra)=>ok(quien,'registrarRecepcion',{reqFolio:r1,sitio:'Manzanillo (TIMSA)',idSolicitud:'rc'+(++nId),...extra});
falla('luis','registrarRecepcion',[{reqFolio:r1,sitio:'Querétaro',renglones:[{renglon:1,cantidad:1}]}],/Solo quien pidió la requisición .* o quien la recibe/,'PERMISO');
falla('ana','registrarRecepcion',[{reqFolio:r1}],/No tienes permiso para registrar recepciones/,'PERMISO');
falla('rosa','registrarRecepcion',[{reqFolio:r1,sitio:'Manzanillo (TIMSA)',renglones:[{renglon:1,cantidad:81}]}],/solo faltan 80 M por recibir/);
falla('rosa','registrarRecepcion',[{reqFolio:r1,sitio:'Manzanillo (TIMSA)',renglones:[{renglon:3,cantidad:1}]}],/no tiene el renglón 3/);
let rr=recibir('rosa',{renglones:[{renglon:1,cantidad:50}],evidencia:{nombre:'remision.jpg',datos:JPG},notas:'Faltan 30 m',idSolicitud:'rcR'});
assert.equal(recibir('rosa',{renglones:[{renglon:1,cantidad:50}],idSolicitud:'rcR'}).folio,REC('0001'),'idempotencia');
assert.deepEqual([rr.folio,rr.completo,rr.estado],[REC('0001'),false,'Autorizada']);
const movs=()=>H('MovimientosInventario').slice(1);
assert.deepEqual(movs().map(m=>[m[0],m[3],m[4],m[6],m[7],m[8],m[10],m[12],m[13],m[18]].join('|')),
  [[REC('0001'),'Entrada por compra','Manzanillo (TIMSA)',r1,ocF,1,'Cable THW 10',50,'rosa@helgen.tech','Vigente'].join('|')]);
const foto=archivos[movs()[0][16]];
assert.deepEqual([foto.blob.name,foto.acceso],[r1+' — Recepción '+REC('0001')+'.jpg','PRIVATE']);
mo=ok('obrero','misRequisiciones').find(x=>x.folio===r1);
assert.deepEqual([mo.estado,mo.avance.map(l=>l.recibido+'/'+l.pedido).join(),mo.recepciones.length,mo.recepciones[0].sitio],['Autorizada','50/80,0/12',1,'Manzanillo (TIMSA)']);
assert.equal(mo.recepciones[0].evidenciaUrl,undefined,'quien pidió no recibe la liga de la foto');
falla('pedro','registrarRecepcion',[{reqFolio:r1,sitio:'Querétaro',renglones:[{renglon:2,cantidad:1}]}],/escribe en las notas por qué/);

// Completa sin pagar: Recibida (la orden sigue Emitida, con fecha de recepción)
rr=recibir('obrero',{renglones:[{renglon:1,cantidad:30},{renglon:2,cantidad:12}]});
assert.deepEqual([rr.completo,rr.estado],[true,'Recibida']);
let fo=H('OrdenesCompra').find(x=>x[0]===ocF);
assert.deepEqual([fo[28],fo[29],fo[30]],['Emitida',HOY_ISO,'obrero@helgen.tech']);
falla('rosa','registrarRecepcion',[{reqFolio:r1,sitio:'Querétaro',renglones:[{renglon:1,cantidad:1}]}],/está recibida: no tiene material por recibir/);
vc=ok('pedro','getRequisicion',r1);
assert.deepEqual([vc.puedePagar,vc.puedeCancelarPago,vc.recepcionCompleta,vc.recepciones.length,!!vc.recepciones[0].evidenciaUrl],[true,false,true,2,true]);
falla('pedro','cancelarOrdenCompra',[ocF,'Ya no la queremos'],/ya tiene material recibido/);
// Pagar: Recibida → Cerrada y la orden Recibida
const pagar=(folio,monto)=>ok('pedro','registrarPagoProveedor',{reqFolio:folio,fecha:HOY_ISO,monto,monedaPago:'MXN',metodo:'Transferencia',referencia:'SPEI',
  comprobante:{nombre:'c.pdf',datos:PDF},idSolicitud:'pg'+(++nId)});
let pg=pagar(r1,1670.4);
fo=H('OrdenesCompra').find(x=>x[0]===ocF);
assert.deepEqual([pg.vista.requisicion.estado,fo[28]],['Cerrada','Recibida']);
falla('pedro','cancelarPagoProveedor',[pg.folio,'Me equivoqué de monto'],/ya está cerrada/);
falla('pedro','cancelarRecepcion',[REC('0001'),'Cantidad equivocada'],/ya está cerrada/);

// Separar renglones (otro proveedor) y pedir aclaración
const r2=ok('obrero','guardarRequisicion',nuevaReq({sitio:'Querétaro',fechaRequerida:'',renglones:[{descripcion:'Antena GNSS',cantidad:2,unidad:'pza'},
  {descripcion:'Cable coaxial',cantidad:10,unidad:'m'},{descripcion:'Conector TNC',cantidad:4,unidad:'pza'}]})).folio;
ok('adri','aprobarRequisicion',r2,todo(3));
falla('pedro','separarRequisicion',[r2,[1,2,3],'Otro proveedor para todo'],/Deja al menos un renglón aprobado/);
falla('pedro','separarRequisicion',[r2,[],'Otro proveedor'],/Elige los renglones/);
falla('pedro','separarRequisicion',[r2,[3],'no'],/por qué separas/);
const sp=ok('pedro','separarRequisicion',r2,[3],'El conector lo vende otro proveedor');
const r3=sp.folio;
assert.deepEqual([sp.vista.renglones.map(x=>x.renglon+':'+x.descripcion+':'+x.decision).join(),sp.vista.requisicion.estado,sp.vista.puedeSeparar],
  ['1:Antena GNSS:Aprobado,2:Cable coaxial:Aprobado','Aprobada',true]);
let v3=ok('pedro','getRequisicion',r3);
assert.deepEqual([v3.requisicion.estado,v3.requisicion.origenFolio,v3.requisicion.sitio,v3.requisicion.solicitanteEmail,v3.requisicion.aproboEmail,
  v3.renglones.map(x=>x.renglon+':'+x.descripcion+':'+x.decision).join(),v3.puedeSeparar],
  ['Aprobada',r2,'Querétaro','obrero@helgen.tech','adri@helgen.tech','1:Conector TNC:Aprobado',false]);
assert(ok('obrero','misRequisiciones').some(x=>x.folio===r3),'quien pidió ve la nueva');
v3=ok('pedro','devolverRequisicion',r3,'¿Conector macho o hembra?');
assert.equal(v3.requisicion.estado,'Devuelta');
ok('obrero','guardarRequisicion',{folio:r3,sitio:'Querétaro',renglones:[{descripcion:'Conector TNC macho',cantidad:4,unidad:'pza'}],idSolicitud:'re3'});
v3=ok('pedro','getRequisicion',r3);
assert.deepEqual([v3.requisicion.estado,v3.requisicion.aprobacion,v3.renglones[0].decision],['Solicitada',null,undefined],'al reenviar, operaciones la vuelve a aprobar');
falla('pedro','cotizarRequisicion',[r3,PROP()],/está solicitada: no se puede mandar la propuesta de/);

// Pagar antes de recibir; cancelar una recepción equivocada; última recepción con faltante → Cerrada
const prop2={proveedor:{razonSocial:'GNSS Store'},fechaEntrega:MANANA,condicionesPago:'Contado',diasCredito:0,
  renglones:[{renglon:1,disponibilidad:'Exacto',costo:1000},{renglon:2,disponibilidad:'Exacto',costo:10}],idSolicitud:'p2x'};
ok('pedro','cotizarRequisicion',r2,prop2);
const oc2=ok('adri','autorizarPropuesta',r2,1,'vb2').ocFolio;
pg=pagar(r2,2436);
assert.equal(pg.vista.requisicion.estado,'Pagada');
rr=ok('obrero','registrarRecepcion',{reqFolio:r2,sitio:'Querétaro',renglones:[{renglon:1,cantidad:2}],idSolicitud:'r2a'});
assert.deepEqual([rr.completo,rr.estado],[false,'Pagada']);
const recMal=rr.folio;
vc=ok('pedro','cancelarRecepcion',recMal,'Llegaron a Manzanillo, no a Querétaro');
assert.deepEqual(movs().filter(m=>m[0]===recMal).map(m=>m[18]+':'+m[19]+':'+m[21]),['Cancelado:pedro@helgen.tech:Llegaron a Manzanillo, no a Querétaro']);
assert.deepEqual([vc.requisicion.estado,vc.avance.map(l=>l.recibido).join()],['Pagada','0,0']);
falla('pedro','cancelarRecepcion',[recMal,'Otra vez lo mismo'],/ya está cancelada/);
falla('obrero','cancelarRecepcion',[recMal,'Otra vez lo mismo'],/permiso de compras/,'PERMISO');
rr=ok('obrero','registrarRecepcion',{reqFolio:r2,sitio:'Manzanillo (TIMSA)',renglones:[{renglon:1,cantidad:2},{renglon:2,cantidad:8}],final:true,notas:'Faltaron 2 m de cable',idSolicitud:'r2b'});
assert.deepEqual([rr.completo,rr.estado],[true,'Cerrada']);
fo=H('OrdenesCompra').find(x=>x[0]===oc2);
assert.deepEqual([fo[28],fo[30]],['Recibida','obrero@helgen.tech']);
assert(/última, con faltante/.test(ok('obrero','misRequisiciones').find(x=>x.folio===r2).eventos.at(-1).nota));

// Cancelar la orden con aprobación: vuelve a Aprobada para cotizar de nuevo
const r4=ok('obrero','guardarRequisicion',nuevaReq({renglones:[{descripcion:'Batería 12V',cantidad:1}]})).folio;
ok('adri','aprobarRequisicion',r4,todo(1));
ok('pedro','cotizarRequisicion',r4,{...prop2,renglones:[{renglon:1,disponibilidad:'Exacto',costo:500}],idSolicitud:'p4'});
const oc4=ok('adri','autorizarPropuesta',r4,1,'vb4').ocFolio;
ok('pedro','cancelarOrdenCompra',oc4,'Proveedor sin existencias');
vc=ok('pedro','getRequisicion',r4);
assert.deepEqual([vc.requisicion.estado,vc.requisicion.ocFolio,vc.requisicion.voboEmail,vc.puedeCotizar,vc.requisicion.propuesta.version],['Aprobada','','',true,1]);
assert.equal(ok('pedro','cotizarRequisicion',r4,{...prop2,renglones:[{renglon:1,disponibilidad:'Exacto',costo:550}],idSolicitud:'p4b'}).version,2);
const fr4=H('Requisiciones').find(x=>x[0]===r4), pj=JSON.parse(fr4[20]); pj.fechaEntrega=AYER; fr4[20]=JSON.stringify(pj);
falla('adri','autorizarPropuesta',[r4,2,'vb4b'],/ya pasó: regrésala a compras/);

// "Recibí el material" ya no; archivos sin acceso a Drive
falla('obrero','cerrarRequisicion',[r1,''],/Registrar recepción/);
const arch=ok('adri','archivoRequisicion',r1,archProp.id);
assert.deepEqual([arch.nombre,arch.mime,Buffer.from(arch.datos,'base64').toString().slice(0,5)],[r1+' — Cotización de compras.pdf','application/pdf','%PDF-']);
falla('obrero','archivoRequisicion',[r1,archProp.id],/No tienes acceso a ese archivo/,'PERMISO');
falla('adri','archivoRequisicion',[r1,'otro-id'],/No tienes acceso a ese archivo/,'PERMISO');

// Sincronización de operaciones
const sv=ok('adri','sincronizar',{},{opsReq:r1});
assert(Array.isArray(sv.opsRequisiciones)&&sv.opsRequisicion.requisicion.folio===r1);
assert.deepEqual([sv.comRequisiciones,sv.requisicion],[undefined,undefined],'operaciones sin compras no recibe lo de compras');
const sv2=ok('adri','sincronizar',sv.versiones,{opsReq:r1});
assert.deepEqual([sv2.cambios,sv2.opsRequisiciones],[[],undefined]);
dA=ok('adri','getDatosIniciales');
assert(Array.isArray(dA.ops.requisiciones)&&dA.ops.requisiciones.length>=5,'ya en caché');
assert(dA.ops.requisiciones.find(x=>x.folio===r4).total===638,'el total solo de las que esperan el visto bueno');
assert.equal(dA.ops.requisiciones.find(x=>x.folio===r2).total,null);

// Sin ROL_OPERACIONES otra vez: el flujo de siempre; una que se quedó a medias se puede rechazar o devolver
props.ROL_OPERACIONES='';
const r5=ok('obrero','guardarRequisicion',{proyectoFolio:p1,renglones:[{descripcion:'Cinta',cantidad:1}],cotizacion:{nombre:'c.pdf',datos:PDF},idSolicitud:'r5'}).folio;
vc=ok('pedro','getRequisicion',r5);
assert.deepEqual([vc.flujoOperaciones,vc.puedeAutorizar,vc.puedeCotizar],[false,true,false]);
assert.equal(ok('pedro','rechazarRequisicion',r4,'Se quitó el flujo de operaciones').requisicion.estado,'Rechazada');

console.log('OK operaciones');
