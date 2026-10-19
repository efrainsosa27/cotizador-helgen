# Guía: poner en marcha el Cotizador Helgen con Claude Code

Tiempo estimado: 45–60 min la primera vez.

## Cómo funciona (en una línea)
Formulario web → Apps Script asigna folio `HLG-2026-0001` → recalcula subtotal/IVA/total → genera PDF → lo guarda en Drive → registra la fila en una hoja de Google.

```
[Navegador del equipo] ──► [Apps Script: Code.gs] ──► Google Sheets (registro, catálogo, config)
                                     └──────────────► Google Drive /Cotizaciones Helgen (PDF)/2026/
```

---

## Paso 1 · Instalar herramientas (una sola vez, en tu Mac)

Abre **Terminal** y ejecuta:

```bash
# Node.js (si no lo tienes): descárgalo de https://nodejs.org (versión LTS)
node -v

# Claude Code
npm install -g @anthropic-ai/claude-code

# clasp: la herramienta oficial de Google para subir código a Apps Script
npm install -g @google/clasp
```

Activa la API de Apps Script en tu cuenta: entra a https://script.google.com/home/usersettings y enciende **"Google Apps Script API"**.

## Paso 2 · Crear la carpeta del proyecto

1. Descarga los archivos de esta carpeta (`Code.gs`, `Index.html`, `appsscript.json`, `CLAUDE.md`) a una carpeta, por ejemplo `~/Helgen/cotizador-helgen`.
2. En Terminal:

```bash
cd ~/Helgen/cotizador-helgen
clasp login            # se abre el navegador: entra con tu cuenta @helgen.tech
clasp create --type standalone --title "Cotizador Helgen"
```

> `clasp create` puede sobrescribir `appsscript.json`. Si pasa, vuelve a copiar el que te di.

## Paso 3 · Abrir Claude Code y subir el código

```bash
claude
```

Claude Code lee `CLAUDE.md` automáticamente, así ya entiende el proyecto. Escríbele:

> Sube el proyecto con clasp push y ábreme el editor.

## Paso 4 · Instalación inicial (en el editor de Apps Script)

1. En el editor, elige la función **`setup`** y pulsa **Ejecutar**.
2. Acepta los permisos (Drive y Sheets).
3. En **Registro de ejecución** verás dos links: la **hoja de base de datos** y la **carpeta de PDF**.

## Paso 5 · Configurar tus datos

Abre la hoja de base de datos:

- **Config** → llena nombre, RFC, dirección, teléfono, correo, prefijo del folio y términos.
- **Logo** → sube tu logo (PNG con fondo transparente, ~600 px de ancho) a Drive. Copia su ID (la parte larga del link entre `/d/` y `/view`) y pégalo en `LOGO_FILE_ID`.
- **Catalogo** → captura tus productos/servicios frecuentes con su precio. Aparecerán como autocompletado.

## Paso 6 · Publicar para el equipo

Pídele a Claude Code:

> Publica la app web con clasp deploy y dame la URL.

O manualmente en el editor: **Implementar → Nueva implementación → App web**
- Ejecutar como: **Yo** (así todos los PDF quedan en una sola carpeta)
- Quién tiene acceso: **Cualquier usuario de helgen.tech**

Comparte la URL con el equipo y agrégala a favoritos.

## Paso 7 · Prueba de aceptación

- [ ] Crear una cotización de prueba → aparece el folio `HLG-2026-0001`.
- [ ] El PDF se abre, muestra el logo y los totales coinciden con la calculadora.
- [ ] Aparece la fila en la hoja **Cotizaciones** y el PDF en Drive/2026.
- [ ] Dos personas guardan casi al mismo tiempo → folios distintos.
- [ ] Borrar la fila de prueba (el contador NO retrocede; es intencional para no repetir folios).
- [ ] Doble clic rápido en "Guardar" → se crea un solo folio y un solo PDF.

> Protección de folios: el folio sale del mayor entre el contador (`CONSECUTIVO_AAAA`) y el último folio en la hoja **Cotizaciones**, dentro de un candado (`LockService`). Aunque alguien borre el contador, no se repite.

---

## Cómo pedirle cambios a Claude Code (ejemplos de prompts)

Usa frases concretas; Claude Code edita, prueba y sube por ti.

| Quiero… | Prompt |
|---|---|
| Ajustar el diseño al PDF de referencia | "Adjunto `referencia.pdf`. Ajusta `construirHtmlPdf` para que se parezca: mismo orden de secciones y tipografía. Genera un PDF de prueba local con Playwright antes de subir." |
| Descuento por renglón | "Agrega una columna de descuento % por concepto, en el formulario y en el PDF. El cálculo debe hacerse en el servidor." |
| Enviar por correo | "Agrega un botón 'Enviar al cliente' que mande el PDF por Gmail al correo del cliente con copia a mí." |
| Duplicar una cotización | "En el historial agrega un botón 'Duplicar' que cargue los datos en el formulario con un folio nuevo." |
| Estatus | "Agrega una columna Estatus (Enviada, Aceptada, Rechazada) editable desde el historial." |
| Corregir un error | "Al guardar sale este error: [pega el mensaje]. Revisa `clasp logs` y corrígelo." |

**Flujo de cada cambio:** pides → Claude Code edita → prueba local → `clasp push` → `clasp deploy --deploymentId <ID>` (misma URL para el equipo).

**Recomendación:** inicializa git en la carpeta (`git init`, o pídeselo a Claude Code) para poder deshacer cualquier cambio.

---

## Por qué esta arquitectura

| Criterio | Resultado |
|---|---|
| Costo | $0 — usa Google Workspace que ya pagan |
| Servidores | Ninguno que mantener |
| Acceso | Solo cuentas @helgen.tech |
| Respaldo | Drive + historial de versiones de Sheets |
| Folios | Consecutivos y sin duplicados aunque varios usuarios guarden a la vez |
| Límite | ~cientos de cotizaciones/día sin problema. Si algún día necesitan CRM, facturación o app móvil, se migra a Next.js + base de datos y se importa el historial desde la hoja. |
