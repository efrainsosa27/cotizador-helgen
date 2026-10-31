# Publicar CAPRI incremento 5 + centro de mando (29/10/2026)

Orden: **0 → A (centro de mando) → B (CAPRI) → C (comprobar)**, de corrido (≈ 45 min). Al hacer `clasp push` el activador
de 15 min ya corre el código nuevo, así que no dejes B a medias.

## 0. Antes

- **Respaldo del libro de compras:** en Drive, Archivo → Hacer una copia ("Compras — respaldo antes de inc 5").
- **Aviso a compras** (puedes reenviarlo tal cual):

  > Desde hoy en CAPRI: (1) cada orden lleva **forma de pago**; con **crédito del proveedor** el material se recibe antes de
  > pagar. (2) **Un pago por transferencia no se registra** si el proveedor no tiene su **carátula bancaria** (y la **constancia
  > de situación fiscal** si es nacional): súbanlas en *Proveedores*. Con tarjeta, efectivo o cheque solo avisa. (3) Al recibir
  > se pide **una foto por renglón**. (4) Si algo llega mal: **Reportar problema**; compras decide en *Devoluciones* (reponer,
  > devolver, cancelar el renglón o conservar).

## A. Centro de mando (drogheda.helgen.online) — va primero

```bash
cd ~/Documents/Claude/Projects/Drogheda/hbox-docs
git status --short                       # solo los 2 lotes del 28-oct sin rastrear; nada modificado
git am ~/Documents/Claude/Projects/cotizador-helgen/entregas/incremento-5/centro-de-mando/*.patch   # 11 commits
bash backend/tests-1029.sh .             # 238 bien
bash backend/tests-1028.sh .             # 61 bien
mkdocs build --strict
git push
cd .. && git add hbox-docs && git commit -m "hbox-docs: compras con foto, devoluciones y nginx del cotizador (CAPRI inc. 5)" && git push
cd hbox-docs && ./scripts/deploy.sh      # sitio + backend
```

En el servidor: respaldo de la base y reinicio (`app.py` cambió).

```bash
ssh -t leo@git.helgen.online '
  python3 -c "import sqlite3;s=sqlite3.connect(\"/srv/projects/drogheda/drogheda.db\");s.backup(sqlite3.connect(\"/srv/projects/drogheda/drogheda-antes-1029.db\"))" &&
  sudo systemctl restart actas-hbox && sleep 2 &&
  curl -s localhost:8081/api/compras -H "X-Remote-User: leo" | head -c 120; echo'      # debe decir "ok":true
```

**nginx** (deja pasar al cotizador sin sesión; la firma es el candado). Primero mira que solo cambie el bloque nuevo:

```bash
ssh -t leo@git.helgen.online '
  CONF=$(readlink -f $(grep -l "server_name drogheda.helgen.online" /etc/nginx/sites-enabled/* | head -1)) &&
  sudo diff -u "$CONF" /srv/projects/drogheda/hbox-docs/backend/nginx/drogheda.helgen.online.conf'
# Debe salir SOLO: la zona hbox_cotizador y el bloque «location ^~ /api/integracion/». Si sale algo más, el servidor tiene un
# cambio a mano: no apliques y avísame.
ssh -t leo@git.helgen.online 'sudo bash /srv/projects/drogheda/hbox-docs/backend/nginx/cambiar-entrada.sh aplicar'
# respalda, nginx -t, recarga, corre las pruebas (3 nuevas del cotizador) y regresa solo si una falla
```

**Secreto compartido** (el mismo valor va en CAPRI en el paso B). No lo pegues en chats ni en el repo.

```bash
openssl rand -hex 32                     # cópialo
ssh -t leo@git.helgen.online 'sudo systemctl edit actas-hbox'
#   entre las líneas de comentario escribe:
#   [Service]
#   Environment=COTIZADOR_SECRETO=<el valor>
ssh -t leo@git.helgen.online 'sudo systemctl restart actas-hbox'
curl -s https://drogheda.helgen.online/api/integracion/inventario/items; echo
#   → debe decir "Firma inválida o vencida"   ← bien: llega al backend (antes decía "sesion":false)
```

## B. CAPRI

```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
git fetch entregas/incremento-5/capri-incremento-5-fd5c6d5.bundle incremento-5:incremento-5
git checkout incremento-5
bash tests/todas.sh                      # todo en verde
git push github incremento-5             # para el PR de Efrain (texto en PR-incremento-5.md)
npx clasp push --force
```

En el **editor de Apps Script como facilities@** (Chrome "Leopoldos MacBook Pro 2"):

1. Ejecutar **`prepararCapri`**: crea la pestaña `Devoluciones` y las columnas nuevas. No pide permisos nuevos (si los pide,
   Permitir).
2. ⚙ Configuración del proyecto → **Propiedades de la secuencia de comandos** → agregar:
   - `PORTAL_URL` = `https://drogheda.helgen.online`
   - `PORTAL_SECRETO` = el valor del paso A
   - `PORTAL_PROYECTOS` = `{"PRY-2026-0002":"drogheda"}`
3. Ejecutar **`probarCentroMando`**. El registro debe decir `Ítems: N en la lista`, `Recepciones (últimas 24 h): <número>` y
   `Aviso de prueba …: aceptado`. Si dice "Firma inválida": el secreto no es igual en los dos lados.
4. Implementar → **Administrar implementaciones** → lápiz de la implementación `AKfycbwBjF7…` → Versión: **Nueva versión** →
   descripción "CAPRI incremento 5" → Implementar. (Tiene que ser facilities@: la API corre como quien la publica.)

Interfaz (la cuenta de Cloudflare de Helgen, no la personal):

```bash
CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy
```

## C. Comprobar (≈ 10 min)

- CAPRI (recarga con Cmd+Shift+R): una orden nueva muestra **Forma de pago** (6 opciones); existe **Proveedores**; registrar un
  pago por transferencia a un proveedor sin carátula → lo rechaza con el mensaje de documentos.
- Primera orden real de DROGHEDA: autorizar → en camino → en el sitio **Recibir** con foto → en ≤ 15 min la requisición se cierra
  en CAPRI, la foto queda en Drive (`Compras/2026/…/Recepciones/`) y en el sitio se sigue viendo la miniatura.

## Si algo sale mal

- **CAPRI:** Administrar implementaciones → lápiz → Versión **13** → Implementar; interfaz:
  `CLOUDFLARE_ACCOUNT_ID=… npx --yes wrangler@4 rollback` (elige la versión `5f66244c`). Las columnas y la pestaña nuevas se
  quedan; la versión 13 no las lee.
- **Centro de mando:** `git revert` de los 11 commits, `./scripts/deploy.sh` y `sudo systemctl restart actas-hbox`; nginx:
  `sudo bash …/cambiar-entrada.sh deshacer`. Las fotos ya tomadas se quedan en `adjuntos/compras/` (no las borres a mano: si
  CAPRI no las ha bajado son la única copia).
- **Apagar solo el enlace** (todo lo demás sigue): borrar `PORTAL_SECRETO` en CAPRI.
