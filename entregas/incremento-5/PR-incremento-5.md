# CAPRI — incremento 5 (rama `incremento-5`)

**Para:** Efrain (revisa y hace merge) · **De:** Leo · **Base:** `incremento-4` = `c078fd4` (lo publicado el 29/10, API @13)
· **Punta:** `fd5c6d5` · **Va junto con:** centro de mando `hbox-docs`, 11 parches (`centro-de-mando/`)

## Cómo traer la rama (desde la sesión de Claude no se puede subir: GitHub responde 403)

```bash
git fetch entregas/incremento-5/capri-incremento-5-fd5c6d5.bundle incremento-5:incremento-5
git checkout incremento-5
bash tests/todas.sh                      # 21 archivos + sintaxis de la interfaz, todo en verde
git push github incremento-5             # PR contra incremento-4 (o contra main cuando entre el 4)
```

Si el bundle no sirve: `git checkout -b incremento-5 c078fd4 && git apply --index entregas/incremento-5/capri-incremento-5.diff`.
No subas la carpeta `entregas/` al repositorio.

## Qué trae (pedido de los usuarios, 29/10/2026)

- **F · Forma de pago y proveedores.** Cada orden lleva forma de pago: Transferencia, **Crédito del proveedor** (el material se
  recibe antes de pagar; el pago la cierra), Tarjeta de crédito, Tarjeta de débito (en sitio), Efectivo o Cheque. Base de
  **proveedores** con dirección, banco, CLABE (dígito verificador), titular y documentos (**constancia de situación fiscal,
  carátula bancaria, comprobante de domicilio**) en Drive privado. Sin documentos la orden avisa y **el pago por transferencia no
  se registra** (carátula, y CSF si el RFC es nacional; un proveedor extranjero solo necesita la carátula); con tarjeta, efectivo
  o cheque solo avisa. Super admin puede pasarlo con motivo (bitácora). Un cambio de cuenta bancaria pide carátula nueva y avisa a
  compras. Nunca se guarda un número de tarjeta: la referencia que lo parece se rechaza.
- **H · Fotos y devoluciones.** **Una foto por renglón** al recibir ("Registrar lo que llegó", "Recibí el material", "Lo recogí";
  comprimida en el navegador a 1600 px, a Drive con `privado_`); compras puede cerrar sin foto en su respaldo. **Reportar
  problema** (Incorrecto · Dañado · Faltante · Sobrante · Otro, con comentario y foto) crea una devolución `DEV-AAAA-NNNN`; compras la
  resuelve: **Reponer** · **Devolver al proveedor** · **Cancelar renglón** · **Conservar**. Con una devolución abierta la
  requisición no se cierra. En proyectos ligados (DROGHEDA) las fotos y problemas del sitio llegan desde el centro de mando y la
  resolución viaja de regreso (`oc.devolucion`).

Detalle: `docs/incremento-5.md` (contrato), `docs/incremento-5-proveedores.md`, `docs/incremento-5-recepcion.md`, `CLAUDE.md` §4.9.

## Revisión

Dos revisiones independientes: (1) flujos, dinero y estados; (2) seguridad + **prueba en vivo del `Code.js` real contra el
servidor real del centro de mando**. Todo lo encontrado se arregló con su prueba (`tests/revision5.test.js`,
`tests/revision5-centro.test.js` y casos en proveedores, recepción, interfaz y correos). Lo principal:

- Cancelar o anular una recepción de una requisición retenida (pagada, con devolución abierta) la dejaba sin salida → regresa a
  Pagada (transición `cancelarRecepcionPagada`).
- Anular una orden o requisición ahora anula sus devoluciones; anular una recepción con devoluciones se rechaza.
- Crédito del proveedor con material devuelto: el pago esperado es la orden menos lo devuelto sin reponer.
- Detección de números de tarjeta: una sola regla (13–19 dígitos, inicia en 3–6, Luhn; CLABE nunca cuenta) con cualquier
  separador entre grupos con forma de tarjeta; falsos positivos en referencias de ~10 % a ~4 %.
- Contrato con el centro de mando: `devolucion.origen` (`centro`/`capri`) y `problema.por`; reposición recibida en el mismo minuto
  que "Reponer"; fotos de órdenes que CAPRI no puede ligar se archivan igual (`Compras/AAAA/_sin-orden/`).

Prueba en vivo final (CAPRI + centro de mando con todos los arreglos): 44 + 7 comprobaciones bien.

## Para publicar

Pasos completos en `PUBLICAR-incremento-5.md` (misma carpeta). Lo importante: **el centro de mando va primero**; la versión nueva
de la API la publica **facilities@ desde el editor** (la API corre como quien la publica); no hay permisos nuevos de Google.

## Pendiente

- **Manual del Cotizador**: actualizar formas de pago, proveedores, fotos y devoluciones (no está compartido con la cuenta de Leo).
- Hay `esc()` dentro de `onclick` fuera de `mod-recepcion` (solo folios del servidor; sin riesgo hoy) — cambiarlos a `jsArg`.
- La firma del centro de mando cubre hora y cuerpo, no la ruta (limitación conocida, `DESPLIEGUE.md` D5).
