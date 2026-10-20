// Sesión con Google en doPost y columnas vendedor_*.
// Uso: node tests/sesion.test.js .   (carpeta con Code.js y Logo.js)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];
let src=fs.readFileSync(path.join(dir,'Logo.js'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'Code.js'),'utf8');
const CID='123-abc.apps.googleusercontent.com';
src=src.replace(/const CLIENT_ID_GOOGLE = '[^']*';/,"const CLIENT_ID_GOOGLE = '"+CID+"';");
function hoja(m){return{m,getLastRow:()=>m.length,getDataRange:()=>({getValues:()=>m.map(r=>r.slice()),getDisplayValues:()=>m.map(r=>r.map(x=>x instanceof Date?'19/10/2026':String(x??'')))}),
 appendRow:a=>m.push(a),
 getRange:(r,c,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>{const f=(m[r-1+i]||[]).slice(c-1,c-1+nc);while(f.length<nc)f.push('');return f}),
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}})}}
const cfg=hoja([['Clave','Valor'],['PREFIJO_FOLIO','HLG'],['IVA_TASA',0.16]]);
// Hoja con una fila vieja (sin columnas vendedor_*)
const cot=hoja([['Folio','Fecha','Cliente','Empresa','RFC','Correo','Teléfono','Subtotal','IVA','Total','Elaboró','PDF','Conceptos (JSON)','Notas','Marca','Dirección'],
  ['HLG-2026-0001','x','Viejo','','','','',1,0.16,1.16,'antes@helgen.tech','u','[]','','Helgen','']]);
let pry=null;
const props={SPREADSHEET_ID:'x',FOLDER_ID:'y',CATALOGO_ID:'c'},cache={};
const ahora=Math.floor(Date.now()/1000);
const BUENO={aud:CID,iss:'https://accounts.google.com',exp:String(ahora+3000),email:'Ana.Lopez@helgen.tech',email_verified:'true',hd:'helgen.tech',given_name:'Ana',family_name:'López Díaz'};
const tokens={'t-bueno':BUENO,'t-gmail':{...BUENO,email:'ana@gmail.com',hd:undefined},'t-otro-aud':{...BUENO,aud:'otro.apps.googleusercontent.com'},
  't-otro-dominio':{...BUENO,email:'x@otra.com',hd:'otra.com'}};
let fetches=0;
const ctx={console,Date,JSON,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>''})}, // despliegue anónimo: Google no da el correo
 Utilities:{formatDate:(d,tz,f)=>f==='yyyy'?'2026':'19/10/2026',newBlob:h=>({getAs:()=>({setName:n=>({name:n,html:h})})}),
  base64Encode:b=>Buffer.from(b).toString('base64'),DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest:(a,s)=>[...require('crypto').createHash('sha256').update(s).digest()]},
 UrlFetchApp:{fetch:url=>{fetches++;const t=decodeURIComponent(url.split('id_token=')[1]);const c=tokens[t];
  return{getResponseCode:()=>c?200:400,getContentText:()=>JSON.stringify(c||{error:'invalid_token'})}}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({t,setMimeType(){return this}})},
 SpreadsheetApp:{flush(){},openById:id=>id==='c'?{getSheetByName:()=>hoja([['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó','Clave SAT','Unidad SAT']]),getUrl:()=>'cat'}:{getSheetByName:n=>n==='Config'?cfg:n==='Proyectos'?pry:cot,
   insertSheet:n=>pry=Object.assign(hoja([]),{setFrozenRows(){},getMaxRows:()=>1000,setColumnWidth(){}})},
  newDataValidation:()=>{const b={requireValueInList:()=>b,setAllowInvalid:()=>b,setHelpText:()=>b,build:()=>({})};return b}},
 DriveApp:{getFolderById:()=>({getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:()=>({getUrl:()=>'u'})})})})},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
const post=(cuerpo)=>JSON.parse(ctx.doPost({postData:{contents:typeof cuerpo==='string'?cuerpo:JSON.stringify(cuerpo)}}).t);
const base={cliente:{nombre:'Cliente Uno'},items:[{descripcion:'Servicio',cantidad:1,precio:100}]};

// --- validarClaimsToken (lógica pura) ---
const v=(c)=>ctx.validarClaimsToken(c,CID,'helgen.tech',ahora);
assert.deepEqual({...v(BUENO)},{email:'ana.lopez@helgen.tech',nombre:'Ana',apellido:'López Díaz'});
assert.deepEqual({...v({...BUENO,given_name:'',family_name:'',name:'Luis Pérez Gómez'})},{email:'ana.lopez@helgen.tech',nombre:'Luis',apellido:'Pérez Gómez'});
assert.equal(v({...BUENO,email_verified:true}).email,'ana.lopez@helgen.tech');
for(const [malo,msg] of [[{aud:'otro'},/no corresponde/],[{iss:'evil.com'},/inválida/],[{exp:String(ahora-1)},/expiró/],
  [{hd:undefined,email:'ana@gmail.com'},/@helgen.tech/],[{hd:'otra.com'},/@helgen.tech/],[{email_verified:'false'},/@helgen.tech/],
  [{email:'ana@helgen.tech.mx'},/@helgen.tech/]]){
  assert.throws(()=>v({...BUENO,...malo}),e=>e.sesion===true&&msg.test(e.message),JSON.stringify(malo));
}

// --- doPost rechaza sin token válido y no ejecuta nada ---
const filasAntes=cot.m.length;
for(const tok of [undefined,'','t-falso','t-gmail','t-otro-aud','t-otro-dominio']){
  const r=post({funcion:'guardarCotizacion',args:[{...base,idSolicitud:'x-'+tok}],token:tok});
  assert.equal(r.ok,false,String(tok)); assert.equal(r.codigo,'SESION',String(tok));
}
assert.equal(cot.m.length,filasAntes,'sin sesión no se guarda nada');
assert.equal(post('no es json').ok,false);
assert.equal(post({funcion:'setup',token:'t-bueno'}).error,'Función no permitida: setup.');
assert.equal(post({funcion:'guardarCotizacion',args:[base]}).codigo,'SESION');
assert.equal(post({funcion:'crearProyecto',args:[{nombre:'X',cliente:{nombre:'Y'}}]}).codigo,'SESION');
assert.equal(post({funcion:'listarProyectos',args:['']}).codigo,'SESION');

// --- Guardar con token válido: vendedor del token, aunque el navegador mande otro ---
fetches=0;
const r=post({funcion:'guardarCotizacion',token:'t-bueno',
  args:[{...base,idSolicitud:'ok1',vendedor_email:'impostor@helgen.tech',vendedor:{email:'impostor@helgen.tech',nombre:'X'},elaboro:'impostor@helgen.tech'}]});
assert(r.ok,r.error); assert.equal(r.datos.folio,'HLG-2026-0002');
const enc=cot.m[0]; assert.deepEqual(enc.slice(16),['vendedor_email','vendedor_nombre','vendedor_apellido','proyecto_folio']);
const fila=cot.m[cot.m.length-1];
assert.equal(fila[10],'ana.lopez@helgen.tech','Elaboró = correo del token');
assert.deepEqual(fila.slice(16),['ana.lopez@helgen.tech','Ana','López Díaz',''],'sin proyecto = columna T vacía');
assert(!JSON.stringify(fila).includes('impostor'));
// Caché: el token ya se verificó (en la llamada a setup); no se vuelve a consultar a Google
assert.equal(post({funcion:'listarCotizaciones',args:[''],token:'t-bueno'}).ok,true); assert.equal(fetches,0);
// Reenvío del mismo formulario = mismo folio (idempotencia intacta)
assert.equal(post({funcion:'guardarCotizacion',args:[{...base,idSolicitud:'ok1'}],token:'t-bueno'}).datos.folio,'HLG-2026-0002');

// --- Historial con el nombre del vendedor; filas viejas muestran el correo de "Elaboró" ---
const h=post({funcion:'listarCotizaciones',args:[''],token:'t-bueno'}).datos;
assert.equal(h[0].vendedor,'Ana López Díaz'); assert.equal(h[1].vendedor,'antes@helgen.tech');
// Datos iniciales: usuario = correo del token
const d=post({funcion:'getDatosIniciales',args:[],token:'t-bueno'}).datos;
assert.equal(d.usuario,'ana.lopez@helgen.tech'); assert.equal(d.vendedor.nombre,'Ana');
assert.deepEqual([...d.proyectos],[]); assert.equal(pry.m[0][0],'Folio','la pestaña Proyectos se crea sola');
assert.equal(cot.m[0][0],'Folio'); assert.equal(cot.m[0][19],'proyecto_folio','Cotizaciones no se toca al crear Proyectos');
assert.equal(h[1].proyecto,'Sin proyecto');
assert.throws(()=>ctx.crearProyecto({nombre:'X',cliente:{nombre:'Y'}}),/Inicia sesión/);
// Fuera de doPost (sin token) guardar se rechaza
assert.throws(()=>ctx.guardarCotizacion({...base,idSolicitud:'directo'}),/Inicia sesión/);
// doGet ya no sirve la app
assert(/solo la API/.test(ctx.doGet().t));
console.log('OK');
