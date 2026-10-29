// Incremento 4 · módulo B (correos y proveedores). Avisos por correo en cada relevo de una requisición: a quién va cada uno
// (con delegaciones y super admin), nunca a quien hizo el cambio, nunca montos, proveedores ni folio de orden; bitácora Correos;
// una falla o la cuota agotada no deshacen el cambio. Eventos de otros módulos (alta, delegación, anulado, en camino, centro de
// mando). Flujo de siempre (sin aprobaciones). Solicitud de cotización en PDF (rol, solo renglones aprobados, sin cliente,
// proyecto ni precios, dirección del sitio, archivo privado, no cambia la requisición), ligas de Gmail y mailto: con tope de
// largo (y la copia de la interfaz), PDF de la orden para el proveedor, listarCorreos solo super admin, preparar() y la interfaz
// (caja de solicitud, envío de la orden, botón en la lista de órdenes y bitácora en Administración).
// Uso: node tests/correos.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';
const PROPS = { ROL_COBRANZA: 'efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech',
  ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech, tania@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, pedro@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech' };
const A = require('./arnes')(dir, { props: PROPS });
const { P, ok, falla, plain, props, HOY_ISO, masDias, ANIO, como, conFotos, FOTOS } = A;
const REQ = n => 'REQ-' + ANIO + '-' + n, OC = n => 'OC-' + ANIO + '-' + n;
const fmx = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const MANANA = masDias(1);
const URL_APP = 'https://cotizador-helgen.cotizador-helgen.workers.dev/cotizador/';

// Sitios con dirección (tercer campo, opcional) y libro de Administración (bitácora Correos)
A.libros.DB.pest.Config.m.push(['SITIOS', 'QRO | Querétaro\nZLO | Manzanillo (TIMSA) | Av. del Puerto 123, Manzanillo, Col.\nVER | Veracruz (ICAVE)']);
P.prepararCapri(); // SUPER_ADMIN = leo (no tiene aprobaciones ni compras en su fila: no recibe esos avisos); el arnés no tiene getEffectiveUser: preparar no manda prueba
assert.equal(A.correos.length, 0);
const LA = A.libros[props.ADMIN_DB_ID];
const log = () => LA.pest.Correos.m;
const ultimoLog = () => log()[log().length - 1];

let visto = 0;
const nuevos = () => { const l = A.correos.slice(visto); visto = A.correos.length; return l; };
const para = m => m.to.split(',').sort();
const porPara = (l, correo) => l.find(m => m.to.split(',').indexOf(correo) !== -1);
// Nada sensible en ningún correo: montos, proveedor, folio de orden, cliente; y nunca a quien hizo el cambio
const PROHIBIDO = [/Ferretera/i, /\$\s?\d/, /1,?856/, /1,?670/, /OC-\d{4}-\d{4}/, /Cliente Secreto/, /Empresa Oculta/, /98,?765/, /5,?000/];
function revisarCorreo(m) {
  const t = [m.subject, m.htmlBody, m.body].join('\n');
  PROHIBIDO.forEach(re => assert(!re.test(t), 'el correo "' + m.subject + '" no debe tener ' + re + ':\n' + t));
  assert.equal(m.name, 'CAPRI Helgen');
  if (m.replyTo) assert(para(m).indexOf(m.replyTo) === -1, 'nadie recibe aviso de lo que él hizo: ' + m.subject);
  para(m).forEach(c => assert(/@helgen\.(tech|services)$/.test(c), 'solo cuentas de CAPRI: ' + c));
}

// ================= Lógica pura =================
assert.equal(P.folioReqDeDatos({ req: 'req-2026-0005' }), 'REQ-2026-0005');
assert.equal(P.folioReqDeDatos({ req: { folio: 'REQ-2026-0007' } }), 'REQ-2026-0007');
assert.equal(P.folioReqDeDatos({ folio: 'REQ-2026-0009' }), 'REQ-2026-0009');
assert.equal(P.folioReqDeDatos({ folio: 'OC-2026-0001' }), '');
assert.equal(P.folioDeAviso({ oc: 'OC-2026-0001' }), 'OC-2026-0001');
assert.equal(P.limpiarTextoAviso('Ferretera del Puerto cobra $1,856.00 (o 1500 MXN, 300 dólares); ver OC-2026-0012', ['ferretera del puerto']),
  '[proveedor] cobra [monto] (o [monto], [monto]); ver la orden de compra');
assert.equal(P.limpiarTextoAviso('  Faltan   30 m  ', []), 'Faltan 30 m', 'cantidades sin moneda se quedan');
assert.equal(P.limpiarTextoAviso(null), '');
assert.equal(P.fechaCorreo('2026-11-05'), '05/11/2026');
const ROLES = { aprobaciones: ['adri@helgen.tech', 'obrero@helgen.tech'], compras: ['efrain@helgen.tech', 'pedro@helgen.tech'] };
const INFO = { solicitanteEmail: 'obrero@helgen.tech', recibeEmail: 'rosa@helgen.tech', revisoEmail: 'adri@helgen.tech', flujo: true,
  elaboroPropuesta: 'pedro@helgen.tech', actorCorreo: 'pedro@helgen.tech' };
const D = (t, d, i) => plain(P.destinatariosAviso(t, d || {}, Object.assign({}, INFO, i || {}), ROLES));
assert.deepEqual(D('req.solicitada'), [{ quien: 'aprobaciones', para: ['adri@helgen.tech'] }], 'quien pidió no se aprueba');
assert.deepEqual(D('req.solicitada', {}, { flujo: false }), [{ quien: 'compras', para: ['efrain@helgen.tech', 'pedro@helgen.tech'] }]);
assert.deepEqual(D('req.autorizada').map(g => g.quien), ['solicitante', 'recibe', 'compras']);
assert.deepEqual(D('req.recibida').map(g => g.quien), ['compras', 'solicitante', 'recibe'], 'registrada en su lugar');
assert.deepEqual(D('req.recibida', {}, { actorCorreo: 'rosa@helgen.tech' }).map(g => g.quien), ['compras']);
assert.deepEqual(D('req.recibida', {}, { actorCorreo: '' }).map(g => g.quien), ['compras'], 'centro de mando (sin sesión)');
assert.deepEqual(D('req.cancelada', { antes: 'Devuelta' }), [{ quien: 'revisor', para: ['adri@helgen.tech'] }]);
assert.deepEqual(D('req.cancelada', { antes: 'Solicitada' }), [{ quien: 'revisor', para: ['adri@helgen.tech'] }]);
assert.deepEqual(D('req.cotizada'), [{ quien: 'aprobaciones', para: ['adri@helgen.tech'] }]);
assert.deepEqual(D('anulado', { para: 'a@helgen.tech; b@helgen.tech' }), [{ quien: 'involucrado', para: ['a@helgen.tech', 'b@helgen.tech'] }]);
assert.deepEqual(D('oc.cancelada', {}, { solicitanteEmail: '' }).map(g => g.quien), ['compras'], 'orden sin requisición');
const C = P.contenidoAviso('req.solicitada', 'aprobaciones', { folio: 'REQ-2026-0005', proyectoNombre: 'DROGHEDA', proyectoVisible: 'PRY-2026-0002-DRO',
  sitio: 'Manzanillo (TIMSA)', solicitante: 'Juan Obrero', actorNombre: 'Juan Obrero', actorCorreo: 'obrero@helgen.tech', fecha: '2026-10-28 10:00:00' });
assert.equal(C.asunto, '[CAPRI] REQ-2026-0005 · Por aprobar · DROGHEDA · Manzanillo (TIMSA)');
assert.equal(C.boton.url, URL_APP + '#req=REQ-2026-0005');
assert.deepEqual(plain(C.filas.map(f => f[0])), ['Proyecto', 'Sitio', 'Pidió', 'Lo hizo', 'Cuándo'], 'sin filas vacías');
assert(/<a href="https:\/\/cotizador-helgen[^"]*#req=REQ-2026-0005"/.test(P.construirHtmlAviso(C)));
assert(!/<script/i.test(P.construirHtmlAviso(Object.assign({}, C, { nota: '<script>x</script>' }))), 'la nota va escapada');
// Revisión de seguridad: el texto libre de una nota nunca va en el correo (montos, proveedores y folios que no detecta un filtro)
const fuga = 'Ferreteria Lopez cotizo 15,000 + IVA (USD 820); con Grupo Acme sale en 12 mil pesos. OC 2026-0004';
for (const [tipo, quien] of [['req.devuelta', 'solicitante'], ['req.rechazada', 'solicitante'], ['req.recibida', 'compras'], ['req.cancelada', 'aprobaciones']]) {
  const x = P.contenidoAviso(tipo, quien, { folio: 'REQ-2026-0001', nota: fuga });
  const todo = P.textoAviso(x) + P.construirHtmlAviso(x);
  assert(!/Lopez|Acme|15,000|820|12 mil|2026-0004/.test(todo) && /ábrela en CAPRI/.test(todo), tipo);
}
assert(/Abrir REQ-2026-0005 en CAPRI: https:/.test(P.textoAviso(C)));

// Ligas de correo: tope de largo con acentos y muchas partidas
const largas = Array.from({ length: 60 }, (_, i) => (i + 1) + '. 10 PZA · Conector coaxial tipo N macho para cable LMR-400 (ñ, á, é) ' + i);
const CASOS = [
  ['ventas@x.mx', 'Solicitud de cotización · Helgen · REQ-2026-0001', { inicio: ['Buenos días:', ''], lista: largas, fin: ['', 'Saludos,', 'Pedro'] }],
  ['', 'Orden de compra', { inicio: ['a'], lista: ['1. b'], fin: ['c'] }],
  ['x@y.mx', 'Largo', { inicio: ['x'.repeat(3000)], lista: ['1. algo'], fin: ['fin'] }],
];
const c0 = P.correoConLigas(...CASOS[0]);
assert(c0.recortado && c0.gmail.length <= 1800 && c0.mailto.length <= 1800, 'cabe en ~1,800 caracteres');
assert(/\n… y \d+ partida\(s\) más: ver el PDF adjunto\.\n/.test(c0.cuerpo), c0.cuerpo);
assert(/^1\. 10 PZA/m.test(c0.cuerpo) && /Saludos,\nPedro$/.test(c0.cuerpo), 'empieza la lista y conserva la firma');
assert(c0.gmail.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=ventas%40x.mx&su=Solicitud%20de%20cotizaci%C3%B3n'));
assert(c0.mailto.startsWith('mailto:ventas@x.mx?subject=') && /%0D%0A/.test(c0.mailto));
const c1 = P.correoConLigas(...CASOS[1]);
assert.deepEqual(plain(c1), { para: '', asunto: 'Orden de compra', cuerpo: 'a\n1. b\nc', recortado: false,
  gmail: 'https://mail.google.com/mail/?view=cm&fs=1&to=&su=Orden%20de%20compra&body=a%0A1.%20b%0Ac',
  mailto: 'mailto:?subject=Orden%20de%20compra&body=a%0D%0A1.%20b%0D%0Ac' });
const c2 = P.correoConLigas(...CASOS[2]);
assert(c2.recortado && c2.gmail.length <= 1800 && c2.mailto.length <= 1800 && c2.cuerpo.endsWith('… ver el PDF adjunto.'));

// La interfaz tiene una copia idéntica (rehace las ligas si se cambia el correo)
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
const modCorreos = scripts.find(s => s.id === 'mod-correos').src;
const sinSangria = s => s.split('\n').map(l => l.trim()).join('\n');
const fuente = (src, nombre) => { const i = src.indexOf('function ' + nombre + '('); const j = src.indexOf('\n}', src.indexOf('\n', i)) ;
  return src.slice(i, j); };
const deServidor = sinSangria(fuente(fs.readFileSync(path.join(dir, 'Code.js'), 'utf8'), 'correoConLigas'));
const iUi = modCorreos.indexOf('function correoConLigas(');
const deUi = sinSangria(modCorreos.slice(iUi, modCorreos.indexOf('\n    }\n', iUi)));
assert.equal(deUi, deServidor, 'correoConLigas de la interfaz = la de Code.js');

// ================= Avisos de cada relevo (flujo con aprobaciones) =================
const p1 = ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', ubicacion: 'Manzanillo, Col.', cliente: { nombre: 'Cliente Secreto', empresa: 'Empresa Oculta SA' },
  idSolicitud: 'p1' }).folio;
ok('ana', 'guardarCotizacion', { cliente: { nombre: 'Cliente Secreto', empresa: 'Empresa Oculta SA' }, items: [{ descripcion: 'Servicio', cantidad: 1, precio: 98765 }],
  proyectoFolio: p1, idSolicitud: 'c1' });
assert.equal(nuevos().length, 0, 'cotizar no manda avisos');
// Delegación: tania deja compras a ana hoy (los dos reciben los avisos de compras)
LA.pest.Delegaciones.m.push(['DEL-1', 'tania@helgen.tech', 'ana@helgen.tech', "'" + HOY_ISO, "'" + masDias(3), 'compras', 'Activa', 'tania@helgen.tech', '']);
P.subirVersiones_(['permisos']);
const COMPRAS = ['ana@helgen.tech', 'efrain@helgen.tech', 'pedro@helgen.tech', 'tania@helgen.tech'];
const sinQuien = (l, x) => l.filter(c => c !== x);

let n = 0;
const nuevaReq = extra => Object.assign({ proyectoFolio: p1, sitio: 'Manzanillo (TIMSA)', fechaRequerida: masDias(5),
  renglones: [{ descripcion: 'Cable THW 10', cantidad: 100, unidad: 'm', notas: 'Para la caseta norte' }, { descripcion: 'Pintura', cantidad: 2, unidad: 'cubeta' },
    { descripcion: 'Tubo conduit 3/4', cantidad: 12, unidad: 'pza' }], idSolicitud: 'q' + (++n) }, extra || {});

// Nueva → aprobaciones (adri; el super admin leo no tiene aprobaciones en su fila: no le llegan esos avisos), menos quien pidió
const r1 = ok('obrero', 'guardarRequisicion', nuevaReq()).folio;
let m = nuevos();
assert.equal(m.length, 1);
assert.deepEqual(para(m[0]), ['adri@helgen.tech']);
assert.equal(m[0].subject, '[CAPRI] ' + r1 + ' · Por aprobar · DROGHEDA · Manzanillo (TIMSA)');
assert.equal(m[0].replyTo, 'obrero@helgen.tech', 'Reply-To = quien hizo el cambio');
assert(m[0].htmlBody.indexOf(URL_APP + '#req=' + r1) !== -1 && /Pidió: Juan Obrero/.test(m[0].body) && /Se necesita: /.test(m[0].body));
assert.deepEqual(ultimoLog().slice(1), ['adri@helgen.tech', m[0].subject, 'req.solicitada', r1, 'Enviado', '', 'obrero@helgen.tech']);
assert(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(ultimoLog()[0]), 'fecha como texto: ' + ultimoLog()[0]);

// Aprobada → compras (con la delegada ana), con la nota de aprobaciones sin montos
ok('adri', 'aprobarRequisicion', r1, { version: 1, prioridad: 'Urgente', nota: 'Urgente, presupuesto de $5,000 MXN',
  renglones: [{ renglon: 1, aprobado: true, cantidad: 80 }, { renglon: 2, aprobado: false, comentario: 'Ya hay en almacén' }, { renglon: 3, aprobado: true }] });
m = nuevos();
assert.equal(m.length, 1);
assert.deepEqual(para(m[0]), COMPRAS, 'compras + delegada + super admin');
assert(/ · Aprobada, por cotizar · /.test(m[0].subject) && /Nota: Hay una nota: ábrela en CAPRI/.test(m[0].body) && !/Urgente, presupuesto|5,000/.test(m[0].body) && /Prioridad: Urgente/.test(m[0].body));

// Compras pide aclaración → quien pidió; reenvío → aprobaciones ("Corregida")
ok('pedro', 'devolverRequisicion', r1, '¿El cable es THW o THHW?');
m = nuevos();
assert.deepEqual([m.length, para(m[0]), m[0].replyTo], [1, ['obrero@helgen.tech'], 'pedro@helgen.tech']);
assert(/ · Devuelta para corregir · /.test(m[0].subject) && /Nota: Hay una nota: ábrela en CAPRI/.test(m[0].body) && !/THHW/.test(m[0].body));
ok('obrero', 'guardarRequisicion', nuevaReq({ folio: r1 }));
m = nuevos();
assert(/ · Corregida, por aprobar · /.test(m[0].subject) && para(m[0]).join() === 'adri@helgen.tech');
ok('adri', 'aprobarRequisicion', r1, { version: 2, prioridad: 'Urgente',
  renglones: [{ renglon: 1, aprobado: true, cantidad: 80 }, { renglon: 2, aprobado: false, comentario: 'Ya hay en almacén' }, { renglon: 3, aprobado: true }] });
nuevos();

// Propuesta → aprobaciones (menos quien la preparó); regresada → compras con la nota limpia
const PROP = extra => Object.assign({ proveedor: { razonSocial: 'Ferretera del Puerto', rfc: '', correo: 'ventas@ferreteria.mx' }, fechaEntrega: MANANA,
  condicionesPago: 'Contado', diasCredito: 0, recibe: 'rosa@helgen.tech',
  renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 3, disponibilidad: 'Sustituto', descripcion: 'Tubo conduit 1"', costo: 50 },
    { renglon: 0, disponibilidad: 'Adicional', descripcion: 'Flete', unidad: 'SERV', cantidad: 1, costo: 200, recibir: false }], idSolicitud: 'pp' + (++n) }, extra || {});
ok('pedro', 'cotizarRequisicion', r1, PROP());
m = nuevos();
assert.deepEqual([m.length, para(m[0])], [1, ['adri@helgen.tech']]);
assert(/ · Propuesta por revisar · /.test(m[0].subject));
ok('adri', 'regresarACompras', r1, 'Ferretera del Puerto cobra $1,856.00 por todo; busca otro');
m = nuevos();
assert.deepEqual(para(m[0]), sinQuien(COMPRAS, 'adri@helgen.tech'));
assert(/ · Propuesta regresada · /.test(m[0].subject) && /Nota: Hay una nota: ábrela en CAPRI/.test(m[0].body) && !/busca otro/.test(m[0].body), m[0].body);
ok('pedro', 'cotizarRequisicion', r1, PROP());
m = nuevos();
assert(/versión 2/.test(m[0].body));

// Visto bueno → quien pidió, quien recibe (con la entrega esperada) y compras; nunca el folio de la orden
const huella = ok('adri', 'getRequisicionOperaciones', r1).propuesta.huella;
const oc1 = ok('adri', 'autorizarPropuesta', r1, 2, 'vb1', huella).ocFolio;
assert.equal(oc1, OC('0001'));
m = nuevos();
assert.equal(m.length, 3);
const aObrero = porPara(m, 'obrero@helgen.tech'), aRosa = porPara(m, 'rosa@helgen.tech'), aCompras = porPara(m, 'pedro@helgen.tech');
assert.deepEqual([para(aObrero), para(aRosa), para(aCompras)], [['obrero@helgen.tech'], ['rosa@helgen.tech'], sinQuien(COMPRAS, 'adri@helgen.tech')]);
assert(/ · Autorizada · /.test(aObrero.subject) && aObrero.body.indexOf('Entrega esperada: ' + fmx(MANANA)) !== -1 && /Lo recibe /.test(aObrero.body));
assert(/ · Material por recibir · /.test(aRosa.subject) && /Tú recibes el material en Manzanillo \(TIMSA\)/.test(aRosa.body));
assert(/ · Autorizada, enviar orden · /.test(aCompras.subject) && /Enviar orden al proveedor/.test(aCompras.body));

// Recepción parcial por quien recibe → compras; el resto lo registra compras en su lugar → compras, quien pidió y quien recibe
ok('rosa', 'registrarRecepcion', { reqFolio: r1, sitio: 'Manzanillo (TIMSA)', renglones: conFotos([{ renglon: 1, cantidad: 50 }]), notas: 'Faltan 30 m', idSolicitud: 'rc1' });
m = nuevos();
assert.deepEqual([m.length, para(m[0])], [1, COMPRAS]);
assert(/ · Recepción parcial · /.test(m[0].subject) && /Nota: Hay una nota: ábrela en CAPRI/.test(m[0].body) && !/Faltan 30/.test(m[0].body) && /recepción parcial del material en Manzanillo/.test(m[0].body));
ok('pedro', 'registrarRecepcion', { reqFolio: r1, sitio: 'Manzanillo (TIMSA)', renglones: conFotos([{ renglon: 1, cantidad: 30 }, { renglon: 2, cantidad: 12 }]),
  notas: 'Llegó al almacén de compras', idSolicitud: 'rc2' });
m = nuevos();
assert.equal(m.length, 3);
assert.deepEqual(para(porPara(m, 'efrain@helgen.tech')), sinQuien(COMPRAS, 'pedro@helgen.tech'));
assert(/Falta registrar el pago/.test(porPara(m, 'efrain@helgen.tech').body));
assert(/ · Recepción registrada · /.test(porPara(m, 'obrero@helgen.tech').subject) && porPara(m, 'rosa@helgen.tech'));

// Una falla al mandar no deshace el cambio: queda en Correos con su error
A.fallarCorreo = true;
const r2 = ok('obrero', 'guardarRequisicion', nuevaReq()).folio;
A.fallarCorreo = false;
assert.equal(nuevos().length, 0);
const LC = A.libros[props.COMPRAS_DB_ID];
assert.equal(LC.pest.Requisiciones.m.find(x => x[0] === r2)[5], 'Solicitada', 'la requisición quedó guardada');
assert.deepEqual(ultimoLog().slice(3, 7), ['req.solicitada', r2, 'Error', 'Servicio de correo no disponible']);

// Cuota del día agotada: no se manda nada y queda "Sin enviar"
const cuota = A.ctx.MailApp.getRemainingDailyQuota;
A.ctx.MailApp.getRemainingDailyQuota = () => 0;
ok('adri', 'devolverRequisicion', r2, 'Falta el calibre del cable');
assert.equal(nuevos().length, 0);
assert.deepEqual(ultimoLog().slice(3, 6), ['req.devuelta', r2, 'Sin enviar']);
assert(/cuota diaria/.test(ultimoLog()[6]));
A.ctx.MailApp.getRemainingDailyQuota = () => 1; // alcanza para el único destinatario (adri; el super admin ya no recibe estos)
ok('obrero', 'guardarRequisicion', nuevaReq({ folio: r2 }));
assert.equal(nuevos().length, 1);
assert.equal(ultimoLog()[5], 'Enviado');
A.ctx.MailApp.getRemainingDailyQuota = cuota;

// Cancelada: si estaba Devuelta, a quien la devolvió; si estaba Solicitada, a aprobaciones
ok('adri', 'devolverRequisicion', r2, 'Falta el calibre del cable');
nuevos();
ok('obrero', 'cancelarRequisicion', r2, 'Ya no se necesita');
m = nuevos();
assert.deepEqual([m.length, para(m[0])], [1, ['adri@helgen.tech']]);
assert(/ · Cancelada · /.test(m[0].subject) && /Nota: Hay una nota: ábrela en CAPRI/.test(m[0].body) && !/Ya no se necesita/.test(m[0].body));
const r3 = ok('obrero', 'guardarRequisicion', nuevaReq()).folio;
nuevos();
ok('obrero', 'cancelarRequisicion', r3, 'Me equivoqué de proyecto');
assert.deepEqual(para(nuevos()[0]), ['adri@helgen.tech']);

// Rechazada → quien pidió
const r4 = ok('obrero', 'guardarRequisicion', nuevaReq()).folio;
nuevos();
ok('adri', 'rechazarRequisicion', r4, 'No hay presupuesto este mes');
m = nuevos();
assert.deepEqual(para(m[0]), ['obrero@helgen.tech']);
assert(/ · Rechazada · /.test(m[0].subject));

// Orden cancelada → quien pidió (sin el motivo) y compras (con el motivo limpio); la bitácora guarda la requisición
const r5 = ok('obrero', 'guardarRequisicion', nuevaReq({ renglones: [{ descripcion: 'Antena GNSS', cantidad: 2, unidad: 'pza' }] })).folio;
ok('adri', 'aprobarRequisicion', r5, { version: 1, renglones: [{ renglon: 1, aprobado: true }] });
ok('pedro', 'cotizarRequisicion', r5, PROP({ recibe: '', renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 1000 }] }));
const oc5 = ok('adri', 'autorizarPropuesta', r5, 1, 'vb5', ok('adri', 'getRequisicionOperaciones', r5).propuesta.huella).ocFolio;
nuevos();
ok('pedro', 'cancelarOrdenCompra', oc5, 'El proveedor Ferretera del Puerto subió $500 el precio');
m = nuevos();
assert.equal(m.length, 2);
const ocObrero = porPara(m, 'obrero@helgen.tech'), ocCompras = porPara(m, 'efrain@helgen.tech');
assert(/ · Orden cancelada · /.test(ocObrero.subject) && !/Nota:/.test(ocObrero.body) && /comprar de nuevo/.test(ocObrero.body));
assert.deepEqual(para(ocCompras), sinQuien(COMPRAS, 'pedro@helgen.tech'));
assert(/Nota: Hay una nota: ábrela en CAPRI/.test(ocCompras.body) && !/subió/.test(ocCompras.body) && /cotizarla de nuevo/.test(ocCompras.body), ocCompras.body);
assert.deepEqual(ultimoLog().slice(3, 6), ['oc.cancelada', r5, 'Enviado']);

// Eventos de otros módulos (alta, delegación, anulado, en camino) y del centro de mando (sin sesión)
como('leo@helgen.tech', 'Leo');
P.notificar_('usuario.alta', { correo: 'jesus@helgen.services', nombre: 'Jesús Honorato' });
P.notificar_('usuario.alta', { correo: 'nuevo@helgen.tech' });
P.notificar_('delegacion', { a: 'ana@helgen.tech', de: 'tania@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: masDias(3) });
P.notificar_('anulado', { para: ['obrero@helgen.tech', 'pedro@helgen.tech', 'x@gmail.com'], folio: oc5, tipo: 'Orden de compra', req: r5,
  nota: 'Duplicada por error' });
P.notificar_('req.encamino', { folio: r1, fechaEsperada: masDias(2), paqueteria: 'Estafeta', guia: '123456' });
P.notificar_('no.existe', {});
P.enviarCorreosPendientes_();
m = nuevos();
assert.equal(m.length, 6);
const alta = porPara(m, 'jesus@helgen.services');
assert(alta.subject === '[CAPRI] Ya tienes acceso a CAPRI' && /código/.test(alta.body) && /Jesús Honorato, te damos la bienvenida/.test(alta.body));
assert(/Acceder con Google/.test(porPara(m, 'nuevo@helgen.tech').body));
assert.equal(porPara(m, 'ana@helgen.tech').subject, '[CAPRI] Te delegaron Compras del ' + fmx(HOY_ISO) + ' al ' + fmx(masDias(3)));
const anul = porPara(m, 'pedro@helgen.tech');
assert.deepEqual(para(anul), ['obrero@helgen.tech', 'pedro@helgen.tech'], 'sin cuentas de fuera');
assert(anul.subject.indexOf(r5 + ' · Orden de compra anulada') !== -1 && !/Nota:|Duplicada por error/.test(anul.body));
const enc = porPara(m, 'rosa@helgen.tech');
assert.deepEqual(para(enc), ['rosa@helgen.tech']);
assert(/ · En camino · /.test(enc.subject) && /Paquetería: Estafeta/.test(enc.body) && /Guía: 123456/.test(enc.body) && enc.body.indexOf(fmx(masDias(2))) !== -1);
assert(m.every(x => x.replyTo === 'leo@helgen.tech'));
assert.deepEqual(log().slice(-7).map(r => r[3] + ':' + r[5]), ['usuario.alta:Enviado', 'usuario.alta:Enviado', 'delegacion:Enviado', 'anulado:Enviado',
  'req.encamino:Enviado', 'req.encamino:Enviado', 'no.existe:Error']);
como(null); // centro de mando: sin sesión ni Reply-To; todo compras (también pedro)
P.notificar_('req.recibida', { req: r1, parcial: true, quien: 'Jesús Honorato en ZLO' });
P.enviarCorreosPendientes_();
m = nuevos();
assert.deepEqual([m.length, para(m[0]), m[0].replyTo], [1, COMPRAS, undefined]);
assert(/Lo hizo: Jesús Honorato en ZLO/.test(m[0].body) && !/Si respondes/.test(m[0].body));

// ================= Solicitud de cotización =================
falla('obrero', 'solicitudCotizacion', [r1, {}], /permiso de compras/, 'PERMISO');
falla('adri', 'solicitudCotizacion', [r1, {}], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla('pedro', 'solicitudCotizacion', [r3, {}], /está cancelada: la solicitud de cotización se hace desde que está aprobada/);
falla('pedro', 'solicitudCotizacion', [r1, { renglones: [{ renglon: 2, incluir: true }] }], /renglón 2 no está aprobado/);
falla('pedro', 'solicitudCotizacion', [r1, { renglones: [{ renglon: 1, incluir: false }, { renglon: 3, incluir: false }] }], /al menos un renglón/);
falla('pedro', 'solicitudCotizacion', [r1, { proveedor: { correo: 'no es correo' } }], /correo del proveedor no es válido/);
const verAntes = JSON.stringify(['requisiciones', 'oc', 'pagosProveedores'].map(c => props['VER_' + c]));
const bitAntes = LC.pest.Bitacora.m.length;
const s = ok('pedro', 'solicitudCotizacion', r1, { renglones: [{ renglon: 1, incluir: true, descripcion: 'Cable THW calibre 10, color rojo', notas: '' },
  { renglon: 3, incluir: false }], proveedor: { nombre: 'Ferretera del Puerto', correo: 'Ventas@Ferreteria.mx' }, notas: 'Favor de cotizar con entrega en sitio.' });
assert.deepEqual([s.folio, s.nombre, s.mime, s.renglones], [r1, r1 + ' — Solicitud de cotización.pdf', 'application/pdf', 1]);
const pdf = Buffer.from(s.datos, 'base64').toString('utf8'); // el arnés guarda el HTML como "PDF"
for (const t of ['SOLICITUD DE COTIZACIÓN', r1, 'Cable THW calibre 10, color rojo', '<td class="r">80</td>', 'Manzanillo (TIMSA)<br>Av. del Puerto 123, Manzanillo, Col.',
  'Para:', 'Ferretera del Puerto', 'ventas@ferreteria.mx', 'Pedro Ruiz', 'pedro@helgen.tech', 'HSE240304PC1', 'precio unitario de cada partida, IVA, tiempo de entrega, ' +
  'vigencia de la cotización y condiciones de pago', 'Favor de cotizar con entrega en sitio.', fmx(masDias(5))]) {
  assert(pdf.indexOf(t) !== -1, 'el PDF debe tener: ' + t);
}
for (const re of [/Tubo conduit/, /Pintura/, /caseta norte/, /Cliente Secreto/, /Empresa Oculta/, /DROGHEDA/, /PRY-/, /\$\s?\d/, /OC-\d/, /Flete/]) {
  assert(!re.test(pdf), 'el PDF no debe tener ' + re);
}
const archivoSol = Object.values(A.archivos).find(a => a.nombre === s.nombre || (a.blob && a.blob.name === s.nombre));
assert.equal(archivoSol.acceso, 'PRIVATE', 'el PDF queda restringido');
assert.equal(archivoSol.padre.nombre, 'Requisiciones');
assert.equal(archivoSol.padre.padre.nombre, p1);
assert.equal(s.url, 'https://drive/file/' + archivoSol.id);
const bit = LC.pest.Bitacora.m[LC.pest.Bitacora.m.length - 1];
assert.equal(LC.pest.Bitacora.m.length, bitAntes + 1);
assert.deepEqual([bit[1], bit[2], bit[3], bit[4]], ['pedro@helgen.tech', 'Solicitud de cotización', p1, r1 + ' · 1 renglón(es) · para Ferretera del Puerto · ' + s.nombre]);
assert.equal(LC.pest.Requisiciones.m.find(x => x[0] === r1)[5], 'Recibida', 'no cambia la requisición');
assert.equal(JSON.stringify(['requisiciones', 'oc', 'pagosProveedores'].map(c => props['VER_' + c])), verAntes, 'no sube versiones');
assert.equal(nuevos().length, 0, 'no manda avisos');
// Correo listo para Gmail y para el correo de la persona
const sc = s.correo;
assert.deepEqual([sc.para, sc.asunto, sc.recortado], ['ventas@ferreteria.mx', 'Solicitud de cotización · Helgen Servicios Especializados · ' + r1, false]);
assert(sc.cuerpo.indexOf('Buenos días, Ferretera del Puerto:') === 0 && /\n1\. 80 M · Cable THW calibre 10, color rojo\n/.test(sc.cuerpo), sc.cuerpo);
assert(/Por favor incluyan precio unitario, IVA, tiempo de entrega, vigencia de la cotización y condiciones de pago\./.test(sc.cuerpo));
assert(sc.cuerpo.indexOf('\nEntrega en Manzanillo (TIMSA): Av. del Puerto 123, Manzanillo, Col.\nSe necesita para el ' + fmx(masDias(5)) + '.\n') !== -1, sc.cuerpo);
assert(/\nPedro Ruiz\nCompras · Helgen Servicios Especializados\n/.test(sc.cuerpo) && !/\$\s?\d|Cliente Secreto|DROGHEDA/.test(sc.cuerpo));
assert.equal(sc.gmail, 'https://mail.google.com/mail/?view=cm&fs=1&to=ventas%40ferreteria.mx&su=' + encodeURIComponent(sc.asunto) + '&body=' + encodeURIComponent(sc.cuerpo));
assert.equal(sc.mailto, 'mailto:ventas@ferreteria.mx?subject=' + encodeURIComponent(sc.asunto) + '&body=' + encodeURIComponent(sc.cuerpo).replace(/%0A/g, '%0D%0A'));
assert.deepEqual(plain(P.correoConLigas(sc.para, sc.asunto, sc.partes)), plain({ para: sc.para, asunto: sc.asunto, cuerpo: sc.cuerpo, gmail: sc.gmail,
  mailto: sc.mailto, recortado: false }), 'partes para rehacer las ligas');
// Sin opciones: todos los aprobados como están (con sus notas); el segundo archivo lleva (2)
const s2 = ok('pedro', 'solicitudCotizacion', r1);
assert.equal(s2.nombre, r1 + ' — Solicitud de cotización (2).pdf');
const pdf2 = Buffer.from(s2.datos, 'base64').toString('utf8');
assert(/Cable THW 10/.test(pdf2) && /Tubo conduit 3\/4/.test(pdf2) && /Para la caseta norte/.test(pdf2) && !/Para:/.test(pdf2) && !/Pintura/.test(pdf2));
assert.equal(s2.correo.para, '');
// Requisición Aprobada (antes de la propuesta) también
const r6 = ok('obrero', 'guardarRequisicion', nuevaReq()).folio;
ok('adri', 'aprobarRequisicion', r6, { version: 1, renglones: [1, 2, 3].map(x => ({ renglon: x, aprobado: true })) });
nuevos();
assert.equal(ok('pedro', 'solicitudCotizacion', r6, {}).renglones, 3);

// ================= PDF de la orden para el proveedor =================
const filaOc = LC.pest.OrdenesCompra.m.find(x => x[0] === oc1);
A.archivos[filaOc[23]].blob.bytes = [...Buffer.from('%PDF-1.4 orden de compra')];
falla('obrero', 'pdfOrdenCompra', [oc1], /permiso de compras/, 'PERMISO');
falla('pedro', 'pdfOrdenCompra', [oc5], /está cancelada: no se manda al proveedor/);
const po = ok('pedro', 'pdfOrdenCompra', oc1);
assert.deepEqual([po.folio, po.nombre, po.mime, Buffer.from(po.datos, 'base64').toString()], [oc1, oc1 + ' — Ferretera del Puerto.pdf', 'application/pdf',
  '%PDF-1.4 orden de compra']);
assert.deepEqual([po.correo.para, po.correo.asunto], ['ventas@ferreteria.mx', 'Orden de compra ' + oc1 + ' · Helgen Servicios Especializados']);
assert(/Les enviamos la orden de compra OC-\d{4}-0001 \(PDF adjunto\)/.test(po.correo.cuerpo) && /1\. 80 M · Cable THW 10/.test(po.correo.cuerpo) &&
  /Entrega: \d\d\/\d\d\/\d{4} en Manzanillo, Col\./.test(po.correo.cuerpo) && !/\$\s?\d/.test(po.correo.cuerpo), po.correo.cuerpo);
assert(po.correo.gmail.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=ventas%40ferreteria.mx&su=Orden%20de%20compra%20OC-'));

// ================= Bitácora de correos (solo super admin) =================
falla('pedro', 'listarCorreos', [''], /Solo un super admin/, 'PERMISO');
falla('efrain', 'listarCorreos', [''], /Solo un super admin/, 'PERMISO');
let lc = ok('leo', 'listarCorreos', '');
assert.equal(lc.total, log().length - 1);
assert.deepEqual(lc.correos[0], { fecha: ultimoLog()[0], para: ultimoLog()[1], asunto: ultimoLog()[2], tipo: 'req.aprobada', folio: r6, estado: 'Enviado',
  error: '', actor: 'adri@helgen.tech' }, 'los más recientes primero');
assert.deepEqual(lc.correos[1].tipo + ':' + lc.correos[1].folio, 'req.solicitada:' + r6);
assert(ok('leo', 'listarCorreos', { texto: r2 }).correos.every(c => c.folio === r2));
const errores = ok('leo', 'listarCorreos', { estado: 'Error' }).correos;
assert(errores.length === 2 && errores.some(c => c.error === 'Servicio de correo no disponible'));
assert.deepEqual(ok('leo', 'listarCorreos', { texto: 'cuota', estado: 'Sin enviar' }).correos.length, 1); // el segundo intento ya alcanzó (un solo destinatario)
for (let i = 0; i < 250; i++) LA.pest.Correos.m.push(["2026-10-01 10:00:00", 'a@helgen.tech', 'x', 'req.aprobada', 'REQ-2025-' + i, 'Enviado', '', '']);
lc = ok('leo', 'listarCorreos', null);
assert.deepEqual([lc.correos.length, lc.total >= 250], [200, true]);

// ================= preparar(): correo de prueba a la cuenta que corre el script =================
A.ctx.Session.getEffectiveUser = () => ({ getEmail: () => 'efrain@helgen.tech' });
P.prepararCorreos_();
m = nuevos();
assert.deepEqual([m.length, m[0].to, m[0].subject, m[0].name], [1, 'efrain@helgen.tech', '[CAPRI] Correo de prueba', 'CAPRI Helgen']);
assert.deepEqual(ultimoLog().slice(1, 6), ['efrain@helgen.tech', '[CAPRI] Correo de prueba', 'prueba', '', 'Enviado']);

A.correos.forEach(revisarCorreo);

// ================= Flujo de siempre (sin aprobaciones ni libro de Administración) =================
const B = require('./arnes')(dir, { props: { ROL_COMPRAS: 'efrain@helgen.tech, pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech',
  ROL_COBRANZA: 'efrain@helgen.tech' } });
const pB = B.ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', ubicacion: 'Qro', cliente: { nombre: 'Cliente Secreto' }, idSolicitud: 'pb' }).folio;
const rB = B.ok('obrero', 'guardarRequisicion', { proyectoFolio: pB, renglones: [{ descripcion: 'Brida', cantidad: 4 }], cotizacion: { nombre: 'c.pdf', datos: B.PDF },
  idSolicitud: 'rb' }).folio;
assert.equal(B.correos.length, 1);
assert.deepEqual([para(B.correos[0]), B.correos[0].subject], [['efrain@helgen.tech', 'pedro@helgen.tech'], '[CAPRI] ' + rB + ' · Por autorizar · Casa del Lago']);
// Revisión 28/10/2026: sin aprobaciones, la solicitud de cotización sale desde Solicitada con lo pedido
const solB = B.ok('pedro', 'solicitudCotizacion', rB, {});
assert.equal(solB.renglones, 1, 'lo pedido');
const ocB = B.ok('pedro', 'autorizarRequisicion', rB, { proveedor: { razonSocial: 'Eléctrica del Centro' }, fechaEntrega: B.masDias(2), condicionesPago: 'Contado',
  diasCredito: 0, ivaTasa: 0.16, renglones: [{ descripcion: 'Brida', unidad: 'PZA', cantidad: 4, costo: 100 }], idSolicitud: 'ob' }).ocFolio;
assert.equal(B.correos.length, 3);
assert(/ · Autorizada · /.test(porPara(B.correos.slice(1), 'obrero@helgen.tech').subject));
assert.deepEqual(para(porPara(B.correos.slice(1), 'efrain@helgen.tech')), ['efrain@helgen.tech'], 'compras, sin quien autorizó');
B.ok('pedro', 'registrarPagoProveedor', { reqFolio: rB, fecha: B.HOY_ISO, monto: 464, monedaPago: 'MXN', metodo: 'Transferencia', referencia: 'SPEI 1',
  comprobante: { nombre: 's.pdf', datos: B.PDF }, idSolicitud: 'pgb' });
// Revisión 28/10/2026: en el flujo de siempre el pago abre la confirmación: aviso a quien recibe
assert.equal(B.correos.length, 4, 'pagar avisa a quien recibe');
assert.deepEqual([para(B.correos[3]), / · Pagada, por recibir · /.test(B.correos[3].subject), /confirma en CAPRI/.test(B.correos[3].body)],
  [['obrero@helgen.tech'], true, true]);
assert(!/464|Eléctrica|OC-/.test(B.correos[3].body + B.correos[3].subject), 'sin monto, proveedor ni orden');
B.ok('obrero', 'cerrarRequisicion', rB, 'Todo bien', B.FOTOS);
const cierre = B.correos[4];
assert.deepEqual([para(cierre), / · Material recibido · /.test(cierre.subject), /La requisición quedó cerrada/.test(cierre.body)],
  [['efrain@helgen.tech', 'pedro@helgen.tech'], true, true]);
assert.equal(B.props.ADMIN_DB_ID, undefined, 'sin libro de Administración no hay bitácora, pero los correos salen');
B.falla('pedro', 'solicitudCotizacion', [rB, {}], /está cerrada: la solicitud de cotización se hace desde que está solicitada/);
B.correos.forEach(revisarCorreo);
assert(/^OC-/.test(ocB));

// ================= Interfaz (mod-correos sobre la app, con el servidor simulado de arriba) =================
const apiWeb = scripts.find(s => s.id === 'api-web').src, app = scripts.find(s => !s.id).src;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64({ email: 'pedro@helgen.tech', given_name: 'Pedro', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
function montar(datosIniciales) {
  const clics = [];
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() { clics.push(e); }, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  const respuestas = { bootstrap: { ok: true, datos: datosIniciales },
    sincronizar: () => ({ ok: true, datos: { versiones: {}, permisos: datosIniciales.permisos, soloRequisicion: false, cambios: [] } }) };
  async function fetch(url, o) { const c = JSON.parse(o.body); llamadas.push(c); const r = respuestas[c.funcion]; const datos = typeof r === 'function' ? r(c) : r;
    return { ok: true, json: async () => datos || { ok: false, error: 'sin respuesta simulada: ' + c.funcion } }; }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true, prompt: () => null,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    Blob: class { constructor(partes, o) { this.partes = partes; this.type = o && o.type; } },
    URL: { createObjectURL: b => { ctx.ultimoBlob = b; return 'blob:x'; }, revokeObjectURL() {} },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(apiWeb, ctx); vm.runInContext(app, ctx); vm.runInContext(modCorreos, ctx);
  return { ctx, $: id => document.getElementById(id), llamadas, respuestas, clics, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 10) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  const U = montar({ ivaTasa: 0.16, catalogo: [], clientes: [], proyectos: [], marcas: {}, versiones: {},
    permisos: { compras: true, superadmin: true, ventas: true, requisicion: false, cobranza: false } });
  const { $, llamadas, respuestas } = U;
  await esperar(5);
  // Las llamadas de la caja van al servidor simulado de arriba (como pedro; la bitácora como leo)
  const ultima = {};
  ['solicitudCotizacion', 'pdfOrdenCompra', 'getRequisicion', 'getComprasProyecto'].forEach(f => {
    respuestas[f] = c => (ultima[f] = A.post('pedro', c.funcion, ...c.args)); });
  respuestas.listarCorreos = c => A.post('leo', c.funcion, ...c.args);

  // Detalle de una requisición aprobada: caja de solicitud de cotización con los renglones aprobados
  const vista = ok('pedro', 'getRequisicion', r1);
  U.run('pintarReqCom(' + JSON.stringify(vista) + ')');
  assert(!$('rcSolicitud').classList.contains('oculto'), 'compras ve la solicitud de cotización');
  assert(/Preparar solicitud de cotización/.test($('rcSolicitud').innerHTML));
  U.run('CORREOS.abrirSolicitud()');
  const caja = $('rcSolicitud').innerHTML;
  assert(/corSolDesc-1/.test(caja) && /corSolDesc-3/.test(caja) && !/corSolDesc-2/.test(caja), 'solo los aprobados');
  assert(/value="Cable THW 10"/.test(caja) && /value="Para la caseta norte"/.test(caja) && /Ferretera del Puerto/.test(caja));
  assert.equal($('corSolInc-1').checked, true);
  $('corSolInc-3').checked = false; $('corSolDesc-1').value = 'Cable THW calibre 10'; $('corSolNotas-1').value = '';
  $('corSolProv').value = 'Ferretera del Puerto'; $('corSolProv').disparar('change');
  assert.equal($('corSolCorreo').value, 'ventas@ferreteria.mx', 'el correo sale de Proveedores');
  U.run('CORREOS.generarSolicitud()');
  await esperar();
  const llam = llamadas.filter(c => c.funcion === 'solicitudCotizacion').pop();
  assert.deepEqual(llam.args, [r1, { renglones: [{ renglon: 1, incluir: true, descripcion: 'Cable THW calibre 10', notas: '' },
    { renglon: 3, incluir: false, descripcion: 'Tubo conduit 3/4', notas: '' }], notas: '', proveedor: { nombre: 'Ferretera del Puerto', correo: 'ventas@ferreteria.mx' } }]);
  const res = ultima.solicitudCotizacion.datos;
  assert(ultima.solicitudCotizacion.ok, ultima.solicitudCotizacion.error);
  assert.equal($('corSolGmail').href, res.correo.gmail);
  assert.equal($('corSolMailto').href, res.correo.mailto);
  assert(/Descargar PDF/.test($('corSolRes').innerHTML) && /adjúntalo/.test($('corSolNota').innerHTML));
  $('corSolCorreo').value = 'otro@proveedor.mx'; $('corSolCorreo').disparar('input');
  assert.equal($('corSolGmail').href, P.correoConLigas('otro@proveedor.mx', res.correo.asunto, res.correo.partes).gmail, 'cambiar el correo rehace las ligas');
  U.run('CORREOS.descargarSolicitud()');
  const descarga = U.clics.pop();
  assert(/ — Solicitud de cotización \(\d\)\.pdf$/.test(descarga.download) && descarga.href === 'blob:x' && U.ctx.ultimoBlob.type === 'application/pdf');

  // Orden emitida: enviar al proveedor desde la requisición
  assert(!$('rcEnviarOc').classList.contains('oculto'));
  assert.equal($('corOcCorreoRc').value, 'ventas@ferreteria.mx');
  U.run("CORREOS.prepararOc('Rc')");
  await esperar();
  assert.equal($('corOcRcGmail').href, ultima.pdfOrdenCompra.datos.correo.gmail);
  U.run("CORREOS.descargarOc('Rc')");
  assert.equal(U.clics.pop().download, oc1 + ' — Ferretera del Puerto.pdf');

  // Lista de órdenes por proyecto: botón "Enviar" solo en las vigentes
  U.run('pintarCompras(' + JSON.stringify(ok('pedro', 'getComprasProyecto', p1)) + ')');
  const filas = $('ocLista').innerHTML;
  assert(filas.indexOf("CORREOS.enviarOcLista('" + oc1 + "')") !== -1 && filas.indexOf("CORREOS.enviarOcLista('" + oc5 + "')") === -1, filas);
  U.run("CORREOS.enviarOcLista('" + oc1 + "')");
  assert(!$('ocEnviarCaja').classList.contains('oculto') && /Enviar orden al proveedor · OC-/.test($('ocEnviarCaja').innerHTML));
  U.run('CORREOS.cerrarOcLista()');
  assert($('ocEnviarCaja').classList.contains('oculto'));

  // Sin compras: no hay cajas; requisición sin renglones aprobados (rechazada): tampoco
  U.run('PERMISOS.compras = false; pintarReqCom(' + JSON.stringify(vista) + ')');
  assert($('rcSolicitud').classList.contains('oculto') && $('rcEnviarOc').classList.contains('oculto'));
  U.run('PERMISOS.compras = true; pintarReqCom(' + JSON.stringify(ok('pedro', 'getRequisicion', r4)) + ')');
  assert($('rcSolicitud').classList.contains('oculto'));

  // Administración → Correos enviados (solo super admin)
  U.run("verTab('admin')");
  await esperar();
  const lcall = llamadas.filter(c => c.funcion === 'listarCorreos').pop();
  assert.deepEqual(lcall.args, [{ texto: '', estado: '' }]);
  assert(/<td>prueba<\/td>/.test($('corLogLista').innerHTML) && /200 de \d+ correo\(s\)/.test($('corLogInfo').textContent), $('corLogInfo').textContent);
  U.run("aplicarPermisos({compras:true, superadmin:false, ventas:true}, false)");
  assert($('adminCorreos').classList.contains('oculto') && $('adminCorreos').innerHTML === '');
  console.log('OK correos');
})().catch(e => { console.error(e); process.exit(1); });
