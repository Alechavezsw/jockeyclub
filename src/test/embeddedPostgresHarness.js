/**
 * Arranque y apagado de PostgreSQL embebido para tests.
 * Los reintentos aplican solo a la limpieza del directorio (EBUSY/EPERM en Windows),
 * nunca a una aserción fallida.
 */
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const EMBEDDED_PG_BUSY_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES']);
const BUSY = EMBEDDED_PG_BUSY_CODES;

export async function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('No se pudo reservar un puerto local.'));
        else resolve(port);
      });
    });
  });
}

export async function removeDirWithRetries(dir, {
  attempts = 8,
  waitMs = 120,
  log = () => {},
} = {}) {
  if (!dir) return { ok: true, attempts: 0 };
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      const code = error && typeof error === 'object' ? error.code : '';
      log(`cleanup attempt ${attempt}/${attempts}: ${code || error}`);
      if (!BUSY.has(code) || attempt === attempts) {
        return { ok: false, attempts: attempt, error: lastError };
      }
      await delay(waitMs * attempt);
    }
  }
  return { ok: false, attempts, error: lastError };
}

/**
 * Cierra pool → cluster → borra databaseDir con reintentos solo por bloqueo de archivos.
 */
export async function stopEmbeddedPostgres({
  pool,
  cluster,
  databaseDir,
  log = () => {},
} = {}) {
  const notes = [];
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      notes.push(`pool.end: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (cluster) {
    try {
      await cluster.stop();
    } catch (error) {
      notes.push(`cluster.stop: ${error instanceof Error ? error.message : error}`);
    }
    // Deja soltar handles de Windows/Linux antes del rmSync.
    await delay(80);
  }
  const cleaned = await removeDirWithRetries(databaseDir, {
    log: (line) => {
      notes.push(line);
      log(line);
    },
  });
  if (!cleaned.ok) {
    const detail = cleaned.error instanceof Error ? cleaned.error.message : String(cleaned.error || 'EBUSY');
    notes.push(`directorio retenido: ${detail}`);
    log(notes.join(' | '));
    // No tumba la suite: el fallo real ya se midió en los it(). Deja rastro.
    return { ok: false, notes, retainedDir: databaseDir };
  }
  return { ok: true, notes };
}

export async function startEmbeddedPostgres({
  label = 'jockey-pg',
  user = 'postgres',
  password = 'postgres',
  persistent = false,
  poolMax = 2,
  clusterOptions = {},
} = {}) {
  const databaseDir = mkdtempSync(join(tmpdir(), `${label}-`));
  const port = await reserveLocalPort();
  const cluster = new EmbeddedPostgres({
    databaseDir,
    user,
    password,
    port,
    persistent,
    ...clusterOptions,
  });
  await cluster.initialise();
  await cluster.start();
  const pool = new pg.Pool({
    connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/postgres`,
    max: poolMax,
  });
  return {
    cluster,
    pool,
    databaseDir,
    port,
    connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/postgres`,
  };
}
