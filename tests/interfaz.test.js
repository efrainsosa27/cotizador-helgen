// Interfaz (web/cotizador/index.html): corre la capa api-web y el script de la app con un DOM y un fetch simulados.
// Cubre: si el servidor rechaza el proyecto (codigo PROYECTO), se limpia el campo, se refresca la lista y se avisa;
// moneda USD (el catálogo no pone precio); pestaña Cobranza solo con permiso; aceptar con confirmación; pago con comprobante;
// margen en Cobranza; pestaña Compras solo con permiso: requisición → orden precargada (renglones sin costo, tipo de cambio),
// pago con comprobante, cancelar el pago, cerrar con motivo; días de crédito; facturas del proveedor (CFDI con vista previa y
// extranjera); cuentas por pagar (resumen, filtros, CSV, sincronización); pestaña Requisiciones (nueva, corregir, recibí el material) y
// SOLO_REQUISICION (solo esa pestaña); con operaciones (incremento 3): pestaña Operaciones (pendientes, aprobar por renglón, visto
// bueno con la versión vista, regresar a compras), sitio y cotización opcional, recepción por renglón, propuesta de compras,
// separar renglones, recepción en su lugar y cancelar una recepción.
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
   confirm:m=>{dialogos.vistos.push(m);return dialogos.confirmar},
   prompt:m=>{dialogos.vistos.push(m);return Array.isArray(dialogos.prompt)?dialogos.prompt.shift():dialogos.prompt}, // arreglo = varias respuestas seguidas
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
  // Cuentas por pagar: se pide al abrir Compras (si no vino en la carga inicial)
  const RANGOS=[{clave:'porVencer',etiqueta:'Por vencer'},{clave:'d1a30',etiqueta:'Vencido 1–30'},{clave:'d31a60',etiqueta:'Vencido 31–60'},
    {clave:'d61a90',etiqueta:'Vencido 61–90'},{clave:'d90mas',etiqueta:'Vencido +90'}];
  const CXPD={hoy:'2026-10-20',rangos:RANGOS,
    totales:[{moneda:'MXN',facturas:1,porVencer:0,d1a30:1740,d31a60:0,d61a90:0,d90mas:0,vencido:1740,total:1740},
      {moneda:'USD',facturas:1,porVencer:500,d1a30:0,d31a60:0,d61a90:0,d90mas:0,vencido:0,total:500}],
    abiertas:[{folio:'FPR-2026-0001',tipo:'CFDI',serieFolio:'A-1',ocFolio:'OC-2026-0001',reqFolio:'REQ-2026-0001',proyectoFolio:'PRY-2026-0001',
        proyectoVisible:'PRY-2026-0001-TEC',proyectoNombre:'Techo',proveedor:'Paneles del Bajío',fechaEmision:'2026-09-10',fechaVencimiento:'2026-10-10',dias:10,rango:'d1a30',moneda:'MXN',total:1740},
      {folio:'FPR-2026-0002',tipo:'Extranjera',serieFolio:'=INV-1',ocFolio:'OC-2026-0006',reqFolio:'REQ-2026-0008',proyectoFolio:'PRY-2026-0002',
        proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',proveedor:'Ardusimple SL',fechaEmision:'2026-10-20',fechaVencimiento:'2026-10-25',dias:-5,rango:'porVencer',moneda:'USD',total:500}],
    faltantes:[{folio:'OC-2026-0005',fecha:'2026-10-01',proyectoFolio:'PRY-2026-0003',proyectoVisible:'PRY-2026-0003-BON',proyectoNombre:'Bodega',proveedor:'Cementos SA',
      estado:'Pagada',pagada:true,moneda:'MXN',subtotal:1000,facturado:0,faltante:1000,reqFolio:'REQ-2026-0009'}],
    repPendientes:{n:1,folios:['FPR-2026-0003']}};
  C.respuestas.cuentasPorPagar={ok:true,datos:CXPD};
  C.$('rcEstado').value='Solicitada'; C.run("verTab('com')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='listarRequisiciones').args,['','Solicitada']);
  assert(/REQ-2026-0001/.test(C.$('rcLista').innerHTML)&&/Juan Obrero/.test(C.$('rcLista').innerHTML)&&/abrirReqCom/.test(C.$('rcLista').innerHTML));
  assert(/PRY-2026-0001 — Luis — Solar MX — Techo/.test(C.$('comProyectosList').innerHTML)&&/MXN · Helgen/.test(C.$('comProyectosList').innerHTML));
  assert.equal(C.llamadas.filter(c=>c.funcion==='cuentasPorPagar').length,1);
  const cr=C.$('cxpResumen').innerHTML;
  assert(/Por pagar MXN/.test(cr)&&/\$1,740\.00 MXN/.test(cr)&&/Vencido MXN/.test(cr)&&/Por pagar USD/.test(cr)&&/\$500\.00 USD/.test(cr)&&
    /1 orden sin factura completa/.test(cr)&&/1 complemento de pago \(REP\) pendiente/.test(cr),cr);
  assert(!/2,240/.test(cr),'nunca se suman MXN y USD');
  // Vista completa: sin volver a pedirla; vencidas primero, filtros, CSV
  C.run('verCxp()');
  assert(!C.$('comVistaCxp').classList.contains('oculto')&&C.$('comVistaLista').classList.contains('oculto'));
  assert.equal(C.llamadas.filter(c=>c.funcion==='cuentasPorPagar').length,1,'ya cargada');
  assert(/Vencido 1–30/.test(C.$('cxpTotales').innerHTML)&&/1 factura por pagar/.test(C.$('cxpTotales').innerHTML));
  let cl=C.$('cxpLista').innerHTML;
  assert(/FPR-2026-0001/.test(cl)&&/Vencida hace 10 días/.test(cl)&&/PRY-2026-0001-TEC/.test(cl)&&/data-req="REQ-2026-0001"/.test(cl)&&/Vence en 5 días/.test(cl));
  assert(/Pagada sin factura/.test(C.$('cxpFaltantes').innerHTML)&&/data-req="REQ-2026-0009"/.test(C.$('cxpFaltantes').innerHTML)&&/FPR-2026-0003/.test(C.$('cxpRep').innerHTML));
  C.$('cxpVencidas').checked=true; C.run('pintarCxp()');
  assert(/FPR-2026-0001/.test(C.$('cxpLista').innerHTML)&&!/FPR-2026-0002/.test(C.$('cxpLista').innerHTML),'solo vencidas');
  C.$('cxpVencidas').checked=false; C.$('cxpBuscar').value='ardu'; C.run('pintarCxp()');
  assert(!/FPR-2026-0001/.test(C.$('cxpLista').innerHTML)&&/FPR-2026-0002/.test(C.$('cxpLista').innerHTML),'por proveedor');
  C.$('cxpBuscar').value=''; C.$('cxpMoneda').value='MXN'; C.run('pintarCxp()');
  assert(!/FPR-2026-0002/.test(C.$('cxpLista').innerHTML),'por moneda');
  C.$('cxpMoneda').value='';
  const csvC=C.run('csvCxp(filtrarCxp())');
  assert(csvC.startsWith('﻿"Vencimiento","Días vencida"')&&/"FPR-2026-0001"/.test(csvC)&&/,1740\.00/.test(csvC)&&csvC.includes(`"'=INV-1"`)&&/"Vencido 1–30"/.test(csvC),csvC);
  // Sincronización: pide cuentas por pagar y las repinta
  C.respuestas.sincronizar={ok:true,datos:{versiones:{facturasProveedor:3},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:false},
    cambios:['facturasProveedor'],cxp:{...CXPD,totales:[],abiertas:[],faltantes:[],repPendientes:{n:0,folios:[]}}}};
  C.run('sincronizarAhora()'); await esperar();
  assert.equal(C.llamadas.filter(c=>c.funcion==='sincronizar').pop().args[1].cxp,true);
  assert(/No hay facturas por pagar/.test(C.$('cxpResumen').innerHTML)&&/No hay facturas por pagar/.test(C.$('cxpLista').innerHTML));
  C.respuestas.sincronizar=()=>({ok:true,datos:{versiones:{facturasProveedor:3},permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:false},cambios:[]}});
  C.run('verListaCom()');
  assert(C.$('comVistaCxp').classList.contains('oculto')&&!C.$('comVistaLista').classList.contains('oculto'));
  const PROV={id:'PDB200101AB1',razonSocial:'Paneles del Bajío',rfc:'PDB200101AB1',contacto:'Luis Pérez',correo:'v@pdb.mx',telefono:'442',etiqueta:'Paneles del Bajío',diasCredito:30};
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
  // Días de crédito: vacíos al precargar; las condiciones se llenan solas
  assert.deepEqual([C.$('ocDias').value,C.$('ocCondiciones').value],['','']);
  C.$('ocDias').value='0'; C.$('ocDias').disparar('input'); assert.equal(C.$('ocCondiciones').value,'Contado');
  // Proveedor registrado: se autorrellena (también sus días de crédito de la orden anterior)
  C.$('prvRazon').value='Paneles del Bajío'; C.$('prvRazon').disparar('change');
  assert.deepEqual([C.$('prvRfc').value,C.$('prvContacto').value,C.$('prvCorreo').value,C.$('ocDias').value,C.$('ocCondiciones').value],
    ['PDB200101AB1','Luis Pérez','v@pdb.mx',30,'Crédito 30 días']);
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
  C.$('ocTc').value='18.5'; C.$('ocEntrega').value='2026-10-25'; C.$('ocCondiciones').value='Contado'; C.$('ocCondiciones').disparar('input');
  C.$('ocDias').value='45'; C.$('ocDias').disparar('input'); assert.equal(C.$('ocCondiciones').value,'Contado','escritas a mano: ya no cambian solas');
  const ORD={folio:'OC-2026-0001',fecha:'2026-10-20',proveedor:'Paneles del Bajío',moneda:'USD',total:3200,tipoCambio:18.5,fechaEntrega:'2026-10-25',
    lugarEntrega:'Qro',condicionesPago:'Contado',estado:'Emitida',pdfUrl:'https://drive/oc',reqFolio:'REQ-2026-0001'};
  const autorizada=vistaReq({orden:ORD,puedeAutorizar:false,puedeRevisar:false,puedePagar:true},{estado:'Autorizada',ocFolio:'OC-2026-0001'});
  C.respuestas.autorizarRequisicion={ok:true,datos:{folio:'REQ-2026-0001',ocFolio:'OC-2026-0001',url:'https://drive/oc',total:3200,moneda:'USD',vista:autorizada}};
  const idOc=C.run('ID_OC'); C.run('guardarOc()'); await esperar();
  const go=C.llamadas.find(c=>c.funcion==='autorizarRequisicion');
  assert.equal(go.args[0],'REQ-2026-0001');
  assert.deepEqual([go.args[1].proveedor.razonSocial,go.args[1].proveedor.rfc,go.args[1].moneda,go.args[1].tipoCambio,go.args[1].ivaTasa,go.args[1].fechaEntrega,
    go.args[1].lugarEntrega,go.args[1].diasCredito,go.args[1].condicionesPago,go.args[1].idSolicitud,'proyectoFolio' in go.args[1]],
    ['Paneles del Bajío','PDB200101AB1','USD','18.5','0','2026-10-25','Qro','45','Contado',idOc,false],'el proyecto sale de la requisición en el servidor');
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

  // ===== Facturas del proveedor (en la requisición, abierta desde Cuentas por pagar) =====
  const ORDF={...ORD,moneda:'MXN',total:2320,subtotal:2000,tipoCambio:'',diasCredito:30,estado:'Emitida'};
  const vFac=(extra={})=>vistaReq({orden:ORDF,puedeAutorizar:false,puedeRevisar:false,puedePagar:true,puedeFacturar:true,facturas:[],totalFacturado:0,
    facturaCompleta:false,...extra},{estado:'Autorizada',ocFolio:'OC-2026-0001'});
  C.run('verCxp()'); C.respuestas.getRequisicion={ok:true,datos:vFac()};
  C.run("abrirReqCom('REQ-2026-0001')"); await esperar();
  assert.equal(C.$('btnVolverCom').textContent,'← Cuentas por pagar');
  assert(C.$('comVistaCxp').classList.contains('oculto')&&!C.$('rcFacturasCaja').classList.contains('oculto')&&!C.$('rcFormFactura').classList.contains('oculto'));
  assert(/Sin facturas todavía/.test(C.$('rcFacturasResumen').innerHTML)&&/30 días de crédito/.test(C.$('rcOrden').innerHTML));
  assert.deepEqual([C.$('fcTipo').value,C.$('fcXmlCaja').classList.contains('oculto'),C.$('fcExtCampos').classList.contains('oculto'),C.$('fcPdfLbl').textContent,
    C.$('fcMoneda').value,C.$('ppMonto').value],['CFDI',false,true,'PDF de la factura (opcional)','MXN',2320]);
  // Sin XML no se envía
  C.run('registrarFacturaProv()'); await esperar();
  assert(/Adjunta el XML/.test(C.$('aviso').innerHTML)&&!C.llamadas.some(c=>c.funcion==='registrarFacturaProveedor'));
  // XML: vista previa (UTF-8; no lee el emisor falso del comentario) con avisos y el vencimiento según los días de la orden
  const xmlCfdi=(o={})=>{const a={moneda:'MXN',version:'4.0',metodo:'PPD',...o};
    return '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="'+a.version+'" Serie="A" Folio="77" '+
    'Fecha="2026-10-01T10:00:00" SubTotal="1500.00" Moneda="'+a.moneda+'" Total="1740.00" TipoDeComprobante="I" MetodoPago="'+a.metodo+'">'+
    '<!-- <cfdi:Emisor Rfc="AAA010101AAA" Nombre="FALSO"/> --><cfdi:Emisor Rfc="PDB200101AB1" Nombre="PANELES DEL BAJÍO &amp; CIA"/>'+
    '<cfdi:Receptor Rfc="HSE240304PC1"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="6F1C5E2A-3B4D-4C5E-9F60-000000000001"/></cfdi:Complemento></cfdi:Comprobante>'};
  const archivoXml=o=>[{name:'a77.xml',type:'text/xml',size:600,b64:Buffer.from(xmlCfdi(o),'utf8').toString('base64')}];
  C.$('fcXml').files=archivoXml({moneda:'USD',version:'3.3'}); C.$('fcXml').disparar('change'); await esperar();
  assert(/es en USD y la orden en MXN/.test(C.$('fcPrevia').innerHTML)&&/No es CFDI 4\.0/.test(C.$('fcPrevia').innerHTML));
  // Un XML con una "moneda" hostil no mete HTML en la vista previa (dinero() escapa la moneda)
  C.$('fcXml').files=archivoXml({moneda:'&lt;img src=x onerror=&amp;#97;lert(1)&gt;'}); C.$('fcXml').disparar('change'); await esperar();
  assert(!/<img/i.test(C.$('fcPrevia').innerHTML)&&/&lt;IMG/.test(C.$('fcPrevia').innerHTML),C.$('fcPrevia').innerHTML);
  assert.equal(C.run("dinero(1,'<b>')"),'$1.00 &lt;b&gt;');
  C.$('fcXml').files=archivoXml(); C.$('fcXml').disparar('change'); await esperar();
  const pv=C.$('fcPrevia').innerHTML;
  assert(/PANELES DEL BAJÍO &amp; CIA/.test(pv)&&/PDB200101AB1/.test(pv)&&!/FALSO/.test(pv)&&/A-77/.test(pv)&&/Total \$1,740\.00 MXN/.test(pv)&&
    /Vencería el 31\/10\/2026/.test(pv)&&/REP/.test(pv)&&!/aviso-moneda/.test(pv),pv);
  // Registrar: el servidor lee todo del XML; la vista se repinta y el formulario queda listo para la siguiente
  const F1={folio:'FPR-2026-0001',tipo:'CFDI',uuid:'6F1C5E2A-3B4D-4C5E-9F60-000000000001',serieFolio:'A-77',fechaEmision:'2026-10-01',fechaVencimiento:'2026-10-31',
    diasCredito:30,ocFolio:'OC-2026-0001',moneda:'MXN',subtotal:1500,total:1740,retenidos:0,metodoPago:'PPD',xmlUrl:'https://drive/xml1',pdfUrl:'',estado:'Vigente',
    nombreEmisor:'PANELES DEL BAJÍO & CIA',rfcEmisor:'PDB200101AB1'};
  C.respuestas.registrarFacturaProveedor={ok:true,datos:{folio:'FPR-2026-0001',fechaVencimiento:'2026-10-31',ocFolio:'OC-2026-0001',desde:'requisicion',
    vista:vFac({facturas:[F1],totalFacturado:1740})}};
  const idF=C.run('ID_FPR'); C.$('fcNotas').value='Primera entrega'; C.run('registrarFacturaProv()'); await esperar(20);
  const rf=C.llamadas.find(c=>c.funcion==='registrarFacturaProveedor').args[0];
  assert.deepEqual([rf.ocFolio,rf.tipo,rf.xml.datos,rf.xml.nombre,rf.pdf,rf.notas,rf.desde,rf.idSolicitud,rf.numero],
    ['OC-2026-0001','CFDI',archivoXml()[0].b64,'a77.xml',null,'Primera entrega','requisicion',idF,'']);
  assert(/FPR-2026-0001/.test(C.$('aviso').innerHTML)&&/31\/10\/2026/.test(C.$('aviso').innerHTML));
  const tf=C.$('rcFacturas').innerHTML;
  assert(/FPR-2026-0001/.test(tf)&&/Vence en 11 días/.test(tf)&&/https:\/\/drive\/xml1/.test(tf)&&/cambiarDiasFactura\('FPR-2026-0001',30\)/.test(tf)&&/cancelarFacturaProv/.test(tf),tf);
  assert(/Facturado: <b>\$1,740\.00 MXN/.test(C.$('rcFacturasResumen').innerHTML));
  assert.deepEqual([C.run('ID_FPR')!==idF,C.run('FC_XML'),C.$('fcNotas').value],[true,null,''],'el formulario queda listo para la siguiente');
  assert.equal(C.$('ppMonto').value,2320,'facturada a medias: el pago es el total de la orden');
  assert(/todavía no cubren la orden/.test(C.$('ppNota').textContent));
  // Extranjera: PDF obligatorio; número, fecha, moneda, subtotal e impuestos capturados
  C.$('fcTipo').value='Extranjera'; C.run('pintarTipoFactura()');
  assert.deepEqual([C.$('fcXmlCaja').classList.contains('oculto'),C.$('fcExtCampos').classList.contains('oculto'),C.$('fcPdfLbl').textContent],[true,false,'PDF de la factura *']);
  C.$('fcNumero').value='INV-9'; C.$('fcFecha').value='2026-10-15'; C.$('fcSubtotal').value='500'; C.$('fcImpuestos').value='80'; C.run('pintarPreviaFactura()');
  assert(/Total \$580\.00 MXN/.test(C.$('fcPrevia').innerHTML)&&/Vencería el 14\/11\/2026/.test(C.$('fcPrevia').innerHTML));
  C.run('registrarFacturaProv()'); await esperar();
  assert(/Adjunta el PDF de la factura del proveedor extranjero/.test(C.$('aviso').innerHTML)&&C.llamadas.filter(c=>c.funcion==='registrarFacturaProveedor').length===1);
  C.$('fcPdf').files=[{name:'inv9.pdf',type:'application/pdf',size:900,b64:'JVBERi0='}];
  const F2={...F1,folio:'FPR-2026-0002',tipo:'Extranjera',uuid:'',serieFolio:'INV-9',fechaEmision:'2026-10-15',fechaVencimiento:'2026-11-14',total:348,subtotal:500,
    retenidos:232,metodoPago:'',xmlUrl:'',pdfUrl:'https://drive/pdf2',nombreEmisor:'Paneles del Bajío',rfcEmisor:''};
  C.respuestas.registrarFacturaProveedor={ok:true,datos:{folio:'FPR-2026-0002',fechaVencimiento:'2026-11-14',ocFolio:'OC-2026-0001',desde:'requisicion',
    vista:vFac({facturas:[F1,F2],totalFacturado:2088,facturaCompleta:true})}};
  C.run('registrarFacturaProv()'); await esperar(20);
  const rf2=C.llamadas.filter(c=>c.funcion==='registrarFacturaProveedor').pop().args[0];
  assert.deepEqual([rf2.tipo,rf2.xml,rf2.pdf.datos,rf2.numero,rf2.fecha,rf2.moneda,rf2.subtotal,rf2.impuestos],['Extranjera',null,'JVBERi0=','INV-9','2026-10-15','MXN','500','80']);
  assert.equal(C.$('fcTipo').value,'Extranjera','la siguiente, del mismo tipo que la última');
  // Facturada completa con retenciones: el pago se precarga con el total de sus facturas
  assert.equal(C.$('ppMonto').value,2088);
  assert(/o el total de sus facturas \(\$2,088\.00 MXN\)/.test(C.$('ppNota').textContent)&&/Retenciones \$232\.00 MXN/.test(C.$('rcFacturas').innerHTML));
  // Cancelar (motivo obligatorio) y cambiar días de crédito (número y motivo)
  C.dialogos.prompt=['  ']; C.run("cancelarFacturaProv('FPR-2026-0002')"); await esperar();
  assert(!C.llamadas.some(c=>c.funcion==='cancelarFacturaProveedor'));
  C.respuestas.cancelarFacturaProveedor={ok:true,datos:{folio:'FPR-2026-0002',desde:'requisicion',
    vista:vFac({facturas:[F1,{...F2,estado:'Cancelada',canceladoPor:'pedro@helgen.tech',motivoCancelacion:'Duplicada'}],totalFacturado:1740})}};
  C.dialogos.prompt=['Duplicada']; C.run("cancelarFacturaProv('FPR-2026-0002')"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='cancelarFacturaProveedor').args,['FPR-2026-0002','Duplicada','requisicion']);
  assert(/fila-cancelada/.test(C.$('rcFacturas').innerHTML)&&C.$('ppMonto').value===2320,'cancelada: vuelve al total de la orden');
  C.dialogos.prompt=['abc']; C.run("cambiarDiasFactura('FPR-2026-0001',30)"); await esperar();
  assert(/número entero/.test(C.$('aviso').innerHTML));
  C.dialogos.prompt=['45',' ']; C.run("cambiarDiasFactura('FPR-2026-0001',30)"); await esperar();
  assert(/por qué cambian/.test(C.$('aviso').innerHTML)&&!C.llamadas.some(c=>c.funcion==='cambiarDiasCreditoFactura'));
  C.respuestas.cambiarDiasCreditoFactura={ok:true,datos:{folio:'FPR-2026-0001',fechaVencimiento:'2026-11-15',desde:'requisicion',
    vista:vFac({facturas:[{...F1,diasCredito:45,fechaVencimiento:'2026-11-15'}],totalFacturado:1740})}};
  C.dialogos.prompt=['45','El proveedor amplió el crédito']; C.run("cambiarDiasFactura('FPR-2026-0001',30)"); await esperar();
  assert.deepEqual(C.llamadas.find(c=>c.funcion==='cambiarDiasCreditoFactura').args,['FPR-2026-0001','45','El proveedor amplió el crédito','requisicion']);
  assert(/15\/11\/2026/.test(C.$('aviso').innerHTML)&&/45 días de crédito/.test(C.$('rcFacturas').innerHTML));
  // Regresar: a cuentas por pagar (de donde se abrió)
  C.run('volverCom()');
  assert(!C.$('comVistaCxp').classList.contains('oculto')&&C.$('comVistaReq').classList.contains('oculto'));
  // Órdenes por proyecto: columna "Facturado"
  C.respuestas.getComprasProyecto={ok:true,datos:{proyecto:PRY,moneda:'MXN',marca:'helgen',hoy:'2026-10-20',
    ordenes:[{...ORDF,facturas:[F1],totalFacturado:1740},{...ORDF,folio:'OC-2026-0003',facturas:[],totalFacturado:0}]}};
  C.run("abrirProyectoCom('PRY-2026-0001')"); await esperar();
  assert(/\$1,740\.00 MXN<div class="nota">1 factura/.test(C.$('ocLista').innerHTML)&&/Sin factura/.test(C.$('ocLista').innerHTML));

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
  // ===== Con operaciones (ROL_OPERACIONES): pestaña Operaciones, sitio, propuesta de compras y recepción por renglón =====
  const SIT=['Querétaro','Manzanillo (TIMSA)','Ensenada (EIT)'];
  const OPSL=[{folio:'REQ-2026-0010',fecha:'2026-10-28',proyectoFolio:'PRY-2026-0002',proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',solicitante:'Jesús',
      solicitanteEmail:'jesus@helgen.tech',estado:'Solicitada',sitio:'Manzanillo (TIMSA)',fechaRequerida:'2026-10-30',prioridad:'',renglones:3,elaboroPropuesta:'',proveedor:'',total:null,moneda:''},
    {folio:'REQ-2026-0009',fecha:'2026-10-27',proyectoFolio:'PRY-2026-0002',proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',solicitante:'Miguel',
      solicitanteEmail:'miguel@helgen.tech',estado:'Cotizada',sitio:'Querétaro',fechaRequerida:'',prioridad:'Urgente',renglones:2,elaboroPropuesta:'tania@helgen.tech',
      proveedor:'Ferretera del Puerto',total:1670.4,moneda:'MXN'},
    {folio:'REQ-2026-0008',fecha:'2026-10-27',proyectoFolio:'PRY-2026-0002',proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',solicitante:'Ana',
      solicitanteEmail:'ana@helgen.tech',estado:'Solicitada',sitio:'Querétaro',fechaRequerida:'',prioridad:'',renglones:1,elaboroPropuesta:'',proveedor:'',total:null,moneda:''},
    {folio:'REQ-2026-0007',fecha:'2026-10-26',proyectoFolio:'PRY-2026-0002',proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',solicitante:'Daniel',
      solicitanteEmail:'daniel@helgen.tech',estado:'Cerrada',sitio:'Ensenada (EIT)',fechaRequerida:'',prioridad:'Normal',renglones:1,elaboroPropuesta:'',proveedor:'',total:null,moneda:''}];
  const O=montar({soloRequisicion:true,ivaTasa:0.16,catalogo:[],tipoCambio:null,clientes:[],proyectos:[],marcas:{},sitios:SIT,ops:{requisiciones:OPSL},
    permisos:{cobranza:false,desbloqueo:false,compras:false,requisicion:true,operaciones:true,flujoOperaciones:true}});
  O.respuestas.listarProyectosRequisicion={ok:true,datos:[]}; O.respuestas.misRequisiciones={ok:true,datos:[]};
  await esperar(10);
  for(const t of ['tabNueva','tabHist','tabCat','tabCob','tabCom']) assert(O.$(t).classList.contains('oculto'),'oculta '+t);
  assert(!O.$('tabOps').classList.contains('oculto')&&!O.$('tabReq').classList.contains('oculto'),'operaciones con SOLO_REQUISICION: Requisiciones y Operaciones');
  assert.equal(O.$('tabOps').textContent,'Operaciones (2)','pendientes: aprobar la de otro y el visto bueno; no la propia ni la cerrada');
  O.$('opsFiltro').value='pendientes'; O.run("verTab('ops')"); await esperar();
  assert(!O.llamadas.some(c=>c.funcion==='listarOperaciones'),'la lista vino en la carga inicial');
  let ol=O.$('opsLista').innerHTML;
  assert(/REQ-2026-0010/.test(ol)&&/REQ-2026-0009/.test(ol)&&!/REQ-2026-0008/.test(ol)&&!/REQ-2026-0007/.test(ol)&&/\$1,670\.40 MXN/.test(ol)&&/Ferretera del Puerto/.test(ol));
  O.$('opsFiltro').value=''; O.$('opsBuscar').value='ensenada'; O.run('pintarListaOps()');
  assert(/REQ-2026-0007/.test(O.$('opsLista').innerHTML)&&!/REQ-2026-0010/.test(O.$('opsLista').innerHTML),'busca por sitio sin acentos');
  // Aprobar renglón por renglón
  const VOPS={requisicion:{folio:'REQ-2026-0010',fecha:'2026-10-28',proyectoFolio:'PRY-2026-0002',solicitante:'Jesús',solicitanteEmail:'jesus@helgen.tech',estado:'Solicitada',
      motivo:'',sitio:'Manzanillo (TIMSA)',fechaRequerida:'2026-10-30',prioridad:'',recibe:'jesus@helgen.tech',origenFolio:'',cotizacionId:'',actualizado:''},
    proyecto:{folio:'PRY-2026-0002',folioVisible:'PRY-2026-0002-DRO',nombre:'DROGHEDA',estado:'Activo',ubicacion:''},
    renglones:[{renglon:1,descripcion:'Cable THW 10',cantidad:100,unidad:'M',notas:''},{renglon:2,descripcion:'Pintura',cantidad:2,unidad:'CUBETA',notas:''},
      {renglon:3,descripcion:'Tubo conduit 3/4',cantidad:12,unidad:'PZA',notas:''}],
    aprobacion:null,propuesta:null,eventos:[{fecha:'2026-10-28 09:00',estado:'Solicitada',nombre:'Jesús',nota:'Manzanillo (TIMSA)'}],orden:null,avance:null,recepciones:[],hoy:'2026-10-28',
    esPropia:false,preparoPropuesta:false,puedeAprobar:true,puedeDevolver:true,puedeRechazar:true,puedeVisto:false,puedeRegresar:false};
  O.respuestas.getRequisicionOperaciones={ok:true,datos:VOPS};
  O.run("abrirOps('REQ-2026-0010')"); await esperar();
  assert(!O.$('opsVistaReq').classList.contains('oculto')&&O.$('opsVistaLista').classList.contains('oculto'));
  assert(/Manzanillo \(TIMSA\)/.test(O.$('opsInfo').innerHTML)&&/Para el 30\/10\/2026/.test(O.$('opsInfo').innerHTML));
  assert(/id="opsAp1"/.test(O.$('opsRenglones').innerHTML)&&/id="opsCant3"/.test(O.$('opsRenglones').innerHTML)&&/value="100"/.test(O.$('opsRenglones').innerHTML));
  assert(!O.$('opsAprobar').classList.contains('oculto')&&!O.$('btnOpsAprobar').classList.contains('oculto'));
  for(const n of [1,2,3]){O.$('opsAp'+n).value='si';O.$('opsCant'+n).value=String(VOPS.renglones[n-1].cantidad);O.$('opsCom'+n).value='';}
  O.$('opsAp2').value='no'; O.$('opsCant1').value='80'; O.$('opsPrioridad').value='Urgente';
  O.run('aprobarOps()'); await esperar();
  assert(/Escribe por qué no se compra/.test(O.$('aviso').innerHTML)&&!O.llamadas.some(c=>c.funcion==='aprobarRequisicion'));
  O.$('opsCom2').value='Ya hay en almacén';
  O.respuestas.aprobarRequisicion={ok:true,datos:{...VOPS,requisicion:{...VOPS.requisicion,estado:'Aprobada',prioridad:'Urgente'},puedeAprobar:false,puedeDevolver:false,
    renglones:VOPS.renglones.map((x,i)=>({...x,decision:i===1?'Rechazado':'Aprobado',cantidadAprobada:i===0?80:i===1?0:12,comentario:i===1?'Ya hay en almacén':''}))}};
  O.run('aprobarOps()'); await esperar();
  const apr=O.llamadas.find(c=>c.funcion==='aprobarRequisicion').args;
  assert.deepEqual(apr,['REQ-2026-0010',{prioridad:'Urgente',nota:'',renglones:[{renglon:1,aprobado:true,cantidad:'80',comentario:''},
    {renglon:2,aprobado:false,cantidad:'2',comentario:'Ya hay en almacén'},{renglon:3,aprobado:true,cantidad:'12',comentario:''}]}]);
  assert(/aprobada: pasa a compras/.test(O.$('aviso').innerHTML)&&/No se compra/.test(O.$('opsRenglones').innerHTML)&&/Aprobado: 80/.test(O.$('opsRenglones').innerHTML));
  assert(O.$('opsAprobar').classList.contains('oculto')===false&&O.$('btnOpsAprobar').classList.contains('oculto'),'ya no aprueba; aún puede rechazar');
  // Visto bueno sobre la propuesta (sustituto en negritas, no disponible sin costo, adicional que no se recibe)
  const PROPV={version:2,fecha:'2026-10-28 12:00:00',elaboroEmail:'tania@helgen.tech',elaboroNombre:'Tania Ibarra',recibe:'rosa@helgen.tech',
    proveedor:{razonSocial:'Ferretera del Puerto',rfc:'FPU010101AB1'},moneda:'MXN',ivaTasa:0.16,tipoCambio:'',fechaEntrega:'2026-10-30',lugarEntrega:'Manzanillo',
    condicionesPago:'Contado',diasCredito:0,notas:'',subtotal:1440,iva:230.4,total:1670.4,archivos:[{id:'ARCH1',nombre:'REQ-2026-0009 — Cotización de compras.pdf'}],
    renglones:[{renglon:1,disponibilidad:'Exacto',nota:'',recibir:true,clave:'',descripcion:'Cable THW 10',unidad:'M',cantidad:80,costo:8,importe:640},
      {renglon:3,disponibilidad:'Sustituto',nota:'No hay de 3/4',recibir:true,clave:'',descripcion:'Tubo conduit 1"',unidad:'PZA',cantidad:12,costo:50,importe:600},
      {renglon:0,disponibilidad:'Adicional',nota:'',recibir:false,clave:'',descripcion:'Flete',unidad:'SERV',cantidad:1,costo:200,importe:200}]};
  const VCOT={...VOPS,requisicion:{...VOPS.requisicion,folio:'REQ-2026-0009',estado:'Cotizada',prioridad:'Urgente'},propuesta:PROPV,
    renglones:VOPS.renglones.map((x,i)=>({...x,decision:i===1?'Rechazado':'Aprobado',cantidadAprobada:i===0?80:i===1?0:12})),
    puedeAprobar:false,puedeDevolver:false,puedeRechazar:true,puedeVisto:true,puedeRegresar:true};
  O.run('pintarOps('+JSON.stringify(VCOT)+')');
  assert(!O.$('opsModProp').classList.contains('oculto')&&!O.$('opsVisto').classList.contains('oculto')&&!O.$('btnOpsVisto').classList.contains('oculto'));
  assert(O.$('opsAprobar').classList.contains('oculto'),'en Cotizada rechazar va junto a la propuesta');
  const pvo=O.$('opsPropRenglones').innerHTML;
  assert(/Sustituto/.test(pvo)&&/<b>Tubo conduit 1&quot;<\/b>/.test(pvo)&&/No hay de 3\/4/.test(pvo)&&/Agregado por compras/.test(pvo)&&/No se recibe en sitio/.test(pvo)&&/\$640\.00 MXN/.test(pvo),pvo);
  assert(/versión 2/.test(O.$('opsPropTitulo').textContent)&&/\$1,670\.40 MXN/.test(O.$('opsPropTotales').innerHTML)&&/Ferretera del Puerto/.test(O.$('opsPropInfo').innerHTML));
  assert(/verArchivoReq\('REQ-2026-0009','ARCH1'\)/.test(O.$('opsPropArchivos').innerHTML),'cotización sin acceso a Drive');
  O.dialogos.confirmar=false; O.run('vistoBuenoOps()'); await esperar();
  assert(!O.llamadas.some(c=>c.funcion==='autorizarPropuesta')&&/Ferretera del Puerto por \$1,670\.40 MXN/.test(O.dialogos.vistos.at(-1)));
  O.dialogos.confirmar=true;
  O.respuestas.autorizarPropuesta={ok:true,datos:{folio:'REQ-2026-0009',ocFolio:'OC-2026-0012',vista:{...VCOT,requisicion:{...VCOT.requisicion,estado:'Autorizada'},puedeVisto:false,puedeRegresar:false,puedeRechazar:false,
    orden:{folio:'OC-2026-0012',fecha:'2026-10-28',estado:'Emitida',proveedor:'Ferretera del Puerto',total:1670.4,moneda:'MXN',fechaEntrega:'2026-10-30',lugarEntrega:'Manzanillo'},
    avance:[{renglon:1,descripcion:'Cable THW 10',unidad:'M',pedido:80,recibido:0,pendiente:80}]}}};
  const idVobo=O.run('ID_VOBO'); O.run('vistoBuenoOps()'); await esperar();
  assert.deepEqual(O.llamadas.find(c=>c.funcion==='autorizarPropuesta').args,['REQ-2026-0009',2,idVobo],'con la versión que vio');
  assert(/OC-2026-0012/.test(O.$('aviso').innerHTML)&&!O.$('opsModOrden').classList.contains('oculto')&&/Cable THW 10/.test(O.$('opsAvance').innerHTML));
  O.run('pintarOps('+JSON.stringify({...VCOT,preparoPropuesta:true,puedeVisto:false})+')');
  assert(/Tú preparaste la propuesta/.test(O.$('opsAviso').textContent)&&O.$('btnOpsVisto').classList.contains('oculto'));
  O.dialogos.prompt='El cable cuesta menos en otro lado';
  O.respuestas.regresarACompras={ok:true,datos:{...VCOT,requisicion:{...VCOT.requisicion,estado:'Aprobada',motivo:'El cable cuesta menos en otro lado'},puedeVisto:false,puedeRegresar:false}};
  O.run('regresarOps()'); await esperar();
  assert.deepEqual(O.llamadas.find(c=>c.funcion==='regresarACompras').args,['REQ-2026-0009','El cable cuesta menos en otro lado']);
  assert(/Regresada a compras:<\/b> El cable cuesta menos/.test(O.$('opsInfo').innerHTML));

  // Quien pide, con operaciones: sitio obligatorio, cotización opcional; ve lo que se compra y registra lo que llegó
  const MISQ=[{folio:'REQ-2026-0005',fecha:'2026-10-28',proyectoFolio:'PRY-2026-0002',proyectoVisible:'PRY-2026-0002-DRO',proyectoNombre:'DROGHEDA',estado:'Autorizada',
    motivo:'',notasRecepcion:'',solicitante:'Ana',sitio:'Manzanillo (TIMSA)',fechaRequerida:'2026-10-30',prioridad:'Urgente',
    renglones:[{renglon:1,descripcion:'Cable THW 10',cantidad:100,unidad:'M',notas:'',decision:'Aprobado',cantidadAprobada:80,comentario:''},
      {renglon:2,descripcion:'Pintura',cantidad:2,unidad:'CUBETA',notas:'',decision:'Rechazado',cantidadAprobada:0,comentario:'Ya hay en almacén'}],
    eventos:[],compra:[{renglon:1,disponibilidad:'Exacto',descripcion:'Cable THW 10',unidad:'M',cantidad:80,nota:'',recibir:true},
      {renglon:0,disponibilidad:'Adicional',descripcion:'Flete',unidad:'SERV',cantidad:1,nota:'',recibir:false}],
    avance:[{renglon:1,clave:'',descripcion:'Cable THW 10',unidad:'M',pedido:80,recibido:30,pendiente:50}],
    recepciones:[{folio:'REC-2026-0001',fecha:'2026-10-28',nombre:'Rosa',correo:'rosa@helgen.tech',sitio:'Manzanillo (TIMSA)',notas:'',estado:'Vigente',renglones:[{renglon:1,descripcion:'Cable THW 10',unidad:'M',cantidad:30}]}],
    recibe:'ana@helgen.tech',esReceptor:false,puedeEditar:false,puedeCancelar:false,puedeCerrar:false,puedeRecibir:true}];
  const Q=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[],marcas:{},sitios:SIT,
    permisos:{cobranza:false,desbloqueo:false,compras:false,requisicion:true,operaciones:false,flujoOperaciones:true}});
  Q.respuestas.listarProyectosRequisicion={ok:true,datos:[{folio:'PRY-2026-0002',folioVisible:'PRY-2026-0002-DRO',nombre:'DROGHEDA'}]};
  Q.respuestas.misRequisiciones={ok:true,datos:MISQ};
  await esperar(5);
  assert(Q.$('tabOps').classList.contains('oculto'),'sin rol de operaciones no ve la pestaña');
  Q.run("verTab('req')"); await esperar();
  assert(/Manzanillo \(TIMSA\)/.test(Q.$('reqSitio').innerHTML)&&/Elige el sitio/.test(Q.$('reqSitio').innerHTML)&&/\*$/.test(Q.$('reqLblSitio').textContent));
  assert(/\(opcional\)/.test(Q.$('reqLblArchivo').textContent)&&/Operaciones la revisa/.test(Q.$('reqNotaEnvio').textContent));
  assert.equal(Q.$('tabReq').textContent,'Requisiciones (1)','una por recibir');
  let ql=Q.$('reqLista').innerHTML;
  assert(/No se compra/.test(ql)&&/Ya hay en almacén/.test(ql)&&/Aprobado: 80/.test(ql)&&/Lo que se compra/.test(ql)&&/no se recibe en sitio/.test(ql)&&
    /REC-2026-0001/.test(ql)&&/<b>50<\/b>/.test(ql)&&/abrirRecepcion\('REQ-2026-0005'\)/.test(ql)&&!/recibiMaterial/.test(ql),ql);
  Q.$('reqFilas').hijos[0].querySelector('.desc').value='Antena GNSS'; Q.$('reqFilas').hijos[0].querySelector('.cant').value='2';
  Q.$('reqProyecto').value='PRY-2026-0002-DRO — DROGHEDA'; Q.$('reqArchivo').files=[];
  Q.$('reqSitio').value=''; Q.run('enviarRequisicion()'); await esperar();
  assert(/Elige el sitio/.test(Q.$('aviso').innerHTML)&&!Q.llamadas.some(c=>c.funcion==='guardarRequisicion'));
  Q.$('reqSitio').value='Querétaro'; Q.$('reqFecha').value='2026-11-02';
  Q.respuestas.guardarRequisicion={ok:true,datos:{folio:'REQ-2026-0011',requisiciones:MISQ}};
  Q.run('enviarRequisicion()'); await esperar(20);
  const gq=Q.llamadas.find(c=>c.funcion==='guardarRequisicion').args[0];
  assert.deepEqual([gq.proyectoFolio,gq.sitio,gq.fechaRequerida,gq.cotizacion],['PRY-2026-0002','Querétaro','2026-11-02',null],'sin cotización: la busca compras');
  assert(/Operaciones la revisará/.test(Q.$('aviso').innerHTML));
  // Registrar lo que llegó: por omisión lo que falta; la sincronización no borra el formulario abierto
  Q.run("abrirRecepcion('REQ-2026-0005')");
  const fq=Q.$('rcpCaja-REQ-2026-0005').innerHTML;
  assert(/id="rcp-REQ20260005C1"/.test(fq)&&/value="50"/.test(fq)&&/Manzanillo \(TIMSA\)/.test(fq)&&/capture="environment"/.test(fq),fq);
  Q.respuestas.sincronizar={ok:true,datos:{versiones:{requisiciones:9},permisos:{cobranza:false,desbloqueo:false,compras:false,requisicion:true,operaciones:false,flujoOperaciones:true},
    cambios:['requisiciones'],misReq:[]}};
  Q.run('sincronizarAhora()'); await esperar();
  assert(/REQ-2026-0005/.test(Q.$('reqLista').innerHTML),'con una recepción abierta no se repinta la lista');
  Q.$('rcp-REQ20260005C1').value='50'; Q.$('rcp-REQ20260005Sitio').value='Manzanillo (TIMSA)'; Q.$('rcp-REQ20260005Notas').value='';
  Q.$('rcp-REQ20260005Final').checked=false; Q.$('rcp-REQ20260005Foto').files=[{name:'remision.jpg',type:'image/jpeg',size:3000,b64:'/9j/'}];
  Q.respuestas.registrarRecepcion={ok:true,datos:{folio:'REC-2026-0002',completo:true,estado:'Recibida',requisiciones:[{...MISQ[0],estado:'Recibida',puedeRecibir:false}],vista:null}};
  Q.run("enviarRecepcion('rcp-REQ20260005')"); await esperar(20);
  const rq5=Q.llamadas.find(c=>c.funcion==='registrarRecepcion').args[0];
  assert.deepEqual([rq5.reqFolio,rq5.sitio,rq5.final,rq5.renglones,rq5.evidencia.datos],['REQ-2026-0005','Manzanillo (TIMSA)',false,[{renglon:1,cantidad:'50'}],'/9j/']);
  assert(/REC-2026-0002<\/b> registrada: todo recibido; falta el pago/.test(Q.$('aviso').innerHTML)&&!/abrirRecepcion/.test(Q.$('reqLista').innerHTML));
  assert.equal(Q.run('REC_ABIERTA'),null);

  // Compras, con operaciones: propuesta (no autoriza), separar renglones, recepción en su lugar y cancelar una recepción
  const K=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[],marcas:{},sitios:SIT,
    permisos:{cobranza:false,desbloqueo:false,compras:true,requisicion:false,operaciones:false,flujoOperaciones:true}});
  await esperar(5);
  const VK={requisicion:{folio:'REQ-2026-0010',fecha:'2026-10-28',proyectoFolio:'PRY-2026-0002',solicitanteEmail:'jesus@helgen.tech',solicitante:'Jesús',estado:'Aprobada',
      motivo:'',cotizacionId:'',cotizacionUrl:'',ocFolio:'',sitio:'Manzanillo (TIMSA)',fechaRequerida:'',prioridad:'Urgente',aprobacion:{nota:'Urge para el viernes'},propuesta:null,recibeEmail:''},
    flujoOperaciones:true,renglones:[{renglon:1,descripcion:'Cable THW 10',cantidad:100,unidad:'M',notas:'',decision:'Aprobado',cantidadAprobada:80},
      {renglon:2,descripcion:'Pintura',cantidad:2,unidad:'CUBETA',notas:'',decision:'Rechazado',cantidadAprobada:0,comentario:'Ya hay'},
      {renglon:3,descripcion:'Tubo conduit 3/4',cantidad:12,unidad:'PZA',notas:'',decision:'Aprobado',cantidadAprobada:12}],
    aprobados:[{renglon:1,descripcion:'Cable THW 10',unidad:'M',notas:'',cantidad:80,pedida:100},{renglon:3,descripcion:'Tubo conduit 3/4',unidad:'PZA',notas:'',cantidad:12,pedida:12}],
    eventos:[],proyecto:{folio:'PRY-2026-0002',folioVisible:'PRY-2026-0002-DRO',nombre:'DROGHEDA',cliente:'Helgen',estado:'Activo',ubicacion:'Querétaro'},
    moneda:'MXN',marca:'',sinContrato:true,orden:null,pagos:[],facturas:[],totalFacturado:0,facturaCompleta:false,puedeFacturar:false,proveedores:[],ivaTasas:[0.16,0.08,0],
    metodos:['Transferencia'],hoy:'2026-10-28',sitios:SIT,receptores:['jesus@helgen.tech','rosa@helgen.tech'],avance:null,recepcionCompleta:false,recepciones:[],
    puedeAutorizar:false,puedeRevisar:false,puedeCotizar:true,puedeDevolver:true,puedeSeparar:true,puedePagar:false,puedeCancelarPago:false,puedeCerrar:false,
    puedeRecibir:false,puedeCancelarRecepcion:false};
  K.run('pintarReqCom('+JSON.stringify(VK)+')');
  assert(!K.$('comModOc').classList.contains('oculto')&&/Propuesta de compra/.test(K.$('ocTitulo').textContent)&&!K.$('propExtra').classList.contains('oculto'));
  assert(K.$('rcRevision').classList.contains('oculto')&&!K.$('rcFlujo').classList.contains('oculto'),'no autoriza ni rechaza; pide aclarar y separa');
  assert(/<th>Operaciones<\/th>/.test(K.$('rcRenglonesEnc').innerHTML)&&/No se compra/.test(K.$('rcRenglones').innerHTML)&&/Urge para el viernes/.test(K.$('rcInfo').innerHTML));
  assert(/Sin cotización de quien pidió/.test(K.$('rcCotLink').textContent));
  assert(/jesus@helgen.tech \(pidió\)/.test(K.$('propRecibe').innerHTML)&&K.$('propRecibe').value==='jesus@helgen.tech');
  assert.equal(K.$('btnOc').textContent,'Mandar la propuesta a operaciones');
  const fk=K.$('ocFilas').hijos;
  assert.equal(fk.length,2,'un renglón por renglón aprobado');
  assert.deepEqual([fk[0]._renglon,fk[0].querySelector('.disp').value,fk[0].querySelector('.cant').value,fk[1].querySelector('.desc').value],[1,'Exacto',80,'Tubo conduit 3/4']);
  fk[0].querySelector('.costo').value='8';
  fk[1].querySelector('.disp').value='Sustituto'; fk[1].querySelector('.disp').disparar('change'); fk[1].querySelector('.desc').value='Tubo conduit 1"'; fk[1].querySelector('.costo').value='50';
  fk[1].querySelector('.nota-r').value='No hay de 3/4';
  K.run('agregarRenglonOc()');
  const fa=K.$('ocFilas').hijos[2];
  assert.equal(fa._renglon,0); assert.equal(fa.querySelector('.recibir').checked,true,'un adicional se recibe por omisión');
  fa.querySelector('.desc').value='Flete'; fa.querySelector('.uni').value='SERV'; fa.querySelector('.cant').value='1'; fa.querySelector('.costo').value='200'; fa.querySelector('.recibir').checked=false;
  K.$('prvRazon').value='Ferretera del Puerto'; K.$('ocEntrega').value='2026-10-30'; K.$('ocDias').value='0'; K.$('ocCondiciones').value='Contado'; K.$('propRecibe').value='rosa@helgen.tech';
  K.$('propArchivo').files=[];
  K.respuestas.cotizarRequisicion=c=>({ok:true,datos:{folio:'REQ-2026-0010',version:1,vista:{...VK,requisicion:{...VK.requisicion,estado:'Cotizada',
    propuesta:{...PROPV,version:1,elaboroNombre:'Pedro Ruiz',archivos:[{id:'A9',url:'https://drive/file/A9',nombre:'Cotización de compras.pdf'}]}}}}});
  K.run('guardarOc()'); await esperar(20);
  const ck=K.llamadas.find(c=>c.funcion==='cotizarRequisicion').args;
  assert.equal(ck[0],'REQ-2026-0010');
  assert.deepEqual(ck[1].renglones.map(r=>[r.renglon,r.disponibilidad,r.descripcion,r.cantidad,r.costo,r.recibir,r.nota]),
    [[1,'Exacto','Cable THW 10',80,'8',true,''],[3,'Sustituto','Tubo conduit 1"',12,'50',true,'No hay de 3/4'],[0,'Adicional','Flete',1,'200',false,'']]);
  assert.deepEqual([ck[1].recibe,ck[1].proveedor.razonSocial,ck[1].cotizacion],['rosa@helgen.tech','Ferretera del Puerto',null]);
  assert(/enviada a operaciones/.test(K.$('aviso').innerHTML)&&/espera el visto bueno/.test(K.$('propEstado').innerHTML)&&/Cotización de compras\.pdf/.test(K.$('propEstado').innerHTML));
  assert.equal(K.$('btnOc').textContent,'Corregir la propuesta (versión 2)');
  // Separar renglones
  K.dialogos.prompt=['3','Lo vende otro proveedor'];
  K.respuestas.separarRequisicion={ok:true,datos:{folio:'REQ-2026-0012',vista:VK}};
  K.run('separarReqCom()'); await esperar();
  assert.deepEqual(K.llamadas.find(c=>c.funcion==='separarRequisicion').args,['REQ-2026-0010',[3],'Lo vende otro proveedor']);
  assert(/REQ-2026-0012/.test(K.$('aviso').innerHTML));
  // Recepción: avance, registrar en su lugar (con notas) y cancelar una equivocada
  const VKA={...VK,requisicion:{...VK.requisicion,estado:'Pagada',ocFolio:'OC-2026-0012',recibeEmail:'rosa@helgen.tech'},puedeCotizar:false,puedeDevolver:false,puedeSeparar:false,
    orden:{folio:'OC-2026-0012',fecha:'2026-10-28',estado:'Pagada',proveedor:'Ferretera del Puerto',total:1670.4,moneda:'MXN',condicionesPago:'Contado',diasCredito:0,fechaEntrega:'2026-10-30',lugarEntrega:'Manzanillo'},
    avance:[{renglon:1,clave:'',descripcion:'Cable THW 10',unidad:'M',pedido:80,recibido:50,pendiente:30},{renglon:2,clave:'',descripcion:'Tubo conduit 1"',unidad:'PZA',pedido:12,recibido:12,pendiente:0}],
    recepciones:[{folio:'REC-2026-0003',fecha:'2026-10-28',nombre:'Rosa',sitio:'Manzanillo (TIMSA)',notas:'',estado:'Vigente',evidenciaUrl:'https://drive/file/F1',
      renglones:[{renglon:1,descripcion:'Cable THW 10',unidad:'M',cantidad:50}]}],puedeRecibir:true,puedeCancelarRecepcion:true,puedeCerrar:true};
  K.run('pintarReqCom('+JSON.stringify(VKA)+')');
  assert(K.$('comModOc').classList.contains('oculto')&&!K.$('rcRecepcion').classList.contains('oculto'));
  let av=K.$('rcAvance').innerHTML;
  assert(/REC-2026-0003/.test(av)&&/Foto/.test(av)&&/cancelarRecepcionCom\('REC-2026-0003'\)/.test(av)&&/abrirRecepcionCom\(\)/.test(av)&&/Recibe: rosa@helgen.tech/.test(av),av);
  assert(!/cancelarOcDesdeReq/.test(K.$('rcOrden').innerHTML),'con material recibido no se ofrece cancelar la orden');
  K.run('abrirRecepcionCom()');
  assert(/en lugar de quien la recibe/.test(K.$('rcRecibirForm').innerHTML)&&/id="rcpComC1"/.test(K.$('rcRecibirForm').innerHTML)&&!/id="rcpComC2"/.test(K.$('rcRecibirForm').innerHTML));
  assert(!/abrirRecepcionCom\(\)/.test(K.$('rcAvance').innerHTML),'con el formulario abierto no se repite el botón');
  K.dialogos.prompt='Se registró en el sitio equivocado';
  K.respuestas.cancelarRecepcion={ok:true,datos:{...VKA,recepciones:[{...VKA.recepciones[0],estado:'Cancelado',motivoCancelacion:'Se registró en el sitio equivocado'}]}};
  K.run("cancelarRecepcionCom('REC-2026-0003')"); await esperar();
  assert.deepEqual(K.llamadas.find(c=>c.funcion==='cancelarRecepcion').args,['REC-2026-0003','Se registró en el sitio equivocado']);
  assert(/<s>/.test(K.$('rcAvance').innerHTML)&&/cancelada: Se registró en el sitio equivocado/.test(K.$('rcAvance').innerHTML));
  console.log('OK interfaz');
})().catch(e=>{console.error(e);process.exit(1)});
