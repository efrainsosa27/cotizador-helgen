// Compras (fase 3): órdenes de compra por proyecto (siempre desde una requisición autorizada), proveedores, PDF y margen. Permisos con ROL_COMPRAS validados en el
// servidor; el margen solo lo ve ROL_COBRANZA. Todo por doPost con tokens simulados (mismos simulacros que cobranza.test.js).
// Uso: node tests/compras.test.js .   (carpeta con Code.js y Logo.js)
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
libro('CAT','Catálogo',{Catalogo:hoja([['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó','Clave SAT','Unidad SAT']])});
const props={SPREADSHEET_ID:'DB',FOLDER_ID:pdfRaiz.id,CATALOGO_ID:'CAT',
  ROL_COBRANZA:'efrain@helgen.tech, tania@helgen.tech',ADMIN_DESBLOQUEO:'efrain@helgen.tech',
  ROL_COMPRAS:'efrain@helgen.tech; Pedro@helgen.tech, intruso@gmail.com',ROL_REQUISICION:'obrero@helgen.tech'},cache={};

// ---- Tokens: efrain (cobranza + compras + admin), tania (cobranza sin compras), pedro (compras sin cobranza), ana (vendedora sin rol),
// obrero (solo ROL_REQUISICION: pide materiales) ----
const ahora=Math.floor(Date.now()/1000);
const claims=(email,n,a)=>({aud:CID,iss:'https://accounts.google.com',exp:String(ahora+3000),email,email_verified:'true',hd:'helgen.tech',given_name:n,family_name:a});
const tokens={efrain:claims('efrain@helgen.tech','Efrain','Sosa'),tania:claims('tania@helgen.tech','Tania','R'),
  ana:claims('ana@helgen.tech','Ana','López'),obrero:claims('obrero@helgen.tech','Juan','Obrero'),pedro:claims('pedro@helgen.tech','Pedro','Ruiz'),intruso:{...claims('intruso@gmail.com','X','Y'),hd:undefined}};

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

// ================= Lógica pura =================
const P=ctx;
// Proveedor
const pv=P.normalizarProveedor({razonSocial:'  Paneles   del Bajío ',rfc:'pdb-200101-ab1',correo:' Ventas@PDB.mx ',telefono:'+52 442 000 0000'});
assert.deepEqual([pv.razonSocial,pv.rfc,pv.correo],['Paneles del Bajío','PDB200101AB1','ventas@pdb.mx']);
for(const [mal,re] of [[{},/razón social/],[{razonSocial:'X',rfc:'ABC'},/RFC del proveedor no es válido/],
  [{razonSocial:'X',correo:'no-es-correo'},/correo del proveedor/],[{razonSocial:'X'.repeat(151)},/150 caracteres/]]){
  assert.throws(()=>P.normalizarProveedor(mal),re,JSON.stringify(mal));
}
assert.equal(P.proveedorId({razonSocial:'X',rfc:'PDB200101AB1'}),'PDB200101AB1');
assert.equal(P.proveedorId({razonSocial:'Pánéles  del Bajío',rfc:'XEXX010101000'}),'SIN-RFC:paneles del bajio','RFC genérico no identifica');
assert.deepEqual({...P.fusionarProveedor({razonSocial:'A',contacto:'Luis',correo:'a@a.mx'},{razonSocial:'A SA',contacto:'',correo:'b@b.mx'})},
  {razonSocial:'A SA',rfc:'',contacto:'Luis',correo:'b@b.mx',telefono:''},'un dato vacío no borra uno anterior');
const pl=P.proveedoresDesdeFilas([['X1','Zeta','','','','',''],['R1','Acme','AAA010101AA1','','','',''],['R2','acme','BBB010101BB1','','','',''],['','','','','','','']]);
assert.deepEqual(pl.map(p=>p.etiqueta+'@'+p.fila),['Acme — AAA010101AA1@3','acme — BBB010101BB1@4','Zeta@2']);
// Orden de compra
const PRO={moneda:'MXN',ubicacion:'Querétaro, Qro.',hoy:'2026-10-20',ivaTasa:0.16};
const base={proveedor:{razonSocial:'Paneles del Bajío'},fechaEntrega:'2026-10-25',condicionesPago:' Crédito  30 días ',
  renglones:[{clave:'pan-550',descripcion:'Panel solar 550 W',unidad:'pza',cantidad:'10',costo:'2500.5'},{descripcion:'',cantidad:1,costo:''}]};
let o=P.normalizarOrdenCompra(base,PRO);
assert.deepEqual([o.lugarEntrega,o.condicionesPago,o.moneda,o.ivaTasa,o.subtotal,o.iva,o.total,o.tipoCambio,o.subtotalProyecto],
  ['Querétaro, Qro.','Crédito 30 días','MXN',0.16,25005,4000.8,29005.8,'',25005],'por omisión: ubicación del proyecto, IVA de Config, moneda del proyecto');
assert.deepEqual({...o.renglones[0]},{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA',cantidad:10,costo:2500.5,importe:25005});
assert.equal(o.renglones.length,1,'los renglones vacíos se ignoran');
o=P.normalizarOrdenCompra({...base,moneda:'USD',tipoCambio:'18.5',ivaTasa:0,lugarEntrega:'Bodega Norte'},PRO);
assert.deepEqual([o.moneda,o.iva,o.tipoCambio,o.subtotalProyecto,o.monedaProyecto,o.lugarEntrega],['USD',0,18.5,462592.5,'MXN','Bodega Norte']);
assert.equal(P.normalizarOrdenCompra({...base,moneda:'MXN',tipoCambio:18.5,renglones:[{descripcion:'A',cantidad:1,costo:1850}]},{...PRO,moneda:'USD'}).subtotalProyecto,100);
assert.equal(P.normalizarOrdenCompra({...base,ivaTasa:'0.08'},PRO).iva,2000.4);
for(const [mal,re] of [[{fechaEntrega:''},/fecha de entrega es obligatoria/],[{fechaEntrega:'2026-10-19'},/anterior a hoy/],
  [{condicionesPago:''},/condiciones de pago/],[{moneda:'EUR'},/Moneda no válida/],[{moneda:'USD'},/tipo de cambio/],
  [{moneda:'USD',tipoCambio:'0.5'},/tipo de cambio/],[{ivaTasa:0.1},/Tasa de IVA/],[{renglones:[]},/al menos un renglón/],
  [{renglones:[{descripcion:'A',cantidad:0,costo:1}]},/cantidad de "A"/],[{renglones:[{descripcion:'A',cantidad:1,costo:''}]},/costo unitario de "A"/],
  [{renglones:[{descripcion:'A',cantidad:1,costo:-1}]},/negativo/],[{renglones:[{descripcion:'A',cantidad:1,costo:0}]},/mayor a 0/],
  [{proveedor:{}},/razón social/]]){
  assert.throws(()=>P.normalizarOrdenCompra({...base,...mal},PRO),re,JSON.stringify(mal));
}
assert.throws(()=>P.normalizarOrdenCompra({...base,lugarEntrega:''},{...PRO,ubicacion:''}),/lugar de entrega/);
// Margen: contratado sin IVA − costos; nunca mezcla monedas
const M=P.margenProyecto(10000,'MXN',[{concepto:'Órdenes de compra',moneda:'MXN',monto:3850.005,cantidad:2}]);
assert.deepEqual([M.contratado,M.totalCostos,M.margen,M.porcentaje],[10000,3850.01,6149.99,61.5]);
assert.deepEqual([P.margenProyecto(1000,'USD',[{concepto:'X',moneda:'USD',monto:1200}]).margen,P.margenProyecto(0,'MXN',[]).porcentaje],[-200,0]);
assert.throws(()=>P.margenProyecto(1000,'MXN',[{concepto:'X',moneda:'USD',monto:1}]),/no se suman monedas/);
assert.equal(P.nombreArchivoOc('OC-2026-0001','Paneles: "del" Bajío/SA'),'OC-2026-0001 — Paneles del Bajío SA.pdf');
assert.equal(P.terminosOcParaPdf({TERMINOS_OC:''}).length,4,'celda vacía: los términos iniciales');
assert.deepEqual([...P.terminosOcParaPdf({TERMINOS_OC:'Uno\n\n Dos '})],['Uno','Dos']);

// ================= Servidor (doPost) =================
// Proyectos y cotizaciones (los crea una vendedora); cobranza acepta y firma
const proy=(nombre,id,ubicacion)=>ok('ana','crearProyecto',{nombre,ubicacion,cliente:{nombre:'Luis',empresa:'Solar MX'},idSolicitud:id}).folio;
const p1=proy('Techo solar','p1','Querétaro, Qro.'), p2=proy('Planta Texas','p2','Austin, TX'), p3=proy('Sin firmar','p3',''), p4=proy('Se cancela','p4','');
const cot=(proyectoFolio,precio,extra)=>ok('ana','guardarCotizacion',{cliente:{nombre:'Luis',empresa:'Solar MX'},
  items:[{descripcion:'Servicio',cantidad:1,precio}],proyectoFolio,idSolicitud:'c'+(++nId),...extra}).folio;
const c1=cot(p1,10000), c1usd=cot(p1,100,{moneda:'USD'}), c2=cot(p2,5000,{moneda:'USD',marca:'energy'}), c3=cot(p3,100), c4=cot(p4,100);
for(const [p,c] of [[p1,c1],[p2,c2],[p4,c4]]){ok('efrain','marcarAceptada',p,c,true);ok('efrain','firmarContrato',p,HOY_ISO)}
ok('efrain','marcarAceptada',p3,c3);
// Los proyectos nuevos ya no tienen subcarpeta "Órdenes de compra"
const carpP1=carpetas[db.pest.Proyectos.m.find(r=>r[0]===p1)[7]];
assert.deepEqual(carpP1.hijos.map(h=>h.nombre),['Cotizaciones']);

// --- Sin rol de compras: no ve la pestaña ni recibe datos; el servidor rechaza todo con PERMISO ---
assert.deepEqual({...ok('ana','getDatosIniciales').permisos},{cobranza:false,desbloqueo:false,compras:false,requisicion:false});
assert.deepEqual({...ok('tania','getDatosIniciales').permisos},{cobranza:true,desbloqueo:false,compras:false,requisicion:false});
assert.deepEqual({...ok('pedro','getDatosIniciales').permisos},{cobranza:false,desbloqueo:false,compras:true,requisicion:false});
assert.deepEqual({...ok('efrain','getDatosIniciales').permisos},{cobranza:true,desbloqueo:true,compras:true,requisicion:false});
assert.deepEqual({...ok('obrero','getDatosIniciales').permisos},{cobranza:false,desbloqueo:false,compras:false,requisicion:true});
const OC=f=>'OC-'+ANIO+'-'+f, REQ=f=>'REQ-'+ANIO+'-'+f;
const COMPRAS=[['listarProyectosCompras',['']],['getComprasProyecto',[p1]],['cancelarOrdenCompra',[OC('0001'),'motivo largo']],
  ['listarRequisiciones',['']],['getRequisicion',[REQ('0001')]],['autorizarRequisicion',[REQ('0001'),{}]],
  ['rechazarRequisicion',[REQ('0001'),'motivo largo']],['devolverRequisicion',[REQ('0001'),'motivo largo']],
  ['registrarPagoProveedor',[{reqFolio:REQ('0001')}]],['cancelarPagoProveedor',['PGP-'+ANIO+'-0001','motivo largo']],
  ['cerrarRequisicionCompras',[REQ('0001'),'motivo largo']]];
for(const quien of ['ana','tania','obrero']) for(const [f,args] of COMPRAS) falla(quien,f,args,/No tienes permiso de compras/,'PERMISO');
for(const [f,args] of COMPRAS) falla('intruso',f,args,/@helgen.tech/,'SESION');
// Las órdenes solo salen de una requisición: ya no hay emisión directa ni "Recibida" desde compras
for(const f of ['guardarOrdenCompra','marcarOcRecibida']) falla('pedro',f,[{}],/Función no permitida/);
assert.equal(props.COMPRAS_DB_ID,undefined,'una llamada sin rol no crea nada');
assert.throws(()=>ctx.getComprasProyecto(p1),/Inicia sesión/,'desde el editor (sin token) tampoco');
// Compras sin cobranza: no ve cobranza (ni el margen)
falla('pedro','getCobranzaProyecto',[p1],/No tienes permiso de cobranza/,'PERMISO');

// Requisiciones (las pide obrero): toda orden de compra sale de una requisición autorizada
const PDF=Buffer.from('%PDF-1.4 cotizacion del proveedor').toString('base64');
const req=(proyectoFolio)=>ok('obrero','guardarRequisicion',{proyectoFolio,renglones:[{descripcion:'Material',cantidad:1,unidad:'pza'}],
  cotizacion:{nombre:'cot.pdf',datos:PDF},idSolicitud:'rq'+(++nId)}).folio;
const reqP4=req(p4);
const filaP4=db.pest.Proyectos.m.findIndex(r=>r[0]===p4); db.pest.Proyectos.m[filaP4][6]='Cancelado'; // a mano en la hoja
for (const k of Object.keys(cache)) if (k.startsWith('F_proyectos')) delete cache[k]; // pasan los 5 min del caché

// --- Lista: Activos y Cerrados con o sin contrato (los Cancelados no), con su moneda y sin montos ---
const lista=ok('pedro','listarProyectosCompras','');
assert.deepEqual(lista.map(p=>p.folio+':'+p.moneda+':'+p.marca+':'+p.sinContrato),
  [p3+':MXN:helgen:false',p2+':USD:energy:false',p1+':MXN:helgen:false'],'p3 tiene aceptada sin firmar; p4 está cancelado');
assert(!/total|subtotal|contratado|margen/i.test(JSON.stringify(lista)),'sin montos del contrato');
assert.deepEqual(ok('pedro','listarProyectosCompras','texas').map(p=>p.folio),[p2]);

// --- Vista: sin montos del contrato ni margen; el libro y la carpeta son privados ---
let v=ok('pedro','getComprasProyecto',p1.toLowerCase());
assert.deepEqual([v.proyecto.folio,v.moneda,v.marca,v.ordenes.length,v.proyecto.ubicacion],[p1,'MXN','helgen',0,'Querétaro, Qro.']);
assert(!('margen' in v)&&!('contrato' in v)&&!/11600|10000/.test(JSON.stringify(v)),'compras no ve el contratado ni el margen');
const carpCom=carpetas[props.COMPRAS_FOLDER_ID], LC=libros[props.COMPRAS_DB_ID];
assert.equal(ruta(carpCom),'Mi unidad/Cotizador Helgen — Compras');
assert.equal(LC.nombre,'Cotizador Helgen — Compras (datos)'); assert.equal(archivos[LC.id].padre,carpCom);
assert.deepEqual(Object.keys(LC.pest).sort(),['Bitacora','FacturasProveedor','OrdenesCompra','PagosProveedores','Proveedores','Requisiciones','RequisicionesEventos','RequisicionesRenglones']);
assert.deepEqual([carpCom.acceso,archivos[LC.id].acceso],['PRIVATE','PRIVATE'],'carpeta y libro de compras restringidos');
const H=n=>LC.pest[n].m, bit=()=>H('Bitacora').slice(1);

// --- Emitir (al autorizar): folio, línea de negocio del contrato (no del navegador), costo capturado, PDF privado ---
const oc=(extra)=>({...base,fechaEntrega:HOY_ISO,proveedor:{razonSocial:'Paneles del Bajío',contacto:'Luis Pérez',telefono:'+52 442 111 2233'},
  renglones:[{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA',cantidad:2,costo:1000,precio:4100}],
  notas:'<script>x</script>',marca:'energy',proyectoFolio:p2,idSolicitud:'o'+(++nId),...extra});
const emitir=(quien,proyectoFolio,x)=>{const R=req(proyectoFolio);const r=ok(quien,'autorizarRequisicion',R,x);return {...r,folio:r.ocFolio,req:R}};
let r=emitir('pedro',p1,oc({idSolicitud:'oc1'}));
assert.deepEqual([r.folio,r.total,r.moneda,r.req,r.vista.requisicion.estado,r.vista.requisicion.ocFolio],[OC('0001'),2320,'MXN',REQ('0002'),'Autorizada',OC('0001')]);
let f=H('OrdenesCompra')[1];
assert.deepEqual([f[0],f[1],f[2],f[3],f[4],f[5],f[7],f[9],f[10],f[11],f[12],f[13],f[14],f[15],f[16],f[17],f[18],f[19],f[20],f[25],f[26],f[28],f[34]],
  [r.folio,HOY_ISO,p1,'Helgen','SIN-RFC:paneles del bajio','Paneles del Bajío','Luis Pérez','+52 442 111 2233',HOY_ISO,'Querétaro, Qro.',
   'Crédito 30 días','MXN',0.16,2000,320,2320,'MXN','',2000,'pedro@helgen.tech','Pedro Ruiz','Emitida',REQ('0002')],'el proyecto sale de la requisición, no del navegador');
assert.deepEqual(JSON.parse(f[21]).map(x=>x.costo+'/'+x.importe+'/'+('precio' in x)),['1000/2000/false'],'el costo es el capturado; el precio de venta no se guarda');
const pdfOc=archivos[f[23]];
assert.equal(ruta(pdfOc.padre),'Mi unidad/Cotizador Helgen — Compras/'+ANIO+'/'+p1);
assert.equal(pdfOc.blob.name,r.folio+' — Paneles del Bajío.pdf'); assert.equal(f[24],r.url);
assert.deepEqual([pdfOc.acceso,pdfOc.padre.acceso,pdfOc.padre.padre.acceso],['PRIVATE','PRIVATE','PRIVATE'],'PDF y subcarpetas restringidos');
const html=pdfOc.blob.html;
assert(/ORDEN DE COMPRA/.test(html)&&/Helgen Servicios Especializados/.test(html)&&/RFC HSE240304PC1/.test(html));
assert(/>Requisición<\/td>/.test(html)&&html.includes(REQ('0002')),'el PDF lleva la línea "Requisición: REQ-…"');
for(const t of ['Favor de indicar el folio de esta orden en su factura.','Facturar a nombre de la razón social y RFC indicados arriba.',
  'Precios fijos según esta orden; cualquier cambio requiere una nueva orden.','Entregar en el lugar y fecha indicados.']) assert(html.includes(t),'término: '+t);
assert(/&lt;script&gt;/.test(html)&&!/<script>x/.test(html),'notas escapadas');
assert(!/4,100|4100/.test(html),'sin precio de venta'); assert(html.includes('DOS MIL TRESCIENTOS VEINTE PESOS 00/100 M.N.'));
// Idempotencia
assert.equal(ok('pedro','autorizarRequisicion',REQ('0002'),oc({idSolicitud:'oc1'})).ocFolio,r.folio); assert.equal(H('OrdenesCompra').length,2);
// Rechazos que no gastan folio (la requisición sigue Solicitada)
falla('obrero','guardarRequisicion',[{proyectoFolio:p4,renglones:[{descripcion:'A',cantidad:1}],cotizacion:{datos:PDF}}],/está cancelado: no se piden materiales/);
falla('pedro','autorizarRequisicion',[reqP4,oc()],/está cancelado: no admite órdenes/);
const rPend=req(p1);
falla('pedro','autorizarRequisicion',[rPend,oc({moneda:'USD'})],/proyecto es en MXN y la orden en USD: captura el tipo de cambio/);
falla('pedro','autorizarRequisicion',[rPend,oc({renglones:[{descripcion:'Inversor',cantidad:1,costo:''}]})],/costo unitario de "Inversor"/);
falla('pedro','autorizarRequisicion',['REQ-2000-0001',oc()],/No existe la requisición/);
falla('pedro','autorizarRequisicion',[REQ('0002'),oc()],/está autorizada: no se puede autorizar/);
assert.equal(props['CONSECUTIVO_OC_'+ANIO],'1','los rechazos no gastan folio'); assert.equal(H('OrdenesCompra').length,2);
assert.equal(ok('pedro','getRequisicion',rPend).requisicion.estado,'Solicitada');
// Orden en USD en un proyecto MXN: tipo de cambio obligatorio; el costo para el margen queda en pesos
r=emitir('efrain',p1,oc({moneda:'USD',tipoCambio:18.5,ivaTasa:0,renglones:[{descripcion:'Inversor',cantidad:1,costo:100}],
  proveedor:{razonSocial:'Paneles del Bajío',rfc:'PDB200101AB1',correo:'ventas@pdb.mx'},lugarEntrega:'Bodega Norte',fechaEntrega:MANANA}));
const R2=r.req;
f=H('OrdenesCompra')[2];
assert.deepEqual([r.folio,f[4],f[13],f[14],f[16],f[17],f[18],f[19],f[20],f[11]],[OC('0002'),'PDB200101AB1','USD',0,0,100,'MXN',18.5,1850,'Bodega Norte']);
assert(/P\. Unitario|Costo unit\. \(USD\)/.test(archivos[f[23]].blob.html)&&/Moneda/.test(archivos[f[23]].blob.html)&&!/18\.5/.test(archivos[f[23]].blob.html),'USD en el PDF; el tipo de cambio no sale');
// Proveedor: el que tenía solo razón social toma el RFC (una sola fila) y conserva el contacto
assert.equal(H('Proveedores').length,2,'un solo proveedor');
assert.deepEqual(H('Proveedores')[1].slice(0,6),['PDB200101AB1','Paneles del Bajío','PDB200101AB1','Luis Pérez','ventas@pdb.mx','+52 442 111 2233']);
assert.deepEqual(ok('pedro','getRequisicion',rPend).proveedores.map(p=>p.etiqueta+'|'+p.rfc+'|'+p.contacto),['Paneles del Bajío|PDB200101AB1|Luis Pérez']);
v=ok('pedro','getComprasProyecto',p1);
assert.deepEqual(v.ordenes.map(x=>x.folio+':'+x.reqFolio),[OC('0002')+':'+R2,OC('0001')+':'+REQ('0002')],'más reciente primero, con su requisición');
// Proyecto USD de Helgen Energy pagado en pesos: costo en dólares; el PDF dice Helgen (no Helgen Energy)
r=emitir('pedro',p2,oc({moneda:'MXN',tipoCambio:18.5,renglones:[{descripcion:'Cable',cantidad:1,costo:1850}],proveedor:{razonSocial:'Cables SA'}}));
f=H('OrdenesCompra')[3];
assert.deepEqual([f[3],f[13],f[18],f[20],f[11]],['Helgen Energy','MXN','USD',100,'Austin, TX'],'la línea de negocio sale del contrato');
assert(/Helgen Servicios Especializados/.test(archivos[f[23]].blob.html)&&!/HELGEN ENERGY|Helgen Energy/.test(archivos[f[23]].blob.html));
// Una tercera orden en p1 que se cancela
const r3=emitir('pedro',p1,oc({renglones:[{descripcion:'Estructura',cantidad:1,costo:5000}]}));

// --- Pagada, recibida (al cerrar la requisición) y cancelada (nunca se borran) ---
const pagoR2={reqFolio:R2,fecha:HOY_ISO,monto:100,monedaPago:'USD',metodo:'Transferencia',referencia:'SPEI 1',comprobante:{nombre:'p.pdf',datos:PDF},idSolicitud:'pg1'};
v=ok('pedro','registrarPagoProveedor',pagoR2).vista;
assert.deepEqual([v.requisicion.estado,v.orden.estado],['Pagada','Pagada']);
falla('pedro','cancelarOrdenCompra',[OC('0002'),'Ya no se necesita'],/ya está pagada: no se puede cancelar/);
ok('obrero','cerrarRequisicion',R2,'');
f=H('OrdenesCompra')[2];
assert.deepEqual([f[28],f[29],f[30]],['Recibida',HOY_ISO,'obrero@helgen.tech'],'recibida con la fecha y el correo del solicitante');
falla('pedro','cancelarOrdenCompra',[OC('0002'),'Ya no se necesita'],/ya se recibió: no se puede cancelar/);
falla('pedro','cancelarOrdenCompra',[r3.folio,''],/motivo/);
v=ok('pedro','cancelarOrdenCompra',r3.folio,'El proveedor no tiene existencias');
const fc=H('OrdenesCompra').find(x=>x[0]===r3.folio);
assert.deepEqual([fc[28],fc[31],!!fc[32],fc[33]],['Cancelada','pedro@helgen.tech',true,'El proveedor no tiene existencias']);
let vr=ok('pedro','getRequisicion',r3.req);
assert.deepEqual([vr.requisicion.estado,vr.requisicion.ocFolio,vr.orden,vr.puedeAutorizar],['Solicitada','',null,true],'su requisición regresa a Solicitada para autorizarla de nuevo');
assert(/Se canceló la orden/.test(vr.eventos[vr.eventos.length-1].nota));
falla('pedro','cancelarOrdenCompra',[r3.folio,'otra vez'],/ya está cancelada/);
assert.equal(H('OrdenesCompra').length,5,'la cancelada sigue en la hoja');

// --- Margen (solo cobranza): contratado sin IVA − órdenes vigentes sin IVA, en la moneda del proyecto ---
v=ok('tania','getCobranzaProyecto',p1);
assert.deepEqual([v.margen.moneda,v.margen.contratado,v.margen.totalCostos,v.margen.margen,v.margen.porcentaje],['MXN',10000,3850,6150,61.5]);
assert.deepEqual(v.margen.costos.map(c=>c.concepto+':'+c.cantidad),['Órdenes de compra:2'],'emitida + recibida; la cancelada no cuenta');
v=ok('tania','getCobranzaProyecto',p2);
assert.deepEqual([v.margen.moneda,v.margen.contratado,v.margen.totalCostos,v.margen.margen,v.margen.porcentaje],['USD',5000,100,4900,98]);
v=ok('tania','getCobranzaProyecto',p3); assert.deepEqual([v.margen.totalCostos,v.margen.margen],[0,100],'sin órdenes');

// --- Resumen de cobranza: costo de órdenes y margen por proyecto (las mismas cifras que la vista) ---
const rs=ok('tania','resumenCobranzaGeneral');
const rp1=rs.proyectos.find(x=>x.folio===p1), rp2=rs.proyectos.find(x=>x.folio===p2);
assert.deepEqual([rp1.ordenes,rp1.costoOc,rp1.margen,rp1.margenPorcentaje],[2,3850,6150,61.5],'la cancelada no cuenta');
assert.deepEqual([rp2.moneda,rp2.costoOc,rp2.margen,rp2.margenPorcentaje],['USD',100,4900,98]);
assert(!rs.proyectos.some(x=>x.folio===p4),'proyecto cancelado fuera del resumen');
assert.deepEqual(rs.proyectos.filter(x=>x.estadoContrato==='Por firmar').map(x=>x.folio),[p3]);
const tm=rs.totales.find(t=>t.moneda==='MXN');
assert.deepEqual([tm.contratadoSinIva,tm.costoOc,tm.margen,tm.margenPorcentaje],[10000,3850,6150,61.5],'el por firmar no suma al margen');
falla('pedro','resumenCobranzaGeneral',[],/No tienes permiso de cobranza/,'PERMISO');

// --- Con órdenes vigentes en MXN, la aceptada no puede cambiar a USD (tras desbloquear) ---
ok('efrain','desbloquearContrato',p1,'Prueba de moneda con órdenes');
falla('efrain','marcarAceptada',[p1,c1usd],/órdenes de compra en MXN/);
// Sin contrato firmado (desbloqueado) sigue en la lista y admite requisiciones y órdenes en la moneda de su aceptada
assert.deepEqual(ok('pedro','listarProyectosCompras','').map(p=>p.folio+':'+p.moneda),[p3+':MXN',p2+':USD',p1+':MXN']);
v=ok('pedro','getComprasProyecto',p1); assert.equal(v.ordenes.length,3);
assert.equal(ok('pedro','getRequisicion',rPend).puedeAutorizar,true);
ok('efrain','firmarContrato',p1,HOY_ISO);

// --- Bitácora, separación de datos y reparación del acceso ---
const acciones=bit().map(b=>b[2]);
for(const a of ['Solicitar requisición','Autorizar requisición','Emitir orden de compra','Registrar pago a proveedor','Cerrar requisición',
  'Cancelar orden de compra','Requisición a Solicitada']) assert(acciones.includes(a),'bitácora: '+a);
assert(bit().every(b=>/@helgen\.tech$/.test(b[1])));
assert.equal(bit().find(b=>b[2]==='Cancelar orden de compra')[5],'El proveedor no tiene existencias');
assert.deepEqual(Object.keys(db.pest).sort(),['Config','Cotizaciones','Proyectos'],'nada de compras en la Base de datos');
assert(!JSON.stringify(db.pest.Cotizaciones.m).includes('OC-')&&!JSON.stringify(db.pest.Proyectos.m).includes('OC-'));
assert(db.pest.Config.m.some(x=>x[0]==='TERMINOS_OC'),'Config tiene TERMINOS_OC');
assert.deepEqual(Object.keys(libros[props.COBRANZA_DB_ID].pest).sort(),['Bitacora','Contratos','Esquemas','Pagos'],'nada de compras en cobranza');
assert(vivos(maestra).every(x=>!/Compras/.test(x.nombre)),'nada de compras en la carpeta maestra');
carpCom.acceso='DOMAIN'; archivos[LC.id].acceso='DOMAIN'; ctx.prepararCompras();
assert.deepEqual([carpCom.acceso,archivos[LC.id].acceso],['PRIVATE','PRIVATE'],'prepararCompras repara el acceso');

// --- Proyecto sin cotización aceptada: requisición, orden (MXN, sin línea de negocio) y pago; Cobranza ve "Sin contrato" ---
const p5=proy('Bodega Norte','p5','Saltillo');
const cerrado=proy('Ya terminado','p6','');
db.pest.Proyectos.m[db.pest.Proyectos.m.findIndex(r=>r[0]===cerrado)][6]='Cerrado';
for (const k of Object.keys(cache)) if (k.startsWith('F_proyectos')) delete cache[k];
const rl=ok('obrero','listarProyectosRequisicion','');
assert(rl.some(p=>p.folio===p5)&&rl.some(p=>p.folio===cerrado)&&!rl.some(p=>p.folio===p4),'Activos y Cerrados sin contrato; Cancelados no');
assert.equal(ok('obrero','listarProyectosRequisicion','BON').map(p=>p.folio)[0],p5,'se busca por clave');
const r5=req(p5);
let v5=ok('pedro','getRequisicion',r5);
assert.deepEqual([v5.moneda,v5.marca,v5.sinContrato,v5.puedeAutorizar],['MXN','',true,true]);
const o5=ok('pedro','autorizarRequisicion',r5,oc({idSolicitud:'o5',proyectoFolio:p5,renglones:[{descripcion:'Cemento',cantidad:4,costo:250}]}));
const fo5=H('OrdenesCompra').find(x=>x[0]===o5.ocFolio);
assert.deepEqual([fo5[2],fo5[3],fo5[13],fo5[18],fo5[20]],[p5,'','MXN','MXN',1000],'sin contrato: MXN y sin línea de negocio');
ok('pedro','registrarPagoProveedor',{reqFolio:r5,fecha:HOY_ISO,monto:1160,monedaPago:'MXN',metodo:'Transferencia',referencia:'SPEI 5',
  comprobante:{nombre:'p.pdf',datos:PDF},idSolicitud:'pg5'});
assert.equal(ok('pedro','getRequisicion',r5).requisicion.estado,'Pagada');
const vc5=ok('efrain','getCobranzaProyecto',p5);
assert.deepEqual([vc5.contrato,vc5.margen.sinContrato,vc5.margen.costos[0].moneda,vc5.margen.costos[0].monto,vc5.margen.costos[0].cantidad],
  [null,true,'MXN',1000,1],'Cobranza: costo de las órdenes y "Sin contrato"');
falla('efrain','registrarPago',[{proyectoFolio:p5,fecha:HOY_ISO,monto:100,monedaPago:'MXN',metodo:'Efectivo',comprobante:{nombre:'p.pdf',datos:PDF}}],
  /contrato firmado/);
// Con órdenes en MXN no se puede aceptar una cotización en USD (nunca se mezclan monedas)
const c5usd=cot(p5,100,{moneda:'USD'});
falla('efrain','marcarAceptada',[p5,c5usd],/órdenes de compra en MXN/);
console.log('OK compras');
