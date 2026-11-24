import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMBEDDED_PG_BUSY_CODES,
  removeDirWithRetries,
  reserveLocalPort,
  startEmbeddedPostgres,
  stopEmbeddedPostgres,
} from './embeddedPostgresHarness.js';

describe('limpieza de PostgreSQL embebido', () => {
  it('reserva puertos locales distintos', async () => {
    const a = await reserveLocalPort();
    const b = await reserveLocalPort();
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('borra un directorio temporal y clasifica códigos de bloqueo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-clean-'));
    writeFileSync(join(dir, 'note.txt'), 'ok');
    const cleaned = await removeDirWithRetries(dir, { attempts: 3, waitMs: 10 });
    expect(cleaned.ok).toBe(true);
    expect(EMBEDDED_PG_BUSY_CODES.has('EBUSY')).toBe(true);
    expect(EMBEDDED_PG_BUSY_CODES.has('EINVAL')).toBe(false);
  });

  it('arranca y apaga un cluster sin tumbar por limpieza', async () => {
    const ctx = await startEmbeddedPostgres({ label: 'harness-smoke' });
    const ping = await ctx.pool.query('select 1::int as n');
    expect(ping.rows[0].n).toBe(1);
    const stopped = await stopEmbeddedPostgres(ctx);
    expect(stopped.ok).toBe(true);
  }, 120_000);

  it('un fallo real de SQL sigue siendo fallo de prueba', async () => {
    const ctx = await startEmbeddedPostgres({ label: 'harness-fail' });
    await expect(ctx.pool.query('select * from no_such_table_xyz')).rejects.toThrow(/no_such_table_xyz|does not exist/i);
    await stopEmbeddedPostgres(ctx);
  }, 120_000);
});
