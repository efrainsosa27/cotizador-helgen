const fs=require('fs'),vm=require('vm'),assert=require('assert');
// Acepta Code.js (código actual) o Code.gs (código anterior); Logo con la misma extensión.
const src=fs.readFileSync(process.argv[2].replace(/Code\.(js|gs)$/,'Logo.$1'),'utf8')+'\n'+fs.readFileSync(process.argv[2],'utf8');
// Hoja simulada (matriz) con getRange(fila,col,nf,nc) / getRange('B:B')
function hoja(m){return{m,getLastRow:()=>m.length,getDataRange:()=>({getValues:()=>m.map(r=>r.slice())}),
 appendRow:a=>m.push(a),
 getRange:(r,c,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){}}:({
  getValues:()=>m.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc)),
  getValue:()=>(m[r-1]||[])[c-1],
  setValue(v){m[r-1][c-1]=v;return this},setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setFontWeight(){return this},setBackground(){return this},setFontColor(){return this}})}}
const cfg=hoja([['Clave','Valor'],['EMPRESA_NOMBRE','Helgen Technologies'],['EMPRESA_RFC','XAXX010101000'],['EMPRESA_WEB','helgen.tech'],['EMPRESA_TELEFONO','#ERROR!'],['EMPRESA_EMAIL','contacto@helgen.tech'],['PREFIJO_FOLIO','HLG'],['IVA_TASA',0.16],
  ['TERMINOS','Metraje adicional...\nCualquier trabajo o material fuera del alcance descrito se cotizará por separado.']]);
const cot=hoja([['Folio','Fecha','Cliente','Empresa','RFC','Correo','Teléfono','Subtotal','IVA','Total','Elaboró','PDF','Conceptos (JSON)','Notas']]);
const props={SPREADSHEET_ID:'x',FOLDER_ID:'y'},cache={},pdfs=[];
const ctx={console,Date,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>'efrain@helgen.tech'})},
 Utilities:{formatDate:(d,tz,f)=>f==='yyyy'?'2026':'15/10/2026',newBlob:h=>({getAs:()=>({setName:n=>({name:n,html:h})})}),base64Encode:()=>''},
 SpreadsheetApp:{flush(){},openById:()=>({getSheetByName:n=>n==='Config'?cfg:cot})},
 DriveApp:{getFolderById:()=>({getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:b=>{pdfs.push(b);return{getUrl:()=>'u'}}})})})},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
// Código con sesión (Fase 2): guardar exige un vendedor verificado; aquí se simula uno.
if (/let VENDEDOR_\b/.test(src)) vm.runInContext("VENDEDOR_ = {email:'efrain@helgen.tech',nombre:'Efrain',apellido:'Sosa'}", ctx);
const base={cliente:{nombre:'Ana',telefono:'+52 55 1234 5678'},items:[{descripcion:'Servicio',cantidad:1,precio:100}]};
ctx.guardarCotizacion({...base,idSolicitud:'h1'});
ctx.guardarCotizacion({...base,marca:'energy',idSolicitud:'e1'});
// Migración de Config
const claves=cfg.m.map(r=>r[0]);
assert(!claves.includes('TERMINOS')&&claves.includes('TERMINOS_HELGEN')&&claves.includes('TERMINOS_ENERGY'));
const val=k=>cfg.m.find(r=>r[0]===k)[1];
assert.equal(val('EMPRESA_TELEFONO'),'+52 442 644 5391'); assert.equal(val('EMPRESA_RFC'),'HSE240304PC1');
assert.equal(val('EMPRESA_NOMBRE'),'Helgen Servicios Especializados');
// Migrar de nuevo no duplica
ctx.guardarCotizacion({...base,idSolicitud:'h2'}); assert.equal(cfg.m.filter(r=>r[0]==='TERMINOS_HELGEN').length,1);
// PDF Helgen: solo vigencia
const [h,e]=pdfs.map(p=>p.html);
const li=x=>(x.match(/<li>/g)||[]).length;
assert.equal(li(h),1); assert(h.includes('Precios vigentes por 15 días o hasta agotar existencias'));
assert(!h.includes('Metraje')&&!h.includes('alcance')&&!h.includes('HELGEN ENERGY')&&!h.includes('#ERROR'));
assert.equal(li(e),4); assert(e.includes('Metraje adicional')&&e.includes('Obra civil')&&e.includes('HELGEN ENERGY')&&!e.includes('alcance'));
// Hoja Cotizaciones
assert.equal(cot.m[0][14],'Marca'); assert.equal(cot.m[0][15],'Dirección'); assert.equal(cot.m[1][14],'Helgen'); assert.equal(cot.m[2][14],'Helgen Energy');
assert.equal(cot.m[1][6],"'+52 55 1234 5678");
assert.deepEqual(cot.m.slice(1).map(r=>r[0]),['HLG-2026-0001','HLG-2026-0002','HLG-2026-0003']);
assert.equal(ctx.guardarCotizacion({...base,idSolicitud:'h1'}).folio,'HLG-2026-0001','reenvío = mismo folio');
delete props.CONSECUTIVO_2026; assert.equal(ctx.guardarCotizacion({...base,idSolicitud:'z'}).folio,'HLG-2026-0004','contador borrado no repite');
fs.writeFileSync(process.argv[3]+'/helgen.html',h); fs.writeFileSync(process.argv[3]+'/energy.html',e);
assert(h.includes('data:image/png;base64,iVBOR')&&h.includes('#2C3C5B')&&h.includes('#51F3DA')&&!/#0B1C3F|#4CAF50/.test(h));
assert(h.includes('HSE240304PC1')&&h.includes('Sendero del Regocijo 32 int 1'));
// Clientes
const F=(fecha,n,e,rfc,mail,tel,dir)=>{const r=['F',fecha,n,e,rfc,mail,tel];r[15]=dir;return r};
let cl=ctx.clientesDesdeFilas([
  F('01/10/2026','Juan Pérez','Acme','',  'j@a.com','',     'Calle 1'),
  F('02/10/2026','juan  perez','ACME','AAA010101AAA','', '442 1', ''),   // mismo cliente (acentos/mayúsculas/espacios)
  F('03/10/2026','Juan Pérez','Otra SA','', '', '', ''),                  // mismo nombre, otra empresa
  F('04/10/2026','Ana','','', '', '', ''),
  F('05/10/2026','','SinNombre','', '', '', ''),
]);
assert.equal(cl.length,3);
assert.deepEqual(cl.map(c=>c.etiqueta),['Ana','Juan Pérez — Otra SA','juan  perez — ACME']);
const acme=cl.find(c=>/acme/i.test(c.empresa));
assert.equal(acme.cotizaciones,2); assert.equal(acme.rfc,'AAA010101AAA'); assert.equal(acme.email,'j@a.com','dato vacío no borra el anterior');
assert.equal(acme.direccion,'Calle 1'); assert.equal(acme.telefono,'442 1'); assert.equal(acme.ultimaFecha,'02/10/2026');
assert.deepEqual([...ctx.clientesDesdeFilas([F('x','Solo','','','','','')])].map(c=>c.etiqueta),['Solo']);
// Desde la hoja: el cliente guardado aparece con su dirección; si se borran sus filas desaparece
ctx.guardarCotizacion({cliente:{nombre:'Luis',empresa:'Solar MX',direccion:'Av. 5'},items:[{descripcion:'x',cantidad:1,precio:1}],idSolicitud:'cl1'});
let lc=ctx.getClientes(); const luis=lc.find(c=>c.nombre==='Luis');
assert(luis&&luis.direccion==='Av. 5'&&luis.empresa==='Solar MX'); assert.equal(lc[0].nombre,'Luis','más reciente primero');
cot.m.splice(1); assert.equal(ctx.getClientes().length,0,'sin filas = sin sugerencias');
// Moneda: USD en etiqueta, total e importe con letra; MXN igual que antes; columna U
if (ctx.monedaDeCotizacion) {
  assert.equal(ctx.importeConLetra(1160.02),'MIL CIENTO SESENTA PESOS 02/100 M.N.');
  assert.equal(ctx.importeConLetra(1160.02,'USD'),'MIL CIENTO SESENTA DÓLARES 02/100 USD');
  assert.equal(ctx.importeConLetra(1,'USD'),'UN DÓLAR 00/100 USD');
  assert.equal(ctx.importeConLetra(2000000.5,'USD'),'DOS MILLONES DE DÓLARES 50/100 USD');
  assert.equal(ctx.monedaDeCotizacion(''),'MXN'); assert.equal(ctx.monedaDeCotizacion('usd'),'USD');
  assert.throws(()=>ctx.monedaDeCotizacion('EUR'),/Moneda no válida/);
  assert.throws(()=>ctx.guardarCotizacion({...base,moneda:'EUR',idSolicitud:'eur'}),/Moneda no válida/);
  const n=pdfs.length;
  const rU=ctx.guardarCotizacion({cliente:{nombre:'Solar Corp',empresa:'Solar Corp LLC',direccion:'Austin, TX'},moneda:'USD',marca:'energy',
    items:[{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA',cantidad:12,precio:180},{descripcion:'Inversor 8 kW',cantidad:1,precio:1450.5}],
    notas:'Precios en dólares estadounidenses.',idSolicitud:'usd1'});
  assert.equal(rU.moneda,'USD');
  const u=pdfs[n].html, fila=cot.m[cot.m.length-1];
  assert.equal(fila[20],'USD'); assert.equal(cot.m[0][20],'moneda');
  assert(u.includes('TOTAL USD')&&!u.includes('TOTAL MXN')&&u.includes('USD (dólares estadounidenses)'));
  assert(u.includes('DÓLARES')&&u.includes('/100 USD)')&&!u.includes('PESOS'));
  assert(h.includes('TOTAL MXN')&&h.includes('M.N.')&&!h.includes('dólares'),'MXN sin cambios');
  fs.writeFileSync(process.argv[3]+'/usd.html',u);
}
console.log('OK');
