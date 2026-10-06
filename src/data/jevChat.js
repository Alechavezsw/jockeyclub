import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { guideForPrompt } from '../domain/assistant/clubGuide';

export async function askJevChat({ messages = [], brief = {}, guide = '' } = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Jev necesita la sesión del club para leer el libro.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.access_token) {
    throw new Error('Volvé a entrar para hablar con Jev.');
  }
  const { data, error } = await supabase.functions.invoke('jev-chat', {
    body: { messages, brief, guide: guide || guideForPrompt() },
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
