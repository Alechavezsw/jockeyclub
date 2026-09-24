const CLUB = 'Jockey Club San Juan';
const SEDE = 'Sede Rivadavia · República del Líbano 1799 Oeste';

export function escapeInviteHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function accessInviteSubject() {
  return `Tu acceso al portal · ${CLUB}`;
}

export function accessInviteText({
  name = '',
  username = '',
  loginEmail = '',
  password = '',
  portalUrl = '',
} = {}) {
  const greeting = name ? `Hola ${name}` : 'Hola';
  const sameLogin = !username || username.toLowerCase() === String(loginEmail || '').toLowerCase();
  return [
    `${greeting}, te saludamos de ${CLUB}.`,
    '',
    'Ya tenés acceso al portal de socios.',
    portalUrl,
    '',
    ...(sameLogin ? [] : [`Usuario: ${username}`]),
    `Email de ingreso: ${loginEmail}`,
    `Contraseña: ${password}`,
    '',
    'Ingresá con esos datos y cambiá la contraseña cuando puedas.',
    '',
    `${CLUB} · ${SEDE}`,
  ].join('\n');
}

/** Plantilla HTML institucional para Resend. */
export function accessInviteHtml({
  name = '',
  username = '',
  loginEmail = '',
  password = '',
  portalUrl = '',
  logoUrl = '',
} = {}) {
  const who = escapeInviteHtml(name || 'socio');
  const user = escapeInviteHtml(username);
  const mail = escapeInviteHtml(loginEmail);
  const pass = escapeInviteHtml(password);
  const href = escapeInviteHtml(portalUrl);
  const logo = /^https:\/\//i.test(String(logoUrl || ''))
    ? `<img src="${escapeInviteHtml(logoUrl)}" width="72" height="72" alt="${CLUB}" style="display:block;margin:0 auto 12px;border:0;" />`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${accessInviteSubject()}</title>
</head>
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
          <tr>
            <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
              ${logo}
              <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">${SEDE}</p>
              <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;color:#fffdf8;">${CLUB}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0 0 12px;font-size:18px;">Hola ${who},</p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">
                Secretaría ya dejó listo tu usuario del portal. Guardá estos datos:
                el ingreso es personal y la contraseña se puede cambiar apenas entres.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4;border:1px solid #e2d3b4;margin:0 0 20px;">
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1612;">
                    ${user && user.toLowerCase() !== mail.toLowerCase() ? `<p style="margin:0 0 8px;"><strong style="color:#096755;">Usuario</strong><br />${user}</p>` : ''}
                    <p style="margin:0 0 8px;"><strong style="color:#096755;">Email de ingreso</strong><br />${mail}</p>
                    <p style="margin:0;"><strong style="color:#096755;">Contraseña</strong><br />${pass}</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                <tr>
                  <td style="background:#ca390c;border-radius:999px;">
                    <a href="${href}" style="display:inline-block;padding:12px 22px;color:#fffdf8;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:0.04em;">
                      Entrar al portal
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#6a6156;">
                Si el botón no abre, copiá esta dirección:<br />
                <a href="${href}" style="color:#096755;">${href}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;">
              ${CLUB} · San Juan, Argentina
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildAccessInviteEmail(input = {}) {
  return {
    subject: accessInviteSubject(),
    text: accessInviteText(input),
    html: accessInviteHtml(input),
  };
}

export function joinWelcomeSubject() {
  return `Recibimos tu solicitud · ${CLUB}`;
}

export function joinWelcomeText({ name = '' } = {}) {
  const greeting = name ? `Hola ${name}` : 'Hola';
  return [
    `${greeting}, te saludamos de ${CLUB}.`,
    '',
    'Recibimos tu solicitud para asociarte.',
    'Secretaría la revisa y te contacta. Esto todavía no es el alta.',
    '',
    'Cuando te den de alta te llega otro mail, ese sí con usuario y contraseña del portal.',
    '',
    `${CLUB} · ${SEDE}`,
  ].join('\n');
}

export function joinWelcomeHtml({ name = '', logoUrl = '' } = {}) {
  const who = escapeInviteHtml(name || 'socio');
  const logo = /^https:\/\//i.test(String(logoUrl || ''))
    ? `<img src="${escapeInviteHtml(logoUrl)}" width="72" height="72" alt="${CLUB}" style="display:block;margin:0 auto 12px;border:0;" />`
    : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${joinWelcomeSubject()}</title>
</head>
<body style="margin:0;padding:0;background:#efe6d4;font-family:Georgia,'Times New Roman',serif;color:#1a1612;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe6d4;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fffdf8;border:1px solid #d8c7a4;">
          <tr>
            <td style="background:#096755;padding:28px 28px 22px;text-align:center;color:#fffdf8;">
              ${logo}
              <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#d7c48a;">${SEDE}</p>
              <h1 style="margin:10px 0 0;font-size:26px;font-weight:normal;color:#fffdf8;">${CLUB}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0 0 12px;font-size:18px;">Hola ${who},</p>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#3f3830;">
                Recibimos tu solicitud para asociarte al club. Secretaría la revisa
                y te contacta. Este mail es solo la bienvenida: todavía no es el alta.
              </p>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3f3830;">
                Cuando te den de alta te llega otro correo, ese sí con usuario y contraseña
                para entrar al portal.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid #eadcc0;font-size:12px;color:#6a6156;">
              ${CLUB} · San Juan, Argentina
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildJoinWelcomeEmail(input = {}) {
  return {
    subject: joinWelcomeSubject(),
    text: joinWelcomeText(input),
    html: joinWelcomeHtml(input),
  };
}
