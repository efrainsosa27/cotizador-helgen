const fs=require('fs'),vm=require('vm'),assert=require('assert');
const dir=process.argv[2];
// Acepta Code.js (código actual) o Code.gs (código anterior).
const ext=fs.existsSync(dir+'/Code.js')?'js':'gs';
const src=fs.readFileSync(dir+'/Logo.'+ext,'utf8')+'\n'+fs.readFileSync(dir+'/Code.'+ext,'utf8');
const chain=new Proxy({}, {get:(t,k)=>k==='build'?()=>({}):()=>chain});
// Hoja simulada; las fórmulas van aparte (h.f["fila,col"]), como en Sheets no son el valor de la celda
function hoja(nombre,m,padre){const h={m,nombre,f:{},getName:()=>nombre,setName(n){nombre=n;return h},getLastRow:()=>m.length,
 getDataRange:()=>({getValues:()=>m.map(r=>r.slice())}),appendRow:a=>m.push(a),setFrozenRows(){},setColumnWidth(){},
 getParent:()=>padre||{getUrl:()=>'https://sheets/catalogo'},
 getRange:(r,c=1,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this},setDataValidation(){return this},
   protect:()=>{h.protegida=r;return chain}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>{const x=(m[r-1+i]||[]).slice(c-1,c-1+nc);while(x.length<nc)x.push('');return x}),
  getValue:()=>(m[r-1]||[])[c-1],
  getFormulas:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>h.f[(r+i)+','+(c+j)]||'')),
  setFormula(v){h.f[r+','+c]=v;return this},
  setValue(v){(m[r-1]=m[r-1]||[])[c-1]=v;return this},
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setNumberFormat(){return this},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this}})};return h}
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
   RecalculationInterval:{HOUR:'HOUR'},
   create:n=>{creados++;catSS={getId:()=>'cat',getUrl:()=>'https://sheets/catalogo',pest:{},nombres:{},
     getSheets:()=>Object.values(catSS.pest),getSheetByName:x=>Object.values(catSS.pest).find(h=>h.getName()===x)||null,
     insertSheet:x=>{if(catSS.getSheetByName(x))throw new Error('ya existe');return catSS.pest[x]=hoja(x,[],catSS)},
     setNamedRange:(n,r)=>{catSS.nombres[n]=r},setRecalculationInterval:v=>{catSS.recalculo=v}};
     catSS.h=catSS.pest.h=hoja('Hoja 1',[],catSS);return catSS},
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

// ---- Precio en USD con el tipo de cambio del día ----
assert.deepEqual({...ctx.tipoCambioDesdeValores(18.4567891,'')},{valor:18.4568,fuente:'Google Finance'});
assert.deepEqual({...ctx.tipoCambioDesdeValores(18.45,19.9)},{valor:19.9,fuente:'manual'},'el manual manda');
assert.deepEqual({...ctx.tipoCambioDesdeValores('#N/A','')},{valor:null,fuente:''});
assert.deepEqual({...ctx.tipoCambioDesdeValores('Cargando…',0.05)},{valor:null,fuente:''},'fuera de rango se descarta');
assert.equal(ctx.precioEnDolares(15000,18.5),810.81); assert.equal(ctx.precioEnDolares(15000,null),null);
// Pestaña "Tipo de cambio": Google Finance, manual opcional, en uso = rango TIPO_CAMBIO; recalcula cada hora
const tc=catSS.getSheetByName('Tipo de cambio');
assert(tc,'se crea sola'); assert.equal(tc.f['2,2'],'=GOOGLEFINANCE("CURRENCY:USDMXN")');
assert.equal(tc.f['4,2'],'=IF(ISNUMBER(B3),B3,IFERROR(ROUND(B2,4),""))');
assert(catSS.nombres.TIPO_CAMBIO,'rango con nombre'); assert.equal(catSS.recalculo,'HOUR');
// Columna I: encabezado, fórmula por renglón (sin ARRAYFORMULA), protegida con advertencia
const cat=catSS.h;
assert.equal(cat.m[0][8],'Precio USD (sin IVA, automático)'); assert.equal(cat.protegida,'I:I');
assert.equal(cat.f['2,9'],'=IF(ISNUMBER(D2),IFERROR(ROUND(D2/TIPO_CAMBIO,2),""),"")');
assert.equal(cat.f['3,9'],'=IF(ISNUMBER(D3),IFERROR(ROUND(D3/TIPO_CAMBIO,2),""),"")');
assert(!Object.values(cat.f).some(x=>/ARRAYFORMULA/i.test(x)));
// Sin tipo de cambio todavía (GOOGLEFINANCE cargando): sin precio USD, el catálogo funciona igual
r=ctx.getCatalogo(); assert.equal(r.productos[0].precioUsd,null); assert.equal(r.tipoCambio.valor,null);
// Con Google Finance
tc.m[1][1]=18.5;
r=ctx.getCatalogo();
assert.deepEqual(r.productos.map(p=>p.clave+':'+p.precio+':'+p.precioUsd),['CAR-7:15000:810.81','PAN-550M:4100:221.62']);
assert.deepEqual({...r.tipoCambio},{valor:18.5,fuente:'Google Finance'});
// Manual: manda sobre el automático
tc.m[2][1]=20; r=ctx.getCatalogo(); assert.equal(r.productos[0].precioUsd,750); assert.equal(r.tipoCambio.fuente,'manual');
tc.m[2][1]='';
// Alta desde la app: su renglón recibe la fórmula; no se escribe al final de la hoja
r=ctx.guardarProducto({clave:'INV-8',descripcion:'Inversor 8 kW',precio:'26000'});
assert.equal(cat.m.length,4); assert.equal(cat.f['4,9'],'=IF(ISNUMBER(D4),IFERROR(ROUND(D4/TIPO_CAMBIO,2),""),"")');
assert.equal(r.productos.find(p=>p.clave==='INV-8').precioUsd,1405.41); assert.equal(r.tipoCambio.valor,18.5);
// Renglón capturado a mano en Sheets (sin fórmula): se repara al abrir el catálogo; no se duplica la pestaña
cat.m.push(['BAT-5','Batería 5 kWh','PZA',30000]);
ctx.getCatalogo();
assert.equal(cat.f['5,9'],'=IF(ISNUMBER(D5),IFERROR(ROUND(D5/TIPO_CAMBIO,2),""),"")');
assert.equal(Object.keys(catSS.pest).length,2);
console.log('OK catálogo', r.productos.map(p=>p.clave+' '+p.precio).join(', '));
