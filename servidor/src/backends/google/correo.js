// Gmail API (users.messages.send) como la cuenta del servicio (facilities@helgen.tech): mismo remitente que MailApp hoy.
// Arma el MIME a mano: multipart/alternative (texto + HTML), adjuntos opcionales, encabezados en UTF-8 (RFC 2047).
'use strict';
const crypto = require('crypto');

const limpio = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const palabra = s => (/^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=');
const b64 = buf => buf.toString('base64').replace(/.{76}/g, '$&\r\n');

/** Mensaje RFC 5322 listo para codificar en base64url. m = {para, asunto, texto, html, nombre, responderA, cc, cco, adjuntos}. */
function armarMime(m, remitente) {
  const id = crypto.randomBytes(12).toString('hex');
  const encabezados = [
    'From: ' + (m.nombre ? palabra(limpio(m.nombre)) + ' <' + remitente + '>' : remitente),
    'To: ' + limpio(m.para),
  ];
  if (m.cc) encabezados.push('Cc: ' + limpio(m.cc));
  if (m.cco) encabezados.push('Bcc: ' + limpio(m.cco));
  if (m.responderA) encabezados.push('Reply-To: ' + limpio(m.responderA));
  encabezados.push('Subject: ' + palabra(limpio(m.asunto)), 'MIME-Version: 1.0', 'Date: ' + new Date().toUTCString());
  const parteTexto = t => 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(Buffer.from(t || '', 'utf8'));
  const parteHtml = h => 'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(Buffer.from(h, 'utf8'));
  let cuerpo;
  const alt = 'alt-' + id;
  const alternativa = m.html
    ? 'Content-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n--' + alt + '\r\n' + parteTexto(m.texto) + '\r\n--' + alt + '\r\n' + parteHtml(m.html) + '\r\n--' + alt + '--'
    : parteTexto(m.texto);
  if (m.adjuntos && m.adjuntos.length) {
    const mix = 'mix-' + id;
    cuerpo = 'Content-Type: multipart/mixed; boundary="' + mix + '"\r\n\r\n--' + mix + '\r\n' + alternativa;
    m.adjuntos.forEach(a => {
      cuerpo += '\r\n--' + mix + '\r\nContent-Type: ' + limpio(a.tipo || 'application/octet-stream') + '; name="' + palabra(limpio(a.nombre)) +
        '"\r\nContent-Disposition: attachment; filename="' + palabra(limpio(a.nombre)) + '"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64(Buffer.from(a.datos));
    });
    cuerpo += '\r\n--' + mix + '--';
  } else {
    cuerpo = alternativa;
  }
  return encabezados.join('\r\n') + '\r\n' + cuerpo + '\r\n';
}

function crearCorreoGoogle(api, remitente) {
  return async function enviarCorreo(m) {
    const raw = Buffer.from(armarMime(m, remitente), 'utf8').toString('base64url');
    await api.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return true;
  };
}

module.exports = { crearCorreoGoogle, armarMime };
