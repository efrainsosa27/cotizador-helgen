// Interfaz (web/cotizador/index.html): corre la capa api-web y el script de la app con un DOM y un fetch simulados.
// Cubre: si el servidor rechaza el proyecto (codigo PROYECTO), se limpia el campo, se refresca la lista y se avisa;
// moneda USD (el catálogo no pone precio); pestaña Cobranza solo con permiso; aceptar con confirmación; pago con comprobante.
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
function montar(datosIniciales){
  function elemento(tag){const e={tag,value:'',textContent:'',innerHTML:'',className:'',title:'',src:'',placeholder:'',disabled:false,hijos:[],oyentes:{},
   _clases:new Set(),porClase:{},
   classList:{add:c=>e._clases.add(c),remove:c=>e._clases.delete(c),contains:c=>e._clases.has(c),toggle:(c,f)=>f?e._clases.add(c):e._clases.delete(c)},
   addEventListener:(t,f)=>(e.oyentes[t]=e.oyentes[t]||[]).push(f),
   disparar:t=>(e.oyentes[t]||[]).forEach(f=>f({target:e})),
   focus(){},remove(){},appendChild:h=>e.hijos.push(h),
   querySelector:sel=>e.porClase[sel]||(e.porClase[sel]=elemento('input')),
   querySelectorAll:sel=>sel==='tr'?e.hijos:sel==='input'?Object.values(e.porClase):[]};return e}
  const porId={};
  const document={getElementById:id=>porId[id]||(porId[id]=elemento('div')),
   querySelector:()=>({src:'data:logo'}),createElement:t=>elemento(t)};
  document.getElementById('login').classList.add('oculto');
  document.getElementById('tabCob').classList.add('oculto'); // como en el HTML
  const almacen={cotizadorHelgenSesion:token};
  const llamadas=[], respuestas={getDatosIniciales:{ok:true,datos:datosIniciales}};
  async function fetch(url,opts){const c=JSON.parse(opts.body);llamadas.push(c);
   const r=respuestas[c.funcion];const datos=typeof r==='function'?r(c):r;
   return{ok:true,json:async()=>datos||{ok:false,error:'sin respuesta simulada: '+c.funcion}}}
  const dialogos={confirmar:true,prompt:null,vistos:[]};
  class FileReader{readAsDataURL(f){this.result='data:'+f.type+';base64,'+f.b64;setImmediate(()=>this.onload())}}
  const ctx={document,fetch,console,JSON,Date,Math,Number,String,Array,Object,Promise,Proxy,Error,Uint8Array,TextDecoder,FileReader,
   atob:s=>Buffer.from(s,'base64').toString('binary'),crypto:{randomUUID:()=>'id-'+Math.random()},
   sessionStorage:{getItem:k=>almacen[k]??null,setItem:(k,v)=>almacen[k]=v,removeItem:k=>delete almacen[k]},
   confirm:m=>{dialogos.vistos.push(m);return dialogos.confirmar},prompt:m=>{dialogos.vistos.push(m);return dialogos.prompt},
   setTimeout,clearTimeout,scrollTo(){}};
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(apiWeb,ctx); vm.runInContext(app,ctx);
  return {ctx,$:id=>document.getElementById(id),llamadas,respuestas,dialogos,run:c=>vm.runInContext(c,ctx)};
}
const esperar=async(n=10)=>{for(let i=0;i<n;i++) await new Promise(r=>setImmediate(r))};

(async()=>{
  // ===== Vendedora (sin rol de cobranza) =====
  const A=montar({ivaTasa:0.16,catalogo:CAT,tipoCambio:TC,clientes:[],proyectos:[PRY],marcas:{},permisos:{cobranza:false,desbloqueo:false}});
  const {$,llamadas,respuestas}=A;
  await esperar(5);
  assert.equal(A.run('PROYECTOS.length'),1,'carga los proyectos activos');
  assert($('tabCob').classList.contains('oculto'),'sin permiso no ve la pestaña Cobranza');

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
  B.respuestas.listarProyectosCobranza={ok:true,datos:[{...PRY,contrato:''}]};
  B.run("verTab('cob')"); await esperar();
  assert(/PRY-2026-0001 — Luis — Solar MX — Techo/.test(B.$('cobProyectosList').innerHTML)&&/Sin aceptada/.test(B.$('cobProyectosList').innerHTML));
  const cots=[{folio:'HLG-2026-0010',fecha:'20/10/2026',marca:'helgen',moneda:'MXN',subtotal:1000,total:1160,pdf:'p'},
              {folio:'HLG-2026-0011',fecha:'20/10/2026',marca:'energy',moneda:'MXN',subtotal:2000,total:2320,pdf:'p'}];
  const vista=(extra)=>({proyecto:PRY,cotizaciones:cots,contrato:null,esquema:[],resumen:null,pagos:[],esquemaEditable:false,
    puedePagar:false,puedeDesbloquear:false,metodos:['Transferencia','Efectivo','Cheque'],hoy:'2026-10-20',...extra});
  B.respuestas.getCobranzaProyecto={ok:true,datos:vista()};
  B.$('cobProyecto').value='PRY-2026-0001 — Luis — Solar MX — Techo'; B.$('cobProyecto').disparar('change'); await esperar();
  assert.equal(B.llamadas.find(c=>c.funcion==='getCobranzaProyecto').args[0],'PRY-2026-0001');
  assert((B.$('cobCots').innerHTML.match(/Marcar aceptada/g)||[]).length===2);
  assert(B.$('cobModEsquema').classList.contains('oculto')&&B.$('cobModPagos').classList.contains('oculto'),'sin aceptada no hay esquema ni pagos');

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
  console.log('OK interfaz');
})().catch(e=>{console.error(e);process.exit(1)});
