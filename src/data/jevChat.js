import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { guideForPrompt } from '../domain/assistant/clubGuide';
import { parseComposeDraft } from '../domain/messaging/clubNotice';

/** Lo último que preguntó el usuario (y lo anterior, por si es una repregunta): con eso se eligen las lecciones. */
function recentQuestions(messages = []) {
  return messages
    .filter((row) => row?.role === 'user')
    .slice(-2)
    .map((row) => String(row.content || ''))
    .join(' ');
}

export async function askJevChat({
  messages = [],
  brief = {},
  guide = '',
  member = null,
  reviewItems = null,
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Jev necesita la sesión del club para leer el libro.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.access_token) {
    throw new Error('Volvé a entrar para hablar con Jev.');
  }
  const queue = reviewItems || brief.reviewItems || null;
  const { data, error } = await supabase.functions.invoke('jev-chat', {
    body: {
      messages,
      brief,
      guide: guide || guideForPrompt(recentQuestions(messages), { member, reviewItems: queue }),
    },
  });
  if (error) {
    let detail = error.message || 'Jev no pudo responder';
    try {
      const body = typeof error.context?.json === 'function' ? await error.context.json() : data;
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(data?.error || detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function askJevCompose({
  prompt = '',
  audience = 'all',
  channels = 'dm y mail',
  draft = '',
  memberName = '',
} = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('La IA necesita la sesión del club para redactar.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.access_token) {
    throw new Error('Volvé a entrar para redactar con IA.');
  }
  try {
    const { data, error } = await supabase.functions.invoke('jev-chat', {
      body: { mode: 'compose', prompt, audience, channels, draft, memberName },
    });
    if (!error && !data?.error) {
      const parsed = parseComposeDraft(data);
      if (parsed.subject && parsed.body) return parsed;
    }
  } catch {
    /* función sin modo compose: se redacta por el dictamen */
  }

  const who = audience === 'one'
    ? `un socio${memberName ? ` (${memberName})` : ''}`
    : 'todos los socios';
  const remote = await askJevChat({
    messages: [{
      role: 'user',
      content: [
        'Redactá un comunicado institucional. No es una consulta de números ni de secciones.',
        `Pedido: ${prompt || 'comunicado del club'}`,
        draft ? `Borrador actual:\n${draft}` : '',
        `Destino: ${who}. Canal: ${channels}.`,
        'JSON válido y corto. verdict = asunto, máximo 70 caracteres.',
        'text = cuerpo, 2 párrafos, máximo 600 caracteres, listo para enviar, firma Secretaría del Jockey Club San Juan. Sin emojis.',
      ].filter(Boolean).join('\n'),
    }],
  });
  if (remote?.source !== 'gemini') {
    throw new Error('La IA no respondió. Reintentá.');
  }
  const parsed = parseComposeDraft(remote);
  if (!parsed.subject || !parsed.body) {
    throw new Error('La IA no devolvió un comunicado.');
  }
  return parsed;
}
