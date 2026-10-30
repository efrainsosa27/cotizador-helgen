#!/usr/bin/env bash
# nginx + HTTPS de capri.helgen.online (etapa 1). Se corre EN EL SERVIDOR con sudo, desde el repositorio:
#   sudo bash servidor/despliegue/nginx-capri.sh certificado   # 1. solo el puerto 80 + certificado con certbot (una vez)
#   sudo bash servidor/despliegue/nginx-capri.sh aplicar       # 2. el sitio completo (443 → 127.0.0.1:8090); si una prueba
#                                                              #    falla, regresa solo a lo anterior
#   sudo bash servidor/despliegue/nginx-capri.sh probar        #    solo las pruebas, sin cambiar nada
#   sudo bash servidor/despliegue/nginx-capri.sh deshacer      #    quita el sitio de capri (el certificado se queda)
#
# Solo escribe en: /etc/nginx/sites-available/capri.helgen.online.conf, su enlace en sites-enabled/,
# /etc/nginx/respaldos-capri/ y /var/www/letsencrypt/. Nunca toca drogheda.helgen.online: antes y después compara la
# huella de nginx.conf y de los demás sitios habilitados; si alguna cambió, avisa y regresa.
# Certificado: certbot certonly --webroot (certbot no edita el archivo de nginx); la renovación automática es la misma
# que ya renueva drogheda (certbot.timer) y recarga nginx con el --deploy-hook que queda guardado.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
FUENTE="$AQUI/nginx-capri.helgen.online.conf"
HOST=capri.helgen.online
DISP=/etc/nginx/sites-available/capri.helgen.online.conf
HAB=/etc/nginx/sites-enabled/capri.helgen.online.conf
RESP_DIR=/etc/nginx/respaldos-capri
RETO=/var/www/letsencrypt
CERT=/etc/letsencrypt/live/$HOST/fullchain.pem
[ "$(id -u)" = 0 ] || { echo "Córrelo con sudo."; exit 1; }
[ -f "$FUENTE" ] || { echo "No encuentro $FUENTE."; exit 1; }

ok=0; mal=0
prueba() {  # nombre, esperado (subcadena), comando
  local r; r="$(eval "$3" 2>&1)"
  if [[ "$r" == *"$2"* ]]; then ok=$((ok+1)); echo "  ✓ $1"; else mal=$((mal+1)); echo "  ✕ $1 — esperaba «$2», obtuve: ${r:0:160}"; fi
}
C="curl -s --max-time 15 --resolve $HOST:443:127.0.0.1 --resolve $HOST:80:127.0.0.1"
ORIGEN='Origin: https://cotizador-helgen.cotizador-helgen.workers.dev'

# Huella de todo lo de nginx que NO es de capri (nginx.conf, conf.d y los demás sitios habilitados, por su destino real)
huella_otros() {
  { sha256sum /etc/nginx/nginx.conf
    find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 \( -type f -o -type l \) ! -name 'capri.helgen.online.conf' 2>/dev/null \
      | sort | while read -r f; do sha256sum "$(readlink -f "$f")"; done; } | sha256sum | cut -c1-16
}
HUELLA0="$(huella_otros)"
revisar_otros() {
  local h; h="$(huella_otros)"
  if [ "$h" != "$HUELLA0" ]; then echo "  ✕ cambió la configuración de otro sitio o de nginx.conf (esto no debía pasar)"; return 1; fi
  echo "  ✓ los demás sitios (drogheda) siguen idénticos ($h)"
}
otro_dueno() {  # ¿otro archivo ya atiende capri.helgen.online?
  grep -l "server_name[^;]*\b$HOST\b" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null | while read -r f; do
    [ "$(readlink -f "$f")" = "$DISP" ] || echo "$f"; done
}
respaldar() {
  mkdir -p "$RESP_DIR"
  RESP=""
  if [ -f "$DISP" ]; then RESP="$RESP_DIR/capri.helgen.online.conf.$1-$(date +%Y%m%d-%H%M%S)"; cp -p "$DISP" "$RESP"; echo "Respaldo: $RESP"; fi
}
regresar() {  # al respaldo (o sin sitio de capri si no había)
  if [ -n "${RESP:-}" ]; then cp -p "$RESP" "$DISP"; else rm -f "$HAB" "$DISP"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "Regresé a lo anterior." || echo "✕ nginx -t falla aun después de regresar: revisa 'nginx -t' YA."
}
recargar() {
  if ! nginx -t; then echo "nginx -t falló: regreso a lo anterior."; regresar; exit 1; fi
  systemctl reload nginx; sleep 1
}

probar() {
  echo "## nginx ($HOST)"
  local servicio=no
  curl -s --max-time 3 http://127.0.0.1:8090/salud | grep -q '"ok":true' && servicio=si
  prueba "http → https" "301 https://$HOST/api" "$C -o /dev/null -w '%{http_code} %{redirect_url}' http://$HOST/api"
  mkdir -p "$RETO/.well-known/acme-challenge"; echo "reto-capri" > "$RETO/.well-known/acme-challenge/prueba-capri"
  prueba "reto de certbot por http" "reto-capri" "$C http://$HOST/.well-known/acme-challenge/prueba-capri"
  rm -f "$RETO/.well-known/acme-challenge/prueba-capri"
  if [ -f "$CERT" ] && [ -L "$HAB" ] && grep -q 'listen 443' "$DISP"; then
    prueba "certificado de $HOST" "$HOST" "echo | openssl s_client -connect 127.0.0.1:443 -servername $HOST 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName"
    if [ "$servicio" = si ]; then
      prueba "/salud desde fuera = solo {ok}" '{"ok":true}' "$C https://$HOST/salud"
      prueba "API desde la interfaz (sin sesión → SESION)" '"codigo":"SESION"' "$C -H '$ORIGEN' -H 'Content-Type: text/plain;charset=utf-8' -d '{\"funcion\":\"bootstrap\",\"args\":[],\"token\":\"\"}' https://$HOST/api"
    else
      echo "  · el servicio capri no corre todavía (127.0.0.1:8090): se espera la respuesta de reinicio"
      prueba "API con el servicio apagado → REINICIO en JSON" '"codigo":"REINICIO"' "$C -H '$ORIGEN' -d '{}' https://$HOST/api"
    fi
    prueba "CORS solo para la interfaz de Cloudflare" "access-control-allow-origin: https://cotizador-helgen.cotizador-helgen.workers.dev" \
      "$C -D - -o /dev/null -H '$ORIGEN' -d '{}' https://$HOST/api | tr 'A-Z' 'a-z'"
    prueba "dominio propio → interfaz" "302 https://$HOST/home/" "$C -o /dev/null -w '%{http_code} %{redirect_url}' https://$HOST/"
    prueba "interfaz propia disponible" 'CAPRI' "$C https://$HOST/home/"
    prueba "CORS para el dominio propio" "access-control-allow-origin: https://$HOST" \
      "$C -D - -o /dev/null -H 'Origin: https://$HOST' -d '{}' https://$HOST/api | tr 'A-Z' 'a-z'"
    prueba "otro origen → 403 ORIGEN" '"codigo":"ORIGEN"' "$C -H 'Origin: https://malo.example' -d '{}' https://$HOST/api"
    prueba "/admin/correr no existe por nginx" "404" "$C -o /dev/null -w '%{http_code}' -d '{\"funcion\":\"cadaQuinceMinutos\"}' https://$HOST/admin/correr"
    prueba "más de 50 MB → JSON GRANDE (la interfaz lo puede leer)" '"codigo":"GRANDE"' \
      "head -c 52500000 /dev/zero | $C -H '$ORIGEN' --data-binary @- https://$HOST/api"
  fi
  revisar_otros || mal=$((mal+1))
}

case "${1:-}" in
  certificado)
    if [ -f "$CERT" ]; then echo "Ya existe el certificado de $HOST ($CERT): sigue con «aplicar»."; exit 0; fi
    [ -z "$(otro_dueno)" ] || { echo "Otro archivo ya atiende $HOST: $(otro_dueno). No cambio nada."; exit 1; }
    getent hosts "$HOST" >/dev/null || { echo "El DNS de $HOST no resuelve todavía. No cambio nada."; exit 1; }
    respaldar antes-certificado
    mkdir -p "$RETO/.well-known/acme-challenge"
    # Solo el bloque del puerto 80 (reto ACME + redirección): el de 443 no carga sin certificado
    sed -n '/^# ---- puerto 80/,/^# ---- fin del puerto 80/p' "$FUENTE" > "$DISP"
    grep -q 'acme-challenge' "$DISP" || { echo "No pude sacar el bloque del puerto 80 de $FUENTE."; regresar; exit 1; }
    ln -sf "$DISP" "$HAB"
    recargar
    ok=0; mal=0; probar
    [ "$mal" = 0 ] || { echo "El puerto 80 no quedó bien ($mal): regreso."; regresar; exit 1; }
    echo "== certbot (webroot $RETO)"
    # ${CERTBOT_CORREO} solo hace falta si certbot no tiene cuenta todavía (con drogheda ya la tiene)
    certbot certonly --webroot -w "$RETO" -d "$HOST" --non-interactive --keep-until-expiring \
      --deploy-hook 'systemctl reload nginx' ${CERTBOT_CORREO:+--agree-tos -m "$CERTBOT_CORREO"} \
      || { echo "certbot falló: el puerto 80 de capri se queda (sirve para reintentar). ¿Llega el puerto 80 desde Internet a esta máquina?"; exit 1; }
    [ -f "$CERT" ] || { echo "certbot terminó pero no veo $CERT."; exit 1; }
    echo "Certificado listo: $(openssl x509 -noout -enddate -in "$CERT"). Ahora: sudo bash $0 aplicar"
    ;;
  aplicar)
    [ -f "$CERT" ] || { echo "Falta el certificado ($CERT): corre primero «certificado»."; exit 1; }
    [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && [ -f /etc/letsencrypt/ssl-dhparams.pem ] \
      || { echo "Faltan /etc/letsencrypt/options-ssl-nginx.conf o ssl-dhparams.pem (los pone certbot --nginx; drogheda los usa)."; exit 1; }
    [ -z "$(otro_dueno)" ] || { echo "Otro archivo ya atiende $HOST: $(otro_dueno). No cambio nada."; exit 1; }
    respaldar antes-aplicar
    install -m 644 "$FUENTE" "$DISP"
    ln -sf "$DISP" "$HAB"
    recargar
    ok=0; mal=0; probar
    if [ "$mal" != 0 ]; then echo "Algo falló ($mal): regreso a lo anterior."; regresar; exit 1; fi
    echo; echo "Listo ($ok pruebas): https://$HOST/salud → {\"ok\":true}. Para quitarlo: sudo bash $0 deshacer"
    ;;
  probar)
    probar; echo "$ok bien · $mal mal"; [ "$mal" = 0 ]
    ;;
  deshacer)
    [ -e "$HAB" ] || [ -e "$DISP" ] || { echo "No hay sitio de capri instalado."; exit 0; }
    respaldar quitado
    rm -f "$HAB" "$DISP"
    nginx -t && systemctl reload nginx && echo "Sitio de capri quitado (respaldo: ${RESP:-ninguno}). El certificado se queda en /etc/letsencrypt."
    revisar_otros
    ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
