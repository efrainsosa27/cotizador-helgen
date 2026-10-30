# CAPRI — servidor de la etapa 1: Code.js sin cambios en Node, con Chromium para los PDF (docs/servidor-etapa-1.md §10).
# Contexto de construcción = la raíz del repositorio (Code.js y Logo.js viven ahí); lo que entra lo decide /.dockerignore.
#   docker compose build                          (desde servidor/; etapa "app", la que corre)
#   docker build -f servidor/Dockerfile --target pruebas -t capri-pruebas .   (las pruebas del servidor dentro de la imagen)
#
# Versiones fijas:
#   - Node: la misma con la que pasan las pruebas del servidor (22.23.4, LTS de mantenimiento hasta abril de 2027). Para
#     subir a 24: cambiar NODE_IMAGE, construir la etapa "pruebas" y correrla. Recomendado: después de la primera
#     construcción, fijar también el digest (docker image inspect node:22.23.4-bookworm-slim → RepoDigests) así:
#     node:22.23.4-bookworm-slim@sha256:…
#   - Chromium: Chrome for Testing "chrome-headless-shell" en la versión exacta que pide puppeteer-core (25.16.0 →
#     156.0.8078.47; pruebas/unidades.test.js revisa que coincidan). Solo existe para amd64; en arm64 se usa el chromium
#     de Debian (mismo motor, versión de Debian).
#   - Paquetes de Debian: los de bookworm del día de la construcción (la imagen base fija la distribución).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim

# ---------------------------------------------------------------- dependencias de Node y Chromium
FROM ${NODE_IMAGE} AS deps
WORKDIR /app/servidor
# unzip: @puppeteer/browsers baja Chromium en un ZIP y lo descomprime con el «unzip» del sistema (la imagen slim no lo
# trae y su dependencia opcional «yauzl» tampoco está: sin esto la construcción falla con "no zip archiver is available").
# Solo se usa en esta etapa; la imagen final no lo lleva (Utilities.unzip es JavaScript, con zlib).
# hadolint ignore=DL3008
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends unzip; \
    rm -rf /var/lib/apt/lists/*
COPY servidor/package.json servidor/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
ARG CHROME_VERSION=156.0.8078.47
# hadolint ignore=DL4006
RUN set -eu; \
    mkdir -p /opt/capri/chrome; \
    if [ "$(dpkg --print-architecture)" = amd64 ]; then \
      node node_modules/@puppeteer/browsers/lib/main-cli.js install "chrome-headless-shell@${CHROME_VERSION}" --path /tmp/navegadores >/dev/null; \
      bin="$(find /tmp/navegadores -type f -name chrome-headless-shell | head -n 1)"; \
      test -n "$bin"; \
      cp -a "$(dirname "$bin")/." /opt/capri/chrome/; \
      rm -rf /tmp/navegadores; \
    fi

# ---------------------------------------------------------------- la imagen que corre
FROM ${NODE_IMAGE} AS app
# Librerías de Chromium; fuentes (Liberation mide igual que Arial: el PDF de Google usa Arial, CLAUDE.md §6.3); tzdata
# (Code.js trabaja en America/Mexico_City)
# hadolint ignore=DL3008
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates tzdata fonts-liberation fonts-dejavu-core \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libdbus-1-3 libexpat1 libglib2.0-0 \
      libx11-6 libxcb1 libxext6 libfontconfig1; \
    if [ "$(dpkg --print-architecture)" != amd64 ]; then apt-get install -y --no-install-recommends chromium; fi; \
    rm -rf /var/lib/apt/lists/*
COPY --from=deps /opt/capri/chrome /opt/capri/chrome
# Chromium completo y con todas sus librerías: si falta una, la construcción falla aquí y no al primer PDF (el "if" mira lo
# que encuentra grep, no el código de salida de ldd)
# hadolint ignore=DL4006
RUN set -eu; \
    if [ ! -x /opt/capri/chrome/chrome-headless-shell ]; then ln -s /usr/bin/chromium /opt/capri/chrome/chrome-headless-shell; fi; \
    if ldd /opt/capri/chrome/chrome-headless-shell | grep 'not found'; then echo "Faltan librerías de Chromium" >&2; exit 1; fi; \
    /opt/capri/chrome/chrome-headless-shell --version

# Usuario sin privilegios con un UID fijo: es el dueño de /srv/capri/config y /srv/capri/datos en el servidor
ARG CAPRI_UID=10001
RUN groupadd --system --gid "${CAPRI_UID}" capri \
 && useradd --system --uid "${CAPRI_UID}" --gid capri --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin capri

ENV NODE_ENV=production \
    TZ=America/Mexico_City \
    CAPRI_CONFIG=/etc/capri/capri.json \
    HOME=/tmp
WORKDIR /app/servidor
COPY --from=deps /app/servidor/node_modules ./node_modules
COPY Code.js Logo.js /app/
COPY servidor/package.json servidor/package-lock.json servidor/config.ejemplo.json ./
COPY servidor/src ./src
COPY servidor/herramientas ./herramientas

USER ${CAPRI_UID}:${CAPRI_UID}
EXPOSE 8090
# Sano = /salud contesta y los 3 trabajadores ya cargaron Code.js (la precarga de los libros puede tardar unos segundos)
HEALTHCHECK --interval=30s --timeout=6s --start-period=90s --start-interval=3s --retries=3 \
  CMD ["node", "herramientas/admin.js", "salud", "--callado"]
STOPSIGNAL SIGTERM
CMD ["node", "--max-old-space-size=384", "src/index.js"]

# ---------------------------------------------------------------- pruebas (sin Google): actualizar.sh las corre antes de cambiar
FROM app AS pruebas
COPY tests/arnes.js /app/tests/arnes.js
COPY servidor/pruebas ./pruebas
CMD ["node", "pruebas/todas.js"]
