import * as M from '../mappers';
import { unwrap } from '../errors';
import { dedupeMessages, withoutDuesBroadcasts } from '../../domain/messaging/messages';
import { sb, audit } from './shared.js';

// ---- Messages / Claims / Surveys / News ----
export async function listMessages({ limit, memberNumber, forStaff } = {}) {
  const cap = Number(limit) > 0 ? Number(limit) : 120;
  const fail = 'No se pudieron cargar mensajes';
  const newest = (rows) => {
    const mapped = withoutDuesBroadcasts(
      (rows || []).map(M.messageFromRow)
        .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date))),
    );
    const { messages: unique, duplicateIds } = dedupeMessages(mapped);
    if (duplicateIds.length) {
      void Promise.allSettled(
        duplicateIds.slice(0, 40).map((id) => sb().from('messages').delete().eq('id', id)),
      );
    }
    return unique;
  };

  const key = String(memberNumber || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (key && !forStaff) {
    const [inbox, sent] = await Promise.all([
      unwrap(
        sb().from('messages').select('*')
          .in('recipient_key', [key, 'all'])
          .order('created_at', { ascending: false })
          .limit(cap),
        fail,
      ),
      unwrap(
        sb().from('messages').select('*')
          .eq('sender_key', key)
          .order('created_at', { ascending: false })
          .limit(cap),
        fail,
      ),
    ]);
    const map = new Map();
    for (const row of [...(inbox || []), ...(sent || [])]) map.set(row.id, row);
    return newest([...map.values()]);
  }

  if (forStaff) {
    // Inbox a Secretaría + lo que ops envió a socios (comprobantes, avisos) + circulares.
    // Sin opsSent, el poll de Mensajería borraba los MD salientes del estado.
    const [opsInbox, opsSent, circulars] = await Promise.all([
      unwrap(
        sb().from('messages').select('*')
          .eq('recipient_key', 'ops')
          .order('created_at', { ascending: false })
          .limit(cap),
        fail,
      ),
      unwrap(
        sb().from('messages').select('*')
          .eq('sender_key', 'ops')
          .order('created_at', { ascending: false })
          .limit(cap),
        fail,
      ),
      unwrap(
        sb().from('messages').select('*')
          .eq('recipient_key', 'all')
          .order('created_at', { ascending: false })
          .limit(40),
        fail,
      ),
    ]);
    const map = new Map();
    for (const row of [...(opsInbox || []), ...(opsSent || []), ...(circulars || [])]) {
      map.set(row.id, row);
    }
    return newest([...map.values()]);
  }

  const rows = await unwrap(
    sb().from('messages').select('*').order('created_at', { ascending: false }).limit(cap),
    fail,
  );
  return newest(rows);
}

export async function insertMessage(msg) {
  const saved = await unwrap(
    sb().from('messages').insert(M.messageToRow(msg)).select().single(),
    'No se pudo enviar mensaje'
  );
  return M.messageFromRow(saved);
}

export async function updateMessage(id, patch) {
  const row = {};
  if (patch.isRead != null) row.is_read = patch.isRead;
  if (patch.content != null) row.body = patch.content;
  if (patch.meta != null) {
    row.meta = patch.meta;
  } else if (patch.metaMerge != null && typeof patch.metaMerge === 'object') {
    const current = await unwrap(
      sb().from('messages').select('meta').eq('id', id).maybeSingle(),
      'No se pudo leer el mensaje'
    );
    row.meta = { ...(current?.meta && typeof current.meta === 'object' ? current.meta : {}), ...patch.metaMerge };
  }
  const saved = await unwrap(
    sb().from('messages').update(row).eq('id', id).select().single()
  );
  return M.messageFromRow(saved);
}

export async function listClaims({ limit, memberNumber } = {}) {
  let q = sb().from('claims').select('*').order('created_at', { ascending: false });
  if (memberNumber) q = q.eq('member_number', String(memberNumber));
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q, 'No se pudieron cargar reclamos');
  return (rows || []).map(M.claimFromRow);
}

export async function upsertClaim(claim, memberDbId = null) {
  const row = {
    member_id: memberDbId,
    member_number: claim.memberId || null,
    member_name: claim.memberName || null,
    category: claim.category || null,
    subject: claim.subject || claim.title || 'Reclamo',
    body: claim.description || claim.body || '',
    status: claim.status || 'open',
    priority: claim.priority || 'normal',
    resolution: claim.resolution || null,
    meta: claim.meta || {},
  };
  if (claim.id && String(claim.id).includes('-')) {
    const saved = await unwrap(
      sb().from('claims').update(row).eq('id', claim.id).select().single()
    );
    return M.claimFromRow(saved);
  }
  const saved = await unwrap(
    sb().from('claims').insert(row).select().single(),
    'No se pudo crear reclamo'
  );
  return M.claimFromRow(saved);
}

export async function listSurveys() {
  const rows = await unwrap(sb().from('surveys').select('*').order('created_at', { ascending: false }));
  return (rows || []).map(M.surveyFromRow);
}

function surveyToRow(survey) {
  const options = Array.isArray(survey.options)
    ? survey.options
    : Array.isArray(survey.questions)
      ? survey.questions
      : [];
  const question = survey.question || survey.title || 'Encuesta';
  const active = survey.active !== false;
  const status =
    survey.status ||
    (active ? 'open' : 'closed');
  return {
    title: question,
    description: survey.description || null,
    status,
    questions: options,
    meta: {
      question,
      category: survey.category || '',
      active,
      votedBy: Array.isArray(survey.votedBy) ? survey.votedBy : [],
      options,
    },
  };
}

export async function upsertSurvey(survey) {
  const row = surveyToRow(survey);
  if (survey.id && String(survey.id).includes('-')) {
    const saved = await unwrap(
      sb().from('surveys').update(row).eq('id', survey.id).select().single()
    );
    await audit('survey.upsert', 'survey', saved.id, { title: saved.title, status: saved.status });
    return M.surveyFromRow(saved);
  }
  const saved = await unwrap(sb().from('surveys').insert(row).select().single());
  await audit('survey.upsert', 'survey', saved.id, { title: saved.title, status: saved.status });
  return M.surveyFromRow(saved);
}

export async function deleteSurvey(surveyId) {
  if (!surveyId || !String(surveyId).includes('-')) return;
  await unwrap(sb().from('surveys').delete().eq('id', surveyId));
  await audit('survey.delete', 'survey', surveyId, {});
}

export async function castSurveyVote({ survey, memberId, memberNumber, optionId }) {
  if (!survey?.id || !optionId) throw new Error('Voto incompleto');
  const options = (survey.options || []).map((opt) =>
    String(opt.id) === String(optionId) ? { ...opt, votes: (Number(opt.votes) || 0) + 1 } : opt
  );
  const votedBy = Array.from(new Set([...(survey.votedBy || []), memberId].filter(Boolean)));
  const saved = await upsertSurvey({ ...survey, options, votedBy, active: survey.active !== false });
  try {
    await unwrap(
      sb().from('survey_responses').upsert(
        {
          survey_id: survey.id,
          member_number: memberNumber || null,
          answers: { optionId },
        },
        { onConflict: 'survey_id,member_number' }
      )
    );
  } catch {
    /* response log best-effort */
  }
  return saved;
}

export async function listNews({ limit } = {}) {
  let q = sb().from('news_posts').select('*').order('created_at', { ascending: false });
  if (limit && Number(limit) > 0) q = q.limit(Number(limit));
  const rows = await unwrap(q);
  return (rows || []).map(M.newsFromRow);
}

export async function upsertNews(item) {
  const status = item.status
    || (item.isPublished === false ? 'draft' : 'published');
  const eventDate = item.eventDate && String(item.eventDate).trim()
    ? String(item.eventDate).slice(0, 10)
    : null;
  const row = {
    title: item.title,
    summary: item.excerpt || item.summary || null,
    body: item.content || item.body || null,
    image_url: item.image || null,
    category: item.category || null,
    is_published: status === 'published',
    event_date: eventDate,
    meta: {
      dateLabel: item.date || null,
      image: item.image || null,
      gallery: Array.isArray(item.gallery) ? item.gallery : [],
      isEvent: Boolean(item.isEvent || item.allowRsvp),
      allowRsvp: Boolean(item.allowRsvp || item.isEvent),
      slug: item.slug || null,
      author: item.author || null,
      tags: Array.isArray(item.tags) ? item.tags : [],
      featured: Boolean(item.featured),
      pinned: Boolean(item.pinned),
      status,
      scheduledAt: item.scheduledAt || null,
      seoTitle: item.seoTitle || null,
      seoDescription: item.seoDescription || null,
      coverCredit: item.coverCredit || null,
      updatedAt: item.updatedAt || new Date().toISOString(),
      createdAt: item.createdAt || null,
    },
  };
  const isPersistedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(item.id || ''));
  if (isPersistedUuid) {
    const saved = await unwrap(sb().from('news_posts').update(row).eq('id', item.id).select().single());
    return M.newsFromRow(saved);
  }
  // Nunca mandar ids temporales (tmp-news-…) a columnas uuid
  const saved = await unwrap(sb().from('news_posts').insert(row).select().single());
  return M.newsFromRow(saved);
}

export async function deleteNews(newsId) {
  await unwrap(sb().from('news_posts').delete().eq('id', newsId), 'No se pudo eliminar la noticia');
}

export async function listRsvps() {
  const rows = await unwrap(sb().from('news_rsvps').select('*'));
  return (rows || []).map((r) => ({
    id: r.id,
    newsId: r.news_id,
    memberId: r.member_number,
    memberName: r.member_name,
    status: r.status,
  }));
}

export async function upsertRsvp(rsvp, memberDbId = null) {
  const row = {
    news_id: rsvp.newsId,
    member_id: memberDbId,
    member_number: rsvp.memberId,
    member_name: rsvp.memberName || null,
    status: rsvp.status || 'going',
  };
  const saved = await unwrap(
    sb().from('news_rsvps').upsert(row, { onConflict: 'news_id,member_number' }).select().single()
  );
  return {
    id: saved.id,
    newsId: saved.news_id,
    memberId: saved.member_number,
    memberName: saved.member_name,
    status: saved.status,
  };
}
