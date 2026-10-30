// Incremento 7 · módulo N (horas y nómina). Contrato: docs/incremento-7.md §0–§3; detalle: docs/incremento-7-nomina.md.
//  1. Lógica pura: semana ISO, horas por día (cuartos de hora, ≤ 24 h), normalizar y planear la semana (estados, parte aprobada que
//     no cambia, 24 h por día entre proyectos), partes, quién aprueba, Pendientes, reparto de costoNominaPorProyecto (contrato §1:
//     resto mayor, meses parciales, horas sin costear, solo aprobadas, sin datos por persona), meses, importes, CSV y recordatorio.
//  2. Servidor por doPost: rol Nómina (Permisos, no delegable), área privada NÓMINA (privado_, nada en la Base de datos), líder de
//     proyecto (super admin o cobranza), hoja de horas (validaciones y estados), separación de funciones (líder, Aprobaciones, super
//     admin con motivo), devolver con correo sin montos, Pendientes, @helgen.services, recordatorio una vez por semana, costos a mano
//     y en CSV, reporte de nómina, sincronizar por rol.
//  3. Privacidad: nadie sin Nómina obtiene un costo de una persona por NINGUNA función de la API, ni bootstrap ni sincronizar.
//  4. Interfaz (mod-horas sobre la app, conectada al servidor simulado): la semana en el teléfono, copiar la semana pasada, enviar,
//     aprobar como líder, líderes, costos y reporte según el rol.
// Uso: node tests/nomina.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const crearArnes = require('./arnes');
const PROPS = { ROL_COBRANZA: 'tania@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech', ROL_REQUISICION: 'obrero@helgen.tech',
  SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: 'adri@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' };
const A = crearArnes(dir, { props: Object.assign({}, PROPS) });
const { P, ok, falla, plain, props, libros, HOY_ISO, correr, como } = A;
A.tokens.nora = A.claims('nora@helgen.tech', 'Nora', 'Nómina');
A.tokens.luis = A.claims('luis@helgen.tech', 'Luis', 'Líder');
A.tokens.baja = A.claims('baja@helgen.tech', 'Baja', 'Inactiva');

// ================= 1. Lógica pura =================
// Semana ISO (lunes a domingo)
assert.equal(P.esLunesIso('2026-10-26'), true);
assert.equal(P.esLunesIso('2026-10-27'), false);
assert.equal(P.esLunesIso('2026-02-30'), false);
assert.deepEqual(plain(P.numeroSemanaIso('2026-10-29')), { anio: 2026, semana: 44 });
assert.deepEqual(plain(P.numeroSemanaIso('2025-12-29')), { anio: 2026, semana: 1 }, 'el jueves decide el año');
assert.deepEqual(plain(P.numeroSemanaIso('2027-01-01')), { anio: 2026, semana: 53 }, '2026 tiene 53 semanas');
assert.equal(P.textoSemanaHoras('2026-10-26'), 'del 26/10 al 01/11/2026');
assert.equal(P.textoSemanaHoras('2025-12-29'), 'del 29/12/2025 al 04/01/2026');
assert.deepEqual(plain(P.diasDeSemanaHoras('2026-10-26')), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
assert.equal(P.validarSemanaHoras('2026-10-26', '2026-10-29'), '2026-10-26');
assert.throws(() => P.validarSemanaHoras('2026-10-27', '2026-10-29'), /empieza en lunes/);
assert.throws(() => P.validarSemanaHoras('2026-11-02', '2026-10-29'), /semanas futuras/);
assert.throws(() => P.validarSemanaHoras('', '2026-10-29'), /La semana es obligatoria/);
assert.throws(() => P.validarSemanaHoras('2019-12-30', '2026-10-29'), /no es válida/);
// Horas por día: cuartos de hora, de 0 a 24
assert.deepEqual(plain(P.normalizarHorasDias(['8', 7.5, '', null, '0,25', 0, '24'], 'PRY')), [8, 7.5, 0, 0, 0.25, 0, 24]);
assert.throws(() => P.normalizarHorasDias([0.3], 'PRY-1'), /cuartos de hora.*PRY-1 \(lunes\)/);
assert.throws(() => P.normalizarHorasDias([0, 24.25], 'PRY-1'), /Máximo 24 h al día \(PRY-1, martes\)/);
assert.throws(() => P.normalizarHorasDias([0, 0, -1], 'PRY-1'), /no válidas en PRY-1 \(miércoles\)/);
assert.throws(() => P.normalizarHorasDias(['ocho'], 'PRY-1'), /no válidas/);
assert.throws(() => P.normalizarHorasDias([1, 1, 1, 1, 1, 1, 1, 1], 'PRY-1'), /7 días/);
// Lo que manda la interfaz
const SEM = '2026-10-26', HOY0 = '2026-10-29';
const sem = (bloques, enviar) => plain(P.normalizarSemanaHoras({ semana: SEM, bloques, enviar }, { hoy: HOY0 }));
assert.deepEqual(sem([{ proyecto: 'pry-2026-0002-dro', horas: [8, 8], actividad: '  Instalación   de antenas ' },
  { proyecto: 'PRY-2026-0003', horas: [], actividad: 'Nada' }], true),
  { semana: SEM, enviar: true, bloques: [{ proyecto: 'PRY-2026-0002', horas: [8, 8, 0, 0, 0, 0, 0], actividad: 'Instalación de antenas' }] },
  'folio con clave → interno; un proyecto sin horas se quita aunque traiga actividad');
assert.equal(sem([], 'si').enviar, false, 'enviar solo con true');
assert.throws(() => sem([{ proyecto: 'PRY-2026-0002', horas: [1], actividad: 'ok ok' }, { proyecto: 'PRY-2026-0002-DRO', horas: [1], actividad: 'otra' }]), /dos veces/);
assert.throws(() => sem([{ proyecto: 'PRY-2026-0002', horas: [1], actividad: 'x' }]), /Escribe la actividad de PRY-2026-0002/);
assert.throws(() => sem([{ proyecto: 'HLG-2026-0001', horas: [1], actividad: 'xxxx' }]), /Proyecto no válido/);
assert.throws(() => sem([{ proyecto: 'PRY-2026-0002', horas: [1], actividad: 'x'.repeat(301) }]), /máximo 300/);
assert.throws(() => sem(Array.from({ length: 16 }, (_, i) => ({ proyecto: 'PRY-2026-' + String(i + 10).padStart(4, '0'), horas: [0.25], actividad: 'abc' }))), /Máximo 15 proyectos/);
// Partes y estados
const H = (correo, proyecto, dia, horas, extra) => Object.assign({ correo, semana: SEM, proyecto, dia, horas, actividad: 'Act ' + proyecto,
  estado: 'Borrador', fila: 0 }, extra || {});
const partes = plain(P.bloquesDeHoras([H('a@helgen.tech', 'PRY-2026-0002', '2026-10-26', 8, { fila: 2 }), H('a@helgen.tech', 'PRY-2026-0002', '2026-11-01', 2, { fila: 3 }),
  H('a@helgen.tech', 'PRY-2026-0003', '2026-10-27', 4, { fila: 4 }), H('a@helgen.tech', 'PRY-2026-0002', '2026-11-02', 9, { fila: 5 })]));
assert.deepEqual(partes.map(b => [b.proyecto, b.horas, b.filas]), [['PRY-2026-0002', [8, 0, 0, 0, 0, 0, 2], [2, 3, 5]], ['PRY-2026-0003', [0, 4, 0, 0, 0, 0, 0], [4]]],
  'una parte por persona, semana y proyecto; un día fuera de la semana no suma');
assert.equal(P.estadoSemanaHoras([]), 'Sin capturar');
assert.equal(P.estadoSemanaHoras([{ estado: 'Aprobada' }, { estado: 'Enviada' }]), 'Enviada');
assert.equal(P.estadoSemanaHoras([{ estado: 'Aprobada' }, { estado: 'Borrador' }, { estado: 'Devuelta' }]), 'Devuelta');
assert.equal(P.estadoSemanaHoras([{ estado: 'Aprobada' }]), 'Aprobada');
// Plan de la semana
const B = (proyecto, horas, estado, extra) => Object.assign({ proyecto, horas: horas.concat([0, 0, 0, 0, 0, 0, 0]).slice(0, 7), actividad: 'Act', estado,
  motivo: '', enviada: '', filas: [] }, extra || {});
const N = (proyecto, horas, actividad) => ({ proyecto, horas: horas.concat([0, 0, 0, 0, 0, 0, 0]).slice(0, 7), actividad: actividad || 'Act' });
let plan = plain(P.planSemanaHoras([], [N('PRY-1', [8])], false));
assert.deepEqual(plan.escribir.map(b => [b.proyecto, b.estado, b.enviada]), [['PRY-1', 'Borrador', '']]);
plan = plain(P.planSemanaHoras([], [N('PRY-1', [8])], true));
assert.deepEqual(plan.escribir.map(b => [b.estado, b.enviada]), [['Enviada', null]], 'enviada = ahora');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Enviada', { enviada: '2026-10-28 10:00:00' })], [N('PRY-1', [8])], true));
assert.deepEqual(plan.escribir.map(b => [b.estado, b.enviada]), [['Enviada', '2026-10-28 10:00:00']], 'reenviar sin cambios conserva cuándo se envió');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Enviada')], [N('PRY-1', [7])], false));
assert.equal(plan.escribir[0].estado, 'Borrador', 'una enviada que cambia sin reenviarse regresa a borrador');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Enviada')], [N('PRY-1', [8])], false));
assert.equal(plan.escribir[0].estado, 'Enviada', 'sin cambios se queda como estaba');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Devuelta', { motivo: 'Faltó el sábado' })], [N('PRY-1', [8, 0, 0, 0, 0, 4])], false));
assert.deepEqual([plan.escribir[0].estado, plan.escribir[0].motivo], ['Devuelta', 'Faltó el sábado'], 'devuelta sigue devuelta hasta reenviarla');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Devuelta', { motivo: 'Faltó el sábado' })], [N('PRY-1', [8, 0, 0, 0, 0, 4])], true));
assert.deepEqual([plan.escribir[0].estado, plan.escribir[0].motivo], ['Enviada', ''], 'al reenviar se va el motivo (queda en la bitácora)');
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Aprobada'), B('PRY-2', [2], 'Borrador')], [N('PRY-1', [8])], false));
assert.deepEqual([plan.conservar.length, plan.escribir.length, plan.quitar.map(b => b.proyecto)], [1, 0, ['PRY-2']], 'la aprobada se conserva; la que no viene se quita');
assert.throws(() => P.planSemanaHoras([B('PRY-1', [8], 'Aprobada')], [N('PRY-1', [8])], true), /ya están aprobadas: no hay nada por enviar/);
plan = plain(P.planSemanaHoras([B('PRY-1', [8], 'Aprobada')], [], false));
assert.deepEqual([plan.conservar.length, plan.quitar.length], [1, 0], 'una aprobada nunca se quita');
assert.throws(() => P.planSemanaHoras([B('PRY-1', [8], 'Aprobada')], [N('PRY-1', [7])], false), /ya están aprobadas: no se pueden cambiar/);
assert.throws(() => P.planSemanaHoras([B('PRY-1', [8], 'Aprobada')], [N('PRY-1', [8], 'Otra actividad')], false), /ya están aprobadas/);
assert.throws(() => P.planSemanaHoras([B('PRY-1', [16], 'Aprobada')], [N('PRY-2', [8.25])], false), /lunes suma 24.25 h: máximo 24 h al día/,
  '24 h por día entre todos los proyectos (también los aprobados)');
assert.doesNotThrow(() => P.planSemanaHoras([B('PRY-1', [16], 'Aprobada')], [N('PRY-2', [8])], false));
assert.throws(() => P.planSemanaHoras([], [], true), /al menos un cuarto de hora/);
// Quién aprueba
assert.equal(P.quienApruebaHoras('a@helgen.tech', 'l@helgen.tech'), 'lider');
assert.equal(P.quienApruebaHoras('l@helgen.tech', 'L@helgen.tech'), 'aprobaciones', 'las horas del líder: Aprobaciones');
assert.equal(P.quienApruebaHoras('a@helgen.tech', ''), 'aprobaciones', 'sin líder: Aprobaciones');
const perm = (yo, roles, correo, lider) => plain(P.permisoAprobarHoras(yo, roles, correo, lider));
assert.deepEqual(perm('l@helgen.tech', {}, 'a@helgen.tech', 'l@helgen.tech'), { puede: true, propio: false, como: 'lider' });
assert.deepEqual(perm('ap@helgen.tech', { aprobaciones: true }, 'a@helgen.tech', 'l@helgen.tech'), { puede: false, propio: false, como: 'lider' },
  'Aprobaciones no aprueba lo que le toca al líder');
assert.deepEqual(perm('ap@helgen.tech', { aprobaciones: true }, 'l@helgen.tech', 'l@helgen.tech'), { puede: true, propio: false, como: 'aprobaciones' });
assert.deepEqual(perm('l@helgen.tech', {}, 'l@helgen.tech', 'l@helgen.tech'), { puede: false, propio: true, como: 'aprobaciones' }, 'nadie aprueba lo suyo');
assert.deepEqual(perm('ap@helgen.tech', { aprobaciones: true }, 'ap@helgen.tech', ''), { puede: false, propio: true, como: 'aprobaciones' });
assert.deepEqual(perm('sa@helgen.tech', { aprobaciones: true, superadmin: true }, 'a@helgen.tech', 'l@helgen.tech'), { puede: true, propio: false, como: 'superadmin' });
assert.deepEqual(perm('x@helgen.tech', {}, 'a@helgen.tech', ''), { puede: false, propio: false, como: 'aprobaciones' });
// Pendientes de horas (sin costos)
const baseP = [
  { correo: 'a@helgen.tech', nombre: 'Ana', semana: SEM, proyecto: 'PRY-1', proyectoVisible: 'PRY-1-AAA', horas: 8, enviada: '2026-10-28 09:00:00', lider: 'l@helgen.tech' },
  { correo: 'a@helgen.tech', nombre: 'Ana', semana: SEM, proyecto: 'PRY-2', proyectoVisible: 'PRY-2-BBB', horas: 4.5, enviada: '2026-10-27 18:00:00', lider: 'l@helgen.tech' },
  { correo: 'a@helgen.tech', nombre: 'Ana', semana: SEM, proyecto: 'PRY-3', proyectoVisible: 'PRY-3-CCC', horas: 2, enviada: '2026-10-28 09:00:00', lider: '' },
  { correo: 'l@helgen.tech', nombre: 'Luis', semana: SEM, proyecto: 'PRY-1', proyectoVisible: 'PRY-1-AAA', horas: 6, enviada: '2026-10-29 08:00:00', lider: 'l@helgen.tech' },
];
let ih = plain(P.itemsHorasPendientes(baseP, { yo: 'l@helgen.tech', roles: {}, hoy: '2026-10-29', nombres: { 'a@helgen.tech': 'Ana López' } }));
assert.deepEqual(ih.map(x => [x.tipo, x.seccion, x.folio, x.destino, x.desde, x.dias]), [['horas', 'horas', 'Horas · Ana López', 'horas', '2026-10-27', 2]],
  'el líder: una tarjeta por persona y semana; no ve las suyas ni las de un proyecto sin líder');
assert.equal(ih[0].detalle, 'semana del 26/10 al 01/11/2026 · 12.5 h · PRY-1-AAA, PRY-2-BBB');
ih = plain(P.itemsHorasPendientes(baseP, { yo: 'ap@helgen.tech', roles: { aprobaciones: true }, hoy: '2026-10-29' }));
assert.deepEqual(ih.map(x => x.folio + ' · ' + x.detalle.split(' · ').slice(1).join(' · ')), ['Horas · Ana · 2 h · PRY-3-CCC', 'Horas · Luis · 6 h · PRY-1-AAA'],
  'Aprobaciones: lo del líder y lo de un proyecto sin líder');
assert.deepEqual(plain(P.itemsHorasPendientes(baseP, { yo: 'a@helgen.tech', roles: { aprobaciones: true }, hoy: '2026-10-29' })).map(x => x.folio), ['Horas · Luis'],
  'nunca las propias');
ih = plain(P.itemsHorasPendientes(baseP, { yo: 'sa@helgen.tech', roles: { aprobaciones: true }, todos: true, hoy: '2026-10-29', nombres: { 'l@helgen.tech': 'Luis L' } }));
assert.deepEqual(ih.map(x => x.folio + ' → ' + x.para), ['Horas · Ana → Luis L', 'Horas · Ana → Aprobaciones', 'Horas · Luis L → Aprobaciones'], 'todos: a quién espera');
assert(!/\$|MXN|costo/i.test(JSON.stringify(ih)), 'sin montos');

// ---- Reparto de nómina: costoNominaPorProyecto (contrato §1) ----
const HA = (correo, proyecto, dia, horas, estado) => ({ correo, proyecto, dia, horas, estado: estado === undefined ? 'Aprobada' : estado });
const C = (correo, mes, costo) => ({ correo, mes, costo });
let cn = plain(P.costoNominaPorProyecto([HA('ana@helgen.tech', 'PRY-2026-0001', '2026-10-05', 60), HA('ana@helgen.tech', 'PRY-2026-0002', '2026-10-06', 20),
  HA('ana@helgen.tech', 'PRY-2026-0003', '2026-10-07', 40)], [C('ana@helgen.tech', '2026-10', 30000)]));
assert.deepEqual(cn, {
  'PRY-2026-0001': [{ concepto: 'Nómina', moneda: 'MXN', monto: 15000, horas: 60, sinCostear: 0 }],
  'PRY-2026-0002': [{ concepto: 'Nómina', moneda: 'MXN', monto: 5000, horas: 20, sinCostear: 0 }],
  'PRY-2026-0003': [{ concepto: 'Nómina', moneda: 'MXN', monto: 10000, horas: 40, sinCostear: 0 }] }, 'costo × horas del proyecto / horas del mes');
// Resto mayor: tres proyectos con la misma hora → 33.34 + 33.33 + 33.33 = 100.00 exacto
cn = plain(P.costoNominaPorProyecto([HA('a@helgen.tech', 'PRY-2026-0003', '2026-10-01', 1), HA('a@helgen.tech', 'PRY-2026-0001', '2026-10-01', 1),
  HA('a@helgen.tech', 'PRY-2026-0002', '2026-10-01', 1)], [C('a@helgen.tech', '2026-10', 100)]));
assert.deepEqual(Object.keys(cn).map(f => cn[f][0].monto), [33.34, 33.33, 33.33]);
// Mes parcial: una semana que cruza de octubre a noviembre; noviembre sin costo = horas sin costear (no se inventa)
const cruza = [HA('b@helgen.tech', 'PRY-2026-0001', '2026-10-30', 8), HA('b@helgen.tech', 'PRY-2026-0002', '2026-10-31', 4),
  HA('b@helgen.tech', 'PRY-2026-0001', '2026-11-01', 6), HA('b@helgen.tech', 'PRY-2026-0001', '2026-10-01', 12)];
cn = plain(P.costoNominaPorProyecto(cruza, [C('b@helgen.tech', '2026-10', 24000)]));
assert.deepEqual(cn, {
  'PRY-2026-0001': [{ concepto: 'Nómina', moneda: 'MXN', monto: 20000, horas: 26, sinCostear: 6 }],
  'PRY-2026-0002': [{ concepto: 'Nómina', moneda: 'MXN', monto: 4000, horas: 4, sinCostear: 0 }] },
  'octubre: 20 de 24 h y 4 de 24 h; el 1 de noviembre (otro mes, sin costo) queda sin costear');
const porMes = plain(P.costoNominaPorProyectoMes(cruza, [C('b@helgen.tech', '2026-10', 24000), C('b@helgen.tech', '2026-11', 12000)]));
assert.deepEqual(porMes['PRY-2026-0001'], { '2026-10': { monto: 20000, horas: 20, sinCostear: 0 }, '2026-11': { monto: 12000, horas: 6, sinCostear: 0 } },
  'con costo de noviembre, sus 6 h llevan todo noviembre (es lo único que trabajó ese mes)');
// Solo horas aprobadas; sin estado = aprobada (quien llama ya filtró); otra persona en el mismo proyecto suma; folio con clave
cn = plain(P.costoNominaPorProyecto([HA('a@helgen.tech', 'PRY-2026-0001-DRO', '2026-10-01', 10), HA('a@helgen.tech', 'PRY-2026-0002', '2026-10-01', 10, 'Enviada'),
  HA('a@helgen.tech', 'PRY-2026-0002', '2026-10-02', 5, 'Borrador'), HA('c@helgen.tech', 'PRY-2026-0001', '2026-10-01', 4, undefined),
  { correo: 'c@helgen.tech', proyectoFolio: 'PRY-2026-0002', dia: '2026-10-03', horas: 4 }],
  [C('a@helgen.tech', '2026-10', 1000), C('c@helgen.tech', '2026-10', 800), C('A@helgen.tech', '2026-10', 1500)]));
assert.deepEqual(cn, {
  'PRY-2026-0001': [{ concepto: 'Nómina', moneda: 'MXN', monto: 1500 + 400, horas: 14, sinCostear: 0 }],
  'PRY-2026-0002': [{ concepto: 'Nómina', moneda: 'MXN', monto: 400, horas: 4, sinCostear: 0 }] },
  'enviadas y borradores no cuentan; si un costo se repite vale el último; dos personas en un proyecto se suman');
// Sin costo de nadie: horas sin costear, monto 0; un costo sin horas no se reparte (repartoNomina lo dice aparte)
cn = plain(P.costoNominaPorProyecto([HA('a@helgen.tech', 'PRY-2026-0001', '2026-09-30', 7.75)], [C('z@helgen.tech', '2026-09', 5000)]));
assert.deepEqual(cn, { 'PRY-2026-0001': [{ concepto: 'Nómina', moneda: 'MXN', monto: 0, horas: 7.75, sinCostear: 7.75 }] });
assert.deepEqual(plain(P.repartoNomina([], [C('z@helgen.tech', '2026-09', 5000)]).sinHoras), [{ correo: 'z@helgen.tech', mes: '2026-09', costo: 5000 }]);
assert.deepEqual(plain(P.costoNominaPorProyecto([], [])), {});
assert.deepEqual(plain(P.costoNominaPorProyecto(null, null)), {});
// Datos raros se ignoran: horas 0, día no válido, sin proyecto, costo 0 o negativo
cn = plain(P.costoNominaPorProyecto([HA('a@helgen.tech', 'PRY-2026-0001', '2026-10-01', 0), HA('a@helgen.tech', 'PRY-2026-0001', '01/10/2026', 3),
  HA('a@helgen.tech', '', '2026-10-01', 3), HA('a@helgen.tech', 'PRY-2026-0001', '2026-10-01', 2)], [C('a@helgen.tech', '2026-10', -5)]));
assert.deepEqual(cn, { 'PRY-2026-0001': [{ concepto: 'Nómina', moneda: 'MXN', monto: 0, horas: 2, sinCostear: 2 }] });
// Nunca datos por persona: solo concepto, moneda, monto, horas y sin costear
Object.keys(cn).forEach(f => cn[f].forEach(x => assert.deepEqual(Object.keys(x).sort(), ['concepto', 'horas', 'moneda', 'monto', 'sinCostear'])));
// Suma exacta con muchos cuartos de hora: el reparto de una persona suma su costo exacto
{
  const hs = [], fs = ['PRY-2026-0001', 'PRY-2026-0002', 'PRY-2026-0003', 'PRY-2026-0004', 'PRY-2026-0005', 'PRY-2026-0006', 'PRY-2026-0007'];
  for (let d = 1; d <= 28; d++) hs.push(HA('q@helgen.tech', fs[d % 7], '2026-02-' + String(d).padStart(2, '0'), 0.25 * ((d * 7) % 13 + 1)));
  const r = plain(P.costoNominaPorProyecto(hs, [C('q@helgen.tech', '2026-02', 33333.33)]));
  assert.equal(Math.round(Object.keys(r).reduce((s, f) => s + r[f][0].monto * 100, 0)), 3333333, 'la suma de los proyectos es el costo exacto');
}
// Meses, rango e importes
assert.deepEqual(['2026-10', '2026/1', '10/2026', '2026-10-31', '15/10/2026', "'2026-10", '2026-13', '2019-12', '2026-02-30', 'oct'].map(P.mesValido),
  ['2026-10', '2026-01', '2026-10', '2026-10', '2026-10', '2026-10', '', '', '', '']);
assert.equal(P.mesMas('2026-11', 3), '2027-02');
assert.equal(P.mesMas('2026-01', -1), '2025-12');
assert.deepEqual(plain(P.rangoMesesNomina('', '', '2026-10-29')).meses, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'], 'por omisión, 6 meses');
assert.deepEqual(plain(P.rangoMesesNomina('2026-09', '2026-10', '2026-10-29')), { desde: '2026-09', hasta: '2026-10', meses: ['2026-09', '2026-10'] });
assert.throws(() => P.rangoMesesNomina('2026-10', '2026-09', '2026-10-29'), /anterior al final/);
assert.throws(() => P.rangoMesesNomina('2024-01', '2026-10', '2026-10-29'), /máximo 24 meses/);
assert.throws(() => P.rangoMesesNomina('x', '2026-10', '2026-10-29'), /mes inicial/);
assert.deepEqual(['45000', '45,000.50', '$45,000', '45000,5', ' 45 000 MXN ', 1200.5, '4,50,00', 'abc', ''].map(P.importeDeTexto),
  [45000, 45000.5, 45000, 45000.5, 45000, 1200.5, null, null, null]);
assert.deepEqual(plain(P.normalizarCostoPersonal({ correo: ' Ana@Helgen.tech ', mes: '10/2026', costo: '$32,500.555', notas: ' Sueldo  + IMSS ' })),
  { correo: 'ana@helgen.tech', mes: '2026-10', costo: 32500.56, notas: 'Sueldo + IMSS', quitar: false });
assert.throws(() => P.normalizarCostoPersonal({ correo: 'ana@gmail.com', mes: '2026-10', costo: 1 }), /@helgen.tech o @helgen.services/);
assert.throws(() => P.normalizarCostoPersonal({ correo: 'ana@helgen.tech', mes: 'octubre', costo: 1 }), /AAAA-MM/);
assert.throws(() => P.normalizarCostoPersonal({ correo: 'ana@helgen.tech', mes: '2026-10', costo: 0 }), /mayor a cero/);
assert.throws(() => P.normalizarCostoPersonal({ correo: 'ana@helgen.tech', mes: '2026-10', costo: 5000000.01 }), /no puede pasar/);
assert.equal(P.normalizarCostoPersonal({ correo: 'ana@helgen.tech', mes: '2026-10', quitar: true }).quitar, true);
// CSV: con encabezado (columnas por nombre), sin encabezado, punto y coma, comillas con miles, BOM, errores por renglón
let csv = plain(P.leerCsvCostos('﻿Correo,Costo,Mes,Notas\r\nana@helgen.tech,"45,000.00",2026-10,Sueldo\r\n\r\nmal@gmail.com,1,2026-10,\r\nobrero@helgen.tech,abc,2026-10\r\n'));
assert.deepEqual(csv.map(r => [r.fila, r.correo, r.mes, r.costo, r.notas, !!r.error]),
  [[2, 'ana@helgen.tech', '2026-10', 45000, 'Sueldo', false], [4, 'mal@gmail.com', '2026-10', 1, '', true], [5, 'obrero@helgen.tech', '2026-10', 0, '', true]]);
assert(/mayor a cero/.test(csv[2].error) && /@helgen.tech/.test(csv[1].error));
csv = plain(P.leerCsvCostos('ana@helgen.tech;2026/11;45000,5\nleo@helgen.tech;01/11/2026;"1,000"'));
assert.deepEqual(csv.map(r => [r.fila, r.correo, r.mes, r.costo, r.error]), [[1, 'ana@helgen.tech', '2026-11', 45000.5, ''], [2, 'leo@helgen.tech', '2026-11', 1000, '']],
  'sin encabezado y con punto y coma; fecha de Excel dd/mm/aaaa');
assert(/columnas correo, mes y costo/.test(P.leerCsvCostos('correo,importe\na@helgen.tech,1')[0].error));
assert.deepEqual(plain(P.leerCsvCostos('')), []);
assert.deepEqual(plain(P.renglonesCsv('a,"b ""c"", d"\n"x\ny",z\n\nw,1')), [{ linea: 1, campos: ['a', 'b "c", d'] }, { linea: 2, campos: ['x\ny', 'z'] },
  { linea: 5, campos: ['w', '1'] }], 'comillas dobles y saltos de línea dentro de comillas; el renglón del archivo');
// Recordatorio: viernes desde las 12:00 (o sábado y domingo), una vez por semana
assert.equal(P.tocaRecordatorioHoras('2026-10-29', 18, ''), '', 'jueves no');
assert.equal(P.tocaRecordatorioHoras('2026-10-30', 11, ''), '', 'viernes antes de las 12 no');
assert.equal(P.tocaRecordatorioHoras('2026-10-30', 12, ''), '2026-10-26');
assert.equal(P.tocaRecordatorioHoras('2026-11-01', 3, ''), '2026-10-26', 'domingo, si el viernes no corrió');
assert.equal(P.tocaRecordatorioHoras('2026-10-31', 9, '2026-10-26'), '', 'ya se mandó esta semana');
assert.equal(P.tocaRecordatorioHoras('2026-11-06', 13, '2026-10-26'), '2026-11-02', 'la semana siguiente sí');
assert.equal(P.tocaRecordatorioHoras('mal', 13, ''), '');
assert.deepEqual(plain(P.destinatariosRecordatorioHoras({ 'b@helgen.tech': { correo: 'b@helgen.tech', activo: true }, 'a@helgen.tech': { correo: 'a@helgen.tech', activo: true },
  'c@helgen.services': { correo: 'c@helgen.services', activo: true }, 'd@helgen.tech': { correo: 'd@helgen.tech', activo: false },
  'e@helgen.tech': { correo: 'e@helgen.tech', activo: true } }, { 'e@helgen.tech': true }, ['B@helgen.tech'])), ['a@helgen.tech', 'c@helgen.services'],
  'activos que no enviaron, menos los excluidos');
// Aviso de horas: uno por persona; sin montos; la nota no va
assert.deepEqual(plain(P.destinatariosAvisoHoras('horas.recordatorio', { para: ['a@helgen.tech', 'b@helgen.tech'] })),
  [{ quien: 'persona', para: ['a@helgen.tech'] }, { quien: 'persona', para: ['b@helgen.tech'] }]);
const avD = plain(P.contenidoAviso('horas.devuelta', 'persona', { tipo: 'horas.devuelta', actorNombre: 'Luis', actorCorreo: 'luis@helgen.tech', fecha: '2026-10-29 10:00:00',
  nota: 'Te faltaron $500 de viáticos', horasSemanaTexto: 'del 26/10 al 01/11/2026', horasProyectos: ['PRY-2026-0002-DRO · DROGHEDA'] }));
assert(/Te devolvieron horas · semana del 26\/10 al 01\/11\/2026/.test(avD.asunto) && /PRY-2026-0002-DRO · DROGHEDA/.test(avD.que), avD.asunto);
assert(!/\$|500|viáticos/.test(JSON.stringify(avD)) && /Hay una nota/.test(avD.nota), 'la nota nunca va en el correo');
assert(/#horas$/.test(avD.boton.url));
const avR = plain(P.contenidoAviso('horas.recordatorio', 'persona', { tipo: 'horas.recordatorio', fecha: '', horasSemanaTexto: 'del 26/10 al 01/11/2026' }));
assert(/Envía tus horas de la semana del 26\/10 al 01\/11\/2026/.test(avR.asunto) && /menos de un minuto/.test(avR.que) && avR.nota === '');

// ================= 2. Servidor por doPost =================
const ANIO = A.ANIO;
const LUNES = P.lunesDe(HOY_ISO), PASADA = P.sumarDias(LUNES, -7), ANTEPASADA = P.sumarDias(LUNES, -14);
const MES = HOY_ISO.slice(0, 7);
// Proyectos (Base de datos): DROGHEDA (con líder), Casa del Lago (sin líder) y uno que se cancela
const P1 = ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', cliente: { nombre: 'Helgen' }, idSolicitud: 'p1' }).folio;
const P2 = ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', cliente: { nombre: 'Luis' }, idSolicitud: 'p2' }).folio;
const P3 = ok('ana', 'crearProyecto', { nombre: 'Planta Norte', cliente: { nombre: 'Rosa' }, idSolicitud: 'p3' }).folio;
const filaProy = f => libros.DB.pest.Proyectos.m.findIndex(r => r[0] === f);
libros.DB.pest.Proyectos.m[filaProy(P3)][6] = 'Cancelado';
correr("subirVersiones_(['proyectos'])");

// ---- Área privada NÓMINA: la crea preparar (prepararCapri) con privado_ de arriba abajo ----
P.prepararCapri();
assert(props.NOMINA_FOLDER_ID && props.NOMINA_DB_ID, 'propiedades NOMINA_FOLDER_ID y NOMINA_DB_ID');
const carpetaN = A.carpetas[props.NOMINA_FOLDER_ID], libroN = libros[props.NOMINA_DB_ID];
assert.equal(carpetaN.nombre, 'CAPRI — Nómina');
assert.equal(carpetaN.padre, A.miUnidad, 'en la raíz de Mi unidad (nunca dentro de una carpeta que lee el dominio)');
assert.equal(carpetaN.acceso, 'PRIVATE', 'carpeta restringida');
assert.equal(A.archivos[props.NOMINA_DB_ID].acceso, 'PRIVATE', 'libro restringido');
assert.equal(A.archivos[props.NOMINA_DB_ID].padre, carpetaN);
assert.equal(libroN.nombre, 'CAPRI — Nómina y horas');
assert.deepEqual(Object.keys(libroN.pest).sort(), ['Bitacora', 'CostosPersonal', 'Horas']);
assert.deepEqual(libroN.pest.Horas.m[0], ['semana', 'correo', 'nombre', 'proyecto_folio', 'dia', 'horas', 'actividad', 'estado', 'motivo', 'aprobo',
  'fecha_aprobacion', 'enviada', 'actualizado']);
assert.deepEqual(libroN.pest.CostosPersonal.m[0], ['correo', 'nombre', 'mes', 'costo', 'notas', 'capturo', 'actualizado']);
assert.equal(libros.DB.pest.Proyectos.m[0][12], 'lider_email', 'columna M de Proyectos');
P.prepararNomina(); // se puede volver a correr (repara, no duplica)
assert.equal(Object.keys(libros).filter(id => libros[id].nombre === 'CAPRI — Nómina y horas').length, 1);

// ---- Rol Nómina en Permisos (no delegable) ----
let vp = ok('leo', 'listarUsuarios');
assert(vp.roles.some(r => r.clave === 'nomina' && r.nombre === 'Nómina'), 'Nómina en la página de Permisos');
const alta = (correo, nombre, roles, extra) => ok('leo', 'guardarUsuario', Object.assign({ nuevo: true, correo, nombre, roles }, extra || {}));
alta('nora@helgen.tech', 'Nora Nómina', ['ventas', 'nomina']);
alta('luis@helgen.tech', 'Luis Líder', ['ventas']);
alta('alan@helgen.services', 'Alán Basurto', ['solo_requisicion'], { sitio: '' });
alta('baja@helgen.tech', 'Baja Inactiva', ['ventas'], { activo: false });
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.services', nombre: 'X', roles: ['nomina'] }], /solo pueden tener "Solo requisiciones"/);
falla('leo', 'guardarUsuario', [{ nuevo: true, correo: 'x@helgen.tech', nombre: 'X', roles: ['solo_requisicion', 'nomina'] }], /no se combina con Nómina/);
assert.deepEqual(plain(P.rolesDeTexto('Nómina, compras')), ['compras', 'nomina']);
falla('nora', 'crearDelegacion', [{ a: 'ana@helgen.tech', roles: ['nomina'], desde: HOY_ISO, hasta: HOY_ISO }], /Aprobaciones o Compras/);
assert.equal(ok('nora', 'bootstrap').horasPermisos.nomina, true);
assert.equal(ok('tania', 'bootstrap').horasPermisos.nomina, false, 'cobranza no es Nómina');
assert.equal(ok('leo', 'bootstrap').horasPermisos.nomina, true, 'super admin sí');
assert.deepEqual(plain(ok('ana', 'bootstrap').horasPermisos), { capturar: true, lider: false, aprobar: false, lideres: false, nomina: false });

// ---- Líder de proyecto: super admin o cobranza ----
falla('ana', 'asignarLider', [P1, 'luis@helgen.tech'], /super admin o cobranza/, 'PERMISO');
falla('pedro', 'asignarLider', [P1, 'luis@helgen.tech'], /super admin o cobranza/, 'PERMISO');
falla('nora', 'listarLideres', [], /super admin o cobranza/, 'PERMISO');
falla('tania', 'asignarLider', [P1, 'luis@gmail.com'], /@helgen.tech o @helgen.services/);
falla('tania', 'asignarLider', [P1, 'baja@helgen.tech'], /no tiene acceso activo/);
falla('tania', 'asignarLider', [P3, 'luis@helgen.tech'], /cancelado/);
falla('tania', 'asignarLider', ['PRY-2026-9999', 'luis@helgen.tech'], /No existe el proyecto/);
const vLider = A.props.VER_proyectos;
let lid = ok('tania', 'asignarLider', P1, ' Luis@Helgen.tech ');
assert.notEqual(A.props.VER_proyectos, vLider, 'sube la versión de proyectos');
assert.equal(libros.DB.pest.Proyectos.m[filaProy(P1)][12], 'luis@helgen.tech', 'columna M');
assert.deepEqual(lid.proyectos.filter(p => p.folio === P1).map(p => [p.lider, p.liderNombre]), [['luis@helgen.tech', 'Luis Líder']]);
assert(!lid.proyectos.some(p => p.folio === P3), 'los cancelados no salen');
assert(lid.candidatos.some(c => c.correo === 'alan@helgen.services') && !lid.candidatos.some(c => c.correo === 'baja@helgen.tech'), 'candidatos: activos');
assert(libroN.pest.Bitacora.m.some(r => r[2] === 'Asignar líder' && r[3] === P1 && /sin líder → luis@helgen.tech/.test(r[4])), 'en la bitácora de nómina');
lid = ok('leo', 'asignarLider', P2, 'nora@helgen.tech');
lid = ok('leo', 'asignarLider', P2, '');
assert.equal(lid.proyectos.find(p => p.folio === P2).lider, '', 'se puede quitar');
assert.equal(ok('luis', 'bootstrap').horasPermisos.lider, true, 'luis es líder');
assert(!('lider' in ok('ana', 'listarProyectos', '', true)[0]), 'las listas de proyectos no traen el líder');

// ---- Hoja de horas ----
let v = ok('obrero', 'misHoras');
assert.deepEqual([v.semana, v.actual, v.estado, v.bloques.length, v.dias.length, v.semanaSiguiente], [LUNES, true, 'Sin capturar', 0, 7, '']);
assert.deepEqual(v.proyectos.map(p => p.folio).sort(), [P1, P2].sort(), 'Activo y Cerrado (no el cancelado)');
assert.equal(v.recientes.length, 8);
falla('obrero', 'misHoras', [P.sumarDias(LUNES, 7)], /semanas futuras/);
falla('obrero', 'misHoras', [P.sumarDias(LUNES, 1)], /empieza en lunes/);
const guardar = (quien, semana, bloques, enviar) => ok(quien, 'guardarSemana', { semana, bloques, enviar: !!enviar });
// La semana antepasada: borrador; luego enviada
v = guardar('obrero', ANTEPASADA, [{ proyecto: P1, horas: [8, 8, 8, 8, 8], actividad: 'Antenas y cableado' }]);
assert.deepEqual([v.semana, v.estado, v.bloques[0].estado, v.bloques[0].total], [ANTEPASADA, 'Borrador', 'Borrador', 40]);
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [{ proyecto: P1, horas: [0.3], actividad: 'Antenas' }] }], /cuartos de hora/);
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [{ proyecto: P1, horas: [16], actividad: 'Antenas' }, { proyecto: P2, horas: [8.25], actividad: 'Obra' }] }],
  /lunes suma 24.25 h/);
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [{ proyecto: P3, horas: [8], actividad: 'Planta' }] }], /está cancelado: quítalo/);
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [{ proyecto: 'PRY-2026-9999', horas: [8], actividad: 'Nada' }] }], /No existe el proyecto/);
falla('obrero', 'guardarSemana', [{ semana: P.sumarDias(LUNES, 7), bloques: [] }], /semanas futuras/);
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [], enviar: true }], /al menos un cuarto de hora/);
const vHoras = A.props.VER_horas;
v = guardar('obrero', PASADA, [{ proyecto: P1, horas: [8, 8, 4], actividad: 'Antenas DRO' }, { proyecto: P2 + '-CAL', horas: [0, 0, 4, 8], actividad: 'Obra civil' }], true);
assert.notEqual(A.props.VER_horas, vHoras, 'sube la versión de horas');
assert.deepEqual([v.estado, v.bloques.map(b => b.proyecto + ':' + b.estado + ':' + b.total)], ['Enviada', [P1 + ':Enviada:20', P2 + ':Enviada:12']]);
assert.deepEqual(v.totalesDia, [8, 8, 8, 8, 0, 0, 0]);
const filasH = () => libroN.pest.Horas.m.slice(1).filter(r => r[0]);
assert.equal(filasH().filter(r => r[1] === 'obrero@helgen.tech').length, 5 + 3 + 2, 'una fila por día con horas');
const fila0 = filasH().find(r => r[4] === PASADA);
assert.deepEqual([fila0[0], typeof fila0[0], fila0[2], fila0[3], fila0[5], fila0[7]], [PASADA, 'string', 'Juan Obrero', P1, 8, 'Enviada'], 'fechas como texto (apóstrofo), folio interno');
assert(!libros.DB.pest.Horas && !Object.keys(libros.DB.pest).some(n => /hora|nomina|costo/i.test(n)), 'nada de horas en la Base de datos (la lee todo el dominio)');
assert(libroN.pest.Bitacora.m.some(r => r[2] === 'Enviar horas' && /Semana .* · 2 proyecto\(s\) · 32 h/.test(r[4])));
// Copiar la semana pasada: la actual ofrece sus proyectos con la actividad
v = ok('obrero', 'misHoras');
assert.deepEqual(v.anterior.map(b => [b.proyecto, b.actividad]), [[P1, 'Antenas DRO'], [P2, 'Obra civil']]);
assert.equal(v.recientes.find(r => r.semana === PASADA).estado, 'Enviada');
// La actual: reescribir la semana (menos filas, otras filas) no deja basura
guardar('obrero', LUNES, [{ proyecto: P1, horas: [1, 1, 1, 1, 1, 1, 1], actividad: 'Antenas DRO' }]);
guardar('obrero', LUNES, [{ proyecto: P1, horas: [2], actividad: 'Antenas DRO' }, { proyecto: P2, horas: [0, 3], actividad: 'Obra civil' }]);
assert.deepEqual(filasH().filter(r => r[1] === 'obrero@helgen.tech' && r[0] === LUNES).map(r => r[3] + ' ' + r[4].slice(5) + ' ' + r[5]),
  [P1 + ' ' + LUNES.slice(5) + ' 2', P2 + ' ' + P.sumarDias(LUNES, 1).slice(5) + ' 3'], 'reescrita en su lugar');
v = guardar('obrero', LUNES, []);
assert.equal(filasH().filter(r => r[1] === 'obrero@helgen.tech' && r[0] === LUNES).length, 0, 'quitar todo borra las filas');
assert.equal(v.estado, 'Sin capturar');
// Una enviada que se edita sin reenviar regresa a borrador; reenviar vuelve a Enviada
v = guardar('obrero', ANTEPASADA, [{ proyecto: P1, horas: [8, 8, 8, 8, 8], actividad: 'Antenas y cableado' }], true);
assert.equal(v.estado, 'Enviada');

// ---- Aprobar y devolver: líder del proyecto, Aprobaciones, nadie lo suyo ----
guardar('luis', PASADA, [{ proyecto: P1, horas: [4, 4], actividad: 'Supervisión' }, { proyecto: P2, horas: [2], actividad: 'Revisión' }], true);
guardar('adri', PASADA, [{ proyecto: P2, horas: [3], actividad: 'Compras de obra' }], true);
guardar('leo', PASADA, [{ proyecto: P2, horas: [1], actividad: 'Dirección' }], true);
falla('ana', 'horasPorAprobar', [], /las aprueba el líder/, 'PERMISO');
let pa = ok('luis', 'horasPorAprobar');
assert.deepEqual(pa.porAprobar.map(x => x.correo + ':' + x.proyecto + ':' + x.semana + ':' + x.como).sort(),
  ['obrero@helgen.tech:' + P1 + ':' + ANTEPASADA + ':lider', 'obrero@helgen.tech:' + P1 + ':' + PASADA + ':lider'].sort(),
  'el líder ve las de su proyecto (no las suyas ni las de otros proyectos)');
assert(!/costo|\$|MXN/i.test(JSON.stringify(pa)), 'sin costos');
pa = ok('adri', 'horasPorAprobar');
assert.deepEqual(pa.porAprobar.map(x => x.correo + ':' + x.proyecto).sort(),
  ['leo@helgen.tech:' + P2, 'luis@helgen.tech:' + P1, 'luis@helgen.tech:' + P2, 'obrero@helgen.tech:' + P2].sort(),
  'Aprobaciones: las del líder y las de un proyecto sin líder; nunca las suyas');
const parte = (lista, correo, proyecto, semana) => lista.find(x => x.correo === correo && x.proyecto === proyecto && x.semana === (semana || PASADA));
const pedido = x => ({ correo: x.correo, semana: x.semana, proyecto: x.proyecto, huella: x.huella });
// Aprobaciones no aprueba lo del líder; el líder no aprueba lo suyo
const deObreroP1 = parte(ok('luis', 'horasPorAprobar').porAprobar, 'obrero@helgen.tech', P1);
falla('adri', 'aprobarHoras', [[pedido(deObreroP1)]], /las revisa el líder del proyecto/, 'PERMISO');
falla('luis', 'aprobarHoras', [[{ correo: 'luis@helgen.tech', semana: PASADA, proyecto: P1 }]], /Nadie aprueba sus propias horas/, 'PERMISO');
falla('obrero', 'aprobarHoras', [[pedido(deObreroP1)]], /Nadie aprueba sus propias horas/, 'PERMISO');
falla('luis', 'aprobarHoras', [[{ correo: 'obrero@helgen.tech', semana: PASADA, proyecto: P2 }]], /las revisa Aprobaciones/, 'PERMISO');
// Huella: si las horas cambiaron desde que se abrieron, no se aprueban
guardar('obrero', PASADA, [{ proyecto: P1, horas: [8, 8, 4, 1], actividad: 'Antenas DRO' }, { proyecto: P2, horas: [0, 0, 4, 8], actividad: 'Obra civil' }], true);
falla('luis', 'aprobarHoras', [[pedido(deObreroP1)]], /cambiaron desde que las abriste/);
pa = ok('luis', 'aprobarHoras', [pedido(parte(ok('luis', 'horasPorAprobar').porAprobar, 'obrero@helgen.tech', P1))]);
assert(!parte(pa.porAprobar, 'obrero@helgen.tech', P1) && parte(pa.revisadas, 'obrero@helgen.tech', P1).estado === 'Aprobada');
const aprobadaFila = filasH().find(r => r[1] === 'obrero@helgen.tech' && r[0] === PASADA && r[3] === P1);
assert.deepEqual([aprobadaFila[7], aprobadaFila[9], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(aprobadaFila[10])], ['Aprobada', 'luis@helgen.tech', true]);
falla('luis', 'aprobarHoras', [[{ correo: 'obrero@helgen.tech', semana: PASADA, proyecto: P1 }]], /están aprobada/);
// Una parte aprobada ya no cambia; reenviarla igual no falla
falla('obrero', 'guardarSemana', [{ semana: PASADA, bloques: [{ proyecto: P1, horas: [8], actividad: 'Antenas DRO' }, { proyecto: P2, horas: [0, 0, 4, 8], actividad: 'Obra civil' }] }],
  /ya están aprobadas: no se pueden cambiar/);
v = guardar('obrero', PASADA, [{ proyecto: P1, horas: [8, 8, 4, 1], actividad: 'Antenas DRO' }, { proyecto: P2, horas: [0, 0, 4, 8], actividad: 'Obra civil' }], true);
assert.deepEqual(v.bloques.map(b => b.estado), ['Aprobada', 'Enviada']);
assert.equal(v.bloques[0].editable, false);
// Aprobaciones aprueba lo del líder y lo de un proyecto sin líder (varias a la vez)
pa = ok('adri', 'horasPorAprobar');
pa = ok('adri', 'aprobarHoras', [pedido(parte(pa.porAprobar, 'luis@helgen.tech', P1)), pedido(parte(pa.porAprobar, 'obrero@helgen.tech', P2))]);
assert.equal(parte(pa.revisadas, 'luis@helgen.tech', P1).estado, 'Aprobada');
falla('adri', 'aprobarHoras', [[{ correo: 'adri@helgen.tech', semana: PASADA, proyecto: P2 }]], /Nadie aprueba sus propias horas/, 'PERMISO');
// Super admin: lo suyo solo con motivo (bitácora de Administración); lo de otros, sí
falla('leo', 'aprobarHoras', [[{ correo: 'leo@helgen.tech', semana: PASADA, proyecto: P2 }]], /Como super admin puedes hacerlo si escribes el motivo/, 'PERMISO');
ok('leo', 'aprobarHoras', [{ correo: 'leo@helgen.tech', semana: PASADA, proyecto: P2 }], 'Junta de dirección: sin otro aprobador');
const libroAdm = libros[props.ADMIN_DB_ID];
assert(libroAdm.pest.Bitacora.m.some(r => r[2] === 'Excepción de super admin: aprobar sus propias horas' && r[5] === 'Junta de dirección: sin otro aprobador'));
ok('leo', 'aprobarHoras', [{ correo: 'adri@helgen.tech', semana: PASADA, proyecto: P2 }]);
// Devolver (con motivo; también una aprobada) → correo a la persona, sin horas, montos ni la nota
falla('luis', 'devolverHoras', [[{ correo: 'obrero@helgen.tech', semana: ANTEPASADA, proyecto: P1 }], 'no'], /mínimo 5 caracteres/);
// Una aprobada solo se devuelve con la huella de lo que se vio (revisión del 29/10/2026; la interfaz siempre la manda)
falla('luis', 'devolverHoras', [[{ correo: 'obrero@helgen.tech', semana: PASADA, proyecto: P1 }], 'Faltó el viernes'], /ábrelas en «Por aprobar»/);
A.correos.length = 0;
const paLuis = ok('luis', 'horasPorAprobar');
pa = ok('luis', 'devolverHoras', [{ correo: 'obrero@helgen.tech', semana: ANTEPASADA, proyecto: P1 }, pedido(parte(paLuis.revisadas, 'obrero@helgen.tech', P1))],
  'Faltó el viernes; $500 de viáticos van aparte');
assert.equal(A.correos.length, 2, 'un correo por semana devuelta');
A.correos.forEach(m => {
  assert.equal(m.to, 'obrero@helgen.tech');
  assert(/Te devolvieron horas/.test(m.subject) && /#horas/.test(m.htmlBody), m.subject);
  assert(!/\$|500|viáticos|Faltó|MXN|\b8 h\b|\b40\b/.test(m.htmlBody + m.body + m.subject), 'sin montos, horas ni la nota: ' + m.body);
});
v = ok('obrero', 'misHoras', PASADA);
assert.deepEqual(v.bloques.map(b => b.estado + ':' + b.motivo), ['Devuelta:Faltó el viernes; $500 de viáticos van aparte', 'Aprobada:'],
  'la aprobada también se puede devolver; la persona ve el motivo');
assert(libroN.pest.Bitacora.m.some(r => r[2] === 'Devolver horas aprobadas' && r[3] === P1));
v = guardar('obrero', PASADA, [{ proyecto: P1, horas: [8, 8, 4, 1, 8], actividad: 'Antenas DRO' }, { proyecto: P2, horas: [0, 0, 4, 8], actividad: 'Obra civil' }], true);
assert.deepEqual(v.bloques.map(b => b.estado), ['Enviada', 'Aprobada'], 'corregida y reenviada');
pa = ok('luis', 'aprobarHoras', [pedido(parte(ok('luis', 'horasPorAprobar').porAprobar, 'obrero@helgen.tech', P1))]);

// ---- Pendientes: horas por aprobar (solo horas) ----
assert.deepEqual(ok('luis', 'pendientes').items.filter(x => x.tipo === 'horas'), [], 'la devuelta no espera al líder');
guardar('obrero', ANTEPASADA, [{ proyecto: P1, horas: [8, 8, 8, 8, 6], actividad: 'Antenas y cableado' }], true);
const pendLuis = ok('luis', 'pendientes');
assert.deepEqual(pendLuis.items.filter(x => x.tipo === 'horas').map(x => [x.folio, x.destino, x.seccion, x.semana]), [['Horas · Juan Obrero', 'horas', 'horas', ANTEPASADA]],
  'la reenviada vuelve a esperar al líder');
assert.equal(pendLuis.conteos.total, pendLuis.items.length);
assert.deepEqual(ok('adri', 'pendientes').items.filter(x => x.tipo === 'horas').map(x => x.folio + ' · ' + x.detalle.split(' · ').pop()),
  ['Horas · Luis Líder · ' + P2 + '-CAL'], 'Aprobaciones: lo que falta de un proyecto sin líder');
assert.deepEqual(ok('obrero', 'pendientes').items.filter(x => x.tipo === 'horas'), [], 'quien captura no tiene horas por aprobar');
assert.deepEqual(ok('leo', 'pendientes', true).items.filter(x => x.tipo === 'horas').map(x => x.folio + ' → ' + x.para),
  ['Horas · Juan Obrero → Luis Líder', 'Horas · Luis Líder → Aprobaciones'], 'super admin: los de todos, con a quién esperan');

// ---- @helgen.services: captura su semana con la sesión de CAPRI; no ve costos ----
const tAlan = correr('emitirSesionCapri_("alan@helgen.services", "Alán")');
assert.equal(ok(tAlan, 'bootstrap').soloRequisicion, true);
v = ok(tAlan, 'guardarSemana', { semana: PASADA, bloques: [{ proyecto: P1, horas: [9, 9, 9, 9, 9], actividad: 'Instalación en sitio' }], enviar: true });
assert.equal(v.estado, 'Enviada');
falla(tAlan, 'listarCostosPersonal', [], /solo tiene acceso a Requisiciones/, 'PERMISO');
falla(tAlan, 'listarLideres', [], /solo tiene acceso a Requisiciones/, 'PERMISO');

// ---- Costos de personal: solo Nómina (y super admin) ----
['tania', 'pedro', 'adri', 'luis', 'obrero', 'ana'].forEach(q => {
  falla(q, 'listarCostosPersonal', [], /Solo Nómina/, 'PERMISO');
  falla(q, 'guardarCostoPersonal', [{ correo: 'obrero@helgen.tech', mes: MES, costo: 1 }], /Solo Nómina/, 'PERMISO');
  falla(q, 'importarCostosPersonal', ['obrero@helgen.tech,' + MES + ',1'], /Solo Nómina/, 'PERMISO');
  falla(q, 'reporteNomina', [], /Solo Nómina/, 'PERMISO');
});
falla('nora', 'guardarCostoPersonal', [{ correo: 'obrero@helgen.tech', mes: MES, costo: 0 }], /mayor a cero/);
const vCostos = A.props.VER_costosPersonal;
let vc = ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes: MES, costo: '$30,000', notas: 'Sueldo + IMSS' });
assert.notEqual(A.props.VER_costosPersonal, vCostos, 'sube la versión de costos');
assert.deepEqual(vc.costos.map(c => [c.correo, c.nombre, c.mes, c.costo, c.notas, c.capturo]), [['obrero@helgen.tech', 'Juan Obrero', MES, 30000, 'Sueldo + IMSS', 'nora@helgen.tech']]);
vc = ok('nora', 'guardarCostoPersonal', { correo: 'obrero@helgen.tech', mes: MES, costo: 32000, notas: 'Con aguinaldo prorrateado' });
assert.deepEqual(vc.costos.map(c => c.costo), [32000], 'un costo por persona y mes: el nuevo reemplaza');
assert(libroN.pest.Bitacora.m.some(r => r[2] === 'Cambiar costo de personal' && /\$30,000\.00 → \$32,000\.00 MXN/.test(r[4])), 'el anterior queda en la bitácora de nómina');
assert(vc.personas.some(p => p.correo === 'alan@helgen.services') && vc.personas.some(p => p.correo === 'nora@helgen.tech'));
vc = ok('nora', 'guardarCostoPersonal', { correo: 'ana@helgen.tech', mes: MES, costo: 1000 });
vc = ok('nora', 'guardarCostoPersonal', { correo: 'ana@helgen.tech', mes: MES, quitar: true });
assert.deepEqual(vc.costos.map(c => c.correo), ['obrero@helgen.tech'], 'quitar');
falla('nora', 'guardarCostoPersonal', [{ correo: 'ana@helgen.tech', mes: MES, quitar: true }], /No hay costo/);
assert.equal(libroN.pest.CostosPersonal.m[1][2], MES, 'el mes como texto (apóstrofo)');
// CSV con resultado por renglón
const MES_ANT = P.mesMas(MES, -1);
let imp = ok('nora', 'importarCostosPersonal', 'correo,mes,costo,notas\n' +
  'obrero@helgen.tech,' + MES + ',32000,Con aguinaldo prorrateado\n' +       // sin cambio
  'luis@helgen.tech,' + MES + ',"45,000.00",\n' +                          // nuevo
  'obrero@helgen.tech,' + MES_ANT + ',29000,\n' +                          // nuevo
  'adri@helgen.tech,' + MES + ',abc,\n' +                                  // error
  'luis@helgen.tech,' + MES + ',46000,Corrección\n' +                      // gana sobre el de arriba
  'x@gmail.com,' + MES + ',1000,\n');                                      // error
assert.deepEqual(imp.resultados.map(r => r.fila + ':' + r.resultado), ['2:Sin cambio', '3:Repetido', '4:Nuevo', '5:Error', '6:Nuevo', '7:Error']);
assert.deepEqual(plain(imp.resumen), { nuevos: 2, actualizados: 0, sinCambio: 1, errores: 2, repetidos: 1 });
assert(/vale el renglón 6/.test(imp.resultados[1].error) && /mayor a cero/.test(imp.resultados[3].error));
imp = ok('nora', 'importarCostosPersonal', 'luis@helgen.tech;' + MES + ';47000');
assert.deepEqual(imp.resultados.map(r => r.resultado + ':' + r.antes), ['Actualizado:46000']);
assert.deepEqual(imp.vista.costos.map(c => c.correo + ' ' + c.mes + ' ' + c.costo).sort(),
  ['luis@helgen.tech ' + MES + ' 47000', 'obrero@helgen.tech ' + MES + ' 32000', 'obrero@helgen.tech ' + MES_ANT + ' 29000'].sort());
falla('nora', 'importarCostosPersonal', [''], /no tiene renglones/);
assert(libroN.pest.Bitacora.m.some(r => r[2] === 'Importar costos de personal (CSV)'));

// ---- Reporte de nómina (Nómina y super admin) = costoNominaPorProyecto ----
const rep = ok('nora', 'reporteNomina', MES_ANT, MES);
const horasAprob = correr('horasDelLibro_(libroNominaSiExiste_())').filter(h => h.estado === 'Aprobada');
const costosLibro = correr('costosDelLibro_(libroNominaSiExiste_())');
const esperado = plain(P.costoNominaPorProyectoMes(horasAprob.filter(h => h.dia.slice(0, 7) >= MES_ANT), costosLibro));
rep.proyectos.forEach(p => Object.keys(p.meses).forEach(m => assert.deepEqual(p.meses[m], esperado[p.folio][m], p.folio + ' ' + m)));
assert.equal(rep.proyectos.length, Object.keys(esperado).length);
assert.deepEqual(rep.meses, [MES_ANT, MES]);
assert(rep.sinCostear.some(x => x.correo === 'adri@helgen.tech' && x.nombre === 'Adriana Del Ángel' && x.mes === PASADA.slice(0, 7) && x.horas === 3),
  'horas aprobadas sin costo del mes: visibles por persona y mes (adri no tiene costo)');
assert(rep.proyectos.some(p => p.folio === P2 && p.total.sinCostear >= 3), 'y por proyecto');
const totalRep = Math.round(rep.proyectos.reduce((s, p) => s + p.total.monto * 100, 0));
assert.equal(Math.round(rep.totales.total.monto * 100), totalRep, 'total = suma de proyectos');
assert(rep.porAprobar.partes >= 1, 'horas enviadas por aprobar (Alán)');
assert.deepEqual(plain(ok('leo', 'reporteNomina', MES_ANT, MES)), plain(rep), 'super admin ve el mismo reporte');
falla('nora', 'reporteNomina', [MES, MES_ANT], /anterior al final/);
// Para el integrador: costoNominaDeProyectos_ = costoNominaPorProyecto con todo el libro
como('nora@helgen.tech');
assert.deepEqual(plain(correr('costoNominaDeProyectos_()')), plain(P.costoNominaPorProyecto(horasAprob, costosLibro)));
como(null);

// ---- Sincronizar: costos y reporte solo para Nómina ----
const ctxTodo = { horasSemana: LUNES, horasAprobar: true, horasLideres: true, nomCostos: true, nomReporte: { desde: MES_ANT, hasta: MES } };
let s = ok('nora', 'sincronizar', {}, ctxTodo);
assert(s.nomCostos && s.nomReporte && s.horasSemana && s.horasPermisos, 'Nómina: costos y reporte');
assert(!s.horasLideres && !s.horasAprobar, 'sin líderes ni por aprobar (no es cobranza ni líder)');
s = ok('tania', 'sincronizar', {}, ctxTodo);
assert(!('nomCostos' in s) && !('nomReporte' in s) && s.horasLideres && s.horasSemana, 'cobranza: líderes y su semana, nunca costos');
s = ok('luis', 'sincronizar', {}, ctxTodo);
assert(s.horasAprobar && !('nomCostos' in s) && !('nomReporte' in s));
// La versión de costosPersonal solo es real para Nómina y super admin (revisión del 29/10/2026): las versiones son de cada quien
assert.equal(s.versiones.costosPersonal, 0, 'luis no ve cuándo cambia un costo');
s = ok('nora', 'sincronizar', {}, ctxTodo);
assert.notEqual(s.versiones.costosPersonal, 0, 'Nómina sí');
s = ok('nora', 'sincronizar', plain(s.versiones), ctxTodo);
assert(!s.nomCostos && !s.horasSemana, 'sin cambios no se manda nada');

// ---- Recordatorio de los viernes: una vez por semana, a quien no envió, sin montos ----
const VIERNES = P.sumarDias(LUNES, 4);
como(null);
A.correos.length = 0;
assert.equal(correr('recordatorioHoras_({ hoy: ' + JSON.stringify(P.sumarDias(LUNES, 3)) + ', hora: 15 })').enviado, false, 'jueves no');
assert.equal(correr('recordatorioHoras_({ hoy: ' + JSON.stringify(VIERNES) + ', hora: 11 })').enviado, false, 'viernes antes de las 12 no');
guardar('nora', LUNES, [{ proyecto: P1, horas: [1], actividad: 'Revisión de nómina' }], true); // Nora sí envió
guardar('pedro', LUNES, [{ proyecto: P1, horas: [1], actividad: 'Compras' }]);                 // Pedro solo en borrador
props.HORAS_SIN_RECORDATORIO = 'leo@helgen.tech, efrain@helgen.tech';
como(null);
let rr = correr('recordatorioHoras_({ hoy: ' + JSON.stringify(VIERNES) + ', hora: 12 })');
assert.deepEqual([rr.enviado, rr.semana], [true, LUNES]);
const para = A.correos.map(m => m.to).sort();
assert(para.indexOf('pedro@helgen.tech') !== -1 && para.indexOf('alan@helgen.services') !== -1 && para.indexOf('obrero@helgen.tech') !== -1, para.join());
assert(para.indexOf('nora@helgen.tech') === -1 && para.indexOf('leo@helgen.tech') === -1 && para.indexOf('baja@helgen.tech') === -1,
  'quien envió, los excluidos y los inactivos no');
assert(A.correos.every(m => m.to.split(',').length === 1), 'uno por persona: nadie ve a quién más le llegó');
assert(A.correos.every(m => /Envía tus horas de la semana/.test(m.subject) && !/\$|MXN|costo/i.test(m.htmlBody + m.body)));
assert.equal(props.HORAS_RECORDATORIO_SEMANA, LUNES);
const n1 = A.correos.length;
como(null);
assert.equal(correr('recordatorioHoras_({ hoy: ' + JSON.stringify(P.sumarDias(LUNES, 5)) + ', hora: 9 })').enviado, false, 'una vez por semana');
assert.equal(A.correos.length, n1);
assert(libros[props.ADMIN_DB_ID].pest.Correos.m.some(r => r[3] === 'horas.recordatorio' && r[5] === 'Enviado'), 'en la bitácora de correos');
// cadaQuinceMinutos lo llama (y no truena aunque no toque)
assert('horas' in correr('cadaQuinceMinutos()'));

// ---- Área creada sola (sin prepararCapri) la primera vez que alguien guarda su semana ----
{
  const B2 = crearArnes(dir, { props: Object.assign({}, PROPS) });
  const F = B2.ok('ana', 'crearProyecto', { nombre: 'Solo', cliente: { nombre: 'X' }, idSolicitud: 'b1' }).folio;
  assert.equal(B2.ok('obrero', 'misHoras').estado, 'Sin capturar');
  assert(!B2.props.NOMINA_DB_ID, 'leer no crea el libro');
  B2.ok('obrero', 'guardarSemana', { semana: P.lunesDe(B2.HOY_ISO), bloques: [{ proyecto: F, horas: [8], actividad: 'Primera semana' }] });
  assert(B2.props.NOMINA_DB_ID && B2.carpetas[B2.props.NOMINA_FOLDER_ID].acceso === 'PRIVATE' && B2.archivos[B2.props.NOMINA_DB_ID].acceso === 'PRIVATE',
    'se crea sola y restringida');
}

// ================= 3. Privacidad: nadie sin Nómina obtiene el costo de una persona =================
// Un arnés aparte con datos conocidos: tres personas con costo en el mismo mes, cada proyecto con al menos dos personas costeadas
// (así el costo de nómina de un proyecto —lo único que el margen podrá mostrar a cobranza— nunca es el de una persona). Se llama
// TODA función de la API, con varias formas de argumentos, como cobranza, compras, Aprobaciones, el líder, quien pide, ventas, solo
// requisiciones y una cuenta @helgen.services; también bootstrap y sincronizar con todo el contexto. Ninguna respuesta (datos o
// error) puede traer un costo mensual ni la parte de una persona en un proyecto, en ninguna forma (número, 2 decimales, con comas,
// en centavos). Además, ningún libro que no sea el de nómina (la Base de datos la lee todo el dominio) guarda esas cifras.
{
  const Z = crearArnes(dir, { props: Object.assign({}, PROPS) });
  Z.tokens.nora = Z.claims('nora@helgen.tech', 'Nora', 'Nómina');
  Z.tokens.luis = Z.claims('luis@helgen.tech', 'Luis', 'Líder');
  Z.P.prepararCapri();
  ['nora:Nora Nómina:ventas,nomina', 'luis:Luis Líder:ventas'].forEach(x => {
    const [u, n, r] = x.split(':');
    Z.ok('leo', 'guardarUsuario', { nuevo: true, correo: u + '@helgen.tech', nombre: n, roles: r.split(',') });
  });
  const Q1 = Z.ok('ana', 'crearProyecto', { nombre: 'DROGHEDA', cliente: { nombre: 'Helgen' }, idSolicitud: 'z1' }).folio;
  const Q2 = Z.ok('ana', 'crearProyecto', { nombre: 'Casa del Lago', cliente: { nombre: 'Luis' }, idSolicitud: 'z2' }).folio;
  Z.ok('tania', 'asignarLider', Q1, 'luis@helgen.tech');
  // Una semana pasada con los 5 días hábiles en el mismo mes
  let sem = Z.P.lunesDe(Z.HOY_ISO);
  do { sem = Z.P.sumarDias(sem, -7); } while (sem.slice(0, 7) !== Z.P.sumarDias(sem, 4).slice(0, 7));
  const mes = sem.slice(0, 7);
  const semana = (quien, bloques) => Z.ok(quien, 'guardarSemana', { semana: sem, bloques, enviar: true });
  semana('obrero', [{ proyecto: Q1, horas: [2, 2, 2, 2, 2], actividad: 'Antenas' }, { proyecto: Q2, horas: [6, 6, 6, 6, 6], actividad: 'Obra' }]);
  semana('luis', [{ proyecto: Q1, horas: [4, 4, 4, 4, 4], actividad: 'Supervisión' }, { proyecto: Q2, horas: [4, 4, 4, 4, 4], actividad: 'Revisión' }]);
  semana('ana', [{ proyecto: Q1, horas: [1, 1, 1, 1, 1], actividad: 'Ventas en sitio' }, { proyecto: Q2, horas: [3, 0, 0, 0, 0], actividad: 'Visita' }]);
  const porAprobar = q => Z.ok(q, 'horasPorAprobar').porAprobar.map(x => ({ correo: x.correo, semana: x.semana, proyecto: x.proyecto, huella: x.huella }));
  Z.ok('luis', 'aprobarHoras', porAprobar('luis'));
  Z.ok('adri', 'aprobarHoras', porAprobar('adri'));
  assert.equal(Z.ok('adri', 'horasPorAprobar').porAprobar.length + Z.ok('luis', 'horasPorAprobar').porAprobar.length, 0, 'todo aprobado');
  const COSTOS = { 'obrero@helgen.tech': 73519.37, 'luis@helgen.tech': 48261.59, 'ana@helgen.tech': 91827.46 };
  Z.ok('nora', 'importarCostosPersonal', 'correo,mes,costo\n' + Object.keys(COSTOS).map(c => c + ',' + mes + ',' + COSTOS[c]).join('\n'));
  // Lo prohibido: el costo de cada persona y su parte en cada proyecto (reparto de una sola persona)
  const horasAprob = Z.correr('horasDelLibro_(libroNominaSiExiste_())').filter(h => h.estado === 'Aprobada');
  const costos = Z.correr('costosDelLibro_(libroNominaSiExiste_())');
  const prohibidos = [];
  Object.keys(COSTOS).forEach(c => {
    prohibidos.push(COSTOS[c]);
    const suyo = Z.plain(Z.P.costoNominaPorProyecto(horasAprob.filter(h => h.correo === c), costos.filter(x => x.correo === c)));
    Object.keys(suyo).forEach(f => prohibidos.push(suyo[f][0].monto));
  });
  // Lo que sí puede llegar a cobranza (después de la integración, en el margen): el total por proyecto, distinto de toda parte
  const porProyecto = Z.plain(Z.P.costoNominaPorProyecto(horasAprob, costos));
  Object.keys(porProyecto).forEach(f => assert(prohibidos.indexOf(porProyecto[f][0].monto) === -1, 'el total de un proyecto no es la parte de nadie'));
  const formas = n => {
    const fijo = Number(n).toFixed(2), ent = fijo.split('.')[0];
    return [String(n), fijo, ent.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fijo.split('.')[1], String(Math.round(n * 100))].filter((x, i, a) => a.indexOf(x) === i);
  };
  const agujas = [].concat(...prohibidos.map(formas));
  const fuga = texto => agujas.find(a => texto.indexOf(a) !== -1) || '';
  // Control: Nómina y super admin sí los ven (si no, la búsqueda no probaría nada)
  assert(fuga(JSON.stringify(Z.ok('nora', 'listarCostosPersonal'))) && fuga(JSON.stringify(Z.ok('leo', 'listarCostosPersonal'))), 'control positivo');
  assert(fuga(JSON.stringify(Z.ok('nora', 'sincronizar', {}, { nomCostos: true, nomReporte: { desde: mes, hasta: mes } }))), 'control positivo (sincronizar)');
  const repZ = Z.ok('leo', 'reporteNomina', mes, mes);
  assert(!fuga(JSON.stringify(repZ.proyectos)), 'el reporte por proyecto suma a las personas (aun para Nómina, la tabla no va por persona)');
  assert.deepEqual(repZ.proyectos.map(p => p.total.monto), Object.keys(porProyecto).map(f => porProyecto[f][0].monto));
  // Todas menos cerrarSesionCapri (cerraría la sesión de la cuenta @helgen.services a media prueba; no devuelve datos)
  const funciones = Z.correr('Object.keys(API_FUNCIONES)').filter(f => f !== 'cerrarSesionCapri');
  assert(funciones.length > 80 && funciones.indexOf('reporteNomina') !== -1 && funciones.indexOf('getCobranzaProyecto') !== -1, 'la lista completa de la API');
  const fila = { correo: 'obrero@helgen.tech', semana: sem, proyecto: Q1 };
  const formasArgs = [[], [''], [Q1], [Q1, 'obrero@helgen.tech'], [{}], [{ correo: 'obrero@helgen.tech', mes: mes, costo: 1 }], [mes, mes],
    [[fila], 'Motivo de prueba largo'], [true], [sem], ['correo,mes,costo\nobrero@helgen.tech,' + mes + ',1'], [{ semana: sem, bloques: [] }]];
  const tServ = (() => { Z.ok('leo', 'guardarUsuario', { nuevo: true, correo: 'alan@helgen.services', nombre: 'Alán', roles: ['solo_requisicion'] });
    return Z.correr('emitirSesionCapri_("alan@helgen.services", "Alán")'); })();
  const quienes = { cobranza: 'tania', compras: 'pedro', aprobaciones: 'adri', lider: 'luis', requisicion: 'obrero', ventas: 'ana', solo: 'rosa', servicios: tServ };
  let llamadas = 0;
  Object.keys(quienes).forEach(rol => {
    const q = quienes[rol];
    funciones.forEach(f => formasArgs.forEach(args => {
      const r = Z.post(q, f, ...args);
      llamadas++;
      const x = fuga(JSON.stringify(r));
      assert(!x, rol + ' obtuvo un costo (' + x + ') con ' + f + '(' + JSON.stringify(args).slice(0, 80) + ')');
    }));
    // Carga inicial y sincronización con todo el contexto (también lo de Nómina): nada
    [Z.post(q, 'bootstrap'), Z.post(q, 'sincronizar', {}, { horasSemana: sem, horasAprobar: true, horasLideres: true, nomCostos: true,
      nomReporte: { desde: mes, hasta: mes }, cobProyecto: Q1, comProyecto: Q1, cobResumen: true, reporte: 'margen', pendTodos: true })]
      .forEach(r => assert(!fuga(JSON.stringify(r)), rol + ': bootstrap/sincronizar con un costo'));
  });
  assert.equal(llamadas, 8 * funciones.length * formasArgs.length, 'cada función, cada forma, cada rol');
  // Los correos que se mandaron (devoluciones, recordatorio…) y los libros que no son de nómina no guardan esas cifras
  Z.correr('recordatorioHoras_({ hoy: ' + JSON.stringify(Z.P.sumarDias(Z.P.lunesDe(Z.HOY_ISO), 4)) + ', hora: 13 })');
  assert(!fuga(JSON.stringify(Z.correos)), 'correos sin costos');
  Object.keys(Z.libros).filter(id => id !== Z.props.NOMINA_DB_ID).forEach(id => {
    const L = Z.libros[id];
    Object.keys(L.pest).forEach(n => assert(!fuga(JSON.stringify(L.pest[n].m)), 'el libro ' + (L.nombre || id) + '/' + n + ' tiene un costo de persona'));
  });
  assert(fuga(JSON.stringify(Z.libros[Z.props.NOMINA_DB_ID].pest.CostosPersonal.m)), 'los costos viven solo en el libro de nómina');
  // El reparto que usará el margen nunca va por persona
  Object.keys(porProyecto).forEach(f => assert.deepEqual(Object.keys(porProyecto[f][0]).sort(), ['concepto', 'horas', 'moneda', 'monto', 'sinCostear']));
}

// ================= 4. Interfaz (mod-horas sobre la app, conectada al servidor simulado) =================
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
assert(scripts.some(s => s.id === 'mod-horas'), 'existe <script id="mod-horas">');
assert(/<button id="tabHoras" class="oculto" onclick="verTab\('horas'\)">Horas<span id="cntHoras" class="cuenta oculto"><\/span><\/button>/.test(html));
assert(/<section id="vistaHoras" class="oculto"><\/section>/.test(html) && /<div id="cobLider" class="oculto"><\/div>/.test(html));
function montar(quien) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['tabCob', 'tabCom', 'tabRep', 'tabHoras', 'vistaHoras', 'cobLider'].forEach(i => document.getElementById(i).classList.add('oculto')); // como en el HTML
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [], dialogos = { prompt: null, confirmar: true, mensajes: [] };
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const datos = A.post(quien, c.funcion, ...c.args);
    return { ok: true, json: async () => datos };
  }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    confirm: m => { dialogos.mensajes.push(String(m)); return dialogos.confirmar; }, prompt: m => { dialogos.mensajes.push(String(m)); return dialogos.prompt; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-pantallas', 'mod-horas'].forEach(n => vm.runInContext(scripts.find(s => s.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  // ---- Mi semana en el teléfono: copiar la semana pasada, capturar, revisar en el navegador y enviar ----
  const O = montar('obrero');
  await esperar();
  assert(!O.$('tabHoras').classList.contains('oculto'), 'toda cuenta activa ve la pestaña Horas');
  O.run("verTab('horas')"); await esperar();
  assert(!O.$('vistaHoras').classList.contains('oculto'));
  let h = O.$('vistaHoras').innerHTML;
  assert(/Semana \d+/.test(h) && /esta semana/.test(h) && !/Por aprobar|Nómina|Líderes/.test(h), 'solo "Mi semana" para quien solo captura');
  assert.equal(O.run('HORAS.estado().semana'), LUNES);
  // La semana pasada del obrero ya está; su actual, vacía: copiar la pasada trae sus proyectos con la actividad
  O.run("HORAS.irSemana('" + LUNES + "')"); await esperar();
  assert(/Copiar proyectos de la semana pasada \(2\)/.test(O.$('vistaHoras').innerHTML), O.$('vistaHoras').innerHTML.slice(0, 400));
  O.run('HORAS.copiar()');
  h = O.$('vistaHoras').innerHTML;
  assert(/id="hrsH0_6"/.test(h) && /id="hrsH1_6"/.test(h) && /inputmode="decimal"/.test(h) && /step="0\.25"/.test(h), '7 casillas por proyecto');
  assert.equal(O.$('hrsA0').value, '', 'el elemento simulado no lee value del HTML');
  assert(/value="Antenas DRO"/.test(h) && /value="Obra civil"/.test(h), 'la actividad de la semana pasada');
  ['8', '8', '8', '', '', '', ''].forEach((x, d) => { O.$('hrsH0_' + d).value = x; });
  ['', '', '', '8', '0.3', '', ''].forEach((x, d) => { O.$('hrsH1_' + d).value = x; });
  O.$('hrsA0').value = 'Antenas DRO'; O.$('hrsA1').value = 'Obra civil';
  O.run('HORAS.cambio()');
  assert(/<b>32\.3 h<\/b>/.test(O.$('hrsTotales').innerHTML), 'total en vivo: ' + O.$('hrsTotales').innerHTML);
  const antes = O.llamadas.length;
  O.run('HORAS.guardar(true)'); await esperar();
  assert(/cuartos de hora/.test(O.$('aviso').innerHTML) && O.llamadas.length === antes, 'el navegador revisa antes de llamar al servidor');
  O.$('hrsH1_4').value = '20'; O.$('hrsH0_4').value = '4.25';
  O.run('HORAS.cambio()');
  assert(/hrs-exceso/.test(O.$('hrsTotales').innerHTML), 'el día que pasa de 24 h se marca');
  O.run('HORAS.guardar(true)'); await esperar();
  assert(/viernes suma 24.25 h/.test(O.$('aviso').innerHTML), O.$('aviso').innerHTML);
  O.$('hrsH0_4').value = '4';
  O.run('HORAS.cambio()');
  O.run('HORAS.guardar(true)'); await esperar();
  const g = O.llamadas.filter(c => c.funcion === 'guardarSemana').pop();
  assert.deepEqual(g.args, [{ semana: LUNES, enviar: true, bloques: [{ proyecto: P1, horas: [8, 8, 8, 0, 4, 0, 0], actividad: 'Antenas DRO' },
    { proyecto: P2, horas: [0, 0, 0, 8, 20, 0, 0], actividad: 'Obra civil' }] }]);
  assert(/Semana enviada/.test(O.$('aviso').innerHTML), O.$('aviso').innerHTML);
  assert.equal(O.run('HORAS.estado().datos.estado'), 'Enviada');
  assert(/chip aceptada">Enviada/.test(O.$('vistaHoras').innerHTML));
  assert.equal(ok('obrero', 'misHoras').estado, 'Enviada', 'en el servidor');
  // Agregar y quitar un proyecto; cambiar de semana con cambios pide confirmar
  O.run("HORAS.agregar('" + P2 + "')"); // ya está: no se duplica
  assert.equal(O.run('HORAS.estado().bloques.length'), 2);
  O.run('HORAS.quitar(1)');
  assert.equal(O.run('HORAS.estado().bloques.length'), 1);
  O.dialogos.confirmar = false;
  O.run("HORAS.irSemana('" + PASADA + "')");
  assert(/cambios sin guardar/.test(O.dialogos.mensajes.pop()) && O.run('HORAS.estado().semana') === LUNES, 'no se va sin confirmar');
  O.dialogos.confirmar = true;
  O.run("HORAS.irSemana('" + PASADA + "')"); await esperar();
  h = O.$('vistaHoras').innerHTML;
  assert(/chip firmado">Aprobada/.test(h) && /disabled/.test(h), 'la parte aprobada no se edita');
  // Sincronizar: su semana abierta va en el contexto
  assert.equal(plain(O.run('contextoSync()')).horasSemana, PASADA);

  // ---- El líder: Por aprobar (sin costos), aprobar y devolver ----
  const L = montar('luis');
  await esperar();
  const nLuis = ok('luis', 'pendientes').items.filter(x => x.seccion === 'horas').length;
  assert(nLuis >= 2, 'obrero (esta semana y la antepasada) y Alán esperan a Luis: ' + nLuis);
  assert.equal(L.$('cntHoras').textContent, String(nLuis), 'el número de la pestaña: semanas por aprobar');
  assert(/Horas por aprobar/.test(L.$('pendLista').innerHTML) && /Revisar horas/.test(L.$('pendLista').innerHTML), 'en Pendientes');
  L.run("abrirDestino('horas', '', 'horas')"); await esperar();
  assert.equal(L.run('HORAS.estado().vista'), 'aprobar');
  h = L.$('vistaHoras').innerHTML;
  assert(/Horas por aprobar/.test(h) && /Juan Obrero/.test(h) && /Aprobar todo/.test(h) || /Aprobar<\/button>/.test(h), h.slice(0, 600));
  assert(!/\$|MXN|costo/i.test(h), 'sin costos');
  const lista = plain(L.run('HORAS.estado().aprobar.porAprobar'));
  assert(lista.every(x => x.correo !== 'luis@helgen.tech'), 'nunca las suyas');
  const i = lista.findIndex(x => x.correo === 'obrero@helgen.tech' && x.semana === LUNES);
  L.run('HORAS.aprobar([' + i + '])'); await esperar();
  assert(/Horas aprobadas/.test(L.$('aviso').innerHTML), L.$('aviso').innerHTML);
  assert.equal(ok('obrero', 'misHoras').bloques.find(b => b.proyecto === P1).estado, 'Aprobada');
  L.dialogos.prompt = 'Faltó la actividad del viernes';
  const j = plain(L.run('HORAS.estado().aprobar.revisadas')).findIndex(x => x.correo === 'obrero@helgen.tech' && x.semana === LUNES && x.proyecto === P1);
  L.run('HORAS.devolver(' + j + ', true)'); await esperar();
  assert(/Horas devueltas/.test(L.$('aviso').innerHTML), L.$('aviso').innerHTML);
  assert.equal(ok('obrero', 'misHoras').bloques.find(b => b.proyecto === P1).estado, 'Devuelta');
  assert(!/Líderes|Nómina/.test(L.$('vistaHoras').innerHTML.split('</div>')[0]), 'el líder no asigna líderes ni ve Nómina');

  // ---- Cobranza: asigna líderes (en Horas y en la vista del proyecto); nunca Nómina ----
  const T = montar('tania');
  await esperar();
  T.run("verTab('horas')"); await esperar();
  T.run("HORAS.ver('lideres')"); await esperar();
  h = T.$('vistaHoras').innerHTML;
  assert(/Líderes de proyecto/.test(h) && /Luis Líder · luis@helgen.tech/.test(h) && !/HORAS\.ver\('nomina'\)/.test(h), 'líderes sí, nómina no');
  T.run("HORAS.ver('nomina')"); await esperar();
  assert.equal(T.run('HORAS.estado().vista'), 'lideres', 'no abre Nómina sin el rol');
  assert(!T.llamadas.some(c => /Costo|reporteNomina/.test(c.funcion)), 'ni lo pide');
  T.run('abrirProyectoCob(' + JSON.stringify(P2) + ')'); await esperar();
  assert(!T.$('cobLider').classList.contains('oculto') && /Líder del proyecto/.test(T.$('cobLider').innerHTML), 'control en la vista de Cobranza');
  T.$('cobLiderSel').value = 'nora@helgen.tech';
  T.run('HORAS.asignarCob()'); await esperar();
  assert.equal(libros.DB.pest.Proyectos.m[filaProy(P2)][12], 'nora@helgen.tech');
  T.$('cobLiderSel').value = '';
  T.run('HORAS.asignarCob()'); await esperar();
  assert.equal(libros.DB.pest.Proyectos.m[filaProy(P2)][12], '');

  // ---- Nómina: costos, CSV y reporte ----
  const Nn = montar('nora');
  await esperar();
  Nn.run("verTab('horas')"); await esperar();
  Nn.run("HORAS.ver('nomina')"); await esperar();
  h = Nn.$('vistaHoras').innerHTML;
  assert(/Costo mensual por persona/.test(h) && /Reporte de nómina por proyecto/.test(h) && /\$32,000\.00 MXN/.test(h), 'costos y reporte');
  Nn.$('nomPersona').value = 'adri@helgen.tech'; Nn.$('nomMes').value = MES; Nn.$('nomCosto').value = '25000'; Nn.$('nomNotas').value = 'Sueldo';
  Nn.run('HORAS.guardarCosto()'); await esperar();
  assert(/Costo guardado/.test(Nn.$('aviso').innerHTML));
  assert(plain(Nn.run('HORAS.estado().costos.costos')).some(c => c.correo === 'adri@helgen.tech' && c.costo === 25000));
  Nn.run("HORAS.importarTexto('correo,mes,costo\\nleo@helgen.tech," + MES + ",80000\\nmal,2026-10,1')"); await esperar();
  h = Nn.$('vistaHoras').innerHTML;
  assert(/1 nuevos · 0 actualizados · 0 sin cambio · 1 con error/.test(h) && /Escribe el correo/.test(h), 'resultado por renglón');
  const csvN = Nn.run('HORAS.csv()');
  assert(csvN.startsWith('﻿"Folio","Proyecto","Estado","Costo ') && /"Total MXN","Horas aprobadas","Horas sin costear"/.test(csvN), csvN.split('\r\n')[0]);
  const cs = plain(Nn.run('contextoSync()'));
  assert.deepEqual([cs.nomCostos, cs.nomReporte, cs.horasSemana], [true, plain(Nn.run('HORAS.estado().rango')), undefined], 'contexto de Nómina');
  console.log('OK nomina (rol, líder, área privada, hoja de horas, aprobar/devolver, Pendientes, recordatorio, costos, CSV, reporte, privacidad, interfaz)');
})().catch(e => { console.error(e); process.exit(1); });
