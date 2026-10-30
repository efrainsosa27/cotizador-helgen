# Incremento 7 (CAPRI) · Módulo N: horas y nómina

Rama `incremento-7-nomina` (sobre `incremento-7-base` = `incremento-6-final` + `docs/incremento-7.md`). Contrato:
`docs/incremento-7.md` §0–§3. Spec aprobado por Leo: "CAPRI — what's missing: spec for increments 6–8", decisiones 9 y 10.
Este archivo es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§1, §4.8–§4.10, §5, §6, §7 regla 12, §9) y
al Manual del Cotizador (una sección nueva "Horas y nómina", Reglas de oro, Historial, Pendientes).

## 0. Decisiones que el contrato no fijó (léelas primero)

1. **El estado va por "parte" (persona + semana + proyecto), no por semana entera.** Con varios proyectos hay varios líderes:
   cada uno aprueba o devuelve solo lo suyo. El estado de la semana se deriva (Devuelta > Borrador > Enviada > Aprobada > Sin
   capturar). "Enviar" manda todas las partes no aprobadas.
2. **Proyecto sin líder → lo aprueba Aprobaciones** (igual que las horas del propio líder).
3. **Super admin aprueba cualquier parte** (también las de un proyecto con líder, marcadas "como super admin"); las suyas, solo con
   motivo ≥ 10 caracteres (`excepcionSuperAdmin_`, bitácora de Administración), como en el incremento 4.
4. **Una parte aprobada no cambia.** Si hay un error, quien podía aprobarla la **devuelve** con motivo (también ya aprobada; en
   "Por aprobar" → "Revisadas en las últimas semanas", 5 semanas). Las horas no se anulan (contrato §0): se devuelven.
   **Revisión del 29/10/2026:** devolver una parte **Aprobada** exige la `huella` que enseñó «Por aprobar» (la interfaz la manda) y
   solo de esas semanas (`inicioRevisadasHoras(hoy)` = lunes de hace `SEMANAS_REVISADAS_HORAS − 1` semanas); las anteriores solo un
   super admin. Antes el servidor no limitaba la antigüedad ni pedía la huella: devolver semanas viejas movía el costo de meses pasados.
5. **Devolver manda un correo** `horas.devuelta` a la persona (no estaba en el contrato; sin horas, montos ni el texto de la nota:
   "Hay una nota: ábrela en CAPRI"). Uno por persona y semana.
6. Editar una parte Enviada sin reenviarla la regresa a **Borrador**; una **Devuelta** sigue Devuelta (con su motivo) hasta que se
   reenvía. Al aprobar se compara la **huella** (horas de los 7 días + actividad) que vio el líder: si la persona la cambió
   mientras tanto, error "cambiaron desde que las abriste".
7. **Actividad obligatoria** por proyecto con horas (3–300 caracteres), una por proyecto y semana (se repite en las filas de sus
   días). "Copiar proyectos de la semana pasada" trae proyectos **y** actividad, sin horas.
8. **Semanas:** cualquier semana pasada (desde 2020) y la actual; ninguna futura. Dentro de la semana actual se pueden capturar
   días que todavía no llegan (se suele llenar el viernes). Máximo 15 proyectos por semana.
9. **Recordatorio:** viernes desde las 12:00 (Ciudad de México) o, si ese día no corrió, sábado o domingo; una vez por semana. Va a
   cada persona **activa de Permisos** sin ninguna parte Enviada o Aprobada esa semana (un borrador no cuenta como enviado), menos
   la Script Property opcional `HORAS_SIN_RECORDATORIO` (correos separados por coma; p. ej. Leo). Un correo por persona (nadie ve a
   quién más le llegó). La semana se marca (`HORAS_RECORDATORIO_SEMANA`) bajo el candado **antes** de mandar: si el envío falla
   (cuota), esa semana no se reintenta (queda "Sin enviar" en Correos).
10. Una semana **sin horas** (vacaciones) no se puede "enviar vacía": esa persona recibe el recordatorio. Si molesta, se agrega a
    `HORAS_SIN_RECORDATORIO` mientras tanto (idea para después: marcar "sin horas esta semana").
11. **Costos:** uno por persona y mes (`AAAA-MM`); guardar otro lo reemplaza y el anterior queda en la Bitacora de nómina (con
    montos: el libro es privado); se puede quitar. Tope de cordura 5,000,000 MXN. Cualquier correo de CAPRI (también de alguien
    que ya no está en Permisos). CSV: correo, mes, costo[, notas], con o sin encabezado, `,` `;` o tabulador, "45,000.00",
    `$`, mes como AAAA-MM, AAAA/MM, MM/AAAA o la fecha dd/mm/aaaa que deja Excel; hasta 500 renglones; si una persona y mes se
    repite en el archivo, **gana el último** (el otro sale "Repetido"). Revisión del incremento 7 (dinero): "45.000" o "1.250.000"
    (punto de miles, como en Excel en español, sin coma) son 45,000 y 1,250,000 (antes "45.000" se leía como 45); con punto de miles
    **y** coma ("45.000,50") es ambiguo y se rechaza ("escribe 45000 o 45,000.00"). Mínimo de cordura: a mano, un costo menor a
    1,000 MXN se confirma (`confirmado: true`; el servidor responde con `codigo: 'CONFIRMAR'` y la interfaz pregunta con
    `window.confirm`); en el CSV (no se puede confirmar) un costo menor a 100 MXN es error del renglón.
12. **Reparto (`costoNominaPorProyecto`)**: el mes es el **del día** (una semana que cruza de mes se parte); en centavos con el
    método del resto mayor (la suma de los proyectos es exactamente el costo de la persona); una fila sin `estado` cuenta como
    aprobada (quien llama ya filtró; con estado, solo `Aprobada`); un costo de un mes sin horas aprobadas **no se reparte** (el
    reporte lo lista en "Costos sin horas aprobadas"); un proyecto con solo horas sin costear sale con `monto: 0` y
    `sinCostear` = sus horas.
13. **Ojo para Leo (privacidad del margen):** el margen mostrará a cobranza la nómina **por proyecto** (así lo dice el contrato §1).
    Si en un mes un proyecto tiene **una sola persona costeada**, ese número es la parte de esa persona. Si importa, opciones para
    el integrador: no mostrar la nómina en el margen de un proyecto con menos de dos personas costeadas en el mes, o mostrarla solo
    a Nómina y super admin. Este módulo no lo decide: nunca publica nada por persona.
    **Decidido tras la revisión del 29/10/2026 (`docs/incremento-7.md` §5):** solo Nómina y super admin la ven en el margen; cobranza
    únicamente con `NOMINA_EN_MARGEN = cobranza` (y solo el monto). Además: **nadie se nombra líder a sí mismo** (`asignarLider`,
    salvo super admin), y la versión de `costosPersonal` que reciben los demás en bootstrap y sincronizar es fija (`VERSION_OCULTA`):
    no les avisa cuándo Nómina captura un costo.
14. **Nómina siempre en MXN:** con un contrato en USD, `margenProyecto` lanza "hay costos en MXN y el contrato es en USD" (el
    margen dice "Revisar"). El integrador decide (convertir con un tipo de cambio o dejarla fuera de los contratos USD).
15. Leer nunca crea el libro de nómina (`libroNominaSiExiste_`); lo crean `prepararNomina`/`prepararCapri`, la primera semana
    guardada, el primer líder asignado o el primer costo.
16. El cambio de líder queda en la **Bitacora de nómina** (no en la de Administración).
17. Una cuenta @helgen.services puede ser líder (si está activa). Nómina no se combina con "Solo requisiciones" ni se da a
    @helgen.services (las reglas de siempre de `normalizarUsuario`).

## 1. Dónde viven los datos

**Área privada NÓMINA** (como cobranza y compras; raíz de la Mi unidad de la cuenta que corre la API, facilities@):
```
📁 CAPRI — Nómina                       (NOMINA_FOLDER_ID; restringida; nadie más por omisión)
   └─ 📊 CAPRI — Nómina y horas          (NOMINA_DB_ID: Horas, CostosPersonal, Bitacora)
```
Columnas en `HOJAS_NOMINA` (texto salvo `horas` y `costo`; fechas y mes con apóstrofo):
- `Horas` — una fila por persona, semana, proyecto y **día con horas** (> 0): `semana` (lunes AAAA-MM-DD), `correo`, `nombre`,
  `proyecto_folio` (llave interna PRY-AAAA-NNNN), `dia`, `horas` (cuartos), `actividad`, `estado` (Borrador · Enviada · Aprobada ·
  Devuelta), `motivo` (de la devolución), `aprobo`, `fecha_aprobacion`, `enviada`, `actualizado`. Estado, motivo, aprobó y fechas
  son de la parte y se repiten en sus filas. Al guardar, las filas de esa semana se reescriben **en su lugar** (las de una parte
  aprobada no se tocan); si sobran, se borran (`deleteRows`, de abajo arriba).
- `CostosPersonal` — `correo`, `nombre`, `mes` (AAAA-MM), `costo` (MXN, sueldo + carga patronal), `notas`, `capturo`, `actualizado`.
- `Bitacora` — las columnas de siempre: enviar horas, aprobar, devolver (y "devolver horas aprobadas"), asignar líder, capturar /
  cambiar / quitar costo (con montos), importar CSV (resumen).

**Base de datos (la lee todo el dominio):** solo la columna nueva `lider_email` (M) en `Proyectos` (se crea sola por nombre con
`ENCABEZADOS_PROYECTOS`; no mueve ninguna columna; la `clave` sigue en L). Nada de horas ni costos.

**Script Properties nuevas:** `NOMINA_FOLDER_ID`, `NOMINA_DB_ID` (se crean solas), `VER_horas`, `VER_costosPersonal` (versiones),
`HORAS_RECORDATORIO_SEMANA` (la escribe CAPRI), `HORAS_SIN_RECORDATORIO` (opcional, a mano). El rol `nomina` va en Permisos
(no hay `ROL_NOMINA` en propiedades: mientras no exista el libro de Administración nadie tiene Nómina, salvo super admin).

## 2. Funciones (`Code.js` §6.N, al final del archivo; interfaz `<script id="mod-horas">`)

`modNomina_()` en `MODULOS_`. API (cada una revisa su permiso):

| Función | Quién | Qué |
|---|---|---|
| `misHoras(semana?)` | toda cuenta activa (también solo requisiciones) | su semana (por omisión la actual): partes, totales por día, `anterior` (para copiar), últimas 8 semanas, proyectos Activo/Cerrado. Caché por persona y versión |
| `guardarSemana({semana, bloques: [{proyecto, horas[7], actividad}], enviar})` | la persona | valida (`normalizarSemanaHoras`, `planSemanaHoras`, proyecto Activo/Cerrado, no anulado) y reescribe su semana; devuelve `misHoras` |
| `horasPorAprobar()` | líder, Aprobaciones, super admin | partes Enviadas que le tocan (con `huella`, `como`, `propio`) y las revisadas de las últimas 5 semanas. Nunca costos |
| `aprobarHoras(lista, motivoExcepcion?)` | líder / Aprobaciones / super admin | `lista = [{correo, semana, proyecto, huella}]` (≤ 100) |
| `devolverHoras(lista, motivo)` | igual | Enviada o Aprobada → Devuelta; correo `horas.devuelta`. Una Aprobada: con `huella` y de las últimas 5 semanas (antes, solo super admin) |
| `listarLideres()` / `asignarLider(folio, correo)` | super admin, cobranza | proyectos no cancelados con su líder y candidatos activos; `correo` vacío = quitar; nadie se asigna a sí mismo (salvo super admin) |
| `listarCostosPersonal()` | Nómina, super admin | costos, personas, meses con horas aprobadas sin costo (6 meses) |
| `guardarCostoPersonal({correo, mes, costo, notas, quitar})` | Nómina | alta, cambio o baja |
| `importarCostosPersonal(texto)` | Nómina | CSV con resultado por renglón (Nuevo · Actualizado · Sin cambio · Error · Repetido) |
| `reporteNomina(desde?, hasta?)` | Nómina | por proyecto y mes (AAAA-MM; 6 meses por omisión, máx. 24): monto, horas, sin costear; horas sin costear por persona y mes; costos sin horas; horas por aprobar |

`cambios`: `guardarSemana`, `aprobarHoras`, `devolverHoras` → `horas`; `asignarLider` → `proyectos`; `guardarCostoPersonal`,
`importarCostosPersonal` → `costosPersonal`. `solo`: `misHoras`, `guardarSemana`, `horasPorAprobar`, `aprobarHoras`,
`devolverHoras`. `bootstrap` → `horasPermisos: {capturar, lider, aprobar, lideres, nomina}`. `sincronizar`: `horasPermisos`
(cambió permisos o proyectos) y, según `ctx`, `horasSemana` (`ctx.horasSemana` = lunes), `horasAprobar`, `horasLideres`, y **solo
con Nómina** `nomCostos` y `nomReporte` (`ctx.nomReporte = {desde, hasta}`). `preparar` = `prepararNomina_`.

Internas: `prepararNomina()` (editor), `AREA_NOMINA`, `libroNomina_`, `libroNominaSiExiste_`, `hojaNomina_`, `bitacoraNomina_`,
`esNomina_`, `exigirNomina_`, `puedeAsignarLider_`, `permisosHoras_`, `horaDesdeFila_`, `horasDelLibro_`, `costosDelLibro_`,
`reescribirFilasHoras_`, `revisarHoras_`, `horasParaPendientes_` (caché por versión), `vistaLideres_`, `vistaCostos_`,
**`recordatorioHoras_(cuando?)`** (la llama `cadaQuinceMinutos`; manda sus correos al terminar: el servidor de la etapa 1 solo
tiene que llamarla), `datosAvisoHoras_`, y para el integrador **`costoNominaDeProyectos_()`** = `costoNominaPorProyecto` con todas las
horas aprobadas y costos del libro (caché por versión de horas y costos; `{}` sin libro).

Puras (se prueban en Node): **`costoNominaPorProyecto(horas, costos)`** (contrato §1, exacta: `{[folio]: [{concepto: 'Nómina',
moneda: 'MXN', monto, horas, sinCostear}]}`), `costoNominaPorProyectoMes`, `repartoNomina`, `reporteNominaDatos`,
`esLunesIso`, `diasDeSemanaHoras`, `numeroSemanaIso`, `textoSemanaHoras`, `validarSemanaHoras`, `normalizarHorasDias`,
`normalizarSemanaHoras`, `claveBloqueHoras`, `huellaBloqueHoras`, `bloquesDeHoras`, `estadoSemanaHoras`, `planSemanaHoras`,
`vistaSemanaHoras`, `quienApruebaHoras`, `permisoAprobarHoras`, `normalizarPedidosHoras`, `vistaPorAprobarHoras`,
`itemsHorasPendientes`, `mesValido`, `mesMas`, `rangoMesesNomina`, `importeDeTexto`, `normalizarCostoPersonal`, `renglonesCsv`,
`leerCsvCostos`, `tocaRecordatorioHoras`, `destinatariosRecordatorioHoras`, `destinatariosAvisoHoras`, `contenidoAvisoHoras`,
`textoHoras`.

**Interfaz (`mod-horas`):** pestaña **Horas** en la barra de grupos (toda cuenta activa; el número = semanas por aprobar) con
"Mi semana" (tarjeta por proyecto con 7 casillas de cuartos de hora y la actividad, totales por día en vivo con el día de más de
24 h en rojo, copiar la semana pasada, guardar borrador o enviar, semanas anteriores), "Por aprobar" (tarjetas por persona y semana:
Aprobar, Aprobar todo, Devolver con motivo; revisadas), "Líderes" y "Nómina" (costos, CSV, lo que falta costear, reporte con CSV).
Control "Líder del proyecto" en la vista de Cobranza del proyecto (`#cobLider`). Liga `#horas` (los correos) abre la pestaña.
`window.HORAS` para las pruebas. Revisado en Chromium a 390 px de ancho (render real con el servidor simulado).

## 3. Cambios compartidos (para el integrador)

`Code.js`:
- `MODULOS_`: `modNomina_()`.
- `COLECCIONES`: `horas`, `costosPersonal` al final.
- `ENCABEZADOS_PROYECTOS` + `lider_email`; `COL_LIDER_PROYECTO = 13`; `proyectosDesdeFilas` agrega `lider` (no sale en
  `proyectoParaLista_`).
- `filasDeArea_`: memo por petición también para `HOJAS_NOMINA` (`'nomina'`).
- `ROLES_CAPRI` (+ `nomina`, antes de `superadmin`) y `NOMBRES_ROLES` (`Nómina`). `ROLES_DELEGABLES` no cambia.
- Pendientes: `COLECCIONES_PENDIENTES` + `horas`; `pendientes()` arma `o.horas` (solo si puede aprobar o ve los de todos);
  `itemsPendientes` agrega `itemsHorasPendientes(x.horas, x)` antes de ordenar (sección y destino `horas`; `conteosPendientes` no
  cambia: cuentan en `total`).
- `cadaQuinceMinutos`: `r.horas = recordatorioHoras_()`.
- Correos: `EVENTOS_CORREO.push('horas.recordatorio', 'horas.devuelta')` (en §6.N); una línea en `destinatariosAviso`,
  `infoDeAviso_` y `contenidoAviso` (como `proveedor.banco`).

`web/cotizador/index.html`: botón `#tabHoras` (+ `#cntHoras`) en `#navGrupos`, `<section id="vistaHoras">`, `<div id="cobLider">`
en el detalle de Cobranza, `abrirDestino` de mod-pantallas con destino `horas`, y el `<script id="mod-horas">` al final (su CSS lo
inyecta el propio script).

Pruebas: `tests/arnes.js` (simulacro `deleteRows`); `tests/permisos.test.js` (super admin con `nomina`),
`tests/identidad.test.js` (Nómina en Permisos), `tests/proyectos.test.js` (encabezado `lider_email`),
`tests/requisiciones.test.js` (versiones `horas` y `costosPersonal`).

**Para el integrador:**
- **Margen:** `margenDeContrato_`, el resumen de cobranza y `reporteMargen` (`costosExtra[folio]`) con `costoNominaDeProyectos_()`
  (ver §0.13 y §0.14). La prueba de privacidad (§3 de `tests/nomina.test.js`) ya prepara datos donde el total por proyecto nunca es
  la parte de una persona: al conectar el margen debe seguir pasando.
- **`VERSION_CODIGO_CACHE`:** las fuentes de proyectos ahora llevan `lider`. Sin cambiarlo no se rompe nada (antes de asignar el
  primer líder no hay ninguno, y `asignarLider` sube la versión de proyectos), pero cámbialo como siempre al publicar.
- `MEMOS_DERIVADOS_`: sin memos nuevos.

## 4. Pruebas

`node tests/nomina.test.js .` (en `bash tests/todas.sh`):
1. **Lógica pura:** semana ISO (2026 tiene 53 semanas), horas por día, normalizar y planear la semana (estados, aprobada que no
   cambia, 24 h por día entre todos los proyectos), partes, quién aprueba (matriz completa), Pendientes, **reparto**: proporción
   simple, resto mayor (33.34 + 33.33 + 33.33 = 100.00), **mes parcial** (semana de octubre a noviembre), **horas sin costear**,
   solo aprobadas, último costo repetido, dos personas en un proyecto, datos raros ignorados, suma exacta con 28 días en cuartos,
   salida sin datos por persona; meses, rangos, importes, CSV (encabezado por nombre, sin encabezado, `;`, comillas, BOM, errores
   por renglón, renglón real del archivo), recordatorio (jueves no, viernes 11:59 no, viernes 12:00 sí, domingo sí, una vez por
   semana) y avisos (uno por persona, sin montos, la nota no va).
2. **Servidor por doPost:** área NÓMINA (carpeta en la raíz de Mi unidad, carpeta y libro restringidos, pestañas, nada en la Base
   de datos; también creada sola con la primera semana), rol Nómina (Permisos, no delegable, no con @helgen.services ni solo
   requisiciones), líder (ventas y compras no; cobranza y super admin sí; correo inválido, inactivo, proyecto cancelado; bitácora;
   versión; las listas no traen el líder), hoja de horas (validaciones, filas por día, reescritura sin basura, copiar), separación de
   funciones (líder, Aprobaciones, nadie lo suyo, super admin con motivo en la bitácora de Administración, huella), devolver
   (correo sin horas, montos ni nota; también una aprobada; reenviar), Pendientes por rol, @helgen.services, costos (permisos de
   cada rol, reemplazo con bitácora, quitar), CSV, reporte = `costoNominaPorProyectoMes`, `costoNominaDeProyectos_`,
   sincronizar por rol, recordatorio (una vez, a quien no envió, sin excluidos ni inactivos, uno por persona) y `cadaQuinceMinutos`.
3. **Privacidad:** arnés aparte con tres personas costeadas; **todas las funciones de la API** (92: todas menos `cerrarSesionCapri`) ×
   12 formas de argumentos × 8 cuentas (cobranza, compras, Aprobaciones, líder, quien pide, ventas, solo requisiciones,
   @helgen.services), más `bootstrap` y `sincronizar` con todo el contexto: ninguna respuesta ni error trae un costo mensual ni la
   parte de una persona en ningún formato (número, 2 decimales, con comas, centavos). Control positivo con Nómina y super admin.
   Ningún libro que no sea el de nómina guarda esas cifras; los correos tampoco; el reparto por proyecto nunca va por persona.
4. **Interfaz:** la semana (7 casillas, copiar, total en vivo, revisión en el navegador: cuartos y 24 h, envío con lo que espera el
   servidor, cambiar de semana con cambios pide confirmar, parte aprobada sin editar, contexto), el líder (número en la pestaña,
   Pendientes → Por aprobar, aprobar y devolver), cobranza (líderes en Horas y en la vista del proyecto; Nómina no) y Nómina
   (costo, CSV con resultado por renglón, CSV del reporte, contexto).

## 5. Publicar

1. Sin permisos nuevos de Google (MailApp, UrlFetchApp, ScriptApp y Drive ya están autorizados).
2. `clasp push`; **como facilities@** (la cuenta de la API), correr **`prepararNomina()`** (o `prepararCapri()`, que lo incluye) **antes**
   de la nueva versión del deployment: crea en su Mi unidad la carpeta "CAPRI — Nómina" y el libro "CAPRI — Nómina y horas",
   restringidos (de arriba abajo), con sus tres pestañas, y agrega `lider_email` a Proyectos. El registro dice quién tiene Nómina.
   Comprobar con `get_file_permissions` que carpeta y libro **no** tienen "helgen.tech: lector" (§6.11).
3. **Compartir:** nadie lo necesita para usar la app (todo pasa por el servidor). Si la persona de Nómina quiere abrir el libro,
   compartirle **la carpeta** por persona (nunca al dominio): ve **todos** los costos y todas las horas. No compartirla con
   cobranza, compras ni líderes.
4. Leo, en Administración → Permisos: dar **Nómina** a quien lleve la nómina. Asignar líderes (Horas → Líderes, o Cobranza →
   proyecto). Opcional: `HORAS_SIN_RECORDATORIO` en Script Properties (p. ej. leo@ y facilities@).
5. Interfaz: `wrangler deploy` junto con la API (la interfaz usa `horasPermisos` y las funciones nuevas).
6. Servidor de la etapa 1: el puente debe dar `Sheet.deleteRows` y programar `recordatorioHoras_()` (o seguir con `cadaQuinceMinutos`).
7. Avisar al equipo: capturar horas cada semana (viernes llega el recordatorio); líderes: Pendientes → Revisar horas.

## 6. Lo que quedó fuera

- ~~Conectar la nómina al margen (integrador, §3) y la decisión de §0.13.~~ Hecho (integración y revisión del 29/10/2026).
- "Semana sin horas" (vacaciones, incapacidad) y días festivos en el recordatorio.
- Recordatorio a líderes con horas sin aprobar (hoy solo Pendientes).
- Que "Actualizar" en Pendientes también refresque el número de la pestaña Horas (se refresca en la siguiente sincronización).
- No probado en PRUEBAS ni con cuentas reales; la interfaz se revisó en Chromium sin conexión a Google.
