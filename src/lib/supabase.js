import { createClient } from '@supabase/supabase-js';

/** Limpia env de Vercel/local: comillas, BOM, saltos (rompen fetch headers). */
function cleanEnv(value) {
  if (value == null) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\r\n\t]/g, '');
}

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
const supabaseAnonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);

const urlLooksValid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl);
const keyLooksValid =
  (supabaseAnonKey.startsWith('eyJ') && supabaseAnonKey.length > 80)
  || (supabaseAnonKey.startsWith('sb_publishable_') && supabaseAnonKey.length > 20);

export const isSupabaseConfigured = Boolean(urlLooksValid && keyLooksValid);

if (import.meta.env.DEV && (supabaseUrl || supabaseAnonKey) && !isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY inválidos o incompletos. Se usa modo local.'
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'X-Client-Info': 'jockey-club-web',
      },
    },
  })
  : null;
