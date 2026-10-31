# Publicar CAPRI incremento 7 (con el 5 y el 6)

El incremento 7 **contiene** al 5 y al 6. Si todavía no se publican, salen juntos en una sola vuelta (≈ 1 h). Al hacer
`clasp push` el activador de 15 min ya corre el código nuevo: no dejes la parte B a medias.

## 0. Antes

- **Respaldos** (Drive → Archivo → Hacer una copia): Base de datos, libro de **Compras** y libro de **Cobranza**
  ("… — respaldo antes de inc 7"). El 7 agrega columnas a la Base de datos (`Cotizaciones.tipo`, `Proyectos.lider_email`) y
  pestañas a Cobranza (`Adicionales`, `FacturasClientes`) y Compras (`Gastos`).
- **Centro de mando:** si el incremento 5 no se ha publicado, primero la **parte A** de
  `entregas/incremento-5/PUBLICAR-incremento-5.md` (parches, deploy, reinicio, nginx y secreto). El 6 y el 7 no cambian nada allá.

## A. CAPRI

```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
B=entregas/incremento-7/capri-incrementos-5-6-7-servidor.bundle
git bundle verify "$B"
git fetch "$B" incremento-5:incremento-5 incremento-6-final:incremento-6 incremento-7:incremento-7 servidor-etapa-1:servidor-etapa-1
git checkout incremento-7
bash tests/todas.sh                      # 36 ✔, nada en ✘
git push github incremento-5 incremento-6 incremento-7 servidor-etapa-1   # GitHub (git.helgen.online es su espejo, solo lectura)
# espejo: https://git.helgen.online/leo/cotizador-helgen/settings → Sincronizar ahora (el servidor clona de ahí)
npx clasp push --force                   # sube solo Code.js, Logo.js, Index.html y appsscript.json (servidor/ no)
```

En el **editor de Apps Script como facilities@** (Chrome "Leopoldos MacBook Pro 2"; recarga el editor después del push):

1. Ejecutar **`prepararCapri`**. Crea lo del 5 (`Devoluciones`, columnas) y lo del 7: el área **NÓMINA** (carpeta "CAPRI — Nómina"
   y libro "CAPRI — Nómina y horas" en el Drive de facilities@, restringidos) y las pestañas nuevas. No pide permisos nuevos (si los
   pide, Permitir). En el registro no debe haber errores.
2. Solo si el 5 no estaba publicado: las tres `PORTAL_*` y `probarCentroMando` (pasos B2–B3 del documento del incremento 5).
3. **No** agregues `NOMINA_EN_MARGEN` (la nómina queda oculta en el margen de cobranza; la ven Nómina y el super admin). **No**
   agregues `API_MUDADA`: es el interruptor del servidor nuevo, para la noche del cambio.
4. Implementar → **Administrar implementaciones** → lápiz de `AKfycbwBjF7…` → Versión: **Nueva versión** → "CAPRI incrementos 5–7" →
   Implementar.

Interfaz el mismo día (la cuenta de Cloudflare de Helgen):

```bash
CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy
```

## B. Permisos (tú, en CAPRI → Administración → Permisos)

- Rol **Aprobaciones** a quien apruebe gastos (y requisiciones con operaciones).
- Rol **Nómina** a quien lleve la nómina; comparte con esa persona la carpeta "CAPRI — Nómina" (Drive de facilities@) y revisa que
  no la lea el dominio.
- **Líder** de cada proyecto activo (Horas → «Líderes de proyecto», o en la vista de cobranza del proyecto). Nadie puede nombrarse a sí mismo.

## C. Avisos al equipo (además de los del 5 y el 6)

> **Todos:** cada viernes llenen su **hoja de horas** (pestaña Horas, por proyecto). Los **gastos** del proyecto (gasolina, casetas,
> hospedaje…) se capturan en Gastos con la foto del ticket; Aprobaciones los aprueba y Compras los reembolsa.
>
> **Ventas:** en un proyecto con contrato firmado ya se puede cotizar un **adicional** (casilla «Adicional»).
>
> **Cobranza:** los adicionales aceptados se cobran con su propio esquema. En *Facturas de clientes* importen los XML (o el ZIP) que timbra
> CONTALINK y lígenlos a su etapa; CAPRI avisa los **REP pendientes**. El margen ya incluye adicionales y gastos (la nómina no
> aparece en su vista).

## D. Comprobar (≈ 10 min, en el real)

- Recarga con Cmd+Shift+R. La primera carga tarda más (caché nuevo, `VERSION_CODIGO_CACHE = 2026-10-29t`): es normal.
- Pestañas **Gastos** y **Horas** visibles para todos; **Facturas** y el margen nuevo para cobranza; Reportes abre.
- Un gasto de prueba con foto (márcalo como prueba y cancélalo) llega a Pendientes de Aprobaciones; en Drive queda en
  `Compras/2026/<proyecto>/Gastos/`, restringido.
- Importa un XML real de CONTALINK y lígalo: la etapa muestra "facturado".

## Si algo sale mal

Administrar implementaciones → versión anterior → Implementar, y
`CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 rollback`. Las columnas, pestañas y el área de Nómina
se quedan; la versión anterior no las lee.

## El servidor propio (otro día, con Gibran)

`entregas/incremento-7/servidor/servidor-comandos.md` (copia de `docs/servidor-comandos.md`): A0 ya lo hiciste arriba (push a GitHub
y «Sincronizar ahora» en el espejo). Gibran empieza en **A1–A3** (revisión, imagen y certificado de `capri.helgen.online`); la parte de Google es tuya
(B–C, guía en `servidor-google-paso-a-paso.md`). La **sombra (E)** se corre después de publicar esto: Apps Script y el servidor
deben correr el mismo `Code.js`.
