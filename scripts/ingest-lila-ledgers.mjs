/**
 * Recibe extractos ya parseados (los baja el navegador logueado en Lila) y los
 * guarda en group_accounts / group_account_lines.
 *
 *   node scripts/ingest-lila-ledgers.mjs
 *
 * Escucha solo en 127.0.0.1. No imprime credenciales ni el contenido de las cuentas.
 */
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.LILA_INGEST_PORT || 8765);
const LINE_CHUNK = 400;

function envValue(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

function requireEnv(name) {
  const value = envValue(name);
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

async function connect() {
  const url = requireEnv('VITE_SUPABASE_URL');
  const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey) return createClient(url, serviceKey, authOptions);

  const email = envValue('JC_ADMIN_EMAIL') || 'admin@jockey.sj';
  const password = envValue('JC_ADMIN_PASSWORD');
  if (!password) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY o JC_ADMIN_PASSWORD');
  const client = createClient(url, requireEnv('VITE_SUPABASE_ANON_KEY'), authOptions);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`No se pudo entrar a la base: ${error.message}`);
  console.log('sesion de carga lista');
  return client;
}

const sb = await connect();

const stats = { accounts: 0, lines: 0, batches: 0, errors: 0 };

function dedupeLines(lines) {
  const byId = new Map();
  for (const line of lines) {
    if (!line?.lila_line_id || !line.line_date) continue;
    byId.set(line.lila_line_id, line);
  }
  return [...byId.values()];
}

async function saveBatch(accounts) {
  const rows = accounts.map((account) => ({
    lila_group_id: String(account.id),
    titular_number: String(account.nro || '').replace(/\D/g, '').replace(/^0+/, '') || '0',
    opening_on: account.opening?.on || null,
    opening_balance: Number(account.opening?.amount) || 0,
    closing_on: account.closing?.on || null,
    closing_balance: Number(account.closing?.amount) || 0,
    loaded_at: new Date().toISOString(),
  }));

  const { data, error } = await sb
    .from('group_accounts')
    .upsert(rows, { onConflict: 'lila_group_id' })
    .select('id, lila_group_id');
  if (error) throw new Error(error.message);

  const idByGroup = new Map((data || []).map((row) => [row.lila_group_id, row.id]));
  const lines = [];
  for (const account of accounts) {
    const groupAccountId = idByGroup.get(String(account.id));
    if (!groupAccountId) continue;
    for (const line of account.lines || []) {
      const [lilaLineId, memberNumber, memberName, lineDate, typeLabel, description, amount] = line;
      lines.push({
        group_account_id: groupAccountId,
        lila_line_id: String(lilaLineId),
        member_number: String(memberNumber || '').replace(/^0+/, '') || '0',
        member_name: String(memberName || ''),
        line_date: String(lineDate || '').slice(0, 10),
        type_label: String(typeLabel || ''),
        description: String(description || ''),
        amount: Number(amount) || 0,
      });
    }
  }

  const unique = dedupeLines(lines);
  for (let i = 0; i < unique.length; i += LINE_CHUNK) {
    const chunk = unique.slice(i, i + LINE_CHUNK);
    const { error: lineError } = await sb
      .from('group_account_lines')
      .upsert(chunk, { onConflict: 'group_account_id,lila_line_id' });
    if (lineError) throw new Error(lineError.message);
  }

  stats.batches += 1;
  stats.accounts += rows.length;
  stats.lines += unique.length;
  return { accounts: rows.length, lines: unique.length };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error('payload demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/batch') {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = JSON.parse(await readBody(req));
    const result = await saveBatch(body.accounts || []);
    console.log(`batch ${stats.batches}: ${result.accounts} cuentas, ${result.lines} lineas`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...result, ...stats }));
  } catch (error) {
    stats.errors += 1;
    console.error('batch error', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ingest listo en 127.0.0.1:${PORT}`);
});
