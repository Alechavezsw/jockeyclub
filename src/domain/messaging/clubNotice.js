/** Mail real: se saltean alias de prueba y el dominio que rebota. */
export function deliverableEmail(value) {
  const email = String(value || '').trim();
  if (!email.includes('@')) return '';
  const lower = email.toLowerCase();
  if (lower.includes('@lila-jockey')) return '';
  if (lower.endsWith('@jockeyclubsj.com')) return '';
  return lower;
}

export function mailAudienceCount(members = []) {
  let withMail = 0;
  let withoutMail = 0;
  for (const member of members) {
    if (String(member?.status || '').toLowerCase() === 'inactive') continue;
    if (deliverableEmail(member?.email)) withMail += 1;
    else withoutMail += 1;
  }
  return { withMail, withoutMail };
}

function looksLikeJson(value) {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('```');
}

function unescapeJsonString(value) {
  return String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .trim();
}

function jsonField(text, key) {
  const open = text.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!open) return '';
  let i = open.index + open[0].length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return unescapeJsonString(out);
}

function salvageJsonDraft(text) {
  const subject = jsonField(text, 'subject') || jsonField(text, 'verdict');
  const body = jsonField(text, 'body') || jsonField(text, 'text');
  if (!subject && !body) return null;
  return { subject, body };
}

export function parseComposeDraft(raw, depth = 0) {
  if (!raw || depth > 4) return { subject: '', body: '' };

  if (typeof raw === 'object') {
    const subject = String(raw.subject || raw.verdict || '').trim();
    const body = String(raw.body || '').trim();
    if (subject && body && !looksLikeJson(body)) return { subject, body };

    const nested = String(raw.text || raw.body || '').trim();
    if (nested && looksLikeJson(nested)) {
      return parseComposeDraft(nested, depth + 1);
    }
    if (subject && nested && nested !== subject && !looksLikeJson(nested)) {
      return { subject, body: nested };
    }
    return { subject, body };
  }

  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parseComposeDraft(parsed, depth + 1);
  } catch {
    if (looksLikeJson(text)) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (end > start) {
        try {
          return parseComposeDraft(JSON.parse(text.slice(start, end + 1)), depth + 1);
        } catch {
          /* JSON incompleto */
        }
      }
      return salvageJsonDraft(text) || { subject: '', body: '' };
    }
    const lines = text.split('\n');
    const first = (lines[0] || '').replace(/^asunto:\s*/i, '').trim();
    const rest = lines.slice(1).join('\n').trim();
    return { subject: first.slice(0, 140), body: rest || text };
  }
  return { subject: '', body: '' };
}

export function noticeConfirmLine({
  audience,
  sendDm,
  sendMail,
  mailCount = 0,
  memberName = '',
} = {}) {
  const channels = [];
  if (audience === 'one') {
    const who = memberName || 'el socio';
    if (sendDm) channels.push('un mensaje interno');
    if (sendMail) channels.push('un mail');
    if (!channels.length) return `Elegí si va por mensaje interno, por mail, o por los dos. Destino: ${who}.`;
    return `Se envía ${channels.join(' y ')} a ${who}.`;
  }
  if (sendDm) channels.push('un mensaje interno a todos los socios');
  if (sendMail) {
    channels.push(mailCount > 0
      ? `mail a ${mailCount} direcciones`
      : 'mail a quienes tienen correo');
  }
  if (!channels.length) return 'Elegí si va por mensaje interno, por mail, o por los dos.';
  return `Se envía ${channels.join(' y ')}.`;
}

export function newCampaignId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `camp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
