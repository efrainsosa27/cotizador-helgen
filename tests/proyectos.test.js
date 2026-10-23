// Proyectos: folio PRY-AAAA-NNNN, carpeta en Drive con subcarpetas, cotización ligada por proyecto_folio.
// Uso: node tests/proyectos.test.js .   (carpeta con Code.js y Logo.js)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];
const src=fs.readFileSync(path.join(dir,'Logo.js'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'Code.js'),'utf8');

// Hoja simulada (matriz). getValues siempre devuelve nr filas, como Sheets (celdas vacías = '').
function hoja(m){return{m,getLastRow:()=>m.length,getMaxRows:()=>1000,setFrozenRows(){},setColumnWidth(){},
 getDataRange:()=>({getValues:()=>m.map(r=>r.slice()),getDisplayValues:()=>m.map(r=>r.map(x=>x instanceof Date?'20/10/2026':String(x??'')))}),
 appendRow:a=>m.push(a),
 getRange:(r,c=1,nr=1,nc=1)=>typeof r==='string'?{setNumberFormat(){return this}}:({
  getValues:()=>Array.from({length:nr},(_,i)=>{const f=(m[r-1+i]||[]).slice(c-1,c-1+nc);while(f.length<nc)f.push('');return f}),
  setValue(v){m[r-1][c-1]=v;return this},
  setValues(vs){vs.forEach((x,i)=>{m[r-1+i]=m[r-1+i]||[];x.forEach((y,j)=>m[r-1+i][c-1+j]=y)});return this},
  setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this},setNumberFormat(){return this}})}}

// Drive simulado: árbol de carpetas con Papelera
let nId=0; const carpetas={};
function carpeta(nombre,padre){const f={id:'F'+(++nId),nombre,padre,hijos:[],archivos:[],trashed:false,
 getId:()=>f.id,getName:()=>f.nombre,setName:n=>{f.nombre=n;return f},getUrl:()=>'https://drive/'+f.id,isTrashed:()=>f.trashed,
 getFoldersByName:n=>{const l=f.hijos.filter(h=>h.nombre===n);let i=0;return{hasNext:()=>i<l.length,next:()=>l[i++]}},
 createFolder:n=>{const h=carpeta(n,f);f.hijos.push(h);return h},
 createFile:b=>{f.archivos.push(b);return{getUrl:()=>'https://drive/pdf/'+b.name}}};
 carpetas[f.id]=f;return f}
const maestra=carpeta('Cotizador Helgen',null), pdfRaiz=maestra.createFolder('Cotizaciones Helgen (PDF)');
const ruta=f=>f.padre?ruta(f.padre)+'/'+f.nombre:f.nombre;
const vivos=f=>f.hijos.filter(h=>!h.trashed);

const cfg=hoja([['Clave','Valor'],['PREFIJO_FOLIO','HLG'],['IVA_TASA',0.16]]);
// Cotizaciones con encabezados viejos (19 columnas, sin proyecto_folio) y una fila real
const ENC19=['Folio','Fecha','Cliente','Empresa','RFC','Correo','Teléfono','Subtotal','IVA','Total','Elaboró','PDF','Conceptos (JSON)','Notas','Marca','Dirección','vendedor_email','vendedor_nombre','vendedor_apellido'];
const filaVieja=['HLG-2026-0004','x','Viejo','Vieja SA','','','',1,0.16,1.16,'antes@helgen.tech','u','[]','','Helgen','','a@helgen.tech','A','B'];
const cot=hoja([ENC19.slice(),filaVieja.slice()]);
let pry=null;
const db={getSheetByName:n=>n==='Config'?cfg:n==='Cotizaciones'?cot:n==='Proyectos'?pry:null,
 insertSheet:n=>{if(pry)throw new Error('ya existe');return pry=hoja([])},getId:()=>'DB'};
const props={SPREADSHEET_ID:'DB',FOLDER_ID:pdfRaiz.id,CATALOGO_ID:'CAT'},cache={};
const dv=()=>{const b={requireValueInList:(l)=>{b.lista=l;return b},setAllowInvalid:()=>b,setHelpText:()=>b,build:()=>({})};return b};
const registro=[];
const ctx={console:{...console,warn(){}},Date,JSON,Logger:{log:m=>registro.push(String(m))},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>props[k]=v,getProperties:()=>Object.assign({},props),setProperties:o=>Object.assign(props,o)})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]??null,put:(k,v)=>cache[k]=v,getAll:ks=>Object.fromEntries(ks.filter(k=>k in cache).map(k=>[k,cache[k]])),putAll:o=>Object.assign(cache,o)})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Session:{getActiveUser:()=>({getEmail:()=>''})},
 Utilities:{formatDate:(d,tz,f)=>f==='yyyy'?'2026':'20/10/2026',newBlob:h=>({getAs:()=>({setName:n=>({name:n,html:h})})}),base64Encode:b=>Buffer.from(b).toString('base64'),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},computeDigest:(a,s)=>[...require('crypto').createHash(a||'sha256').update(s).digest()]},
 SpreadsheetApp:{flush(){},newDataValidation:dv,
  openById:id=>id==='CAT'?{getSheetByName:()=>hoja([['Clave','Descripción','Unidad','Precio unitario (sin IVA)','Actualizado','Actualizó','Clave SAT','Unidad SAT']]),getUrl:()=>'cat'}:db},
 DriveApp:{getFolderById:id=>{if(!carpetas[id])throw new Error('No se encontró');return carpetas[id]},
  getFileById:()=>({getParents:()=>{let d=false;return{hasNext:()=>!d,next:()=>{d=true;return maestra}}}}),
  getRootFolder:()=>{throw new Error('no debe usar Mi unidad')}},
};
vm.createContext(ctx); vm.runInContext(src,ctx);
vm.runInContext("VENDEDOR_ = {email:'ana@helgen.tech',nombre:'Ana',apellido:'López'}",ctx);

// --- Lógica pura ---
assert.equal(ctx.idCliente({nombre:'Juan',rfc:'abc-010101-ab1'}),'ABC010101AB1');
assert.equal(ctx.idCliente({nombre:'Juan',rfc:'XAXX010101000'}),'SIN-RFC:juan|','RFC genérico no identifica');
assert.equal(ctx.idCliente({nombre:'José  Pérez',empresa:'Ácme',rfc:'123'}),'SIN-RFC:jose perez|acme');
assert.throws(()=>ctx.normalizarProyecto({nombre:'',cliente:{nombre:'X'}}),/nombre del proyecto/);
assert.throws(()=>ctx.normalizarProyecto({nombre:'P',cliente:{}}),/cliente del proyecto/);
assert.equal(ctx.normalizarProyecto({nombre:'P',cliente:{nombre:'Luis',empresa:'Solar MX'}}).cliente,'Luis — Solar MX');
assert.equal(ctx.normalizarProyecto({nombre:'P',cliente:{nombre:'Solar MX',empresa:'solar mx'}}).cliente,'Solar MX');
assert.equal(ctx.nombreCarpetaProyecto('PRY-2026-0001','A/B: "C"','Techo*1?'),'PRY-2026-0001 — A B C — Techo 1');
// Clave de proyecto (3 letras): sugerida con el nombre, editable al crear, validada en el servidor
for (const [nombre,clave] of [['DROGHEDA','DRO'],['Casa del Lago','CAL'],['Planta de Agua Norte','PAN'],['Ñandú','NAN'],
  ['El Sol','SOL'],['Línea 3','LIN'],['4 Torres de Querétaro','TOQ'],['Planta para la Energía del Sol','PES'],['Y','XXX'],['',"XXX"],
  ['Yo','YOX'],['A1 B2','ABX'],['Nave Industrial','NAI'],['Proyecto de Prueba oficial','PPO']]) assert.equal(ctx.claveSugerida(nombre),clave,nombre);
assert.equal(ctx.validarClaveProyecto(' dro ','x'),'DRO'); assert.equal(ctx.validarClaveProyecto('','Casa del Lago'),'CAL','vacía = sugerida');
for (const mal of ['DR','DROG','DRÓ','DR1','D-O','ÑAN']) assert.throws(()=>ctx.validarClaveProyecto(mal,'x'),/exactamente 3 letras/,mal);
assert.deepEqual([ctx.folioVisible('PRY-2026-0002','dro'),ctx.folioVisible('PRY-2026-0002','')],['PRY-2026-0002-DRO','PRY-2026-0002']);
assert.deepEqual(['PRY-2026-0002-DRO','pry-2026-0002',' PRY-2026-0002 ','',null].map(ctx.folioInterno),['PRY-2026-0002','PRY-2026-0002','PRY-2026-0002','','']);
// El cliente_id de clientesDesdeFilas es el mismo que el del proyecto
const F=(n,e,rfc)=>{const r=['F','x',n,e,rfc,'','',0,0,0,'','','','','',''];return r};
assert.equal(ctx.clientesDesdeFilas([F('Luis','Solar MX','')])[0].id,'SIN-RFC:luis|solar mx');
assert.equal(ctx.clientesDesdeFilas([F('Luis','Solar MX','LUSM800101AB1')])[0].id,'LUSM800101AB1');

// --- Crear proyecto ---
const nuevo=(extra)=>({nombre:'Techo solar planta',ubicacion:'Querétaro',cliente:{nombre:'Luis',empresa:'Solar MX',rfc:'LUSM800101AB1'},...extra});
const p1=ctx.crearProyecto(nuevo({idSolicitud:'p1',vendedor:{email:'impostor@helgen.tech'}}));
assert.equal(p1.folio,'PRY-2026-0001'); assert.equal(p1.estado,'Activo'); assert.equal(p1.clienteId,'LUSM800101AB1');
assert.equal(pry.m[0].join(','),'Folio,Fecha,Nombre,Cliente,cliente_id,Ubicación,Estado,carpeta_id,vendedor_email,vendedor_nombre,vendedor_apellido,clave');
const f1=pry.m[1];
assert.deepEqual([f1[0],f1[2],f1[3],f1[4],f1[5],f1[6]],['PRY-2026-0001','Techo solar planta','Luis — Solar MX','LUSM800101AB1','Querétaro','Activo']);
assert.deepEqual(f1.slice(8,11),['ana@helgen.tech','Ana','López'],'vendedor del servidor');
assert.equal(f1[11],'TSP','clave sugerida con el nombre (Techo solar planta) en la columna L');
assert(!JSON.stringify(pry.m).includes('impostor'));
// Carpeta: Cotizador Helgen/Proyectos/2026/<folio> — <cliente> — <nombre>/ solo con Cotizaciones (Pagos y Órdenes de compra ya no: van en cobranza y compras)
const c1=carpetas[f1[7]];
assert.equal(ruta(c1),'Cotizador Helgen/Proyectos/2026/PRY-2026-0001-TSP — Luis — Solar MX — Techo solar planta');
assert.deepEqual(c1.hijos.map(h=>h.nombre),['Cotizaciones']);
assert.equal(props.PROYECTOS_FOLDER_ID,c1.padre.padre.id); assert.equal(props.CONSECUTIVO_PROY_2026,'1');
assert.equal(props.CONSECUTIVO_2026,undefined,'el contador de cotizaciones no cambia');
// Idempotencia
assert.equal(ctx.crearProyecto(nuevo({idSolicitud:'p1'})).folio,'PRY-2026-0001'); assert.equal(pry.m.length,2);
// Segundo proyecto: reutiliza Proyectos/2026; texto que parece fórmula va con apóstrofo
const p2=ctx.crearProyecto({nombre:'=Bodega',cliente:{nombre:'+52 Ana'},idSolicitud:'p2'});
assert.equal(p2.folio,'PRY-2026-0002'); assert.equal(pry.m[2][2],"'=Bodega"); assert.equal(pry.m[2][3],"'+52 Ana");
assert.equal(vivos(maestra).filter(h=>h.nombre==='Proyectos').length,1); assert.equal(vivos(c1.padre).length,2);
// Contador borrado no repite folio
delete props.CONSECUTIVO_PROY_2026; assert.equal(ctx.crearProyecto(nuevo({nombre:'Tercero',idSolicitud:'p3'})).folio,'PRY-2026-0003');

// --- Listar / buscar (solo Activos por omisión) ---
pry.m[3][6]='Cancelado';
assert.deepEqual(ctx.listarProyectos('').map(p=>p.folio),['PRY-2026-0002','PRY-2026-0001']);
assert.deepEqual(ctx.listarProyectos('',true).map(p=>p.folio),['PRY-2026-0003','PRY-2026-0002','PRY-2026-0001']);
assert.deepEqual(ctx.listarProyectos('solar').map(p=>p.folio),['PRY-2026-0001'],'por cliente');
assert.deepEqual(ctx.listarProyectos('TECHO').map(p=>p.folio),['PRY-2026-0001'],'por nombre');
assert.deepEqual(ctx.listarProyectos('pry-2026-0002').map(p=>p.folio),['PRY-2026-0002'],'por folio');
assert.equal(ctx.listarProyectos('')[0].carpetaId,undefined,'no expone IDs de Drive');

// --- Cotizar ---
const base={cliente:{nombre:'Luis',empresa:'Solar MX'},items:[{descripcion:'Panel',cantidad:2,precio:100}]};
const r1=ctx.guardarCotizacion({...base,proyectoFolio:'pry-2026-0001',idSolicitud:'c1'});
assert.equal(r1.folio,'HLG-2026-0005'); assert.equal(r1.proyectoFolio,'PRY-2026-0001');
const subCot=c1.hijos.find(h=>h.nombre==='Cotizaciones');
assert.deepEqual(subCot.archivos.map(a=>a.name),['HLG-2026-0005 - Solar MX.pdf'],'PDF en Cotizaciones del proyecto');
// Encabezados: solo cambia la fila 1; la fila vieja no se mueve y queda vacía en T
assert.equal(cot.m[0].length,22); assert.equal(cot.m[0][21],'tipo_cambio'); assert.equal(cot.m[0][19],'proyecto_folio'); assert.equal(cot.m[0][20],'moneda'); assert.deepEqual(cot.m[0].slice(0,19),ENC19);
assert.deepEqual(cot.m[1],filaVieja,'fila vieja intacta');
assert.equal(cot.m[2][19],'PRY-2026-0001'); assert.equal(cot.m[2][20],'MXN');
// Sin proyecto: carpeta del año, columna T vacía
ctx.guardarCotizacion({...base,idSolicitud:'c2'});
assert.equal(vivos(pdfRaiz).find(h=>h.nombre==='2026').archivos.length,1); assert.equal(cot.m[3][19],'');
// Historial
const h=ctx.listarCotizaciones('');
assert.deepEqual(h.map(c=>c.proyecto),['Sin proyecto','PRY-2026-0001-TSP','Sin proyecto'],'el Historial muestra el folio con clave');
assert.deepEqual(ctx.listarCotizaciones('pry-2026-0001').map(c=>c.folio),['HLG-2026-0005'],'busca por proyecto');
// Proyecto inexistente o cancelado: error y no se consume folio
assert.throws(()=>ctx.guardarCotizacion({...base,proyectoFolio:'PRY-2026-0099',idSolicitud:'c3'}),
  e=>/No existe el proyecto PRY-2026-0099/.test(e.message)&&e.codigo==='PROYECTO');
assert.throws(()=>ctx.guardarCotizacion({...base,proyectoFolio:'PRY-2026-0003',idSolicitud:'c4'}),
  e=>/está cancelado/.test(e.message)&&e.codigo==='PROYECTO','la interfaz usa codigo PROYECTO para limpiar el campo');
assert.equal(props.CONSECUTIVO_2026,'6'); assert.equal(cot.m.length,4);

// --- Subcarpetas borradas o renombradas: se crea una nueva ---
subCot.trashed=true;
ctx.guardarCotizacion({...base,proyectoFolio:'PRY-2026-0001',idSolicitud:'c5'});
let nueva=vivos(c1).find(h=>h.nombre==='Cotizaciones');
assert(nueva&&nueva!==subCot&&nueva.archivos.length===1,'Cotizaciones en Papelera -> nueva');
nueva.nombre='Cotizaciones viejas';
ctx.guardarCotizacion({...base,proyectoFolio:'PRY-2026-0001',idSolicitud:'c6'});
assert.equal(vivos(c1).filter(h=>h.nombre==='Cotizaciones').length,1,'renombrada -> nueva');
// Carpeta del proyecto en la Papelera: se vuelve a crear y se actualiza carpeta_id
c1.trashed=true;
ctx.guardarCotizacion({...base,proyectoFolio:'PRY-2026-0001',idSolicitud:'c7'});
const c1b=carpetas[pry.m[1][7]];
assert(c1b!==c1&&!c1b.trashed&&c1b.hijos.find(h=>h.nombre==='Cotizaciones').archivos.length===1);
assert.deepEqual(c1b.hijos.map(h=>h.nombre),['Cotizaciones']);

// --- Claves para proyectos que ya existían (editor): vista previa y aplicar ---
const pr=pry.m;
const cv1=carpeta('PRY-2026-0101 — Helgen — DROGHEDA',pdfRaiz), cv2=carpeta('Nombre puesto a mano',pdfRaiz);
pr.push(['PRY-2026-0101','','DROGHEDA','Helgen','id','','Activo',cv1.id,'a@helgen.tech','A','B']);
pr.push(['PRY-2026-0102','','Planta de Agua Norte','Helgen','id','','Cerrado',cv2.id,'a@helgen.tech','A','B']);
pr.push(['PRY-2026-0103','','Sin carpeta','Helgen','id','','Cancelado','NO-EXISTE','a@helgen.tech','A','B']);
const clavePrevia=pr[1][11];
let prev=ctx.asignarClavesProyectos();
assert.deepEqual(prev.map(x=>x.folio+':'+x.clave),['PRY-2026-0101:DRO','PRY-2026-0102:PAN','PRY-2026-0103:SIC'],'solo los que no tienen clave');
assert.equal(cv1.nombre,'PRY-2026-0101 — Helgen — DROGHEDA','la vista previa no cambia nada'); assert.equal(pr[pr.length-3][11],undefined);
assert(registro.some(l=>/VISTA PREVIA/.test(l))&&registro.some(l=>/DROGHEDA" → PRY-2026-0101-DRO/.test(l)));
ctx.asignarClavesProyectosAplicar();
assert.deepEqual(pr.slice(-3).map(r=>r[11]),['DRO','PAN','SIC']);
assert.equal(cv1.nombre,'PRY-2026-0101-DRO — Helgen — DROGHEDA','carpeta renombrada (por carpeta_id)');
assert.equal(cv2.nombre,'Nombre puesto a mano','renombrada a mano: no se toca');
assert.equal(pr[1][11],clavePrevia,'la clave de un proyecto que ya tenía no cambia');
assert.deepEqual(ctx.asignarClavesProyectos(),[],'una segunda vez ya no hay nada que asignar');

// --- Fuera de doPost (sin vendedor) no se crean proyectos ---
vm.runInContext('VENDEDOR_ = null',ctx);
assert.throws(()=>ctx.crearProyecto(nuevo({idSolicitud:'x'})),/Inicia sesión/);
console.log('OK proyectos');
