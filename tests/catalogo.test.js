const fs=require('fs'),vm=require('vm'),assert=require('assert');
const dir=process.argv[2];
// Acepta Code.js (código actual) o Code.gs (código anterior).
const ext=fs.existsSync(dir+'/Code.js')?'js':'gs';
const src=fs.readFileSync(dir+'/Logo.'+ext,'utf8')+'\n'+fs.readFileSync(dir+'/Code.'+ext,'utf8');
const chain=new Proxy({}, {get:(t,k)=>k==='build'?()=>({}):()=>chain});
function hoja(nombre,m){const h={m,nombre,getName:()=>nombre,setName(n){nombre=n;return h},getLastRow:()=>m.length,
 getDataRange:()=>({getValues:()=>m.map(r=>r.slice())}),appendRow:a=>m.push(a),setFrozenRows(){},setColumnWidth(){},
 getParent:()=>({getUrl:()=>'https://sheets/catalogo'}),
 getRange:(r,c,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this},setDataValidation(){return this}}:({
  getValues:()=>m.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc)),getValue:()=>(m[r-1]||[])[c-1],
  setValue(v){(m[r-1]=m[r-1]||[])[c-1]=v;return this},
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setFontWeight(){return this},setBackground(){return this},setFontColor(){return this}})};return h}
const vieja=hoja('Catalogo',[['Clave','Descripción','Unidad','Precio unitario'],['EJ-001','Producto de ejemplo (bórrame)','PZA',1000],['car-7','Cargador 7 kW','PZA',15000]]);
const dbSheets={Catalogo:vieja,Config:hoja('Config',[['Clave','Valor']].concat([])),Cotizaciones:hoja('Cotizaciones',[['Folio']])};
let borradas=[],creados=0,catSS;
const db={getId:()=>'db',getSheetByName:n=>dbSheets[n]||null,getSheets:()=>Object.values(dbSheets),deleteSheet:h=>{borradas.push(h.getName());delete dbSheets[h.getName()]}};
const props={SPREADSHEET_ID:'db',FOLDER_ID:'f'};
const ctx={console,Date,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>'efrain@helgen.tech'})},
 SpreadsheetApp:{flush(){},newDataValidation:()=>chain,
   create:n=>{creados++;const h=hoja('Hoja 1',[]);catSS={getId:()=>'cat',getSheets:()=>[h],getSheetByName:x=>h.getName()===x?h:null,h};return catSS},
   openById:id=>id==='cat'?catSS:db},
 DriveApp:{getFileById:id=>({getParents:()=>({hasNext:()=>true,next:()=>'carpeta'}),moveTo(){}})},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
// Lógica pura
assert.throws(()=>ctx.normalizarProducto({descripcion:'x',precio:1}),/clave/);
assert.throws(()=>ctx.normalizarProducto({clave:'a',precio:1}),/descripción/);
assert.throws(()=>ctx.normalizarProducto({clave:'a',descripcion:'x',precio:''}),/obligatorio/);
assert.throws(()=>ctx.normalizarProducto({clave:'a',descripcion:'x',precio:-1}),/negativo/);
assert.deepEqual({...ctx.normalizarProducto({clave:' ab-1 ',descripcion:' Panel ',unidad:'',precio:'10.005'})},{clave:'AB-1',descripcion:'Panel',unidad:'PZA',precio:10.01,claveSat:'',unidadSat:''});
assert.equal(ctx.indiceDeClave(['X','Ab-1 '],'ab-1'),1); assert.equal(ctx.indiceDeClave(['X'],''),-1);
// Creación + migración
let r=ctx.getCatalogo();
assert.equal(creados,1); assert.equal(props.CATALOGO_ID,'cat'); assert.deepEqual(borradas,['Catalogo']);
assert.deepEqual(r.productos.map(p=>p.clave),['CAR-7'],'migra sin el ejemplo y normaliza clave');
ctx.getCatalogo(); assert.equal(creados,1,'no crea otro archivo');
// Alta
r=ctx.guardarProducto({clave:'pan-550',descripcion:'Panel solar 550 W',unidad:'pza',precio:'4200'});
assert.equal(r.clave,'PAN-550'); assert.equal(r.productos.length,2);
// Duplicado (otra capitalización)
assert.throws(()=>ctx.guardarProducto({clave:'Pan-550',descripcion:'Otro',precio:1}),/ya existe/);
// Edición de precio
r=ctx.guardarProducto({clave:'PAN-550',descripcion:'Panel solar 550 W',precio:4100,claveOriginal:'PAN-550'});
assert.equal(r.productos.find(p=>p.clave==='PAN-550').precio,4100); assert.equal(r.productos.length,2);
// Cambio de clave hacia una existente: error; hacia una nueva: ok sin duplicar
assert.throws(()=>ctx.guardarProducto({clave:'CAR-7',descripcion:'x',precio:1,claveOriginal:'PAN-550'}),/ya existe/);
r=ctx.guardarProducto({clave:'PAN-550M',descripcion:'Panel solar 550 W mono',precio:4100,claveOriginal:'PAN-550'});
assert.deepEqual(r.productos.map(p=>p.clave),['CAR-7','PAN-550M']);
assert.throws(()=>ctx.guardarProducto({clave:'Z',descripcion:'x',precio:1,claveOriginal:'NOEXISTE'}),/ya no existe/);
assert.equal(catSS.h.m[2][5],'efrain@helgen.tech'); assert.equal(catSS.h.m[0][3],'Precio unitario (sin IVA)');
console.log('OK catálogo', r.productos.map(p=>p.clave+' '+p.precio).join(', '));
