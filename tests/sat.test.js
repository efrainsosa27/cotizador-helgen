const fs=require('fs'),vm=require('vm'),assert=require('assert');
const dir=process.argv[2], csvDir=process.argv[3];
// Acepta Code.js (código actual) o Code.gs (código anterior).
const ext=fs.existsSync(dir+'/Code.js')?'js':'gs';
const src=fs.readFileSync(dir+'/Logo.'+ext,'utf8')+'\n'+fs.readFileSync(dir+'/Code.'+ext,'utf8');
const chain=new Proxy({}, {get:(t,k)=>k==='build'?()=>({}):()=>chain});
function hoja(nombre,m){const h={m,getName:()=>nombre,setName(n){nombre=n;return h},getLastRow:()=>m.length,getMaxRows:()=>Math.max(1000,m.length),
 insertRowsAfter(){},getDataRange:()=>({getValues:()=>m.map(r=>r.slice())}),appendRow:a=>m.push(a),setFrozenRows(){},setColumnWidth(){},
 getParent:()=>({getUrl:()=>'https://sheets/x'}),
 getRange:(r,c,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this},setDataValidation(){return this}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>((m[r-1+i]||[])[c-1+j]??''))),
  getValue:()=>(m[r-1]||[])[c-1],
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},
  createTextFinder:t=>({matchEntireCell:()=>({findNext:()=>m.slice(r-1,r-1+nr).some(x=>String(x[c-1])===t)?{}:null})})})};return h}
function libro(id,hojas){return{getId:()=>id,getSheets:()=>hojas,getSheetByName:n=>hojas.find(h=>h.getName()===n)||null,
  insertSheet(n){const h=hoja(n||'Hoja',[]);hojas.push(h);return h}}}
const parseCsv=t=>t.trim().split('\n').map(l=>{const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];
  if(q){if(ch=='"'&&l[i+1]=='"'){cur+='"';i++}else if(ch=='"')q=false;else cur+=ch}else if(ch=='"')q=true;else if(ch==','){out.push(cur);cur=''}else cur+=ch}
  out.push(cur);return out});
const cat=hoja('Catalogo',[['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó'],['PAN-550','Panel solar 550 W','PZA',4200,'','x']]);
const cot=hoja('Cotizaciones',[['Folio']]), cfg=hoja('Config',[['Clave','Valor']]);
const libros={db:libro('db',[cot,cfg]),cat:libro('cat',[cat])}; let nuevo=0;
const props={SPREADSHEET_ID:'db',FOLDER_ID:'f',CATALOGO_ID:'cat'},cache={};
const archivos={'SAT_c_ClaveProdServ.csv':fs.readFileSync(csvDir+'/SAT_c_ClaveProdServ.csv','utf8'),'SAT_c_ClaveUnidad.csv':fs.readFileSync(csvDir+'/SAT_c_ClaveUnidad.csv','utf8')};
const ctx={console,Date,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v,getProperties:()=>Object.assign({},props),setProperties:o=>Object.assign(props,o)})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v,getAll:ks=>Object.fromEntries(ks.filter(k=>k in cache).map(k=>[k,cache[k]])),putAll:o=>Object.assign(cache,o)})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>'efrain@helgen.tech'})},
 Utilities:{parseCsv,formatDate:(d,tz,f)=>f==='yyyy'?'2026':'15/10/2026',newBlob:h=>({getAs:()=>({setName:n=>({name:n,html:h})})}),base64Encode:b=>Buffer.from(b).toString('base64'),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},computeDigest:(a,s)=>[...require('crypto').createHash(a||'sha256').update(typeof s==='string'?s:Buffer.from(s)).digest()]},
 SpreadsheetApp:{flush(){},newDataValidation:()=>chain,create:n=>{nuevo++;const l=libro('sat',[hoja('Hoja 1',[])]);libros.sat=l;return l},openById:id=>libros[id]},
 DriveApp:{getFilesByName:n=>{let d=false;return{hasNext:()=>!d&&!!archivos[n],next:()=>{d=true;return{isTrashed:()=>false,getParents:()=>({next:()=>({})}),getBlob:()=>({getDataAsString:()=>archivos[n]})}}}},
   getFileById:()=>({moveTo(){},getParents:()=>({hasNext:()=>false})}),
   getFolderById:()=>({getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:b=>({getUrl:()=>'u'})})})})},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
// Código con sesión (Fase 2): guardar exige un vendedor verificado; aquí se simula uno.
if (/let VENDEDOR_\b/.test(src)) vm.runInContext("VENDEDOR_ = {email:'efrain@helgen.tech',nombre:'Efrain',apellido:'Sosa'}", ctx);
// Columnas SAT agregadas a un catálogo existente
let r=ctx.getCatalogo(); assert.equal(cat.m[0][6],'Clave SAT'); assert.equal(cat.m[0][7],'Unidad SAT');
assert.equal(nuevo,1,'importa el catálogo SAT una vez'); assert(r.unidadesSat.length>2000);
assert.equal(libros.sat.getSheetByName('ClaveProdServ').m.length,52514); assert.equal(libros.sat.getSheetByName('ClaveProdServ').m[1][0],'01010101');
ctx.getCatalogo(); assert.equal(nuevo,1);
// Sugerencias
let s=ctx.sugerirClavesSat('Panel solar 550 W'); assert(s.some(x=>x.clave==='26111607'),'sugiere generadores solares');
assert.deepEqual(s.map(x=>x.clave).length,8);
assert.equal(ctx.sugerirClavesSat('26111607')[0].descripcion,'Generadores solares');
assert.equal(ctx.sugerirClavesSat('1010101')[0].clave,'01010101','repone el cero');
// Validación al guardar
assert.throws(()=>ctx.guardarProducto({clave:'PAN-550',descripcion:'Panel',precio:1,claveSat:'99999999',claveOriginal:'PAN-550'}),/no existe/);
assert.throws(()=>ctx.guardarProducto({clave:'PAN-550',descripcion:'Panel',precio:1,unidadSat:'ZZZ',claveOriginal:'PAN-550'}),/no existe/);
assert.throws(()=>ctx.guardarProducto({clave:'PAN-550',descripcion:'Panel',precio:1,claveSat:'12ab'}),/8 dígitos/);
r=ctx.guardarProducto({clave:'PAN-550',descripcion:'Panel solar 550 W',precio:4200,claveSat:'26111607',unidadSat:'h87',claveOriginal:'PAN-550'});
const p=r.productos[0]; assert.equal(p.claveSat,'26111607'); assert.equal(p.unidadSat,'H87'); assert.equal(cat.m[1][6],'26111607');
// Sin datos SAT sigue siendo válido
ctx.guardarProducto({clave:'SERV-1',descripcion:'Servicio sin clasificar',precio:100});
// Cotización: el concepto del catálogo guarda su clave SAT en el JSON, y el PDF no la muestra
const res=ctx.guardarCotizacion({cliente:{nombre:'Ana'},items:[{clave:'pan-550',descripcion:'Panel solar 550 W',cantidad:2,precio:4200},{descripcion:'Libre',cantidad:1,precio:5}],idSolicitud:'s1'});
const items=JSON.parse(cot.m[1][12]); assert.equal(items[0].claveSat,'26111607'); assert.equal(items[0].unidadSat,'H87'); assert(!('claveSat' in items[1]));
console.log('OK SAT', res.folio);
