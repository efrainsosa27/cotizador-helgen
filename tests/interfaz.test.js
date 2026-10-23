// Interfaz (web/cotizador/index.html): corre la capa api-web y el script de la app con un DOM y un fetch simulados.
// Cubre: si el servidor rechaza el proyecto (codigo PROYECTO), se limpia el campo, se refresca la lista y se avisa;
// moneda USD (el catálogo no pone precio); pestaña Cobranza solo con permiso; aceptar con confirmación; pago con comprobante;
// margen en Cobranza; pestaña Compras solo con permiso: requisición → orden precargada (renglones sin costo, tipo de cambio),
// pago con comprobante, cancelar el pago, cerrar con motivo; pestaña Requisiciones (nueva, corregir, recibí el material) y
// SOLO_REQUISICION (solo esa pestaña).
// Uso: node tests/interfaz.test.js .   (carpeta del proyecto)
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const html=fs.readFileSync(path.join(process.argv[2],'web/cotizador/index.html'),'utf8');
const scripts=[...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m=>({id:m[1],src:m[2]}));
const apiWeb=scripts.find(s=>s.id==='api-web').src, app=scripts.find(s=>!s.id).src;

// ---- Sesión vigente (token falso; quien valida es el servidor) ----
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const token='h.'+b64({email:'ana@helgen.tech',given_name:'Ana',exp:Math.floor(Date.now()/1000)+3600})+'.f';
const PRY={folio:'PRY-2026-0001',nombre:'Techo',cliente:'Luis — Solar MX',clienteId:'LUSM800101AB1',ubicacion:'Qro',estado:'Activo',fecha:'20/10/2026'};
const CAT=[{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA',precio:4100,precioUsd:222.22},
  {clave:'SRV-1',descripcion:'Servicio sin USD',unidad:'SRV',precio:1000,precioUsd:null}];
const TC={valor:18.45,fuente:'Google Finance'};

/** App cargada con un DOM y un servidor simulados nuevos. */
function montar(datosIniciales,opts){
  opts=opts||{};
  function elemento(tag){const e={tag,value:'',textContent:'',className:'',title:'',src:'',placeholder:'',disabled:false,hijos:[],oyentes:{},
   _clases:new Set(),porClase:{},
   classList:{add:c=>e._clases.add(c),remove:c=>e._clases.delete(c),contains:c=>e._clases.has(c),toggle:(c,f)=>f?e._clases.add(c):e._clases.delete(c)},
   addEventListener:(t,f)=>(e.oyentes[t]=e.oyentes[t]||[]).push(f),
   disparar:t=>(e.oyentes[t]||[]).forEach(f=>f({target:e})),
   focus(){},remove(){},appendChild:h=>e.hijos.push(h),prepend:h=>e.hijos.unshift(h),contains:()=>false,
   querySelector:sel=>e.porClase[sel]||(e.porClase[sel]=elemento('input')),
   querySelectorAll:sel=>sel==='tr'?e.hijos:sel==='input'?Object.values(e.porClase):[]};
   // Como el DOM: innerHTML = '' quita los renglones agregados con appendChild
   let h='';Object.defineProperty(e,'innerHTML',{get:()=>h,set:v=>{h=v;if(v==='')e.hijos.length=0}});return e}
  const porId={};
  const oyentesDoc={};
  const document={getElementById:id=>porId[id]||(porId[id]=elemento('div')),
   querySelector:()=>({src:'data:logo'}),createElement:t=>elemento(t),visibilityState:'visible',activeElement:null,
   addEventListener:(t,f)=>(oyentesDoc[t]=oyentesDoc[t]||[]).push(f),dispatchEvent:ev=>(oyentesDoc[ev.type]||[]).forEach(f=>f(ev))};
  document.getElementById('login').classList.add('oculto');
  document.getElementById('tabCob').classList.add('oculto'); // como en el HTML
  document.getElementById('tabCom').classList.add('oculto');
  const almacen={cotizadorHelgenSesion:token};
  // bootstrap = la carga inicial; sincronizar sin cambios (mismos permisos) salvo que la prueba ponga otra respuesta
  const llamadas=[], respuestas={bootstrap:{ok:true,datos:datosIniciales},
   sincronizar:()=>({ok:true,datos:{versiones:{},permisos:datosIniciales.permisos,soloRequisicion:!!datosIniciales.soloRequisicion,cambios:[]}})};
  const local={...(opts.local||{})}, intervalos=[];
  // bootstrapPendiente: la respuesta llega cuando la prueba llama la función que recibe (para ver la página antes)
  if (opts.bootstrapPendiente) respuestas.bootstrap=()=>new Promise(res=>opts.bootstrapPendiente(()=>res({ok:true,datos:datosIniciales})));
  async function fetch(url,opts){const c=JSON.parse(opts.body);llamadas.push(c);
   const r=respuestas[c.funcion];const datos=typeof r==='function'?r(c):r;
   return{ok:true,json:async()=>datos||{ok:false,error:'sin respuesta simulada: '+c.funcion}}}
  const dialogos={confirmar:true,prompt:null,vistos:[]};
  class FileReader{readAsDataURL(f){this.result='data:'+f.type+';base64,'+f.b64;setImmediate(()=>this.onload())}}
  const ctx={document,fetch,console,JSON,Date,Math,Number,String,Array,Object,Promise,Proxy,Error,Uint8Array,TextDecoder,FileReader,
   atob:s=>Buffer.from(s,'base64').toString('binary'),crypto:{randomUUID:()=>'id-'+Math.random()},
   sessionStorage:{getItem:k=>almacen[k]??null,setItem:(k,v)=>almacen[k]=v,removeItem:k=>delete almacen[k]},
   confirm:m=>{dialogos.vistos.push(m);return dialogos.confirmar},prompt:m=>{dialogos.vistos.push(m);return dialogos.prompt},
   localStorage:{getItem:k=>local[k]??null,setItem:(k,v)=>local[k]=String(v),removeItem:k=>delete local[k]},
   CustomEvent:class{constructor(type,o){this.type=type;this.detail=o&&o.detail}},
   setTimeout,clearTimeout,setInterval:(f,ms)=>intervalos.push(f),scrollTo(){}};
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(apiWeb,ctx); vm.runInContext(app,ctx);
  return {ctx,$:id=>document.getElementById(id),llamadas,respuestas,dialogos,local,intervalos,document,run:c=>vm.runInContext(c,ctx)};
}
const esperar=async(n=10)=>{for(let i=0;i<n;i++) await new Promise(r=>setImmediate(r))};

(async()=>{
  // ===== Vendedora (sin rol de cobranza) =====
  const A=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[PRY],marcas:{},permisos:{cobranza:false,desbloqueo:false}});
  const {$,llamadas,respuestas}=A;
  await esperar(5);
  assert.equal(A.run('PROYECTOS.length'),1,'carga los proyectos activos');
  assert($('tabCob').classList.contains('oculto'),'sin permiso no ve la pestaña Cobranza');
  assert($('tabCom').classList.contains('oculto'),'sin permiso no ve la pestaña Compras');

  // Elegir el proyecto
  $('cNombre').value='Luis';
  $('proyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; $('proyecto').disparar('change');
  assert(/^Proyecto activo/.test($('proyInfo').textContent));

  // El servidor lo rechaza (se canceló mientras tanto): codigo PROYECTO
  respuestas.guardarCotizacion={ok:false,codigo:'PROYECTO',error:'El proyecto PRY-2026-0001 está cancelado: ya no se le pueden agregar cotizaciones.'};
  respuestas.listarProyectos={ok:true,datos:[]};
  A.run('guardar()');
  await esperar();
  const g=llamadas.find(c=>c.funcion==='guardarCotizacion');
  assert.equal(g.args[0].proyectoFolio,'PRY-2026-0001'); assert.equal(g.token,token); assert.equal(g.args[0].moneda,'MXN');
  assert.equal($('proyecto').value,'','se limpia el campo Proyecto');
  assert(/^Sin proyecto/.test($('proyInfo').textContent),'la etiqueta ya no dice "Proyecto activo": '+$('proyInfo').textContent);
  assert(llamadas.some(c=>c.funcion==='listarProyectos'),'se refresca la lista de proyectos');
  assert.equal(A.run('PROYECTOS.length'),0); assert.equal($('proyectosList').innerHTML,'');
  assert.equal($('aviso').className,'aviso error');
  assert(/está cancelado/.test($('aviso').innerHTML)&&/Se quitó el proyecto/.test($('aviso').innerHTML));
  assert.equal($('btnGuardar').disabled,false,'se puede volver a guardar');

  // Contrato firmado: mismo trato (codigo PROYECTO)
  A.run("recibirProyectos(["+JSON.stringify(PRY)+"])");
  $('proyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; $('proyecto').disparar('change');
  respuestas.guardarCotizacion={ok:false,codigo:'PROYECTO',error:'Proyecto con contrato firmado: no admite cotizaciones nuevas.'};
  A.run('guardar()'); await esperar();
  assert.equal($('proyecto').value,''); assert(/contrato firmado: no admite/.test($('aviso').innerHTML));

  // Otro error (no de proyecto): el campo se queda como estaba
  respuestas.listarProyectos={ok:true,datos:[PRY]}; A.run("recibirProyectos(["+JSON.stringify(PRY)+"])");
  $('proyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; $('proyecto').disparar('change');
  respuestas.guardarCotizacion={ok:false,error:'El sistema está ocupado guardando otra cotización.'};
  const antes=llamadas.filter(c=>c.funcion==='listarProyectos').length;
  A.run('guardar()'); await esperar();
  assert.equal($('proyecto').value,'PRY-2026-0001 — Luis — Solar MX — Techo');
  assert(/^Proyecto activo/.test($('proyInfo').textContent));
  assert.equal(llamadas.filter(c=>c.funcion==='listarProyectos').length,antes);
  assert(/ocupado/.test($('aviso').innerHTML)&&!/Se quitó/.test($('aviso').innerHTML));

  // Moneda: en MXN el catálogo pone el precio en pesos; en USD, su precio convertido con el tipo de cambio del día
  const fila=$('filas').hijos[0];
  fila.querySelector('.desc').value='Panel solar 550 W'; fila.querySelector('.desc').disparar('change');
  assert.equal(fila.querySelector('.pu').value,4100);
  assert(/PAN-550 · \$4,100\.00 MXN/.test($('catalogo').innerHTML),'lista en pesos');
  $('moneda').value='USD'; A.run('cambiarMoneda()');
  assert.equal(fila.querySelector('.pu').value,222.22,'el renglón del catálogo se convierte a USD al cambiar de moneda');
  assert(/18\.4500 pesos por dólar \(Google Finance\)/.test($('notaMoneda').innerHTML)&&!/Revisa/.test($('notaMoneda').innerHTML));
  assert(/PAN-550 · \$222\.22 USD/.test($('catalogo').innerHTML)&&/precio en USD a mano/.test($('catalogo').innerHTML),'lista en dólares');
  assert.equal($('lblTot').textContent,'TOTAL USD');
  $('moneda').value='MXN'; A.run('cambiarMoneda()'); assert.equal(fila.querySelector('.pu').value,4100,'de regreso a pesos');
  $('moneda').value='USD'; A.run('cambiarMoneda()'); assert.equal(fila.querySelector('.pu').value,222.22);
  fila.querySelector('.desc').disparar('change');
  assert.equal(fila.querySelector('.pu').value,222.22,'elegir en USD pone el precio en dólares'); assert.equal(fila.querySelector('.clave').value,'PAN-550');
  // Producto sin precio USD (sin tipo de cambio): se captura a mano
  A.run('agregarFila()'); const fila2=$('filas').hijos[1];
  fila2.querySelector('.clave').value='SRV-1'; fila2.querySelector('.clave').disparar('change');
  assert.equal(fila2.querySelector('.pu').value,''); assert.equal(fila2.querySelector('.pu').placeholder,'USD');
  // Precio ajustado a mano: no se convierte al cambiar de moneda y se avisa
  fila.querySelector('.pu').value='180';
  $('moneda').value='MXN'; A.run('cambiarMoneda()');
  assert.equal(fila.querySelector('.pu').value,'180'); assert(/Revisa los precios que capturaste a mano/.test($('notaMoneda').innerHTML));
  $('moneda').value='USD'; A.run('cambiarMoneda()');
  fila.querySelector('.cant').value='1'; fila.querySelector('.pu').value='180'; A.run('recalcular()');
  assert.equal($('tTot').textContent,'$208.80 USD');
  respuestas.guardarCotizacion={ok:true,datos:{folio:'HLG-2026-0009',url:'u',total:208.8,moneda:'USD',proyectoFolio:''}};
  respuestas.getClientes={ok:true,datos:[]};
  $('proyecto').value=''; A.run('guardar()'); await esperar();
  const gU=llamadas.filter(c=>c.funcion==='guardarCotizacion').pop().args[0];
  assert.deepEqual([gU.moneda,gU.tipoCambio],['USD',18.45],'manda el tipo de cambio con que convirtió');
  assert.equal(g.args[0].tipoCambio,'','en MXN no manda tipo de cambio');
  assert(/\$208\.80 USD/.test($('aviso').innerHTML)); assert.equal($('moneda').value,'MXN','al limpiar vuelve a MXN');

  // ===== Cobranza (con permiso) =====
  const B=montar({ivaTasa:0.16,catalogo:[],clientes:[],proyectos:[],marcas:{},permisos:{cobranza:true,desbloqueo:false}});
  await esperar(5);
  assert(!B.$('tabCob').classList.contains('oculto'),'con permiso ve la pestaña');
  assert(B.$('tabCom').classList.contains('oculto'),'cobranza sin compras no ve Compras');
  B.respuestas.listarProyectosCobranza={ok:true,datos:[{...PRY,contrato:''}]};
  // Resumen de todos los proyectos: aparece al entrar a la pestaña
  const RES={hoy:'2026-10-21',totales:[{moneda:'MXN',proyectos:2,conSaldo:1,contratado:11600,cobrado:5000,porCobrar:6600,avance:43.1,
      contratadoSinIva:10000,costoOc:4850,margen:5150,margenPorcentaje:51.5,porFirmar:1,montoPorFirmar:116},
    {moneda:'USD',proyectos:1,conSaldo:0,contratado:1000,cobrado:1000,porCobrar:0,avance:100,contratadoSinIva:862.07,costoOc:1200,margen:-337.93,margenPorcentaje:-39.2,porFirmar:0,montoPorFirmar:0}],
    proyectos:[{folio:'PRY-2026-0003',nombre:'Techo',cliente:'=Luis, "SA"',estadoProyecto:'Activo',marca:'helgen',moneda:'MXN',estadoContrato:'Firmado',
      contratado:11600,subtotal:10000,pagado:5000,saldo:6600,avance:43.1,siguienteEtapa:'Instalación',siguienteSaldo:3480,ultimoPago:'2026-10-20',ordenes:2,costoOc:4850,margen:5150,margenPorcentaje:51.5,margenError:''},
      {folio:'PRY-2026-0004',nombre:'Texas',cliente:'Solar Corp',estadoProyecto:'Cerrado',marca:'energy',moneda:'USD',estadoContrato:'Firmado',
      contratado:1000,subtotal:862.07,pagado:1000,saldo:0,avance:100,siguienteEtapa:'',siguienteSaldo:0,ultimoPago:'2026-10-19',ordenes:1,costoOc:1200,margen:-337.93,margenPorcentaje:-39.2,margenError:''},
      {folio:'PRY-2026-0005',nombre:'Nuevo',cliente:'Ana',estadoProyecto:'Activo',marca:'helgen',moneda:'MXN',estadoContrato:'Por firmar',
      contratado:116,subtotal:100,pagado:0,saldo:116,avance:0,siguienteEtapa:'Anticipo',siguienteSaldo:69.6,ultimoPago:'',ordenes:0,costoOc:null,margen:null,margenPorcentaje:null,margenError:'hay costos en USD'}]};
  B.respuestas.resumenCobranzaGeneral={ok:true,datos:RES};
  B.run("verTab('cob')"); await esperar();
  assert(!B.$('cobVistaResumen').classList.contains('oculto')&&B.$('cobVistaProyecto').classList.contains('oculto'),'al entrar se ve el resumen');
  const tt=B.$('resTotales').innerHTML;
  assert(/MXN · 2 contratos firmados · 1 por firmar \(\$116\.00 MXN, no suman\)/.test(tt)&&/Por cobrar<\/span><b>\$6,600\.00 MXN/.test(tt)&&/1 de 2/.test(tt),tt);
  assert(/Margen \(sin IVA\)<\/span><b>\$5,150\.00 MXN · 51\.5%/.test(tt)&&/class="negativo">-\$337\.93 USD · -39\.2%/.test(tt),'margen por moneda');
  let rl=B.$('resLista').innerHTML;
  assert.deepEqual((rl.match(/data-folio="([^"]+)"/g)||[]).length,3);
  assert(/chip aceptada" style="white-space:nowrap">Por firmar/.test(rl)&&/Instalación · \$3,480\.00 MXN/.test(rl)&&/Último pago 20\/10\/2026/.test(rl)&&/>Pagado</.test(rl)&&/Sin pagos/.test(rl)&&/· Cerrado/.test(rl)&&/· Helgen Energy/.test(rl),rl);
  assert(/aviso-moneda" title="hay costos en USD">Revisar/.test(rl)&&/aviso-moneda">-\$337\.93 USD/.test(rl));
  // Filtros (solo la tabla)
  B.$('resMoneda').value='USD'; B.run('pintarResumenCob()'); assert.deepEqual(B.$('resLista').innerHTML.match(/data-folio="([^"]+)"/g),['data-folio="PRY-2026-0004"']);
  B.$('resMoneda').value=''; B.$('resSaldo').checked=true; B.run('pintarResumenCob()');
  assert.deepEqual(B.$('resLista').innerHTML.match(/data-folio="([^"]+)"/g),['data-folio="PRY-2026-0003"'],'solo con saldo: firmados con saldo');
  B.$('resSaldo').checked=false; B.$('resBuscar').value='ana'; B.run('pintarResumenCob()');
  assert.deepEqual(B.$('resLista').innerHTML.match(/data-folio="([^"]+)"/g),['data-folio="PRY-2026-0005"']);
  B.$('resBuscar').value='zzz'; B.run('pintarResumenCob()'); assert(/Ningún proyecto coincide/.test(B.$('resLista').innerHTML));
  B.$('resBuscar').value='';
  // CSV: encabezados, números con punto, texto entrecomillado, fórmulas neutralizadas
  const csv=B.run('csvResumenCob(RESUMEN.proyectos)').split('\r\n');
  assert.equal(csv[0].charCodeAt(0),0xFEFF,'BOM para Excel'); assert(csv[0].includes('"Contratado con IVA","Cobrado","Saldo"'));
  assert.equal(csv[1],'"PRY-2026-0003","Techo","\'=Luis, ""SA""","Helgen","Firmado","MXN",11600.00,5000.00,6600.00,43.1,"Instalación",3480.00,"2026-10-20",2,4850.00,5150.00,51.5');
  assert(csv[3].endsWith(',0,,,'),'sin margen: celdas vacías'); assert.equal(csv.length,4);
  // Desde el resumen se abre cualquier proyecto, también uno sin cotización aceptada (no está en la tabla)
  const nAntes=B.llamadas.filter(c=>c.funcion==='getCobranzaProyecto').length;
  B.$('resProyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; B.$('resProyecto').disparar('change'); await esperar();
  const abiertos=B.llamadas.filter(c=>c.funcion==='getCobranzaProyecto');
  assert.equal(abiertos.length,nAntes+1); assert.equal(abiertos.pop().args[0],'PRY-2026-0001');
  assert(!B.$('cobVistaProyecto').classList.contains('oculto')&&B.$('resProyecto').value==='','abre el proyecto y limpia el buscador');
  B.run('verResumenCob()'); await esperar();
  // Clic en un renglón abre el proyecto; "← Resumen" regresa
  B.respuestas.getCobranzaProyecto={ok:true,datos:{proyecto:PRY,cotizaciones:[],contrato:null,esquema:[],resumen:null,pagos:[],puedeAceptar:true,puedeFirmar:false,metodos:[],hoy:'2026-10-20'}};
  B.run("abrirProyectoCob('PRY-2026-0001')"); await esperar();
  assert(B.$('cobVistaResumen').classList.contains('oculto')&&!B.$('cobVistaProyecto').classList.contains('oculto'),'se abre el proyecto');
  const nRes=B.llamadas.filter(c=>c.funcion==='resumenCobranzaGeneral').length;
  B.run('verResumenCob()'); await esperar();
  assert(!B.$('cobVistaResumen').classList.contains('oculto')&&B.$('cobVistaProyecto').classList.contains('oculto'));
  assert.equal(B.llamadas.filter(c=>c.funcion==='resumenCobranzaGeneral').length,nRes,'al regresar no se vuelve a pedir: lo mantiene al día la sincronización');
  // Sincronización: manda el contexto (resumen y proyecto abiertos) y pinta lo que cambió sin recargar
  B.respuestas.sincronizar={ok:true,datos:{versiones:{pagosCobranza:7},permisos:{cobranza:true,desbloqueo:false},cambios:['pagosCobranza'],
    resumen:{...RES,proyectos:RES.proyectos.slice(0,1)}}};
  B.run('sincronizarAhora()'); await esperar();
  const sy=B.llamadas.filter(c=>c.funcion==='sincronizar').pop();
  assert.equal(sy.args[1].cobResumen,true); assert.equal(sy.args[1].cobProyecto,'PRY-2026-0001');
  assert.deepEqual(B.$('resLista').innerHTML.match(/data-folio="([^"]+)"/g),['data-folio="PRY-2026-0003"'],'el resumen se actualizó solo');
  assert.equal(B.run('VERS.pagosCobranza'),7,'guarda las versiones nuevas');
  B.respuestas.sincronizar=()=>({ok:true,datos:{versiones:{pagosCobranza:7},permisos:{cobranza:true,desbloqueo:false},cambios:[]}});
  B.run("RESUMEN=null"); B.run('verResumenCob()'); await esperar();
  assert.equal(B.llamadas.filter(c=>c.funcion==='resumenCobranzaGeneral').length,nRes+1,'sin resumen cargado sí se pide');
  assert(/PRY-2026-0001 — Luis — Solar MX — Techo/.test(B.$('cobProyectosList').innerHTML)&&/Sin aceptada/.test(B.$('cobProyectosList').innerHTML));
  const cots=[{folio:'HLG-2026-0010',fecha:'20/10/2026',marca:'helgen',moneda:'MXN',subtotal:1000,total:1160,pdf:'p'},
              {folio:'HLG-2026-0011',fecha:'20/10/2026',marca:'energy',moneda:'MXN',subtotal:2000,total:2320,pdf:'p'}];
  // Como vistaCobranza_: se acepta mientras no esté firmado; se firma con aceptada (proyecto no cancelado)
  const vista=(extra={})=>{const v={proyecto:PRY,cotizaciones:cots,contrato:null,esquema:[],resumen:null,pagos:[],esquemaEditable:false,
    puedePagar:false,puedeDesbloquear:false,metodos:['Transferencia','Efectivo','Cheque'],hoy:'2026-10-20',...extra};
    if(!('puedeAceptar' in extra)) v.puedeAceptar=!(v.contrato&&v.contrato.estado==='Firmado');
    if(!('puedeFirmar' in extra)) v.puedeFirmar=!!v.contrato&&v.contrato.estado==='Aceptada';
    return v};
  B.respuestas.getCobranzaProyecto={ok:true,datos:vista()};
  B.$('cobProyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; B.$('cobProyecto').disparar('change'); await esperar();
  assert.equal(B.llamadas.find(c=>c.funcion==='getCobranzaProyecto').args[0],'PRY-2026-0001');
  assert((B.$('cobCots').innerHTML.match(/Marcar aceptada/g)||[]).length===2);
  assert(B.$('cobModEsquema').classList.contains('oculto')&&B.$('cobModPagos').classList.contains('oculto'),'sin aceptada no hay esquema ni pagos');
  assert(B.$('cobMargen').classList.contains('oculto'),'sin contrato no hay margen');

  // Aceptar la de Energy: el servidor pide confirmar; si se cancela no se repite
  B.respuestas.marcarAceptada=c=>c.args[2]?{ok:true,datos:vista({contrato:{cotizacion:'HLG-2026-0011',marca:'energy',moneda:'MXN',subtotal:2000,iva:320,total:2320,estado:'Aceptada'},
    esquema:[{etapa:'Anticipo',porcentaje:60},{etapa:'Instalación',porcentaje:30},{etapa:'Encendido del sistema',porcentaje:10}]})}
    :{ok:true,datos:{confirmar:true,mensaje:'Reemplazará el esquema actual. ¿Continuar?'}};
  B.dialogos.confirmar=false; B.run("aceptarCot('HLG-2026-0011')"); await esperar();
  assert.equal(B.llamadas.filter(c=>c.funcion==='marcarAceptada').length,1); assert(/Reemplazará/.test(B.dialogos.vistos.pop()));
  B.dialogos.confirmar=true; B.run("aceptarCot('HLG-2026-0011')"); await esperar();
  const ma=B.llamadas.filter(c=>c.funcion==='marcarAceptada');
  assert.equal(ma.length,3); assert.deepEqual(ma[2].args,['PRY-2026-0001','HLG-2026-0011',true]);
  assert(/Solo el administrador lo puede cambiar/.test(B.$('cobEsqNota').textContent)&&!/input/.test(B.$('cobEsquema').innerHTML),'Energy no editable para Tania');
  assert(/\$1,392\.00 MXN/.test(B.$('cobEsquema').innerHTML),'monto 60% de 2320');
  assert(/Contrato firmado/.test(B.$('cobContrato').innerHTML)&&B.$('cobFormPago').classList.contains('oculto'));

  // Firmado: formulario de pago; sin comprobante no se envía
  const res={moneda:'MXN',contratado:2320,subtotal:2000,pagado:0,saldo:2320,avance:0,
    etapas:[{etapa:'Anticipo',porcentaje:60,monto:1392,pagado:0,saldo:1392,avance:0},{etapa:'Instalación',porcentaje:30,monto:696,pagado:0,saldo:696,avance:0},
      {etapa:'Encendido del sistema',porcentaje:10,monto:232,pagado:0,saldo:232,avance:0}]};
  const firmada=vista({contrato:{cotizacion:'HLG-2026-0011',marca:'energy',moneda:'MXN',subtotal:2000,iva:320,total:2320,estado:'Firmado',fechaFirma:'2026-10-20',firmadoPor:'tania@helgen.tech'},
    esquema:res.etapas,resumen:res,puedePagar:true});
  B.run('pintarCobranza('+JSON.stringify(firmada)+')');
  assert(!B.$('cobFormPago').classList.contains('oculto')); assert(!/Desbloquear/.test(B.$('cobContrato').innerHTML),'Tania no ve desbloquear');
  // Margen (lo manda el servidor solo a cobranza): contratado sin IVA − órdenes de compra vigentes
  B.run('pintarCobranza('+JSON.stringify({...firmada,margen:{moneda:'MXN',contratado:2000,costos:[{concepto:'Órdenes de compra',moneda:'MXN',monto:2500,cantidad:2}],
    totalCostos:2500,margen:-500,porcentaje:-25}})+')');
  const mg=B.$('cobMargen').innerHTML;
  assert(!B.$('cobMargen').classList.contains('oculto')&&/Margen del proyecto \(sin IVA\)/.test(mg)&&/Contratado sin IVA<\/span><b>\$2,000\.00 MXN/.test(mg));
  assert(/Órdenes de compra \(2\)<\/span><b>− \$2,500\.00 MXN/.test(mg)&&/class="negativo">-\$500\.00 MXN/.test(mg)&&/class="negativo">-25%/.test(mg),mg);
  B.run('pintarCobranza('+JSON.stringify({...firmada,margen:{error:'No se pudo calcular el margen: hay costos en USD'}})+')');
  assert(/No se pudo calcular el margen/.test(B.$('cobMargen').innerHTML));
  B.run('pintarCobranza('+JSON.stringify(firmada)+')');
  assert(!/Marcar aceptada/.test(B.$('cobCots').innerHTML),'firmado: ya no se cambia la aceptada');
  assert(/Transferencia/.test(B.$('pgMetodo').innerHTML)&&/saldo \$1,392\.00 MXN/.test(B.$('pgEtapa').innerHTML));
  B.$('pgMonto').value='800'; B.$('pgRef').value='SPEI 1'; B.$('pgMetodo').value='Transferencia';
  B.$('pgArchivo').files=[]; B.run('registrarPago()'); await esperar();
  assert(/Adjunta el comprobante/.test(B.$('aviso').innerHTML)); assert(!B.llamadas.some(c=>c.funcion==='registrarPago'));
  B.$('pgArchivo').files=[{name:'x.pdf',type:'application/pdf',size:11*1024*1024,b64:'JVBERi0='}]; B.run('registrarPago()'); await esperar();
  assert(/más de 10 MB/.test(B.$('aviso').innerHTML));
  // Moneda distinta: aparece el tipo de cambio
  B.$('pgMoneda').value='USD'; B.run('pintarTipoCambio()'); assert(!B.$('pgTcCaja').classList.contains('oculto'));
  B.$('pgMoneda').value='MXN'; B.run('pintarTipoCambio()'); assert(B.$('pgTcCaja').classList.contains('oculto'));
  B.respuestas.registrarPago={ok:true,datos:{folio:'PAG-2026-0001',url:'https://drive/c',vista:firmada}};
  B.$('pgArchivo').files=[{name:'comprobante.pdf',type:'application/pdf',size:1200,b64:'JVBERi0='}];
  const idAntes=B.run('ID_PAGO'); B.run('registrarPago()'); await esperar();
  const rp=B.llamadas.find(c=>c.funcion==='registrarPago').args[0];
  assert.deepEqual([rp.proyectoFolio,rp.monto,rp.monedaPago,rp.metodo,rp.referencia,rp.etapaOrden,rp.comprobante.datos,rp.idSolicitud],
    ['PRY-2026-0001','800','MXN','Transferencia','SPEI 1',1,'JVBERi0=',idAntes]);
  assert(/PAG-2026-0001/.test(B.$('aviso').innerHTML)&&B.run('ID_PAGO')!==idAntes,'id nuevo para el siguiente pago');
  // Cancelar pago: pide motivo; sin motivo no llama
  B.dialogos.prompt=''; B.run("cancelarPagoCob('PAG-2026-0001')"); await esperar();
  assert(!B.llamadas.some(c=>c.funcion==='cancelarPago'));
  // Permiso revocado mientras tanto: el servidor responde PERMISO y se muestra el error
  B.respuestas.cancelarPago={ok:false,codigo:'PERMISO',error:'No tienes permiso de cobranza.'};
  B.dialogos.prompt='Se capturó dos veces'; B.run("cancelarPagoCob('PAG-2026-0001')"); await esperar();
  assert.deepEqual(B.llamadas.find(c=>c.funcion==='cancelarPago').args,['PAG-2026-0001','Se capturó dos veces']);
  assert(/No tienes permiso de cobranza/.test(B.$('aviso').innerHTML));
  // Proyecto cancelado: sin "Marcar aceptada" ni "Contrato firmado", con aviso
  const cancel=vista({proyecto:{...PRY,estado:'Cancelado'},puedeAceptar:false,puedeFirmar:false,
    contrato:{cotizacion:'HLG-2026-0010',marca:'helgen',moneda:'MXN',subtotal:1000,iva:160,total:1160,estado:'Aceptada'},
    esquema:[{etapa:'Anticipo',porcentaje:100}]});
  B.run('pintarCobranza('+JSON.stringify(cancel)+')');
  assert(!/Marcar aceptada/.test(B.$('cobCots').innerHTML)&&!/btnFirmar|Contrato firmado/.test(B.$('cobContrato').innerHTML),'cancelado: sin aceptar ni firmar');
  assert(/Proyecto cancelado: no se puede marcar/.test(B.$('cobContrato').innerHTML)&&/chip cancelado">Cancelado/.test(B.$('cobInfo').innerHTML));
  B.run('pintarCobranza('+JSON.stringify(vista({proyecto:{...PRY,estado:'Cancelado'},puedeAceptar:false,puedeFirmar:false}))+')');
  assert(!/Marcar aceptada/.test(B.$('cobCots').innerHTML)&&/Proyecto cancelado/.test(B.$('cobContrato').innerHTML),'cancelado sin aceptada');
  // Administrador en un contrato de Energy sin firmar: edita el esquema con motivo obligatorio
  const energyAdmin=vista({contrato:{cotizacion:'HLG-2026-0011',marca:'energy',moneda:'MXN',subtotal:2000,iva:320,total:2320,estado:'Aceptada'},
    esquema:[{etapa:'Anticipo',porcentaje:60},{etapa:'Instalación',porcentaje:30},{etapa:'Encendido del sistema',porcentaje:10}],
    esquemaEditable:true,esquemaPideMotivo:true});
  B.run('pintarCobranza('+JSON.stringify(energyAdmin)+')');
  assert(/<input/.test(B.$('cobEsquema').innerHTML)&&/cobMotivoEsq/.test(B.$('cobEsqAcciones').innerHTML)&&/motivo queda registrado/.test(B.$('cobEsqNota').textContent));
  B.$('cobMotivoEsq').value=''; B.run('guardarEsquemaCob()'); await esperar();
  assert(/motivo del cambio/.test(B.$('aviso').innerHTML)); assert(!B.llamadas.some(c=>c.funcion==='guardarEsquema'));
  B.respuestas.guardarEsquema={ok:true,datos:energyAdmin};
  B.run("editarEtapa(0,'porcentaje','50'); editarEtapa(1,'porcentaje','40')");
  B.$('cobMotivoEsq').value='Negociado con el cliente'; B.run('guardarEsquemaCob()'); await esperar();
  const ge=B.llamadas.find(c=>c.funcion==='guardarEsquema').args;
  assert.deepEqual([ge[0],ge[1].map(e=>e.porcentaje),ge[2]],['PRY-2026-0001',['50','40',10],'Negociado con el cliente']);
  // Administrador: ve el desbloqueo
  B.run('pintarCobranza('+JSON.stringify({...firmada,puedeDesbloquear:true})+')');
  assert(/Desbloquear contrato/.test(B.$('cobContrato').innerHTML));

  // .oculto gana sobre clases con display propio (.acciones, .tiles…), aunque estén definidas después (pasó en PRUEBAS, 23/10/2026)
  assert(/\.oculto \{ display:none !important; \}/.test(html),'.oculto con !important');
  // ===== Compras (con permiso, sin cobranza): requisiciones → orden → pago → cierre =====
  const C=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[],marcas:{},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:false}});
  await esperar(5);
  assert(!C.$('tabCom').classList.contains('oculto')&&C.$('tabCob').classList.contains('oculto')&&C.$('tabReq').classList.contains('oculto'),'compras ve Compras y no Cobranza ni Requisiciones');
  assert(/PAN-550 · PZA/.test(C.$('ocCatalogo').innerHTML)&&!/4,100|4100|222/.test(C.$('ocCatalogo').innerHTML+C.$('ocClaves').innerHTML),'listas sin precio de venta');
  const RQ={folio:'REQ-2026-0001',fecha:'2026-10-20',proyectoFolio:'PRY-2026-0001',proyectoNombre:'Techo',solicitante:'Juan Obrero',solicitanteEmail:'juan@helgen.tech',
    estado:'Solicitada',ocFolio:'',renglones:2};
  C.respuestas.listarProyectosCompras={ok:true,datos:[{...PRY,moneda:'MXN',marca:'helgen'}]};
  C.respuestas.listarRequisiciones={ok:true,datos:[RQ]};
  C.$('rcEstado').value='Solicitada'; C.run("verTab('com')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='listarRequisiciones').args,['','Solicitada']);
  assert(/REQ-2026-0001/.test(C.$('rcLista').innerHTML)&&/Juan Obrero/.test(C.$('rcLista').innerHTML)&&/abrirReqCom/.test(C.$('rcLista').innerHTML));
  assert(/PRY-2026-0001 — Luis — Solar MX — Techo/.test(C.$('comProyectosList').innerHTML)&&/MXN · Helgen/.test(C.$('comProyectosList').innerHTML));
  const PROV={id:'PDB200101AB1',razonSocial:'Paneles del Bajío',rfc:'PDB200101AB1',contacto:'Luis Pérez',correo:'v@pdb.mx',telefono:'442',etiqueta:'Paneles del Bajío'};
  const vistaReq=(extra={},req={})=>({requisicion:{folio:'REQ-2026-0001',fecha:'2026-10-20',proyectoFolio:'PRY-2026-0001',solicitante:'Juan Obrero',
      solicitanteEmail:'juan@helgen.tech',estado:'Solicitada',motivo:'',cotizacionId:'COT1',cotizacionUrl:'https://drive/cot',ocFolio:'',...req},
    renglones:[{renglon:1,descripcion:'Cable THW 10',cantidad:100,unidad:'M',notas:'rojo'},{renglon:2,descripcion:'Tubo',cantidad:12,unidad:'PZA',notas:''}],
    eventos:[{fecha:'2026-10-20 10:00',estado:'Solicitada',nombre:'Juan Obrero',correo:'juan@helgen.tech',nota:''}],
    proyecto:PRY,moneda:'MXN',marca:'helgen',orden:null,pagos:[],proveedores:[PROV],ivaTasas:[0.16,0.08,0],metodos:['Transferencia','Efectivo','Cheque'],hoy:'2026-10-20',
    puedeAutorizar:true,puedeRevisar:true,puedePagar:false,puedeCancelarPago:false,puedeCerrar:false,...extra});
  C.respuestas.getRequisicion={ok:true,datos:vistaReq()};
  C.run("abrirReqCom('REQ-2026-0001')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='getRequisicion').args,['REQ-2026-0001']);
  assert(C.$('comVistaLista').classList.contains('oculto')&&!C.$('comVistaReq').classList.contains('oculto'));
  assert.equal(C.$('rcCotVisor').src,'https://drive.google.com/file/d/COT1/preview','la cotización a un lado');
  assert(/Cable THW 10/.test(C.$('rcRenglones').innerHTML)&&!C.$('rcRevision').classList.contains('oculto')&&!C.$('comModOc').classList.contains('oculto')&&C.$('comModPago').classList.contains('oculto'));
  // El formulario de la OC viene precargado con los renglones (notas en la descripción) y sin costo
  const filasOc=C.$('ocFilas').hijos;
  assert.deepEqual(filasOc.map(t=>[t.querySelector('.desc').value,t.querySelector('.cant').value,t.querySelector('.uni').value,t.querySelector('.costo').value]),
    [['Cable THW 10 — rojo',100,'M',''],['Tubo',12,'PZA','']]);
  assert.deepEqual([C.$('ocLugar').value,C.$('ocMoneda').value,C.$('ocIva').value,C.$('ocEntrega').min],['Qro','MXN','0.16','2026-10-20'],'por omisión: ubicación, moneda del proyecto, IVA');
  // Proveedor registrado: se autorrellena
  C.$('prvRazon').value='Paneles del Bajío'; C.$('prvRazon').disparar('change');
  assert.deepEqual([C.$('prvRfc').value,C.$('prvContacto').value,C.$('prvCorreo').value],['PDB200101AB1','Luis Pérez','v@pdb.mx']);
  // Renglón del catálogo: clave, descripción y unidad; el costo queda vacío
  C.run('agregarRenglonOc()');
  const ren=filasOc[filasOc.length-1];
  ren.querySelector('.desc').value='Panel solar 550 W'; ren.querySelector('.desc').disparar('change');
  assert.deepEqual([ren.querySelector('.clave').value,ren.querySelector('.uni').value,ren.querySelector('.costo').value],['PAN-550','PZA',''],'sin precio de venta');
  filasOc[0].querySelector('.costo').value='10'; filasOc[1].querySelector('.costo').value='50'; ren.querySelector('.cant').value='2'; ren.querySelector('.costo').value='1000'; C.run('recalcularOc()');
  assert.equal(C.$('ocTot').textContent,'$4,176.00 MXN');
  C.$('ocIva').value='0'; C.run('recalcularOc()');
  assert.deepEqual([C.$('ocTot').textContent,C.$('ocLblIva').textContent],['$3,600.00 MXN','IVA (0%)']);
  // Moneda distinta a la del proyecto: aparece el tipo de cambio
  assert(C.$('ocTcCaja').classList.contains('oculto'));
  C.$('ocMoneda').value='USD'; C.run('pintarTcOc()');
  assert(!C.$('ocTcCaja').classList.contains('oculto')); assert.equal(C.$('ocLblTot').textContent,'TOTAL USD');
  C.$('ocTc').value='18.5'; C.$('ocEntrega').value='2026-10-25'; C.$('ocCondiciones').value='Contado';
  const ORD={folio:'OC-2026-0001',fecha:'2026-10-20',proveedor:'Paneles del Bajío',moneda:'USD',total:3200,tipoCambio:18.5,fechaEntrega:'2026-10-25',
    lugarEntrega:'Qro',condicionesPago:'Contado',estado:'Emitida',pdfUrl:'https://drive/oc',reqFolio:'REQ-2026-0001'};
  const autorizada=vistaReq({orden:ORD,puedeAutorizar:false,puedeRevisar:false,puedePagar:true},{estado:'Autorizada',ocFolio:'OC-2026-0001'});
  C.respuestas.autorizarRequisicion={ok:true,datos:{folio:'REQ-2026-0001',ocFolio:'OC-2026-0001',url:'https://drive/oc',total:3200,moneda:'USD',vista:autorizada}};
  const idOc=C.run('ID_OC'); C.run('guardarOc()'); await esperar();
  const go=C.llamadas.find(c=>c.funcion==='autorizarRequisicion');
  assert.equal(go.args[0],'REQ-2026-0001');
  assert.deepEqual([go.args[1].proveedor.razonSocial,go.args[1].proveedor.rfc,go.args[1].moneda,go.args[1].tipoCambio,go.args[1].ivaTasa,go.args[1].fechaEntrega,
    go.args[1].lugarEntrega,go.args[1].condicionesPago,go.args[1].idSolicitud,'proyectoFolio' in go.args[1]],
    ['Paneles del Bajío','PDB200101AB1','USD','18.5','0','2026-10-25','Qro','Contado',idOc,false],'el proyecto sale de la requisición en el servidor');
  const rr=go.args[1].renglones.find(x=>x.descripcion==='Panel solar 550 W');
  assert.deepEqual([rr.clave,rr.cantidad,rr.costo,'precio' in rr,'_tr' in rr],['PAN-550',2,'1000',false,false]);
  assert(/REQ-2026-0001/.test(C.$('aviso').innerHTML)&&/OC-2026-0001/.test(C.$('aviso').innerHTML));
  assert(C.$('comModOc').classList.contains('oculto')&&!C.$('comModPago').classList.contains('oculto')&&!C.$('rcFormPago').classList.contains('oculto'));
  assert(/OC-2026-0001/.test(C.$('rcOrden').innerHTML)&&/\$3,200\.00 USD/.test(C.$('rcOrden').innerHTML)&&/cancelarOcDesdeReq/.test(C.$('rcOrden').innerHTML));
  assert.deepEqual([C.$('ppMonto').value,C.$('ppMoneda').value,C.$('ppFecha').max],[3200,'USD','2026-10-20'],'el pago se precarga con el total de la orden');
  // Pago: comprobante obligatorio; en otra moneda pide tipo de cambio
  C.run('registrarPagoProv()'); await esperar();
  assert(!C.llamadas.some(c=>c.funcion==='registrarPagoProveedor')&&/Adjunta el comprobante/.test(C.$('aviso').innerHTML));
  C.$('ppMoneda').value='MXN'; C.run('pintarTcPago()'); assert(!C.$('ppTcCaja').classList.contains('oculto'));
  C.$('ppMonto').value='59200'; C.$('ppTc').value='18.5'; C.$('ppRef').value='SPEI 1';
  C.$('ppArchivo').files=[{name:'spei.pdf',type:'application/pdf',size:2000,b64:'JVBERi0='}];
  const pagada=vistaReq({orden:{...ORD,estado:'Pagada'},pagos:[{folio:'PGP-2026-0001',fecha:'2026-10-20',monto:59200,monedaPago:'MXN',tipoCambio:18.5,montoAplicado:3200,monedaOc:'USD',
    metodo:'Transferencia',referencia:'SPEI 1',estado:'Vigente',comprobanteUrl:'https://drive/pgp'}],puedeAutorizar:false,puedeRevisar:false,puedeCancelarPago:true,puedeCerrar:true},{estado:'Pagada',ocFolio:'OC-2026-0001'});
  C.respuestas.registrarPagoProveedor={ok:true,datos:{folio:'PGP-2026-0001',url:'https://drive/pgp',vista:pagada}};
  const idPgp=C.run('ID_PGP'); C.run('registrarPagoProv()'); await esperar(20);
  const rpp=C.llamadas.find(c=>c.funcion==='registrarPagoProveedor').args[0];
  assert.deepEqual([rpp.reqFolio,rpp.monto,rpp.monedaPago,rpp.tipoCambio,rpp.metodo,rpp.referencia,rpp.comprobante.datos,rpp.idSolicitud],
    ['REQ-2026-0001','59200','MXN','18.5','Transferencia','SPEI 1','JVBERi0=',idPgp]);
  assert(/PGP-2026-0001/.test(C.$('rcPagos').innerHTML)&&/cancelarPagoProv/.test(C.$('rcPagos').innerHTML)&&C.$('rcFormPago').classList.contains('oculto')&&!C.$('rcCierre').classList.contains('oculto'));
  assert(!/cancelarOcDesdeReq/.test(C.$('rcOrden').innerHTML),'una orden pagada ya no se cancela');
  // Cancelar el pago: motivo obligatorio
  C.dialogos.prompt='  '; C.run("cancelarPagoProv('PGP-2026-0001')"); await esperar();
  assert(!C.llamadas.some(c=>c.funcion==='cancelarPagoProveedor'));
  C.respuestas.cancelarPagoProveedor={ok:true,datos:autorizada};
  C.dialogos.prompt='Tipo de cambio equivocado'; C.run("cancelarPagoProv('PGP-2026-0001')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='cancelarPagoProveedor').args,['PGP-2026-0001','Tipo de cambio equivocado']);
  // Cerrar en lugar del solicitante: motivo obligatorio
  C.run('pintarReqCom('+JSON.stringify(pagada)+')');
  C.$('rcMotivoCierre').value=''; C.run('cerrarReqCom()'); await esperar();
  assert(!C.llamadas.some(c=>c.funcion==='cerrarRequisicionCompras')&&/Escribe por qué cierras/.test(C.$('aviso').innerHTML));
  C.respuestas.cerrarRequisicionCompras={ok:true,datos:vistaReq({orden:{...ORD,estado:'Recibida',fechaRecepcion:'2026-10-20',recibio:'pedro@helgen.tech'},puedeAutorizar:false,puedeRevisar:false},{estado:'Cerrada'})};
  C.$('rcMotivoCierre').value='Ya no está en la obra'; C.$('rcNotasCierre').value='Completo'; C.run('cerrarReqCom()'); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='cerrarRequisicionCompras').args,['REQ-2026-0001','Ya no está en la obra','Completo']);
  assert(C.$('rcCierre').classList.contains('oculto')&&/Recibida el 20\/10\/2026/.test(C.$('rcOrden').innerHTML));
  // Devolver: motivo obligatorio; permiso revocado → error del servidor
  C.run('pintarReqCom('+JSON.stringify(vistaReq())+')');
  C.dialogos.prompt=null; C.run("revisarReqCom('devolverRequisicion')"); await esperar();
  assert(!C.llamadas.some(c=>c.funcion==='devolverRequisicion'));
  C.respuestas.devolverRequisicion={ok:false,codigo:'PERMISO',error:'No tienes permiso de compras.'};
  C.dialogos.prompt='Falta el calibre'; C.run("revisarReqCom('devolverRequisicion')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='devolverRequisicion').args,['REQ-2026-0001','Falta el calibre']);
  assert(/No tienes permiso de compras/.test(C.$('aviso').innerHTML));
  // Órdenes por proyecto: con su requisición; sin "Recibida" (se recibe al cerrar la requisición); cancelar solo emitidas
  C.respuestas.getComprasProyecto={ok:true,datos:{proyecto:PRY,moneda:'MXN',marca:'helgen',ordenes:[ORD,{...ORD,folio:'OC-2026-0002',estado:'Pagada'}],hoy:'2026-10-20'}};
  C.$('comProyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; C.$('comProyecto').disparar('change'); await esperar();
  const li=C.$('ocLista').innerHTML;
  assert(/OC-2026-0001/.test(li)&&/REQ-2026-0001/.test(li)&&/\$3,200\.00 USD/.test(li)&&/TC 18\.5/.test(li)&&/25\/10\/2026/.test(li)&&/chip firmado">Pagada/.test(li));
  assert(!/recibirOc|marcarOcRecibida/.test(li)&&(li.match(/cancelarOc\(/g)||[]).length===1,'sin botón Recibida; solo la emitida se cancela');
  assert(!/guardarOrdenCompra|marcarOcRecibida|function recibirOc/.test(html),'ya no hay emisión directa ni "Recibida" desde compras');
  C.dialogos.prompt='Sin existencias'; C.respuestas.cancelarOrdenCompra={ok:true,datos:{proyecto:PRY,moneda:'MXN',marca:'helgen',ordenes:[{...ORD,estado:'Cancelada'}],hoy:'2026-10-20'}};
  C.run("cancelarOc('OC-2026-0001')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='cancelarOrdenCompra').args,['OC-2026-0001','Sin existencias']);
  assert(/fila-cancelada/.test(C.$('ocLista').innerHTML));

  // ===== Requisiciones: quien pide materiales (ROL_REQUISICION, sin otros roles) =====
  const RQS=[{folio:'REQ-2026-0002',fecha:'2026-10-20',proyectoFolio:'PRY-2026-0001',proyectoNombre:'Techo',estado:'Devuelta',motivo:'Falta el calibre',notasRecepcion:'',
      renglones:[{renglon:1,descripcion:'Tubo',cantidad:12,unidad:'PZA',notas:''}],eventos:[{fecha:'2026-10-20 10:00',estado:'Solicitada',nombre:'Juan',nota:''},
      {fecha:'2026-10-20 11:00',estado:'Devuelta',nombre:'Pedro Ruiz',nota:'Falta el calibre'}],puedeEditar:true,puedeCancelar:true,puedeCerrar:false},
    {folio:'REQ-2026-0001',fecha:'2026-10-19',proyectoFolio:'PRY-2026-0001',proyectoNombre:'Techo',estado:'Pagada',motivo:'',notasRecepcion:'',
      renglones:[{renglon:1,descripcion:'Cable',cantidad:100,unidad:'M',notas:'rojo'}],eventos:[{fecha:'2026-10-20 12:00',estado:'Pagada',nombre:'Pedro Ruiz',nota:''}],
      puedeEditar:false,puedeCancelar:false,puedeCerrar:true}];
  const R=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[],marcas:{},permisos:{cobranza:false,desbloqueo:false,compras:false,requisicion:true}});
  R.respuestas.listarProyectosRequisicion={ok:true,datos:[{folio:'PRY-2026-0001',nombre:'Techo'}]};
  R.respuestas.misRequisiciones={ok:true,datos:RQS};
  await esperar(5);
  assert(!R.$('tabReq').classList.contains('oculto')&&R.$('tabCom').classList.contains('oculto')&&!R.$('tabNueva').classList.contains('oculto'),'con ROL_REQUISICION usa el cotizador y ve Requisiciones');
  assert(/Panel solar 550 W/.test(R.$('reqCatalogo').innerHTML)&&!/4,100|4100|222/.test(R.$('reqCatalogo').innerHTML),'sugerencias sin precio');
  R.run("verTab('req')"); await esperar();
  assert.equal(R.$('reqProyectosList').innerHTML,'<option value="PRY-2026-0001 — Techo">','solo folio y nombre');
  const lista=R.$('reqLista').innerHTML;
  assert(/REQ-2026-0002/.test(lista)&&/Motivo:<\/b> Falta el calibre/.test(lista)&&/editarReq\('REQ-2026-0002'\)/.test(lista)&&/cancelarReq\('REQ-2026-0002'\)/.test(lista));
  assert(/recibiMaterial\('REQ-2026-0001'\)/.test(lista)&&!/recibiMaterial\('REQ-2026-0002'\)/.test(lista)&&/Pedro Ruiz/.test(lista),'"Recibí el material" solo en la pagada; historial con quién');
  // Nueva: proyecto, renglones y cotización obligatorios
  const filasR=R.$('reqFilas').hijos;
  assert.equal(filasR.length,1,'un renglón vacío al entrar');
  filasR[0].querySelector('.desc').value='Panel solar 550 W'; filasR[0].querySelector('.desc').disparar('change');
  assert.equal(filasR[0].querySelector('.uni').value,'PZA','del catálogo solo la unidad');
  filasR[0].querySelector('.cant').value='10'; filasR[0].querySelector('.notas').value='Monocristalino';
  R.run('enviarRequisicion()'); await esperar();
  assert(/Elige un proyecto/.test(R.$('aviso').innerHTML));
  R.$('reqProyecto').value='PRY-2026-0001 — Techo';
  R.run('enviarRequisicion()'); await esperar();
  assert(/Adjunta la cotización/.test(R.$('aviso').innerHTML)&&!R.llamadas.some(c=>c.funcion==='guardarRequisicion'));
  R.$('reqArchivo').files=[{name:'cot.jpg',type:'image/jpeg',size:11*1024*1024,b64:'/9j/'}];
  R.run('enviarRequisicion()'); await esperar();
  assert(/pesa más de 10 MB/.test(R.$('aviso').innerHTML)&&!R.llamadas.some(c=>c.funcion==='guardarRequisicion'));
  R.$('reqArchivo').files=[{name:'cot.jpg',type:'image/jpeg',size:2000,b64:'/9j/'}];
  R.respuestas.guardarRequisicion=c=>({ok:true,datos:{folio:c.args[0].folio||'REQ-2026-0003',requisiciones:RQS}});
  const idReq=R.run('ID_REQ'); R.run('enviarRequisicion()'); await esperar(20);
  let gr=R.llamadas.filter(c=>c.funcion==='guardarRequisicion')[0].args[0];
  assert.deepEqual([gr.folio,gr.proyectoFolio,gr.renglones,gr.cotizacion.datos,gr.idSolicitud],
    ['','PRY-2026-0001',[{descripcion:'Panel solar 550 W',cantidad:'10',unidad:'PZA',notas:'Monocristalino'}],'/9j/',idReq]);
  assert(!('precio' in gr.renglones[0])&&!('costo' in gr.renglones[0]),'sin precios');
  assert(/REQ-2026-0003<\/b> enviada/.test(R.$('aviso').innerHTML)&&R.run('ID_REQ')!==idReq);
  // Corregir una devuelta: mismo folio, sin cambiar de proyecto; la cotización nueva es opcional
  R.run("editarReq('REQ-2026-0002')");
  assert.deepEqual([R.$('reqProyecto').disabled,R.$('reqTitulo').textContent,R.$('btnReq').textContent],[true,'1 · Corregir REQ-2026-0002','Reenviar requisición']);
  assert(/Falta el calibre/.test(R.$('reqEditando').innerHTML));
  const fr=R.$('reqFilas').hijos; fr[fr.length-1].querySelector('.desc').value='Tubo conduit cédula 40';
  R.$('reqArchivo').files=[];
  R.run('enviarRequisicion()'); await esperar(20);
  gr=R.llamadas.filter(c=>c.funcion==='guardarRequisicion')[1].args[0];
  assert.deepEqual([gr.folio,gr.cotizacion,gr.renglones.map(x=>x.descripcion)],['REQ-2026-0002',null,['Tubo conduit cédula 40']]);
  assert(/corregida y reenviada/.test(R.$('aviso').innerHTML)&&!R.$('reqProyecto').disabled);
  // Recibí el material (notas opcionales); cancelar pide motivo
  R.respuestas.cerrarRequisicion={ok:true,datos:RQS};
  R.dialogos.prompt=null; R.run("recibiMaterial('REQ-2026-0001')"); await esperar();
  assert(!R.llamadas.some(c=>c.funcion==='cerrarRequisicion'),'si cancela el diálogo no cierra');
  R.dialogos.prompt='Faltó 1 pieza'; R.run("recibiMaterial('REQ-2026-0001')"); await esperar();
  assert.deepEqual(R.llamadas.find(c=>c.funcion==='cerrarRequisicion').args,['REQ-2026-0001','Faltó 1 pieza']);
  R.dialogos.prompt=' '; R.run("cancelarReq('REQ-2026-0002')"); await esperar();
  assert(!R.llamadas.some(c=>c.funcion==='cancelarRequisicion'));

  // ===== SOLO_REQUISICION: solo la pestaña Requisiciones =====
  const S=montar({soloRequisicion:true,ivaTasa:0.16,catalogo:[{clave:'PAN-550',descripcion:'Panel solar 550 W',unidad:'PZA'}],tipoCambio:null,clientes:[],proyectos:[],
    marcas:{},permisos:{cobranza:false,desbloqueo:false,compras:false,requisicion:true}});
  S.respuestas.listarProyectosRequisicion={ok:true,datos:[]}; S.respuestas.misRequisiciones={ok:true,datos:[]};
  await esperar(10);
  for(const t of ['tabNueva','tabHist','tabCat','tabCob','tabCom']) assert(S.$(t).classList.contains('oculto'),'oculta '+t);
  assert(!S.$('tabReq').classList.contains('oculto')&&!S.$('vistaReq').classList.contains('oculto')&&S.$('vistaNueva').classList.contains('oculto'));
  assert(S.llamadas.some(c=>c.funcion==='misRequisiciones')&&/Todavía no tienes requisiciones/.test(S.$('reqLista').innerHTML));
  assert(!S.llamadas.some(c=>['listarCotizaciones','getCatalogo','listarProyectos'].includes(c.funcion)),'no llama nada más');

  // ===== Carga rápida: pestañas al instante con los roles de la última sesión (localStorage); el bootstrap las corrige =====
  let liberar;
  const PRYC={...PRY,clave:'TEC',folioVisible:'PRY-2026-0001-TEC'};
  const T=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[PRYC],marcas:{},versiones:{proyectos:1},
    permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:false},
    com:{proyectos:[{...PRYC,moneda:'MXN',marca:'',sinContrato:true}],requisiciones:[]}},
    {local:{'cotizadorHelgenRoles:ana@helgen.tech':JSON.stringify({permisos:{cobranza:true,compras:false,requisicion:true},soloRequisicion:false})},
     bootstrapPendiente:f=>liberar=f});
  await new Promise(r=>setTimeout(r,5)); // los roles guardados se aplican con setTimeout al terminar de cargar el script
  assert(!T.$('tabCob').classList.contains('oculto')&&!T.$('tabReq').classList.contains('oculto')&&T.$('tabCom').classList.contains('oculto'),
    'antes de responder el servidor: las pestañas de la última sesión');
  liberar(); await esperar(10);
  assert(T.$('tabCob').classList.contains('oculto')&&T.$('tabReq').classList.contains('oculto')&&!T.$('tabCom').classList.contains('oculto'),'el bootstrap corrige');
  assert.deepEqual(JSON.parse(T.local['cotizadorHelgenRoles:ana@helgen.tech']).permisos,{cobranza:false,desbloqueo:false,compras:true,requisicion:false});
  assert.deepEqual(T.llamadas.map(c=>c.funcion),['bootstrap'],'al entrar: una sola llamada');
  assert(/PRY-2026-0001-TEC — Luis — Solar MX — Techo/.test(T.$('proyectosList').innerHTML),'folio con clave al cotizar');
  assert(/PRY-2026-0001-TEC — Luis — Solar MX — Techo/.test(T.$('comProyectosList').innerHTML)&&/MXN · sin contrato/.test(T.$('comProyectosList').innerHTML));
  T.$('proyecto').value='PRY-2026-0001-TEC — Luis — Solar MX — Techo'; T.$('proyecto').disparar('change');
  assert.equal(T.run('proyectoElegido().folio'),'PRY-2026-0001','se elige por la llave interna');
  assert.equal(T.intervalos.length,1,'consulta cada 20 s');
  // Cambio de rol sin recargar: aparece la pestaña Requisiciones (proyectos activos y cerrados)
  T.respuestas.sincronizar={ok:true,datos:{versiones:{proyectos:2},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:true},cambios:['proyectos'],
    reqProyectos:[{folio:'PRY-2026-0002',clave:'DRO',folioVisible:'PRY-2026-0002-DRO',nombre:'DROGHEDA',estado:'Cerrado'}]}};
  T.respuestas.misRequisiciones={ok:true,datos:[]}; T.respuestas.listarProyectosRequisicion={ok:true,datos:[]};
  T.intervalos[0](); await esperar(10);
  assert(!T.$('tabReq').classList.contains('oculto'),'pestaña nueva sin recargar');
  assert(/PRY-2026-0002-DRO — DROGHEDA" label="Cerrado"/.test(T.$('reqProyectosList').innerHTML),T.$('reqProyectosList').innerHTML);
  assert.equal(T.run('VERS.proyectos'),2);
  assert.deepEqual(T.llamadas.filter(c=>c.funcion==='sincronizar').pop().args[0],{proyectos:1},'manda las versiones que tiene');
  // Con la pestaña del navegador oculta no consulta; al volver, sí
  const nSync=()=>T.llamadas.filter(c=>c.funcion==='sincronizar').length, n0=nSync();
  T.document.visibilityState='hidden'; T.intervalos[0](); await esperar();
  assert.equal(nSync(),n0,'pestaña oculta: no consulta');
  T.document.visibilityState='visible'; T.respuestas.sincronizar=()=>({ok:true,datos:{versiones:{proyectos:2},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:true},cambios:[]}});
  T.document.dispatchEvent({type:'visibilitychange'}); await esperar();
  assert.equal(nSync(),n0+1,'al volver a la pestaña consulta');
  T.$('comProyecto').disparar('focus'); await esperar();
  assert.equal(nSync(),n0+2,'al abrir un buscador de proyectos consulta');
  // Alguien está capturando en la vista abierta: no se repinta sola; se avisa y se actualiza con un clic
  const vistaCob={proyecto:PRYC,cotizaciones:[],contrato:null,esquema:[],resumen:null,pagos:[],puedeAceptar:true,puedeFirmar:false,metodos:[],hoy:'2026-10-20',
    margen:{sinContrato:true,costos:[{concepto:'Órdenes de compra',moneda:'MXN',monto:1000,cantidad:1}]}};
  T.run("COB={proyecto:{folio:'PRY-2026-0001'}}"); T.$('cobVistaProyecto').disparar('input');
  T.respuestas.sincronizar={ok:true,datos:{versiones:{proyectos:2,oc:3},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:true},cambios:['oc'],cobranzaProyecto:vistaCob}};
  T.run('sincronizarAhora()'); await esperar();
  assert.equal(T.run('COB.proyecto.clave'),undefined,'no se repintó mientras capturaba');
  const avisoSync=T.$('cobVistaProyecto').querySelector('.aviso-sync');
  assert(/Otra persona cambió esta información/.test(avisoSync.innerHTML));
  avisoSync.querySelector('a').onclick({preventDefault(){}});
  assert(/PRY-2026-0001-TEC/.test(T.$('cobInfo').innerHTML),'con el clic se actualiza');
  assert(/Costo de órdenes de compra/.test(T.$('cobMargen').innerHTML)&&/\$1,000\.00 MXN/.test(T.$('cobMargen').innerHTML)&&/Sin contrato/.test(T.$('cobMargen').innerHTML),
    'sin contrato: costo de las órdenes y "Sin contrato"');
  // Clave del proyecto: se sugiere con el nombre y se puede editar (3 letras A–Z)
  T.$('npNombre').value='Casa del Lago'; T.$('npNombre').disparar('input');
  assert.equal(T.$('npClave').value,'CAL'); assert(/PRY-\d{4}-NNNN-CAL/.test(T.$('npFolio').textContent));
  T.$('npClave').value='xy1z'; T.$('npClave').disparar('input'); assert.equal(T.$('npClave').value,'XYZ');
  T.$('npNombre').value='Otra cosa'; T.$('npNombre').disparar('input'); assert.equal(T.$('npClave').value,'XYZ','la editada a mano no se reemplaza');
  assert.equal(T.run("claveSugerida('DROGHEDA')+claveSugerida('Planta de Agua Norte')+claveSugerida('Ñandú')"),'DROPANNAN');
  T.respuestas.crearProyecto={ok:true,datos:{folio:'PRY-2026-0009',clave:'XYZ',folioVisible:'PRY-2026-0009-XYZ',nombre:'Otra cosa',cliente:'Luis',estado:'Activo',url:'u'}};
  T.$('cNombre').value='Luis'; T.run('crearProyecto()'); await esperar();
  assert.equal(T.llamadas.find(c=>c.funcion==='crearProyecto').args[0].clave,'XYZ');
  assert(/PRY-2026-0009-XYZ/.test(T.$('aviso').innerHTML)&&/^PRY-2026-0009-XYZ — /.test(T.$('proyecto').value));
  console.log('OK interfaz');
})().catch(e=>{console.error(e);process.exit(1)});
