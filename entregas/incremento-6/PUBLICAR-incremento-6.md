# Publicar CAPRI incremento 6 (con el 5)

El incremento 6 **contiene** al 5. Si el 5 todavía no se publica, se publican juntos en una sola vuelta:

1. **Centro de mando:** igual que la parte A de `entregas/incremento-5/PUBLICAR-incremento-5.md` (parches, deploy, reinicio, nginx y
   secreto). El incremento 6 no cambia nada del centro de mando.
2. **CAPRI:** la parte B de ese mismo documento, con **una diferencia**: en lugar de la rama `incremento-5`, trae y sube esta:

   ```bash
   cd ~/Documents/Claude/Projects/cotizador-helgen
   git fetch entregas/incremento-5/capri-incremento-5-fd5c6d5.bundle incremento-5:incremento-5
   git fetch entregas/incremento-6/capri-incremento-6-cabf985.bundle incremento-6-final:incremento-6
   git checkout incremento-6
   bash tests/todas.sh
   git push github incremento-5 incremento-6
   npx clasp push --force
   ```

   Lo demás es igual: como facilities@, `prepararCapri`, las tres `PORTAL_*`, `probarCentroMando` y **Nueva versión** del deployment;
   luego `CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy`. **API e interfaz el mismo día** y
   pedir a compras que recarguen (Cmd+Shift+R): la interfaz nueva renueva el id de cada pago parcial.

Si el 5 ya está publicado: solo el paso 2 (sin `prepararCapri`: las columnas del 6 se crean solas; no hay permisos nuevos).

## Avisos al equipo (además de los del incremento 5)

> **Compras:** una orden ya acepta varios pagos (anticipo, parciales, liquidación) y puede llevar un plan de pagos al autorizar.
> Mientras falte, la orden dice "Pagada parcial"; con el primer pago ya se puede recibir el material. Si se pagó de más (por una
> devolución), aparece como **saldo a favor** con el proveedor.
>
> **Cobranza:** cada etapa del esquema puede llevar su **fecha esperada de cobro**; con ellas funciona la nueva pestaña
> **Reportes** (antigüedad de lo que nos deben, flujo de 13 semanas y margen por proyecto).

## Comprobar (≈ 10 min, en el real, sin crear nada)

- Reportes abre para cobranza (CxC, margen), compras (CxP) y super admin (las cuatro); ventas no la ve.
- En una requisición pagada, el formulario de pago muestra esperado / pagado / saldo.
- La primera carga después de publicar puede tardar más (caché nuevo, `VERSION_CODIGO_CACHE = 2026-10-29r`): es normal.

## Si algo sale mal

Administrar implementaciones → versión anterior (13) → Implementar, y `wrangler rollback` a la versión anterior de la interfaz. Las
columnas nuevas se quedan; la versión anterior no las lee. Un pago parcial registrado con la versión nueva seguirá en la hoja (la
versión 13 solo acepta un pago por orden).

## La rama del servidor (no se publica todavía)

`capri-servidor-etapa-1-6b8f383.bundle` = prototipo del servidor (etapa 1), para guardarlo:
`git fetch entregas/incremento-6/capri-servidor-etapa-1-6b8f383.bundle servidor-etapa-1:servidor-etapa-1`. Diseño:
`docs/servidor-etapa-1.md` en esa rama.
