// Interfaz (web/cotizador/index.html): corre la capa api-web y el script de la app con un DOM y un fetch simulados.
// Cubre: si el servidor rechaza el proyecto (codigo PROYECTO), se limpia el campo, se refresca la lista y se avisa.
// Uso: node tests/interfaz.test.js .   (carpeta del proyecto)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(path.join(process.argv[2],'web/cotizador/index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m=>({id:m[1],src:m[2]}));
const apiWeb=scripts.find(s=>s.id==='api-web').src, app=scripts.find(s=>!s.id).src;

// ---- DOM simulado (solo lo que usa la app) ----
function elemento(tag){const e={tag,value:'',textContent:'',innerHTML:'',className:'',title:'',src:'',disabled:false,hijos:[],oyentes:{},
 _clases:new Set(),porClase:{},
 classList:{add:c=>e._clases.add(c),remove:c=>e._clases.delete(c),contains:c=>e._clases.has(c),toggle:(c,f)=>f?e._clases.add(c):e._clases.delete(c)},
 addEventListener:(t,f)=>(e.oyentes[t]=e.oyentes[t]||[]).push(f),
 disparar:t=>(e.oyentes[t]||[]).forEach(f=>f({target:e})),
 focus(){},remove(){},appendChild:h=>e.hijos.push(h),
 querySelector:sel=>e.porClase[sel]||(e.porClase[sel]=elemento('input')),
 querySelectorAll:sel=>sel==='tr'?e.hijos:[]};return e}
const porId={};
const document={getElementById:id=>porId[id]||(porId[id]=elemento('div')),
 querySelector:()=>({src:'data:logo'}),createElement:t=>elemento(t)};
document.getElementById('login').classList.add('oculto');

// ---- Sesión vigente (token falso; quien valida es el servidor) ----
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token='h.'+b64({email:'ana@helgen.tech',given_name:'Ana',exp:Math.floor(Date.now()/1000)+3600})+'.f';
const almacen={cotizadorHelgenSesion:token};

// ---- Servidor simulado ----
const PRY={folio:'PRY-2026-0001',nombre:'Techo',cliente:'Luis — Solar MX',clienteId:'LUSM800101AB1',ubicacion:'Qro',estado:'Activo',fecha:'20/10/2026'};
const llamadas=[]; let respuestas={};
async function fetch(url,opts){const c=JSON.parse(opts.body);llamadas.push(c);
 const r=respuestas[c.funcion];const datos=typeof r==='function'?r(c):r;
 return{ok:true,json:async()=>datos}}
respuestas.getDatosIniciales={ok:true,datos:{ivaTasa:0.16,catalogo:[],clientes:[],proyectos:[PRY],marcas:{}}};

const ctx={document,fetch,console,JSON,Date,Math,Number,String,Array,Object,Promise,Proxy,Error,Uint8Array,TextDecoder,
 atob:s=>Buffer.from(s,'base64').toString('binary'),crypto:{randomUUID:()=>'id-'+Math.random()},
 sessionStorage:{getItem:k=>almacen[k]??null,setItem:(k,v)=>almacen[k]=v,removeItem:k=>delete almacen[k]},
 setTimeout,clearTimeout,scrollTo(){}};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(apiWeb,ctx); vm.runInContext(app,ctx);
const $=id=>document.getElementById(id), esperar=()=>new Promise(r=>setImmediate(r));

(async()=>{
  for(let i=0;i<5;i++) await esperar();
  assert.equal(vm.runInContext('PROYECTOS.length',ctx),1,'carga los proyectos activos');

  // Elegir el proyecto
  $('cNombre').value='Luis';
  $('proyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; $('proyecto').disparar('change');
  assert(/^Proyecto activo/.test($('proyInfo').textContent));

  // El servidor lo rechaza (se canceló mientras tanto): codigo PROYECTO
  respuestas.guardarCotizacion={ok:false,codigo:'PROYECTO',error:'El proyecto PRY-2026-0001 está cancelado: ya no se le pueden agregar cotizaciones.'};
  respuestas.listarProyectos={ok:true,datos:[]};
  vm.runInContext('guardar()',ctx);
  for(let i=0;i<10;i++) await esperar();
  const g=llamadas.find(c=>c.funcion==='guardarCotizacion');
  assert.equal(g.args[0].proyectoFolio,'PRY-2026-0001'); assert.equal(g.token,token);
  assert.equal($('proyecto').value,'','se limpia el campo Proyecto');
  assert(/^Sin proyecto/.test($('proyInfo').textContent),'la etiqueta ya no dice "Proyecto activo": '+$('proyInfo').textContent);
  assert(llamadas.some(c=>c.funcion==='listarProyectos'),'se refresca la lista de proyectos');
  assert.equal(vm.runInContext('PROYECTOS.length',ctx),0); assert.equal($('proyectosList').innerHTML,'');
  assert.equal($('aviso').className,'aviso error');
  assert(/está cancelado/.test($('aviso').innerHTML)&&/Se quitó el proyecto/.test($('aviso').innerHTML));
  assert.equal($('btnGuardar').disabled,false,'se puede volver a guardar');

  // Otro error (no de proyecto): el campo se queda como estaba
  respuestas.listarProyectos={ok:true,datos:[PRY]}; vm.runInContext("recibirProyectos([PRY_])".replace('PRY_',JSON.stringify(PRY)),ctx);
  $('proyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; $('proyecto').disparar('change');
  respuestas.guardarCotizacion={ok:false,error:'El sistema está ocupado guardando otra cotización.'};
  const antes=llamadas.filter(c=>c.funcion==='listarProyectos').length;
  vm.runInContext('guardar()',ctx);
  for(let i=0;i<10;i++) await esperar();
  assert.equal($('proyecto').value,'PRY-2026-0001 — Luis — Solar MX — Techo');
  assert(/^Proyecto activo/.test($('proyInfo').textContent));
  assert.equal(llamadas.filter(c=>c.funcion==='listarProyectos').length,antes);
  assert(/ocupado/.test($('aviso').innerHTML)&&!/Se quitó/.test($('aviso').innerHTML));
  console.log('OK interfaz');
})().catch(e=>{console.error(e);process.exit(1)});
