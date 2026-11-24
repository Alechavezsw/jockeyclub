import { isOperationalMember } from '../members/operationalVisibility';

const CLUB_MAIL_ADDRESS = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Mail real: se saltean alias de prueba, el dominio que rebota y las direcciones rotas. */
export function deliverableEmail(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower || lower.includes(' ') || lower.split('@').length !== 2) return '';
  if (lower.includes('@lila-jockey')) return '';
  if (lower.endsWith('@jockeyclubsj.com')) return '';
  if (!CLUB_MAIL_ADDRESS.test(lower)) return '';
  return lower;
}

export function mailAudienceCount(members = [], today = new Date()) {
  const seen = new Set();
  let withMail = 0;
  let withoutMail = 0;
  for (const member of members) {
    if (!isOperationalMember(member, today)) continue;
    const email = deliverableEmail(member?.email);
    if (!email) {
      withoutMail += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    withMail += 1;
  }
  return { withMail, withoutMail };
}

/** El reintento informa los ya enviados de toda la campaña, no un delta. */
export function accumulateClubMailProgress(total, page) {
  return {
    sent: (Number(total?.sent) || 0) + (Number(page?.sent) || 0),
    failed: (Number(total?.failed) || 0) + (Number(page?.failed) || 0),
    skipped: Number(page?.skipped) || 0,
    more: Boolean(page?.more),
    campaignId: page?.campaignId || total?.campaignId || '',
  };
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

export function groupMailCampaigns(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.campaignId || row.campaign_id || '');
    if (!id) continue;
    let camp = byId.get(id);
    if (!camp) {
      camp = {
        id,
        subject: String(row.subject || '').trim() || 'Sin asunto',
        createdAt: row.createdAt || row.created_at || '',
        sent: 0,
        failed: 0,
        rows: [],
      };
      byId.set(id, camp);
    }
    camp.rows.push(row);
    if (row.sent || row.resendId || row.resend_id) camp.sent += 1;
    else camp.failed += 1;
    const when = row.createdAt || row.created_at || '';
    if (String(when) > String(camp.createdAt)) camp.createdAt = when;
  }
  return [...byId.values()].toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function newCampaignId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `camp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
