/**
 * Migra padrón datita → public.members (idempotente por member_number).
 *
 * Uso:
 *   node scripts/migrate-datita-socios.mjs --dry-run --limit=50
 *   node scripts/migrate-datita-socios.mjs --limit=50
 *   node scripts/migrate-datita-socios.mjs
 *   node scripts/migrate-datita-socios.mjs --staging-only
 *
 * Auth: admin@jockey.sj vía anon key en .env
 * Staging: si existen tablas public.socios / socio_cuotas, también las llena.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseCsv,
  emptyToNull,
  parseIntSafe,
  parseDate,
  socioToMember,
  memberToDbRow,
  summarizeMembers,
  buildCuotasIndex,
} from '../src/domain/members/datitaImport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BATCH = 200;

function loadEnv(name) {
  const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta ${name} en .env`);
  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
}

function parseArgs(argv) {
  const out = { dryRun: false, stagingOnly: false, skipStaging: false, limit: null };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--staging-only') out.stagingOnly = true;
    else if (a === '--skip-staging') out.skipStaging = true;
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8)) || null;
  }
  return out;
}

function readTextFile(path) {
  const buf = readFileSync(path);
  let text = buf.toString('utf8');
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 20) text = buf.toString('latin1');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

async function stagingAvailable(sb) {
  const { error } = await sb.from('socios').select('nro_socio').limit(1);
  return !error;
}

async function upsertStagingBatch(sb, items) {
  const sociosPayload = items.map(({ row }) => {
    const nro = parseIntSafe(row.nro_socio);
    return {
      nro_socio: nro,
      autorizacion: emptyToNull(row.autorizacion),
      nombre: emptyToNull(row.nombre),
      apellido: emptyToNull(row.apellido),
      documento_tipo: emptyToNull(row.documento_tipo),
      documento_numero: emptyToNull(row.documento_numero),
      direccion: emptyToNull(row.direccion),
      sexo: emptyToNull(row.sexo),
      fecha_nacimiento: parseDate(row.fecha_nacimiento),
      anio_nacimiento: parseIntSafe(row.anio_nacimiento),
      email: emptyToNull(row.email),
      telefono_personal: emptyToNull(row.telefono_personal),
      vencimiento_autorizacion: parseDate(row.vencimiento_autorizacion),
      fecha_alta: parseDate(row.fecha_alta),
      fecha_baja: parseDate(row.fecha_baja),
      motivo_baja: emptyToNull(row.motivo_baja),
      tarjeta_prisma: emptyToNull(row.tarjeta_prisma),
      tipo_debito_prisma: emptyToNull(row.tipo_debito_prisma),
      nro_socio_principal_grupo_familiar: parseIntSafe(row.nro_socio_principal_grupo_familiar),
      nombre_grupo_familiar: emptyToNull(row.nombre_grupo_familiar),
      contacto_emergencia: emptyToNull(row.contacto_emergencia),
      numero_emergencia: emptyToNull(row.numero_emergencia),
      grupo_sanguineo: emptyToNull(row.grupo_sanguineo),
      socio_activo: emptyToNull(row.socio_activo),
      obra_social: emptyToNull(row.obra_social),
      clinica_emergencia: emptyToNull(row.clinica_emergencia),
      imported_at: new Date().toISOString(),
    };
  });

  const { error: sErr } = await sb.from('socios').upsert(sociosPayload, { onConflict: 'nro_socio' });
  if (sErr) throw new Error(`staging socios: ${sErr.message}`);

  const nros = sociosPayload.map((s) => s.nro_socio);
  const { error: dErr } = await sb.from('socio_cuotas').delete().in('nro_socio', nros);
  if (dErr) throw new Error(`staging cuotas delete: ${dErr.message}`);

  const cuotaRows = [];
  for (const { nro, cats } of items) {
    for (const categoria_cuota of cats) {
      cuotaRows.push({ nro_socio: nro, categoria_cuota });
    }
  }
  if (cuotaRows.length) {
    const { error: cErr } = await sb.from('socio_cuotas').insert(cuotaRows);
    if (cErr) throw new Error(`staging cuotas insert: ${cErr.message}`);
  }
}

async function upsertMembersBatch(sb, members) {
  const rows = members.map(memberToDbRow);
  // Prefer bulk upsert by unique member_number
  const { error } = await sb.from('members').upsert(rows, {
    onConflict: 'member_number',
    ignoreDuplicates: false,
  });
  if (!error) {
    // Approximate: we don't know insert vs update without a prior select
    return { inserted: 0, updated: rows.length };
  }

  // Fallback: select then insert/update (handles older schemas / RLS quirks)
  const numbers = rows.map((r) => r.member_number);
  const { data: existing, error: findErr } = await sb
    .from('members')
    .select('id, member_number')
    .in('member_number', numbers);
  if (findErr) throw new Error(findErr.message || error.message);

  const byNumber = new Map((existing || []).map((e) => [e.member_number, e.id]));
  const toInsert = [];
  const toUpdate = [];
  for (const row of rows) {
    const id = byNumber.get(row.member_number);
    if (id) toUpdate.push({ ...row, id });
    else toInsert.push(row);
  }

  let inserted = 0;
  let updated = 0;

  if (toInsert.length) {
    const { error: iErr } = await sb.from('members').insert(toInsert);
    if (iErr) throw new Error(`insert members: ${iErr.message}`);
    inserted = toInsert.length;
  }

  if (toUpdate.length) {
    // Parallel updates in small chunks
    const chunkSize = 25;
    for (let i = 0; i < toUpdate.length; i += chunkSize) {
      const slice = toUpdate.slice(i, i + chunkSize);
      await Promise.all(slice.map(async (row) => {
        const { id, ...rest } = row;
        const { error: uErr } = await sb.from('members').update(rest).eq('id', id);
        if (uErr) throw new Error(`update #${rest.member_number}: ${uErr.message}`);
      }));
      updated += slice.length;
    }
  }

  return { inserted, updated };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sociosPath = resolve(ROOT, 'datita/socios.csv');
  const cuotasPath = resolve(ROOT, 'datita/socio_cuotas.csv');
  if (!existsSync(sociosPath) || !existsSync(cuotasPath)) {
    throw new Error('No se encontraron datita/socios.csv o datita/socio_cuotas.csv');
  }

  console.log('Reading CSVs…');
  const socios = parseCsv(readTextFile(sociosPath));
  const cuotas = parseCsv(readTextFile(cuotasPath));
  console.log(`socios=${socios.length} cuotas=${cuotas.length}`);

  const catsByNro = buildCuotasIndex(cuotas);
  let list = socios
    .map((row) => {
      const nro = parseIntSafe(row.nro_socio);
      return { row, nro, cats: nro ? (catsByNro.get(nro) || []) : [] };
    })
    .filter((x) => x.nro);

  if (args.limit) list = list.slice(0, args.limit);
  console.log(`to_process=${list.length} dryRun=${args.dryRun} stagingOnly=${args.stagingOnly} batch=${BATCH}`);

  const membersPreview = list.map(({ row, cats }) => socioToMember(row, cats));
  if (args.dryRun) {
    console.log('SUMMARY', JSON.stringify(summarizeMembers(membersPreview), null, 2));
    console.log('DRY_RUN_DONE');
    return;
  }

  const url = loadEnv('VITE_SUPABASE_URL');
  const anon = loadEnv('VITE_SUPABASE_ANON_KEY');
  const email = process.env.JC_ADMIN_EMAIL || 'admin@jockey.sj';
  const password = process.env.JC_ADMIN_PASSWORD || 'jockey2026';

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) {
    console.error('LOGIN_FAIL', authErr.message);
    process.exit(1);
  }
  console.log('LOGIN_OK', auth.user?.email);

  let useStaging = !args.skipStaging && (await stagingAvailable(sb));
  if (!useStaging && !args.skipStaging) {
    console.log('STAGING_SKIP tablas public.socios / socio_cuotas no disponibles. Aplicá supabase/migrations/20260829110000_datita_socios_staging.sql');
  } else if (useStaging) {
    console.log('STAGING_OK');
  }

  let inserted = 0;
  let updated = 0;
  let stagingOk = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < list.length; i += BATCH) {
    const chunk = list.slice(i, i + BATCH);
    try {
      if (useStaging) {
        await upsertStagingBatch(sb, chunk);
        stagingOk += chunk.length;
      }
      if (!args.stagingOnly) {
        const members = chunk.map(({ row, cats }) => socioToMember(row, cats));
        const res = await upsertMembersBatch(sb, members);
        inserted += res.inserted;
        updated += res.updated;
      }
    } catch (err) {
      // Fallback fila a fila si el lote falla
      for (const item of chunk) {
        try {
          if (useStaging) {
            await upsertStagingBatch(sb, [item]);
            stagingOk += 1;
          }
          if (!args.stagingOnly) {
            const member = socioToMember(item.row, item.cats);
            const res = await upsertMembersBatch(sb, [member]);
            inserted += res.inserted;
            updated += res.updated;
          }
        } catch (e2) {
          failed += 1;
          const msg = e2?.message || String(e2);
          errors.push({ nro: item.nro, msg });
          if (errors.length <= 20) console.error(`FAIL #${item.nro}`, msg);
        }
      }
    }
    const done = Math.min(i + BATCH, list.length);
    console.log(`progress ${done}/${list.length} inserted=${inserted} updated=${updated} staging=${stagingOk} failed=${failed}`);
  }

  await sb.auth.signOut();
  console.log('DONE', { inserted, updated, stagingOk, failed, total: list.length });
  console.log('SUMMARY', summarizeMembers(membersPreview));
  if (errors.length) {
    console.log('FIRST_ERRORS', errors.slice(0, 10));
    process.exitCode = failed > list.length * 0.05 ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
