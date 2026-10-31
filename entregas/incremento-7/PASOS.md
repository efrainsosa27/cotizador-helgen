# CAPRI — pasos en orden, de donde estamos a terminado

Estado al 29/10/2026 21:00: el servidor `capri.helgen.online` corre en **solo lectura** con los datos reales (pasos A–D
hechos: imagen, certificado, Google, tokens, propiedades). En Apps Script el equipo sigue con el **incremento 4 (@13)**.
Nada de los incrementos 5, 6 y 7 está publicado.

Cada paso dice dónde se corre: **[Mac]** · **[Servidor]** (`ssh leo@git.helgen.online`) · **[Navegador]**.
No te saltes el orden: cada parte desbloquea la siguiente.

---

## PARTE 1 — Subir el código a git (≈5 min) [Mac] [Navegador]

Sin esto, el servidor no puede actualizarse solo más adelante.

```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
git checkout main
git fetch entregas/incremento-7/capri-incrementos-5-6-7-servidor.bundle \
  incremento-7:incremento-7 servidor-etapa-1:servidor-etapa-1 --force
git log --oneline -1 servidor-etapa-1      # debe decir 40af4c5
git push github incremento-5 incremento-6 incremento-7 servidor-etapa-1
```

[Navegador] <https://git.helgen.online/leo/cotizador-helgen/settings> → Configuración del espejo → **Sincronizar ahora**.

```bash
git ls-remote origin servidor-etapa-1      # debe decir 40af4c5
```

---

## PARTE 2 — Poner el servidor al día (≈5 min) [Servidor]

Trae el arreglo de la tabla de escritura (40af4c5). Construye, corre las pruebas dentro de la imagen, cambia y, si no
queda sana, regresa sola. Sigue en solo lectura: no escribe nada.

```bash
cd /srv/projects/capri/app
servidor/despliegue/actualizar.sh servidor-etapa-1
servidor/despliegue/actualizar.sh --estado          # capri:40af4c5 corriendo
cd servidor && sudo docker compose exec capri node herramientas/admin.js salud | tail -40
```

Verificar: `✔ sano`, `"soloLectura": true`, 3 trabajadores `"listo": true`, los 5 libros con su `locale`
(si alguno NO dice `es_MX`, avísame antes de seguir) y `"zona": "America/Mexico_City"`.

---

## PARTE 3 — Publicar los incrementos 5, 6 y 7 en Apps Script (≈1 h)

Esto es lo que usa el equipo. También instala la costura `API_MUDADA` que necesita el cambio al servidor.

### 3.1 Respaldos [Navegador]
En Drive, Archivo → Hacer una copia de: **Base de datos**, libro de **Compras**, libro de **Cobranza**.
Nómbralas "… — respaldo antes de inc 7".

### 3.2 Centro de mando (drogheda.helgen.online) [Mac] [Servidor]
Va **antes** que CAPRI. Texto completo: `entregas/incremento-5/PUBLICAR-incremento-5.md`, parte A.

```bash
cd ~/Documents/Claude/Projects/Drogheda/hbox-docs
git am ~/Documents/Claude/Projects/cotizador-helgen/entregas/incremento-5/centro-de-mando/*.patch
bash backend/tests-1029.sh .                        # 238 bien
bash backend/tests-1028.sh .                        # 61 bien
git push && ./scripts/deploy.sh
```
Respaldo de la base y reinicio, nginx (`cambiar-entrada.sh aplicar`) y el secreto compartido
(`openssl rand -hex 32`): los comandos exactos están en ese archivo, parte A.

### 3.3 CAPRI: subir el código [Mac]
```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
git checkout incremento-7
bash tests/todas.sh                                 # 45 ✔, nada en ✘
npx clasp push --force
```

### 3.4 Apps Script, **como facilities@** [Navegador]
<https://script.google.com/home/projects/1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS/edit>
(recarga el editor después del push)

1. Ejecutar **`prepararCapri`**. Crea el área **NÓMINA** (carpeta "CAPRI — Nómina" y libro "CAPRI — Nómina y horas" en
   el Drive de facilities@, restringidos) y las pestañas nuevas. Si pide permisos, Permitir. El registro sin errores.
2. Propiedades: `PORTAL_URL`, `PORTAL_SECRETO` (el del paso 3.2) y `PORTAL_PROYECTOS` = `{"PRY-2026-0002":"drogheda"}`.
   Luego ejecutar **`probarCentroMando`**: debe decir "aceptado".
3. **NO** agregues `NOMINA_EN_MARGEN` ni `API_MUDADA`.
4. Implementar → Administrar implementaciones → lápiz de `AKfycbwBjF7…` → Versión: **Nueva versión** →
   "CAPRI incrementos 5–7" → Implementar.

### 3.5 Interfaz, el mismo día [Mac]
```bash
CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy
```

### 3.6 Permisos [Navegador]
CAPRI → Administración → Permisos: rol **Aprobaciones** (aprueba gastos), rol **Nómina** (lleva la nómina; compártele
solo a esa persona la carpeta "CAPRI — Nómina"), y en Horas → «Líderes de proyecto» un **líder** por proyecto activo.

### 3.7 Revisar (≈10 min) [Navegador]
Cmd+Shift+R (la primera carga tarda más: el caché es nuevo). Pestañas **Gastos** y **Horas** para todos;
**Facturas de clientes** y el margen nuevo para cobranza; **Reportes** abre. Un gasto de prueba con foto llega a
Pendientes de Aprobaciones y queda en Drive en `Compras/2026/<proyecto>/Gastos/`.

**Si algo sale mal:** Administrar implementaciones → versión anterior → Implementar, y
`CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 rollback`.

---

## PARTE 4 — Corrida de sombra (≈20 min) [Navegador] [Servidor]

Solo después de la parte 3: Apps Script y el servidor tienen que correr el mismo `Code.js`. No escribe nada.

[Navegador] En la pestaña de CAPRI, consola (⌥⌘J): `copy(localStorage.getItem('cotizadorHelgenSesion'))`

```bash
cd /srv/projects/capri/app/servidor
read -rs -p 'ID token: ' CAPRI_TOKEN && export CAPRI_TOKEN && echo
sudo --preserve-env=CAPRI_TOKEN docker compose exec -e CAPRI_TOKEN capri node herramientas/sombra.js \
  --apps https://script.google.com/macros/s/AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2/exec \
  --servidor http://127.0.0.1:8090/api --reintentar --salida "/var/lib/capri/sombra-$(date +%F).json"
unset CAPRI_TOKEN
```

Verificar: "N de N iguales". **Mándame la salida**: cada "DISTINTO" se explica o se corrige antes de seguir.

---

## PARTE 5 — Otro día

1. Repetir la parte 4 (criterio: dos corridas limpias en días distintos).
2. E3 otra vez (tabla de escritura), con los casos que faltan por medir: am/pm junto a una fecha y "15%" en una celda
   de fecha. Te paso los comandos ese día.
3. **E4, ensayo con escritura** en los archivos PRUEBAS: es la primera vez que el servidor genera **PDF con Chromium**
   (en solo lectura nunca lo hace). Comparamos 5–10 PDF reales lado a lado.

---

## PARTE 6 — La noche del cambio (≈30 min, nadie guardando)

Solo con las partes 4 y 5 limpias. Resumen: `API_MUDADA` en Apps Script → propiedades frescas al servidor →
`soloLectura: false` → `API_URL` de la interfaz al servidor → revisar. Comandos exactos:
`entregas/incremento-7/servidor/servidor-comandos.md`, sección **F** (y la **G** para regresar).
