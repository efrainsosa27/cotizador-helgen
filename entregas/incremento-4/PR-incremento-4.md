# CAPRI — incremento 4 (rama `incremento-4`)

**Para:** Efrain (revisa, hace merge y publica) · **De:** Leo · **Base:** `main` = `2eedf21` (API @12) · **Punta:** `c078fd4`

## Cómo traer la rama (no se pudo subir desde la sesión de Claude: GitHub respondió 403)

Desde la carpeta del repositorio, con estos archivos en `entregas/incremento-4/`:

```bash
git fetch entregas/incremento-4/capri-incremento-4.bundle incremento-4:incremento-4
git checkout incremento-4
bash tests/todas.sh                      # todas en verde
git push github incremento-4             # y abrir el PR contra main en GitHub
```

Si el bundle no sirve: `git checkout -b incremento-4 main && git apply --index entregas/incremento-4/capri-incremento-4.diff`
(misma diferencia, sin el historial de commits). No subas la carpeta `entregas/` al repositorio.

## Qué trae

La app se llama **CAPRI** (Cotizaciones · Aprobaciones · Pagos · Requisiciones · Inventario). Spec aprobado por Leo el 28/10/2026
("CAPRI — increment 4 spec", Claude Docs). Se construyó en cinco módulos en paralelo sobre una base común y se integró aquí.

- **Base (roles):** permisos por persona en un libro privado "CAPRI — Administración"; roles ventas, requisición, solo
  requisiciones, aprobaciones (antes `ROL_OPERACIONES`), compras, cobranza, desbloqueo y super admin (raíz: leo@). Mientras no
  exista el libro, todo sigue saliendo de Script Properties como hoy.
- **A · Identidad:** página de Permisos (solo super admin), delegación de Aprobaciones o Compras por fechas, entrada con código por
  correo para `@helgen.services` (solo Requisiciones), sesión de 30 días que se renueva sola, super admin que aprueba lo suyo solo
  con motivo (queda en bitácora).
- **B · Correos y proveedores:** aviso por correo a quien sigue en cada relevo (desde efrain@, nombre "CAPRI Helgen", sin montos,
  proveedores, folios de orden ni el texto de las notas); solicitud de cotización en PDF para el proveedor con botón de correo;
  envío de la orden de compra al proveedor; bitácora de correos.
- **C · Centro de mando (drogheda.helgen.online):** en proyectos ligados, CAPRI avisa cada orden firmada con HMAC y sin montos
  (`oc.autorizada`, `oc.pagada`, `oc.en_camino`, `oc.cancelada`, `req.cerrada`), quien recibe marca "En camino"/"Lo recogí", el
  material se recibe en el centro de mando (entra al inventario del sitio) y CAPRI trae esas recepciones cada 15 minutos para
  cerrar la requisición. Ítem del inventario por renglón y "lo que ya pediste" como sugerencias. **Apagado hasta poner
  `PORTAL_SECRETO`.**
- **D · Pantallas:** nombre CAPRI, navegación por grupos, pantalla de **Pendientes** al entrar, contadores, menú para teléfono y
  ligas directas `#req=REQ-…`.
- **E · Anular:** el super admin anula cualquier registro (ventas, cobranza y compras) con motivo, vista previa de todo lo que
  arrastra y página central de anulados; lo anulado sale de listas, totales y pendientes.

## Revisión independiente

Dos revisiones sin ver el trabajo (seguridad; flujos y centro de mando). Todo lo encontrado se arregló con su prueba
(`tests/revision.test.js` y casos nuevos en identidad, correos, pantallas y centro): notas fuera de los correos; el flujo de
aprobaciones ya no se apaga al desactivar a quien aprueba; sesiones de CAPRI revocables ("Cerrar sesión" y reactivar); topes
globales de la entrada con código; delegaciones sin encadenar; `@helgen.services` nunca super admin; recepciones solo de proyectos
ligados y traídas antes de cancelar o anular; avisos rechazados (4xx) que ya no detienen su orden; `oc.autorizada` primero para
órdenes que ya iban en curso; aviso al pagar en el flujo de siempre; solicitud de cotización también sin aprobaciones.

**Decisión de Leo (29/10/2026):** también en el flujo de siempre nadie autoriza la requisición que pidió; solo un super admin, con
motivo que queda en la bitácora de Administración.

## Publicar (en este orden)

1. Merge a `main`. Respaldar la base de datos, el libro de compras y el de cobranza (como siempre).
2. Recomendado: probar antes en PRUEBAS (anular toca todos los libros).
3. `npx clasp push --force` y comparar el editor con `clasp clone`.
4. **Desde el editor, `prepararCapri()` ANTES del deploy.** Pide permisos nuevos (mandar correo y activadores). Crea el libro de
   Administración, migra los roles a Permisos, `SUPER_ADMIN` = leo@, `SESION_SECRETO`, sitios con código, `PortalPendientes`, el
   activador de 15 minutos y manda "[CAPRI] Correo de prueba" a efrain@. **Si dice que no pudo mandar la prueba, no publicar.**
   Dejar el libro y la carpeta de Administración en Restringido (efrain@ y leo@).
5. `npx clasp deploy --deploymentId AKfycbwBjF7…` (API primero) y después `npx --yes wrangler@4 deploy`.
6. Leo, en Administración → Permisos: revisar roles migrados y nombres, rol Aprobaciones, altas `@helgen.services` con su sitio
   (Alán en VER en lugar de Paola) y probar una entrada con código.
7. Enlace con el centro de mando: Leo genera el secreto (`openssl rand -hex 32`) y lo pone en `PORTAL_SECRETO` (CAPRI) y
   `COTIZADOR_SECRETO` (servidor); `PORTAL_URL = https://drogheda.helgen.online`; `PORTAL_PROYECTOS = {"PRY-2026-0002":
   "drogheda"}`. Correr `probarCentroMando()` y una ronda con `PORTAL_PRUEBA = 1`; luego borrar `PORTAL_PRUEBA`.

## Pendiente

- Preguntas al centro de mando: `recibido` acumulado o por recepción; `proyecto_clave` = "drogheda".
- No probado en PRUEBAS ni en el navegador real. El Manual del Cotizador no se actualizó (no está compartido con Leo en Claude Docs).
- Detalle completo: `CLAUDE.md` §1, §4.8, §5, §6.15 y §9, y `docs/incremento-4*.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_013SfRStBeRbueu9grrfatQU
