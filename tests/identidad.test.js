// Incremento 4 · módulo A (Identidad): página de Permisos (solo super admin; super admin raíz protegido; desactivar = ACCESO
// en el siguiente clic), delegaciones (reglas, efecto en los roles, programadas, vencidas, canceladas), excepción de super admin
// con motivo a "nadie aprueba lo suyo", entrar con código (@helgen.services: respuesta genérica, límite por hora, bloqueo,
// un solo uso, vencimiento, sesión de CAPRI firmada, alterada, vencida y renovada) y la interfaz (pantalla de entrada, sesión
// en localStorage, llamadas públicas sin token, ACCESO sin ciclos, renovación, Permisos y Delegaciones).
// Uso: node tests/identidad.test.js .
const assert = require('assert');
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech',
  ROL_COMPRAS: 'efrain@helgen.tech, tania@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, efrain@helgen.tech, pedro@helgen.tech',
  SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech, jesus@helgen.services',
  ROL_OPERACIONES: 'adri@helgen.tech, pedro@helgen.tech' } });
const { P, ok, falla, post, plain, props, HOY_ISO, masDias, correr, como, ANIO } = A;
A.tokens.jefa = A.claims('jefa@helgen.tech', 'Jefa', 'Suprema');
A.tokens.nuevo = A.claims('nuevo@helgen.tech', 'Nuevo', 'Uno');

// Avisos (notificar_): el módulo de correos los manda; aquí se guardan para revisarlos
correr('var AVISOS_ = []; enviarCorreosPendientes_ = function () { AVISOS_.push.apply(AVISOS_, MEMO_.correos || []); MEMO_.correos = []; };');
const avisos = () => plain(correr('AVISOS_'));
// Reloj: mueve Date (new Date() y Date.now()) dentro del código; las fechas de las hojas siguen siendo Date
const FechaReal = Date;
function reloj(ms) {
  if (!ms) { A.ctx.Date = FechaReal; return; }
  class F extends FechaReal {
    constructor(...a) { if (a.length) super(...a); else super(FechaReal.now() + ms); }
    static now() { return FechaReal.now() + ms; }
    static [Symbol.hasInstance](x) { return x instanceof FechaReal; }
  }
  A.ctx.Date = F;
}
const MIN = 60000, DIA = 86400000;
const datosToken = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));

// ================= Permisos =================
falla('leo', 'listarUsuarios', [], /Solo un super admin/, 'PERMISO'); // sin SUPER_ADMIN nadie es super admin
props.SUPER_ADMIN = 'leo@helgen.tech';
let vp = ok('leo', 'listarUsuarios');
assert.equal(vp.libro, false, 'antes de prepararCapri: roles de Script Properties, sin editar');
assert(vp.usuarios.some(u => u.correo === 'efrain@helgen.tech'));
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.tech', nombre: 'X', roles: ['ventas'] }], /prepararCapri/);
P.prepararCapri();
const secreto = props.SESION_SECRETO;
assert(secreto && secreto.length >= 40, 'prepararCapri crea SESION_SECRETO');
P.prepararCapri();
assert.equal(props.SESION_SECRETO, secreto, 'no lo cambia si ya existe');
const LA = A.libros[props.ADMIN_DB_ID], perm = LA.pest.Permisos.m, fila = c => perm.find(r => r[0] === c);
const bit = () => LA.pest.Bitacora.m, ultBit = () => bit()[bit().length - 1];

vp = ok('leo', 'listarUsuarios');
assert.equal(vp.libro, true);
const leoV = vp.usuarios.find(u => u.correo === 'leo@helgen.tech');
assert.deepEqual([leoV.raiz, leoV.enLista, leoV.roles], [true, false, ['superadmin']], 'el raíz aparece aunque no esté en la hoja');
assert.deepEqual(vp.roles.map(r => r.nombre), ['Ventas', 'Requisiciones', 'Solo requisiciones', 'Aprobaciones', 'Compras', 'Cobranza',
  'Desbloqueo', 'Nómina', 'Super admin']); // Nómina: incremento 7 (N), en la página de Permisos
assert.deepEqual(vp.sitios.map(s => s.codigo), ['QRO', 'ZLO', 'ESE', 'LZC', 'VER']);
assert.deepEqual(vp.usuarios.find(u => u.correo === 'jesus@helgen.services').metodo, 'codigo');
falla('efrain', 'listarUsuarios', [], /Solo un super admin/, 'PERMISO');
falla('efrain', 'guardarUsuario', [{ nuevo: true, correo: 'z@helgen.tech', nombre: 'Z', roles: ['ventas'] }], /Solo un super admin/, 'PERMISO');
falla('adri', 'listarUsuarios', [], /solo tiene acceso a Requisiciones/, 'PERMISO');

// Alta: se valida con normalizarUsuario, sube la versión, queda en la bitácora y avisa a la persona
let ver = Number(props.VER_permisos) || 0;
vp = ok('leo', 'guardarUsuario', { nuevo: true, correo: ' Nuevo@Helgen.TECH ', nombre: ' Nuevo   Uno ', roles: ['ventas', 'Compras'],
  sitio: 'ver', activo: true, notas: 'Entra el lunes' });
assert(Number(props.VER_permisos) > ver, 'sube la versión de permisos');
assert.deepEqual(fila('nuevo@helgen.tech').slice(0, 8), ['nuevo@helgen.tech', 'Nuevo Uno', 'google', 'ventas, compras', 'VER', 'Sí',
  'Entra el lunes', 'leo@helgen.tech']);
assert.equal(typeof fila('nuevo@helgen.tech')[8], 'string', 'actualizado como texto');
assert.deepEqual(ultBit().slice(1, 4), ['leo@helgen.tech', 'Alta de usuario', 'nuevo@helgen.tech']);
let av = avisos().pop();
assert.deepEqual([av.tipo, av.datos.para, av.datos.metodo, av.datos.roles, av.actor],
  ['usuario.alta', ['nuevo@helgen.tech'], 'google', ['Ventas', 'Compras'], 'leo@helgen.tech']);
assert.equal(vp.usuarios.find(u => u.correo === 'nuevo@helgen.tech').actualizo, 'leo@helgen.tech', 'la página se devuelve fresca');
assert.equal(ok('nuevo', 'bootstrap').permisos.compras, true, 'entra con sus roles');
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'nuevo@helgen.tech', nombre: 'Otra', roles: ['ventas'] }], /ya está dado de alta/);
falla('leo', 'guardarUsuario', [{ correo: 'otro@helgen.tech', nombre: 'Otro', roles: ['ventas'] }], /no está en Permisos/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.services', nombre: 'X', roles: ['compras'] }], /solo pueden tener "Solo requisiciones"/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.tech', nombre: 'X', roles: ['ventas'], sitio: 'MTY' }], /no está en la lista de sitios/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@gmail.com', nombre: 'X', roles: ['ventas'] }], /Escribe un correo @helgen.tech/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.tech', nombre: 'X', roles: [] }], /al menos un rol/);
// Super admin raíz: ni desactivarlo ni quitarle Super admin desde la página (sí se puede poner en la lista)
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'leo@helgen.tech', nombre: 'Leo', roles: ['ventas'] }], /no se le puede quitar "Super admin"/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'leo@helgen.tech', nombre: 'Leo', roles: ['superadmin'], activo: false }], /no se puede desactivar/);
vp = ok('leo', 'guardarUsuario', { nuevo: true, correo: 'leo@helgen.tech', nombre: 'Leo Rodríguez', roles: ['superadmin'] });
assert.deepEqual([vp.usuarios.find(u => u.correo === 'leo@helgen.tech').enLista, vp.usuarios.filter(u => u.correo === 'leo@helgen.tech').length], [true, 1]);
// Un super admin da de alta a otro super admin
ok('leo', 'guardarUsuario', { nuevo: true, correo: 'jefa@helgen.tech', nombre: 'Jefa Suprema', roles: ['superadmin'] });
assert.equal(ok('jefa', 'bootstrap').permisos.superadmin, true);
assert(ok('jefa', 'listarUsuarios').usuarios.length > 5);
falla('jefa', 'guardarUsuario', [{ correo: 'jefa@helgen.tech', nombre: 'Jefa', roles: ['superadmin'], activo: false }], /No puedes desactivar tu propia cuenta/);
falla('jefa', 'guardarUsuario', [{ correo: 'jefa@helgen.tech', nombre: 'Jefa', roles: ['ventas'] }], /No puedes quitarte "Super admin"/);
falla('jefa', 'guardarUsuario', [{ correo: 'leo@helgen.tech', nombre: 'Leo', roles: ['superadmin'], activo: 'No' }], /super admin raíz/);
// Desactivar: ACCESO en el siguiente clic; reactivar devuelve el acceso
assert.equal(ok('obrero', 'bootstrap').permisos.requisicion, true);
const obreroV = ok('jefa', 'listarUsuarios').usuarios.find(u => u.correo === 'obrero@helgen.tech');
ok('jefa', 'guardarUsuario', Object.assign({}, obreroV, { nombre: 'Juan Obrero', activo: false }));
assert.deepEqual(ultBit().slice(1, 4), ['jefa@helgen.tech', 'Desactivar usuario', 'obrero@helgen.tech']);
assert(/nombre: — → Juan Obrero/.test(ultBit()[4]), ultBit()[4]);
falla('obrero', 'bootstrap', [], /desactivado/, 'ACCESO');
falla('obrero', 'misRequisiciones', [], /desactivado/, 'ACCESO');
ok('jefa', 'guardarUsuario', Object.assign({}, obreroV, { nombre: 'Juan Obrero', activo: true }));
assert.equal(ultBit()[2], 'Reactivar usuario');
assert.equal(ok('obrero', 'bootstrap').permisos.requisicion, true);
// Cuentas @helgen.services (entran con código; solo requisiciones) y una desactivada para las pruebas
ok('leo', 'guardarUsuario', { correo: 'jesus@helgen.services', nombre: 'Jesús Honorato', roles: [], sitio: 'ZLO' });
assert.deepEqual(fila('jesus@helgen.services').slice(0, 6), ['jesus@helgen.services', 'Jesús Honorato', 'codigo', 'solo_requisicion', 'ZLO', 'Sí']);
for (const [c, n] of [['luz', 'Luz'], ['sol', 'Sol'], ['mar', 'Mar'], ['rio', 'Río']]) {
  ok('leo', 'guardarUsuario', { nuevo: true, correo: c + '@helgen.services', nombre: n, roles: ['Solo requisiciones'] });
}
ok('leo', 'guardarUsuario', { nuevo: true, correo: 'baja@helgen.services', nombre: 'Baja', roles: [], activo: false });
ok('leo', 'guardarUsuario', { nuevo: true, correo: 'baja@helgen.tech', nombre: 'Baja Tech', roles: ['ventas'], activo: false });
assert.equal(avisos().filter(a => a.tipo === 'usuario.alta' && a.datos.para[0] === 'baja@helgen.services').length, 0, 'alta desactivada: sin aviso');

// ================= Entrar con código (@helgen.services) =================
const GENERICO = 'Si el correo está dado de alta, te llegó un código.';
const codigoDe = m => (String(m.body).match(/es: (\d{6})/) || [])[1];
const pedir = c => ok('', 'solicitarCodigo', c);
const entrar = (c, cod) => ok('', 'verificarCodigo', c, cod);
let n0 = A.correos.length;
assert.deepEqual(pedir('Jesus@Helgen.services'), { mensaje: GENERICO });
assert.equal(A.correos.length, n0 + 1);
const m1 = A.correos[A.correos.length - 1];
assert.deepEqual([m1.to, m1.subject, m1.name], ['jesus@helgen.services', 'Tu código de CAPRI', 'CAPRI Helgen']);
assert(!/https?:|href/i.test(m1.body + m1.htmlBody), 'sin ligas que inicien sesión');
assert(/Hola, Jesús Honorato/.test(m1.body) && /10 minutos/.test(m1.body));
const c1 = codigoDe(m1);
assert(/^\d{6}$/.test(c1));
assert(!JSON.stringify(A.cache).includes(c1), 'en el caché solo queda la huella del código');
// Lo mismo para quien no existe, está desactivado o no es de CAPRI: misma respuesta y ningún correo
for (const c of ['nadie@helgen.services', 'baja@helgen.services']) assert.deepEqual(pedir(c), { mensaje: GENERICO });
assert.equal(A.correos.length, n0 + 1, 'nadie más recibió código');
falla('', 'solicitarCodigo', ['leo@helgen.tech'], /entran con el botón de Google/);
falla('', 'solicitarCodigo', ['x@gmail.com'], /correo @helgen.services válido/);
falla('', 'solicitarCodigo', [''], /Escribe tu correo/);
falla('', 'listarUsuarios', [], /Inicia sesión/, 'SESION'); // lo demás sigue pidiendo sesión
// Comprobar: equivocado, bueno (sesión de 30 días) y una sola vez
falla('', 'verificarCodigo', ['jesus@helgen.services', '12345'], /6 números/);
falla('', 'verificarCodigo', ['jesus@helgen.services', c1 === '000000' ? '000001' : '000000'], /Código incorrecto o vencido/);
let r = entrar(' JESUS@helgen.services ', c1.slice(0, 3) + ' ' + c1.slice(3));
assert(r.token.startsWith('capri.') && r.token.split('.').length === 3);
assert.deepEqual([r.correo, r.nombre], ['jesus@helgen.services', 'Jesús Honorato']);
const tJ = r.token, dJ = datosToken(tJ);
assert.deepEqual([dJ.e, dJ.n], ['jesus@helgen.services', 'Jesús Honorato']);
assert(Math.abs(dJ.x - (Date.now() / 1000 + 30 * 86400)) < 60, 'vence en 30 días');
assert.deepEqual(ultBit().slice(2, 5), ['Entrada con código', '', 'jesus@helgen.services']);
falla('', 'verificarCodigo', ['jesus@helgen.services', c1], /Código incorrecto o vencido/); // un solo uso
// La sesión de CAPRI sirve como la de Google; nombre en el encabezado; solo requisiciones
let b = ok(tJ, 'bootstrap');
assert.deepEqual([b.soloRequisicion, b.permisos.requisicion, b.permisos.compras, b.vendedor.email, b.vendedor.nombre, b.sesionCapri],
  [true, true, false, 'jesus@helgen.services', 'Jesús Honorato', undefined], 'recién emitida: no se renueva');
falla(tJ, 'listarCotizaciones', [''], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla(tJ, 'listarUsuarios', [], /solo tiene acceso a Requisiciones/, 'PERMISO');
// Alterada, con otro secreto, mal formada o de otro dominio: SESION
const [, carga, firma] = tJ.split('.');
const firmar = (c, s) => require('crypto').createHmac('sha256', s).update(c).digest('base64url');
falla('capri.' + carga + '.' + firma.slice(0, -2) + (firma.slice(-2) === 'AA' ? 'BB' : 'AA'), 'bootstrap', [], /no es válida/, 'SESION');
const cargaOtra = Buffer.from(JSON.stringify({ e: 'luz@helgen.services', x: dJ.x, n: 'Luz' })).toString('base64url');
falla('capri.' + cargaOtra + '.' + firma, 'bootstrap', [], /no es válida/, 'SESION');
falla('capri.' + cargaOtra + '.' + firmar(cargaOtra, 'otro-secreto'), 'bootstrap', [], /no es válida/, 'SESION');
const cargaTech = Buffer.from(JSON.stringify({ e: 'efrain@helgen.tech', x: dJ.x, n: 'E' })).toString('base64url');
falla('capri.' + cargaTech + '.' + firmar(cargaTech, secreto), 'bootstrap', [], /no es válida/, 'SESION'); // nunca una @helgen.tech
const cargaLarga = Buffer.from(JSON.stringify({ e: 'luz@helgen.services', x: dJ.x + 400 * 86400, n: 'Luz' })).toString('base64url');
falla('capri.' + cargaLarga + '.' + firmar(cargaLarga, secreto), 'bootstrap', [], /no es válida/, 'SESION');
falla('capri.abc', 'bootstrap', [], /Inicia sesión/, 'SESION');
falla('capri.a.b.c', 'bootstrap', [], /Inicia sesión/, 'SESION');
// Vencida a los 30 días; con menos de 15 días por delante, bootstrap y sincronizar mandan una nueva
reloj(31 * DIA);
falla(tJ, 'bootstrap', [], /expiró/, 'SESION');
reloj(16 * DIA);
b = ok(tJ, 'bootstrap');
assert(typeof b.sesionCapri === 'string' && b.sesionCapri !== tJ, 'renovada en la carga inicial');
assert(Math.abs(datosToken(b.sesionCapri).x - (Date.now() / 1000 + 46 * 86400)) < 60, 'otros 30 días desde ahora');
assert.equal(ok(b.sesionCapri, 'bootstrap').sesionCapri, undefined, 'la nueva no se vuelve a renovar');
assert.equal(typeof ok(tJ, 'sincronizar', {}, {}).sesionCapri, 'string', 'también al sincronizar');
reloj(14 * DIA);
assert.equal(ok(tJ, 'bootstrap').sesionCapri, undefined, 'con más de 15 días por delante no se renueva');
reloj(0);
// Desactivar en Permisos corta la sesión de CAPRI en el siguiente clic (y ya no recibe códigos)
const jesusV = ok('leo', 'listarUsuarios').usuarios.find(u => u.correo === 'jesus@helgen.services');
ok('leo', 'guardarUsuario', Object.assign({}, jesusV, { activo: false }));
falla(tJ, 'bootstrap', [], /desactivado/, 'ACCESO');
n0 = A.correos.length;
assert.deepEqual(pedir('jesus@helgen.services'), { mensaje: GENERICO });
assert.equal(A.correos.length, n0, 'desactivado: sin código');
ok('leo', 'guardarUsuario', Object.assign({}, jesusV, { activo: true }));
// Revisión de seguridad: al reactivarlo, la sesión de antes ya no vale (entra con un código nuevo)
falla(tJ, 'bootstrap', [], /se cerró/, 'SESION');
pedir('jesus@helgen.services');
const tJ2 = ok('', 'verificarCodigo', 'jesus@helgen.services', codigoDe(A.correos[A.correos.length - 1])).token;
assert.equal(ok(tJ2, 'bootstrap').permisos.requisicion, true);
// "Cerrar sesión" la invalida también en el servidor
assert.deepEqual(ok(tJ2, 'cerrarSesionCapri'), { cerrada: true });
falla(tJ2, 'bootstrap', [], /se cerró/, 'SESION');
// Desactivado entre pedir y comprobar: el código bueno no basta
pedir('rio@helgen.services');
const cRio = codigoDe(A.correos[A.correos.length - 1]);
const rioV = ok('leo', 'listarUsuarios').usuarios.find(u => u.correo === 'rio@helgen.services');
ok('leo', 'guardarUsuario', Object.assign({}, rioV, { activo: false }));
falla('', 'verificarCodigo', ['rio@helgen.services', cRio], /desactivado/, 'ACCESO');

// Máximo 5 códigos por correo por hora (cuenta igual con o sin alta: no deja averiguar quién existe)
n0 = A.correos.length;
for (let i = 0; i < 5; i++) pedir('sol@helgen.services');
assert.equal(A.correos.length, n0 + 5);
falla('', 'solicitarCodigo', ['sol@helgen.services'], /Ya se pidieron 5 códigos/);
assert.equal(A.correos.length, n0 + 5);
for (let i = 0; i < 5; i++) pedir('fantasma@helgen.services');
falla('', 'solicitarCodigo', ['fantasma@helgen.services'], /Ya se pidieron 5 códigos/);
// El último código manda (el anterior ya no sirve); pasada la hora se puede pedir otra vez
const cSol5 = codigoDe(A.correos[A.correos.length - 1]), cSol4 = codigoDe(A.correos[A.correos.length - 2]);
if (cSol4 !== cSol5) falla('', 'verificarCodigo', ['sol@helgen.services', cSol4], /incorrecto/);
assert(entrar('sol@helgen.services', cSol5).token);
reloj(61 * MIN);
assert.deepEqual(pedir('sol@helgen.services'), { mensaje: GENERICO });
reloj(0);

// 5 intentos fallidos bloquean el correo 15 minutos (también uno sin alta)
pedir('luz@helgen.services');
const cLuz = codigoDe(A.correos[A.correos.length - 1]);
const malo = cLuz === '999999' ? '999998' : '999999';
for (let i = 0; i < 4; i++) falla('', 'verificarCodigo', ['luz@helgen.services', malo], /Código incorrecto/);
falla('', 'verificarCodigo', ['luz@helgen.services', malo], /Demasiados intentos/);
falla('', 'verificarCodigo', ['luz@helgen.services', cLuz], /Demasiados intentos/, null);
n0 = A.correos.length;
falla('', 'solicitarCodigo', ['luz@helgen.services'], /Demasiados intentos/);
assert.equal(A.correos.length, n0, 'bloqueado: sin código nuevo');
for (let i = 0; i < 4; i++) falla('', 'verificarCodigo', ['fantasma2@helgen.services', '123456'], /Código incorrecto/);
falla('', 'verificarCodigo', ['fantasma2@helgen.services', '123456'], /Demasiados intentos/);
reloj(16 * MIN);
pedir('luz@helgen.services');
assert(entrar('luz@helgen.services', codigoDe(A.correos[A.correos.length - 1])).token, 'pasados 15 minutos, entra');
reloj(0);
// El código vence a los 10 minutos
pedir('mar@helgen.services');
const cMar = codigoDe(A.correos[A.correos.length - 1]);
reloj(11 * MIN);
falla('', 'verificarCodigo', ['mar@helgen.services', cMar], /Código incorrecto o vencido/);
reloj(0);
// Sin secreto (no se corrió prepararCapri) no hay sesiones válidas; solicitarCodigo lo crea
assert.deepEqual(plain(P.FUNCIONES_PUBLICAS || correr('FUNCIONES_PUBLICAS')), ['solicitarCodigo', 'verificarCodigo']);

// ================= Delegaciones =================
como(null);
const CTX = P.contextoRoles_();
const nd = p => plain(P.normalizarDelegacion(Object.assign({ de: 'tania@helgen.tech', a: 'obrero@helgen.tech', roles: ['compras'],
  desde: HOY_ISO, hasta: masDias(3) }, p), CTX));
assert.deepEqual(nd({ roles: 'Compras' }), { de: 'tania@helgen.tech', a: 'obrero@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: masDias(3) });
assert.deepEqual(nd({ de: 'adri@helgen.tech', a: 'rosa@helgen.tech', roles: ['aprobaciones'] }).roles, ['aprobaciones'], 'aprobaciones sí a solo requisiciones');
assert.deepEqual(nd({ de: 'efrain@helgen.tech', a: 'pedro@helgen.tech', roles: ['compras', 'compras'] }).roles, ['compras']);
assert.equal(nd({ hasta: masDias(89) }).hasta, masDias(89), '90 días contando el primero');
for (const [p, re] of [
  [{ roles: ['aprobaciones'] }, /no tiene "Aprobaciones": solo se delega lo que uno tiene/],
  [{ de: 'ana@helgen.tech' }, /no tiene "Compras"/],
  [{ a: 'tania@helgen.tech' }, /a uno mismo/],
  [{ a: 'luz@helgen.services' }, /No se delega a cuentas @helgen.services/],
  [{ a: 'rosa@helgen.tech' }, /"Solo requisiciones": no puede recibir Compras/],
  [{ a: 'ana@helgen.tech' }, /no está dado de alta en Permisos/],
  [{ a: 'baja@helgen.tech' }, /está desactivado/],
  [{ de: 'baja@helgen.tech' }, /no está activo/],
  [{ roles: ['cobranza'] }, /Solo se delegan Aprobaciones y Compras/],
  [{ roles: ['compras', 'inventario'] }, /Solo se delegan/],
  [{ roles: [] }, /Elige qué delegas/],
  [{ a: '' }, /a quién le delegas/],
  [{ desde: masDias(-1) }, /anterior a hoy/],
  [{ desde: masDias(2), hasta: masDias(1) }, /fin no puede ser anterior/],
  [{ hasta: masDias(90) }, /máximo 90 días/],
  [{ desde: '28/10/2026' }, /AAAA-MM-DD/]]) {
  assert.throws(() => nd(p), re, JSON.stringify(p));
}
// Crear: el usuario delega lo suyo; el delegado lo tiene de inmediato; aviso y bitácora
falla('ana', 'listarDelegaciones', [], /Aprobaciones o Compras/, 'PERMISO');
assert.equal(ok('obrero', 'bootstrap').permisos.compras, false);
ver = Number(props.VER_permisos);
let vd = ok('tania', 'crearDelegacion', { a: 'obrero@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: masDias(2) });
const id1 = 'DEL-' + ANIO + '-0001';
assert.deepEqual(vd.delegaciones.map(d => [d.id, d.de, d.a, d.estado, d.rolesNombres.join(), d.puedeCancelar]),
  [[id1, 'tania@helgen.tech', 'obrero@helgen.tech', 'Vigente', 'Compras', true]]);
assert.deepEqual([vd.misRoles, vd.superadmin, vd.delegadores], [['compras'], false, undefined]);
assert(vd.candidatos.some(c => c.correo === 'rosa@helgen.tech' && c.solo) && !vd.candidatos.some(c => /helgen\.services$/.test(c.correo)));
assert(Number(props.VER_permisos) > ver);
const filaDel = LA.pest.Delegaciones.m.find(x => x[0] === id1);
assert.deepEqual(filaDel.slice(0, 8), [id1, 'tania@helgen.tech', 'obrero@helgen.tech', HOY_ISO, masDias(2), 'compras', 'Activa', 'tania@helgen.tech']);
assert.deepEqual(ultBit().slice(2, 4), ['Delegar roles', id1]);
av = avisos().pop();
assert.deepEqual([av.tipo, av.datos.para, av.datos.de, av.datos.roles, av.datos.hasta], ['delegacion', ['obrero@helgen.tech'], 'tania@helgen.tech', ['Compras'], masDias(2)]);
assert.equal(ok('obrero', 'bootstrap').permisos.compras, true, 'compras por delegación');
assert(Array.isArray(ok('obrero', 'listarRequisiciones', '', '')));
falla('tania', 'crearDelegacion', [{ a: 'obrero@helgen.tech', roles: ['compras'], desde: masDias(1), hasta: masDias(5) }], /Ya hay una delegación/);
falla('obrero', 'crearDelegacion', [{ a: 'pedro@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: masDias(1) }], /no tiene "Compras"/,
  null); // lo recibido no se vuelve a delegar
falla('obrero', 'crearDelegacion', [{ de: 'tania@helgen.tech', a: 'pedro@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: HOY_ISO }],
  /Solo un super admin/, 'PERMISO');
falla('tania', 'crearDelegacion', [{ a: 'rosa@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: HOY_ISO }], /no puede recibir Compras/);
// Un super admin delega a nombre de otra persona (adri, solo requisiciones con aprobaciones, a efrain)
vd = ok('leo', 'crearDelegacion', { de: 'adri@helgen.tech', a: 'efrain@helgen.tech', roles: 'aprobaciones', desde: HOY_ISO, hasta: masDias(1) });
assert(vd.delegadores.some(x => x.correo === 'adri@helgen.tech' && x.roles.join() === 'aprobaciones'));
assert(vd.delegadores.some(x => x.correo === 'leo@helgen.tech'), 'el raíz también puede delegar');
const id2 = 'DEL-' + ANIO + '-0002';
assert.equal(ok('efrain', 'bootstrap').permisos.operaciones, true);
assert.equal(avisos().pop().actor, 'leo@helgen.tech');
// Programada: empieza mañana, hoy no cuenta
ok('pedro', 'crearDelegacion', { a: 'tania@helgen.tech', roles: ['aprobaciones'], desde: masDias(1), hasta: masDias(5) });
const id3 = 'DEL-' + ANIO + '-0003';
assert.equal(ok('tania', 'bootstrap').permisos.operaciones, false);
// Quién ve qué: super admin todas; los demás las que dieron y las que recibieron
assert.deepEqual(ok('leo', 'listarDelegaciones').delegaciones.map(d => d.id), [id3, id2, id1]);
assert.deepEqual(ok('tania', 'listarDelegaciones').delegaciones.map(d => d.id + ':' + d.estado), [id3 + ':Programada', id1 + ':Vigente']);
assert.deepEqual(ok('obrero', 'listarDelegaciones').delegaciones.map(d => d.id), [id1]);
assert.deepEqual(ok('adri', 'listarDelegaciones').delegaciones.map(d => d.id), [id2], 'solo requisiciones con aprobaciones también');
// Sincronizar trae Permisos y Delegaciones abiertas si cambiaron (según el rol)
let s = ok('leo', 'sincronizar', {}, { admPermisos: true, admDelegaciones: true });
assert(s.admPermisos.usuarios.length && s.admDelegaciones.delegaciones.length === 3);
s = ok('tania', 'sincronizar', {}, { admPermisos: true, admDelegaciones: true });
assert.deepEqual([s.admPermisos, s.admDelegaciones.delegaciones.length], [undefined, 2], 'Permisos solo para super admin');
// Termina sola: pasado "hasta" ya no da el rol
reloj(3 * DIA);
como(null);
assert(P.rolesEfectivos('obrero@helgen.tech', P.contextoRoles_()).roles.indexOf('compras') === -1, 'vencida');
assert(P.rolesEfectivos('tania@helgen.tech', P.contextoRoles_()).roles.indexOf('aprobaciones') !== -1, 'la programada ya empezó');
como('leo@helgen.tech', 'Leo');
assert.deepEqual(plain(P.listarDelegaciones().delegaciones.map(d => d.id + ':' + d.estado)), [id3 + ':Vigente', id2 + ':Terminada', id1 + ':Terminada']);
assert.throws(() => P.cancelarDelegacion(id2, 'Ya no hace falta'), /ya terminó/);
como(null);
reloj(0);
// Cancelar con motivo (quien la dio, quien la recibe o un super admin)
falla('tania', 'cancelarDelegacion', [id1, ''], /por qué cancelas/);
falla('pedro', 'cancelarDelegacion', [id1, 'No me corresponde'], /Solo quien la dio/, 'PERMISO');
vd = ok('tania', 'cancelarDelegacion', id1, 'Ya regresé de vacaciones');
assert.equal(vd.delegaciones.find(d => d.id === id1).estado, 'Cancelada');
const filaCanc = LA.pest.Delegaciones.m.find(x => x[0] === id1);
assert.deepEqual([filaCanc[6], filaCanc[9], filaCanc[10]], ['Cancelada', 'tania@helgen.tech', 'Ya regresé de vacaciones']);
assert.deepEqual(ultBit().slice(2, 6), ['Cancelar delegación', id1, 'tania@helgen.tech → obrero@helgen.tech', 'Ya regresé de vacaciones']);
assert.equal(ok('obrero', 'bootstrap').permisos.compras, false, 'cancelada: ya no tiene compras');
falla('obrero', 'listarRequisiciones', ['', ''], /permiso de compras/, 'PERMISO');
falla('tania', 'cancelarDelegacion', [id1, 'Otra vez la misma'], /ya estaba cancelada/);
ok('tania', 'cancelarDelegacion', id3, 'Ya no voy a viajar'); // la que recibió (programada)

// ================= Excepción de super admin a "nadie aprueba lo suyo" =================
const pry = ok('efrain', 'crearProyecto', { nombre: 'HBOX Manzanillo', ubicacion: 'Manzanillo', cliente: { nombre: 'Cliente' }, idSolicitud: 'p1' }).folio;
let nReq = 0;
const nuevaReq = () => ({ proyectoFolio: pry, sitio: 'Querétaro', renglones: [{ descripcion: 'Brida', cantidad: 4 }, { descripcion: 'Tornillo', cantidad: 10 }],
  idSolicitud: 'rq' + (++nReq) });
const todo = (v) => ({ version: v || 1, renglones: [1, 2].map(n => ({ renglon: n, aprobado: true })) });
// El delegado tampoco aprueba lo que pidió (efrain tiene aprobaciones de adri hasta mañana) y no es super admin: el motivo no basta
const rE = ok('efrain', 'guardarRequisicion', nuevaReq()).folio;
let e = falla('efrain', 'aprobarRequisicion', [rE, todo()], /tu propia requisición/, 'PERMISO');
assert(!/super admin/.test(e.error), 'a quien no es super admin no se le ofrece la excepción');
falla('efrain', 'aprobarRequisicion', [rE, todo(), 'Urgente: no hay nadie más en la oficina'], /tu propia requisición/, 'PERMISO');
assert.deepEqual([ok('efrain', 'getRequisicionOperaciones', rE).puedeAprobar, ok('efrain', 'getRequisicionOperaciones', rE).excepcionSuperAdmin], [false, false]);
// Super admin: sin motivo (o con uno corto) se niega; con motivo ≥ 10 aprueba y queda en la bitácora de Administración
const rL = ok('leo', 'guardarRequisicion', nuevaReq()).folio;
let vo = ok('leo', 'getRequisicionOperaciones', rL);
assert.deepEqual([vo.esPropia, vo.puedeAprobar, vo.excepcionSuperAdmin], [true, true, true], 'la vista deja intentarlo');
e = falla('leo', 'aprobarRequisicion', [rL, todo()], /tu propia requisición/, 'PERMISO');
assert(/Como super admin puedes hacerlo si escribes el motivo/.test(e.error));
falla('leo', 'aprobarRequisicion', [rL, todo(), 'corto'], /tu propia requisición/, 'PERMISO');
const nBit = bit().length;
falla('leo', 'aprobarRequisicion', [rL, todo(9), 'Pedro y Adriana están fuera hoy'], /cambió después de que la abriste/);
assert.equal(bit().length, nBit, 'si otra regla falla, no queda una excepción en la bitácora');
vo = ok('leo', 'aprobarRequisicion', rL, todo(), '  Pedro y Adriana están fuera hoy ');
assert.equal(vo.requisicion.estado, 'Aprobada');
assert.deepEqual(ultBit().slice(1, 6), ['leo@helgen.tech', 'Excepción de super admin: aprobar su propia requisición', rL, '', 'Pedro y Adriana están fuera hoy']);
// Visto bueno a lo propio y a lo que uno preparó
const PROP = id => ({ proveedor: { razonSocial: 'Ferretera del Puerto' }, fechaEntrega: masDias(1), formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0,
  recibe: 'pedro@helgen.tech', renglones: [{ renglon: 1, disponibilidad: 'Exacto', costo: 10 }, { renglon: 2, disponibilidad: 'Exacto', costo: 1 }], idSolicitud: id });
ok('leo', 'cotizarRequisicion', rL, PROP('pl1'));
vo = ok('leo', 'getRequisicionOperaciones', rL);
assert.deepEqual([vo.preparoPropuesta, vo.puedeVisto, vo.excepcionSuperAdmin], [true, true, true]);
e = falla('leo', 'autorizarPropuesta', [rL, vo.propuesta.version, 'vb1', vo.propuesta.huella], /tu propia requisición.*Como super admin/, 'PERMISO');
const rv = ok('leo', 'autorizarPropuesta', rL, vo.propuesta.version, 'vb1', vo.propuesta.huella, 'Compra urgente autorizada por dirección');
assert.equal(rv.vista.requisicion.estado, 'Autorizada');
assert(/^OC-/.test(rv.ocFolio));
assert.deepEqual(ultBit().slice(2, 6), ['Excepción de super admin: visto bueno a su propia requisición y una propuesta que preparó', rL, '',
  'Compra urgente autorizada por dirección']);
// Quien no es super admin no se salta la regla aunque escriba motivo (efrain preparó la propuesta de su requisición)
ok('pedro', 'aprobarRequisicion', rE, todo());
ok('efrain', 'cotizarRequisicion', rE, PROP('pe1'));
vo = ok('efrain', 'getRequisicionOperaciones', rE);
assert.equal(vo.puedeVisto, false);
falla('efrain', 'autorizarPropuesta', [rE, vo.propuesta.version, 'vb2', vo.propuesta.huella, 'Necesito el material para mañana'], /tu propia requisición/, 'PERMISO');
// La propuesta que preparó otro super admin sobre una requisición ajena: solo "preparó"
const rP = ok('pedro', 'guardarRequisicion', nuevaReq()).folio;
ok('adri', 'aprobarRequisicion', rP, todo());
ok('jefa', 'cotizarRequisicion', rP, PROP('pj1'));
vo = ok('jefa', 'getRequisicionOperaciones', rP);
falla('jefa', 'autorizarPropuesta', [rP, vo.propuesta.version, 'vb3', vo.propuesta.huella], /una propuesta que tú preparaste.*Como super admin/, 'PERMISO');
ok('jefa', 'autorizarPropuesta', rP, vo.propuesta.version, 'vb3', vo.propuesta.huella, 'Pedro está de viaje esta semana');
assert.equal(ultBit()[2], 'Excepción de super admin: visto bueno a una propuesta que preparó');
console.log('OK identidad (servidor)');

// ================= Interfaz =================
const html = fs.readFileSync(path.join(dir, 'web/home/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
const apiWeb = scripts.find(x => x.id === 'api-web').src, app = scripts.find(x => !x.id).src, modId = scripts.find(x => x.id === 'mod-identidad').src;
assert(/<h2>CAPRI<\/h2>/.test(html) && /Cotizaciones · Aprobaciones · Pagos · Requisiciones · Inventario/.test(html), 'caja de entrada CAPRI');
assert(/Soy de @helgen\.services/.test(html));

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenG = (email, segs) => 'h.' + b64({ email, given_name: 'Ana', family_name: 'López', hd: 'helgen.tech', exp: Math.floor(Date.now() / 1000) + segs }) + '.f';
const tokenC = (email, n, segs) => 'capri.' + b64({ e: email, n, x: Math.floor(Date.now() / 1000) + segs }) + '.firma';

/** Página con DOM, fetch, almacenamiento y Google Identity Services simulados. */
function montar(op) {
  op = op || {};
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, checked: false, hijos: [],
      oyentes: {}, _clases: new Set(), porClase: {}, style: {}, dataset: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c),
        toggle: (c, f) => (f === undefined ? !e._clases.has(c) : f) ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')),
      querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }),
    createElement: t => elemento(t), visibilityState: 'visible', activeElement: null,
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  // Como el HTML: el login se ve hasta que hay sesión; los paneles de código y Administración ocultos
  ['tabCob', 'tabCom', 'loginCodigo', 'loginPaso2', 'vistaAdmin'].forEach(id => document.getElementById(id).classList.add('oculto'));
  const sesion = Object.assign({}, op.session || {}), local = Object.assign({}, op.local || {});
  const bootDatos = Object.assign({ permisos: {}, catalogo: [], clientes: [], proyectos: [], marcas: {}, ivaTasa: 0.16 }, op.boot || {});
  const llamadas = [], respuestas = Object.assign({ bootstrap: { ok: true, datos: bootDatos },
    sincronizar: { ok: true, datos: { versiones: {}, permisos: (op.boot || {}).permisos || {}, cambios: [] } } }, op.respuestas || {});
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const x = respuestas[c.funcion]; const datos = typeof x === 'function' ? x(c) : x;
    return { ok: true, json: async () => datos || { ok: false, error: 'sin respuesta simulada: ' + c.funcion } };
  }
  const gis = { prompts: [], desactivado: 0, initialize: o => { gis.opciones = o; }, renderButton() {},
    disableAutoSelect: () => gis.desactivado++ };
  gis.prompt = f => gis.prompts.push(f || null);
  const timers = [];
  const dialogos = { prompt: null, confirmar: true, vistos: [] };
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: x => Buffer.from(x, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => sesion[k] ?? null, setItem: (k, v) => sesion[k] = String(v), removeItem: k => delete sesion[k] },
    localStorage: { getItem: k => local[k] ?? null, setItem: (k, v) => local[k] = String(v), removeItem: k => delete local[k] },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    confirm: m => { dialogos.vistos.push(m); return dialogos.confirmar; },
    prompt: m => { dialogos.vistos.push(m); return Array.isArray(dialogos.prompt) ? dialogos.prompt.shift() : dialogos.prompt; },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: n => { if (timers[n - 1]) timers[n - 1].cancelado = true; },
    setInterval: () => 0, scrollTo() {}, location: { recargas: 0, reload() { this.recargas++; } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(apiWeb, ctx); vm.runInContext(app, ctx); vm.runInContext(modId, ctx);
  const cargarGis = () => { ctx.google.accounts = { id: gis }; ctx.iniciarGis(); };
  return { ctx, $: id => document.getElementById(id), llamadas, respuestas, sesion, local, gis, cargarGis, timers, dialogos, document,
    run: c => vm.runInContext(c, ctx) };
}
const esperar = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(res => setImmediate(res)); };

(async () => {
  // --- Google: la sesión vive en localStorage (pestañas nuevas y al reabrir el navegador); la de sessionStorage se migra ---
  const tA = tokenG('ana@helgen.tech', 3600);
  let U = montar({ session: { cotizadorHelgenSesion: tA } });
  await esperar();
  assert.equal(U.local.cotizadorHelgenSesion, tA, 'pasa a localStorage');
  assert.equal(U.sesion.cotizadorHelgenSesion, undefined);
  assert(U.$('login').classList.contains('oculto'));
  assert.equal(U.$('usuarioNombre').textContent, 'Ana López');
  assert.deepEqual([U.llamadas[0].funcion, U.llamadas[0].token], ['bootstrap', tA]);
  U.run('cerrarSesion()');
  assert.deepEqual([U.local.cotizadorHelgenSesion, U.local.capriSesion], [undefined, undefined], 'cerrar sesión borra las dos');
  assert(!U.$('login').classList.contains('oculto'));

  // --- Google vencido: primero intenta entrar sin clics (One Tap con auto_select); si Google no puede, muestra el login ---
  U = montar({ local: { cotizadorHelgenSesion: tokenG('ana@helgen.tech', -10) } });
  await esperar();
  assert(U.$('login').classList.contains('oculto'), 'no muestra el login todavía');
  assert.equal(U.llamadas.length, 0, 'la carga espera la sesión');
  U.cargarGis();
  assert.equal(U.gis.opciones.auto_select, true);
  assert.equal(U.gis.prompts.length, 1, 'intento sin clics al cargar Google');
  const tA2 = tokenG('ana@helgen.tech', 3600);
  U.gis.opciones.callback({ credential: tA2 });
  await esperar();
  assert.deepEqual([U.llamadas.length, U.llamadas[0].token, U.local.cotizadorHelgenSesion], [1, tA2, tA2], 'entró sin clics y siguió');
  assert(U.timers.filter(t => t.ms === 15000).every(t => t.cancelado) && U.timers.some(t => t.ms === 15000), 'sin espera pendiente');
  U = montar({ local: { cotizadorHelgenSesion: tokenG('ana@helgen.tech', -10) } });
  U.cargarGis();
  U.gis.prompts[0]({ isSkippedMoment: () => true, isDismissedMoment: () => false });
  assert(!U.$('login').classList.contains('oculto'), 'Google no pudo: se muestra el login');

  // --- @helgen.services: pedir código y entrar, sin token (no espera en la cola) ---
  U = montar({ respuestas: {
    solicitarCodigo: c => ({ ok: true, datos: { mensaje: GENERICO } }),
    verificarCodigo: c => c.args[1] === '123456' ? { ok: true, datos: { token: tokenC('jesus@helgen.services', 'Jesús Honorato', 30 * 86400),
      correo: 'jesus@helgen.services', nombre: 'Jesús Honorato' } } : { ok: false, error: 'Código incorrecto o vencido. Revísalo o pide uno nuevo.' } } });
  await esperar();
  assert(!U.$('login').classList.contains('oculto'));
  assert.equal(U.llamadas.length, 0);
  U.run("loginCapri.verPanel('codigo')");
  assert(!U.$('loginCodigo').classList.contains('oculto') && U.$('loginGoogle').classList.contains('oculto'));
  U.$('loginCorreo').value = 'jesus@helgen.tech'; U.run('loginCapri.pedirCodigo()');
  assert(/entran con el botón de Google/.test(U.$('loginMsg').textContent));
  U.$('loginCorreo').value = ' Jesus@Helgen.services '; U.run('loginCapri.pedirCodigo()'); await esperar();
  assert.deepEqual(U.llamadas.map(c => [c.funcion, c.args, c.token]), [['solicitarCodigo', ['jesus@helgen.services'], undefined]], 'llamada pública sin token');
  assert.equal(U.$('loginInfo').textContent, GENERICO);
  assert(!U.$('loginPaso2').classList.contains('oculto'));
  U.$('loginNumero').value = '111111'; U.run('loginCapri.entrar()'); await esperar();
  assert(/Código incorrecto/.test(U.$('loginMsg').textContent));
  U.$('loginNumero').value = '123 456'; U.run('loginCapri.entrar()'); await esperar();
  const tC = U.local.capriSesion;
  assert(tC && tC.startsWith('capri.'), 'sesión de CAPRI en localStorage');
  assert(U.$('login').classList.contains('oculto'));
  assert.equal(U.$('usuarioNombre').textContent, 'Jesús Honorato', 'nombre en el encabezado');
  const boot = U.llamadas.find(c => c.funcion === 'bootstrap');
  assert(boot && boot.token === tC, 'la carga que esperaba sale con la sesión de CAPRI');
  // Renovación: el servidor manda sesionCapri y se guarda
  const tC2 = tokenC('jesus@helgen.services', 'Jesús Honorato', 30 * 86400 + 99);
  U.respuestas.sincronizar = { ok: true, datos: { versiones: {}, permisos: {}, cambios: [], sesionCapri: tC2 } };
  U.run('sincronizarAhora()'); await esperar();
  assert.equal(U.local.capriSesion, tC2, 'sesión renovada sin pedir nada');
  // ACCESO: mensaje en la pantalla de entrada, sin reintentar ni ciclos
  U.respuestas.listarDelegaciones = { ok: false, codigo: 'ACCESO', error: 'Tu acceso a CAPRI está desactivado. Pide ayuda a un administrador.' };
  const n1 = U.llamadas.length;
  U.run('var ERR_ACCESO = null; google.script.run.withFailureHandler(function (e) { ERR_ACCESO = e.codigo; }).listarDelegaciones()'); await esperar();
  assert.equal(U.run('ERR_ACCESO'), 'ACCESO', 'el error llega a quien llamó con su código');
  assert(!U.$('login').classList.contains('oculto'));
  assert(/desactivado/.test(U.$('loginMsg').textContent));
  assert(!U.$('loginCodigo').classList.contains('oculto'), 'una cuenta de código vuelve al panel de código');
  assert.equal(U.local.capriSesion, undefined, 'se olvida la sesión');
  U.run('sincronizarAhora()'); await esperar();
  assert.equal(U.llamadas.length, n1 + 1, 'no reintenta ni consulta sin sesión');
  // Entrar otra vez después de ACCESO recarga la página (carga limpia)
  U.$('loginCorreo').value = 'jesus@helgen.services'; U.$('loginNumero').value = '123456'; U.run('loginCapri.entrar()'); await esperar();
  assert.equal(U.ctx.location.recargas, 1);

  // --- CAPRI vencida al abrir: panel de código con el correo listo ---
  U = montar({ local: { capriSesion: tokenC('jesus@helgen.services', 'Jesús', -5) } });
  await esperar();
  assert(!U.$('login').classList.contains('oculto') && !U.$('loginCodigo').classList.contains('oculto'));
  assert.equal(U.$('loginCorreo').value, 'jesus@helgen.services');
  assert(/expiró/.test(U.$('loginMsg').textContent));
  U.cargarGis();
  assert.equal(U.gis.prompts.length, 0, 'sin One Tap de Google para una cuenta de código');

  // --- ACCESO con Google: desactiva auto_select (si no, entraría sola otra vez: ciclo) ---
  U = montar({ local: { cotizadorHelgenSesion: tokenG('baja@helgen.tech', 3600) },
    respuestas: { bootstrap: { ok: false, codigo: 'ACCESO', error: 'Tu cuenta no tiene acceso a CAPRI. Pide a un administrador que te dé de alta.' } } });
  U.cargarGis();
  await esperar();
  assert(!U.$('login').classList.contains('oculto') && /no tiene acceso/.test(U.$('loginMsg').textContent));
  assert.equal(U.gis.desactivado, 1);
  assert.equal(U.gis.prompts.length, 0, 'no lanza One Tap');
  assert.equal(U.llamadas.filter(c => c.funcion === 'bootstrap').length, 1);

  // --- Administración: Permisos (super admin) y Delegaciones ---
  const VP = plain(ok('leo', 'listarUsuarios')), VD = plain(ok('leo', 'listarDelegaciones'));
  U = montar({ local: { cotizadorHelgenSesion: tokenG('leo@helgen.tech', 3600) },
    boot: { permisos: { superadmin: true, ventas: true, compras: true, operaciones: true }, catalogo: [] },
    respuestas: { listarUsuarios: { ok: true, datos: VP }, listarDelegaciones: { ok: true, datos: VD },
      guardarUsuario: c => ({ ok: true, datos: VP }), crearDelegacion: c => ({ ok: true, datos: VD }), cancelarDelegacion: c => ({ ok: true, datos: VD }) } });
  // La consulta de fondo devuelve los permisos que la prueba aplicó (sin cambio de rol no se piden otras listas)
  U.respuestas.sincronizar = () => ({ ok: true, datos: { versiones: {}, permisos: JSON.parse(U.run('JSON.stringify(PERMISOS)')), cambios: [] } });
  await esperar();
  assert(!U.$('adminPermisos').classList.contains('oculto') && !U.$('adminDelegaciones').classList.contains('oculto'));
  U.run("verTab('admin')"); await esperar();
  assert(U.llamadas.some(c => c.funcion === 'listarUsuarios') && U.llamadas.some(c => c.funcion === 'listarDelegaciones'));
  const tabla = U.$('admUsuarios').innerHTML;
  assert(/Nuevo Uno/.test(tabla) && /Super admin raíz/.test(tabla) && /Desactivado/.test(tabla) && /entra con código/.test(tabla), tabla.slice(0, 300));
  // Alta con roles marcados y sitio
  U.run('identidad.nuevoUsuario()');
  assert(!U.$('admForm').classList.contains('oculto'));
  U.$('admCorreo').value = 'otra@helgen.tech'; U.$('admNombre').value = 'Otra Persona'; U.$('admSitio').value = 'QRO'; U.$('admActivo').checked = true;
  U.$('admRol_compras').checked = true; U.$('admRol_aprobaciones').checked = true;
  U.run('identidad.guardarUsuario()'); await esperar();
  const g = U.llamadas.filter(c => c.funcion === 'guardarUsuario').pop().args[0];
  assert.deepEqual([g.nuevo, g.correo, g.nombre, g.roles, g.sitio, g.activo], [true, 'otra@helgen.tech', 'Otra Persona', ['aprobaciones', 'compras'], 'QRO', true]);
  // Editar al raíz: no se puede desactivar ni quitarle Super admin desde la página
  U.run("identidad.editarUsuario('leo@helgen.tech')");
  assert.deepEqual([U.$('admCorreo').disabled, U.$('admActivo').disabled, U.$('admRol_superadmin').disabled], [true, true, true]);
  // @helgen.services: solo "Solo requisiciones"
  U.run('identidad.nuevoUsuario()'); U.$('admCorreo').value = 'pepe@helgen.services'; U.$('admCorreo').disparar('input');
  assert.deepEqual([U.$('admRol_compras').disabled, U.$('admRol_solo_requisicion').checked], [true, true]);
  // Delegaciones: formulario y cancelar con motivo
  assert(/DEL-/.test(U.$('admDelegLista').innerHTML));
  U.$('admDelDe').value = 'adri@helgen.tech'; U.$('admDelA').value = 'pedro@helgen.tech'; U.$('admDelDesde').value = HOY_ISO; U.$('admDelHasta').value = masDias(2);
  U.$('admDelRol_aprobaciones').checked = true;
  U.run('identidad.crearDelegacion()'); await esperar();
  const cd = U.llamadas.filter(c => c.funcion === 'crearDelegacion').pop().args[0];
  assert.deepEqual(cd, { de: 'adri@helgen.tech', a: 'pedro@helgen.tech', roles: ['aprobaciones'], desde: HOY_ISO, hasta: masDias(2) });
  U.dialogos.prompt = 'Ya no hace falta';
  U.run("identidad.cancelarDelegacion('" + id3 + "')"); await esperar();
  assert.deepEqual(U.llamadas.filter(c => c.funcion === 'cancelarDelegacion').pop().args, [id3, 'Ya no hace falta']);
  // Sincronizar: pide las vistas abiertas y repinta lo que llega
  assert.deepEqual([U.run('contextoSync()').admPermisos, U.run('contextoSync()').admDelegaciones], [true, true]);
  // Sin super admin: solo Delegaciones
  U.run('aplicarPermisos({compras:true}, false)');
  assert(U.$('adminPermisos').classList.contains('oculto') && !U.$('adminDelegaciones').classList.contains('oculto'));
  U.run('aplicarPermisos({ventas:true}, false)');
  assert(U.$('adminDelegaciones').classList.contains('oculto'));
  await esperar(30); // lo que dispararon los cambios de rol de la prueba termina antes de seguir

  // --- Excepción de super admin: el servidor niega por separación de funciones → se pide el motivo y se repite ---
  let intentos = 0;
  U.run('aplicarPermisos({superadmin:true, operaciones:true}, false)');
  U.respuestas.aprobarRequisicion = c => (++intentos, c.args[2] ? { ok: true, datos: Object.assign({}, VOPS, { requisicion: Object.assign({}, VOPS.requisicion, { estado: 'Aprobada' }) }) }
    : { ok: false, codigo: 'PERMISO', error: 'No puedes aprobar tu propia requisición: la aprueba otra persona de operaciones. Como super admin puedes hacerlo si escribes el motivo (mínimo 10 caracteres; queda en la bitácora).' });
  const VOPS = { requisicion: { folio: 'REQ-2026-0001', estado: 'Solicitada', solicitante: 'Leo', fecha: HOY_ISO, sitio: 'Querétaro' },
    proyecto: { folio: 'PRY-2026-0001', folioVisible: 'PRY-2026-0001-HBX', nombre: 'HBOX', estado: 'Activo' }, version: 1,
    renglones: [{ renglon: 1, descripcion: 'Brida', cantidad: 4, unidad: 'PZA', notas: '' }], eventos: [], propuesta: null, orden: null,
    esPropia: true, preparoPropuesta: false, excepcionSuperAdmin: true, puedeAprobar: true, puedeDevolver: true, puedeRechazar: true,
    puedeVisto: false, puedeRegresar: false };
  U.run('pintarOps(' + JSON.stringify(VOPS) + ')');
  assert(/como super admin/i.test(U.$('opsAviso').textContent), U.$('opsAviso').textContent);
  U.dialogos.prompt = 'corto';
  U.run('aprobarOps()'); await esperar();
  assert.equal(intentos, 1);
  assert(/mínimo 10/.test(U.$('aviso').innerHTML), 'motivo corto: no se manda');
  U.dialogos.prompt = 'Pedro y Adriana están fuera hoy';
  U.run('aprobarOps()'); await esperar();
  const ap = U.llamadas.filter(c => c.funcion === 'aprobarRequisicion');
  assert.equal(intentos, 3);
  assert.equal(ap.pop().args[2], 'Pedro y Adriana están fuera hoy', 'se repite con el motivo como último argumento');
  assert(/aprobada/.test(U.$('aviso').innerHTML));
  // Quien no es super admin solo ve el error
  U.run('aplicarPermisos({operaciones:true}, false)');
  U.run('pintarOps(' + JSON.stringify(Object.assign({}, VOPS, { excepcionSuperAdmin: false })) + ')');
  const nPrompts = U.dialogos.vistos.length;
  U.run('aprobarOps()'); await esperar();
  assert.equal(U.dialogos.vistos.length, nPrompts, 'sin pedir motivo');
  assert(/tu propia requisición/.test(U.$('aviso').innerHTML));
  console.log('OK identidad (interfaz)');
})().catch(err => { console.error(err); process.exit(1); });
