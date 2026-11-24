import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLUB_MAIL_PAGE,
  classifyClubMailRow,
  clubMailAuthDecision,
  clubMailRequestScope,
  decidePreviewClaim,
  interpretResendBatch,
  scanClubMailAudience,
} from '../../../supabase/functions/_shared/clubMailAudience.ts';

const TODAY = '2026-11-23';

function row(partial) {
  return {
    member_number: partial.memberNumber,
    full_name: partial.name || '',
    email: partial.email,
    status: partial.status,
    meta: partial.meta || {},
  };
}

const roster = [
  row({ memberNumber: '1', email: 'titular@club.com', status: 'active', name: 'Titular' }),
  row({ memberNumber: '2', email: 'familiar@club.com', status: 'active', meta: { familyPrincipalNumber: '1' } }),
  row({ memberNumber: '3', email: 'futuro@club.com', status: 'inactive', meta: { bajaFecha: '2026-12-01' } }),
  row({ memberNumber: '4', email: 'vigente@club.com', status: 'active', meta: { bajaFecha: TODAY } }),
  row({ memberNumber: '5', email: 'inactivo@club.com', status: 'inactive', meta: { bajaFecha: '2026-10-01' } }),
  row({ memberNumber: '6', email: 'Titular@club.com', status: 'active' }),
  row({ memberNumber: '7', email: '', status: 'active' }),
  row({ memberNumber: '8', email: 'alias@lila-jockey.local', status: 'active' }),
  row({ memberNumber: '9', email: 'interno@jockeyclubsj.com', status: 'active' }),
  row({ memberNumber: '10', email: 'fuera@club.com', status: 'active' }),
];

describe('vista previa de comunicados', () => {
  it('cuenta operativo, real, único, vacío, alias, compartido y baja', async () => {
    const loadedInReact = roster.filter((item) => item.member_number !== '10');
    const summary = await scanClubMailAudience(async () => roster, { today: TODAY });
    expect(loadedInReact.some((item) => item.member_number === '10')).toBe(false);
    expect(summary.targets.some((item) => item.memberNumber === '10')).toBe(true);
    expect(summary.operational).toBe(8);
    expect(summary.withRealEmail).toBe(5);
    expect(summary.uniqueAddresses).toBe(4);
    expect(summary.recipients).toBe(4);
    expect(summary.missingEmail).toBe(1);
    expect(summary.aliasExcluded).toBe(2);
    expect(summary.sharedAddresses).toBe(1);
    expect(summary.excludedByBaja).toBe(2);
    expect(summary.sharedGroups).toEqual([['1', '6']]);
  });

  it('una baja futura entra y una baja de hoy no', () => {
    const seen = new Map();
    expect(classifyClubMailRow(roster[2], seen, TODAY).reason).toBe('recipient');
    expect(classifyClubMailRow(roster[3], new Map(), TODAY).reason).toBe('baja');
  });

  it('pagina por encima de 500 e incluye la ficha de la página siguiente', async () => {
    const rows = Array.from({ length: CLUB_MAIL_PAGE + 1 }, (_, index) => row({
      memberNumber: String(index + 1),
      email: `socio${index + 1}@club.com`,
      status: 'active',
    }));
    let calls = 0;
    const summary = await scanClubMailAudience(async (from, to) => {
      calls += 1;
      return rows.slice(from, to + 1);
    }, { pageSize: CLUB_MAIL_PAGE, today: TODAY });
    expect(calls).toBe(2);
    expect(summary.recipients).toBe(501);
    expect(summary.targets.some((item) => item.memberNumber === '501')).toBe(true);
  });

  it('ignora una lista de correos metida en la solicitud', () => {
    const scope = clubMailRequestScope({
      audience: 'all',
      emails: ['otro@club.com'],
      recipients: ['9'],
      memberNumber: '10',
    });
    expect(scope).toEqual({ audience: 'all', memberNumber: '' });
  });

  it('si cambia el padrón, la revisión ya no sirve', () => {
    const preview = {
      audience_sha256: 'aaa',
      body_sha256: 'bbb',
      expires_at: '2026-11-23T20:00:00.000Z',
    };
    const changed = decidePreviewClaim(preview, {
      audienceSha256: 'ccc',
      bodySha256: 'bbb',
      campaignId: '11111111-1111-1111-1111-111111111111',
    }, new Date('2026-11-23T19:00:00.000Z'));
    expect(changed.ok).toBe(false);
    expect(changed.status).toBe(409);
  });

  it('dos confirmaciones: la segunda campaña se rechaza y el mismo lote puede reintentar', () => {
    const now = new Date('2026-11-23T19:00:00.000Z');
    const first = {
      audience_sha256: 'aaa',
      body_sha256: 'bbb',
      expires_at: '2026-11-23T20:00:00.000Z',
      consumed_at: '2026-11-23T19:00:01.000Z',
      campaign_id: '11111111-1111-1111-1111-111111111111',
    };
    const other = decidePreviewClaim(first, {
      audienceSha256: 'aaa',
      bodySha256: 'bbb',
      campaignId: '22222222-2222-2222-2222-222222222222',
    }, now);
    const retry = decidePreviewClaim(first, {
      audienceSha256: 'aaa',
      bodySha256: 'bbb',
      campaignId: first.campaign_id,
    }, now);
    expect(other.ok).toBe(false);
    expect(retry).toMatchObject({ ok: true, retry: true });
  });

  it('una sesión vencida y un socio sin permiso no pasan', () => {
    expect(clubMailAuthDecision({ authorization: '', staff: false }).status).toBe(401);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: false }).status).toBe(403);
    expect(clubMailAuthDecision({ authorization: 'Bearer token', staff: true, staffError: true }).status).toBe(403);
  });

  it('un fallo de Resend no se cuenta como enviado', () => {
    const failed = interpretResendBatch(500, { message: 'proveedor caído' }, 3);
    expect(failed).toMatchObject({ accepted: 0, failed: 3, error: 'proveedor caído' });
    const accepted = interpretResendBatch(200, { data: [{ id: 're_1' }, { id: 're_2' }] }, 2);
    expect(accepted.accepted).toBe(2);
    expect(accepted.error).toBe('');
  });

  it('no graba 4897 ni 2254 como si fueran un cupo fijo', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/functions/_shared/clubMailAudience.ts'),
      'utf8',
    );
    expect(source.includes('4897')).toBe(false);
    expect(source.includes('2254')).toBe(false);
  });

  it('la revisión vencida obliga a contar de nuevo', () => {
    const expired = decidePreviewClaim({
      audience_sha256: 'aaa',
      body_sha256: 'bbb',
      expires_at: '2026-11-23T18:00:00.000Z',
    }, {
      audienceSha256: 'aaa',
      bodySha256: 'bbb',
      campaignId: '11111111-1111-1111-1111-111111111111',
    }, new Date('2026-11-23T19:00:00.000Z'));
    expect(expired.status).toBe(409);
  });
});
