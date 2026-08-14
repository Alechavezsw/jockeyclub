/**
 * Aplica la migración del CMS de revista vía SQL Editor API no disponible:
 * usa login admin + REST para verificar/crear noticia semilla.
 * Para schema completo hace falta `npx supabase db push` con access token.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

function env(name) {
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

const url = env('VITE_SUPABASE_URL');
const anon = env('VITE_SUPABASE_ANON_KEY');
const email = process.env.JC_ADMIN_EMAIL || 'admin@jockey.sj';
const password = process.env.JC_ADMIN_PASSWORD || 'jockey2026';

const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
if (authErr) {
  console.error('LOGIN_FAIL', authErr.message);
  process.exit(1);
}
console.log('LOGIN_OK', auth.user?.email, auth.user?.user_metadata?.role);

const { data: existing, error: listErr } = await sb
  .from('news_posts')
  .select('id, title, is_published, category')
  .order('created_at', { ascending: false })
  .limit(20);

if (listErr) {
  console.error('LIST_FAIL', listErr.message);
  console.error('Hint: aplicá la migración con SQL Editor o `npx supabase db push`');
  process.exit(1);
}

console.log('NEWS_COUNT', existing?.length || 0);
for (const row of existing || []) {
  console.log('-', row.is_published ? 'PUB' : 'DRAFT', row.category, row.title);
}

if (!existing?.length) {
  const { data: inserted, error: insErr } = await sb
    .from('news_posts')
    .insert({
      title: 'Bienvenida a la Revista Digital',
      summary: 'Novedades, torneos y vida del club en un solo lugar.',
      body: 'Desde el panel administrativo podés publicar notas con portada, galería y fotos en el texto. Los socios las ven en Revista Digital.',
      image_url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
      category: 'institucional',
      is_published: true,
      meta: {
        dateLabel: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }),
        gallery: [],
        isEvent: false,
      },
    })
    .select('id, title')
    .single();

  if (insErr) {
    console.error('INSERT_FAIL', insErr.message);
    process.exit(1);
  }
  console.log('SEED_OK', inserted.id, inserted.title);
} else {
  console.log('SEED_SKIP table already has posts');
}

await sb.auth.signOut();
console.log('DONE');
