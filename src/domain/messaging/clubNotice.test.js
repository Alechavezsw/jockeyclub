import { describe, expect, it } from 'vitest';
import {
  accumulateClubMailProgress,
  deliverableEmail,
  mailAudienceCount,
  groupMailCampaigns,
  noticeConfirmLine,
  parseComposeDraft,
} from './clubNotice';

describe('clubNotice', () => {
  it('acepta mails reales y descarta alias que rebotan', () => {
    expect(deliverableEmail('Socio@Club.com')).toBe('socio@club.com');
    expect(deliverableEmail('x@lila-jockey.com')).toBe('');
    expect(deliverableEmail('x@jockeyclubsj.com')).toBe('');
    expect(deliverableEmail('socios@jockeyclubsj.com.ar')).toBe('socios@jockeyclubsj.com.ar');
    expect(deliverableEmail('sin-arroba')).toBe('');
    expect(deliverableEmail('juliana @gmail.com')).toBe('');
    expect(deliverableEmail('xavileiva@@live.com.ar')).toBe('');
    expect(deliverableEmail('alexiskummel@gmail.com@gmail.com')).toBe('');
  });

  it('cuenta mails del padrón activo', () => {
    const counts = mailAudienceCount([
      { status: 'active', email: 'ana@club.com' },
      { status: 'active', email: 'x@jockeyclubsj.com' },
      { status: 'inactive', email: 'viejo@club.com' },
      { status: 'active', email: '' },
    ]);
    expect(counts).toEqual({ withMail: 1, withoutMail: 2 });
  });

  it('cuenta como el padrón: baja futura sí, baja vigente no, y un correo una sola vez', () => {
    const today = new Date('2026-11-23T15:00:00-03:00');
    const counts = mailAudienceCount([
      { status: 'active', email: 'titular@club.com', memberId: '1' },
      { status: 'active', email: 'familiar@club.com', memberId: '2', meta: { familyPrincipalNumber: '1' } },
      { status: 'inactive', email: 'futuro@club.com', bajaFecha: '2026-12-01', meta: { bajaFecha: '2026-12-01' } },
      { status: 'active', email: 'baja@club.com', bajaFecha: '2026-11-23', meta: { bajaFecha: '2026-11-23' } },
      { status: 'inactive', email: 'efectiva@club.com', bajaFecha: '2026-10-01', meta: { bajaFecha: '2026-10-01' } },
      { status: 'active', email: 'Titular@club.com', memberId: '9' },
      { status: 'active', email: '' },
    ], today);
    expect(counts).toEqual({ withMail: 3, withoutMail: 1 });
  });

  it('el reintento no suma dos veces los envíos ya registrados', () => {
    const first = accumulateClubMailProgress(
      { sent: 0, failed: 0, skipped: 0, campaignId: 'camp' },
      { sent: 600, failed: 0, skipped: 0, more: true, campaignId: 'camp' },
    );
    const second = accumulateClubMailProgress(first, {
      sent: 400,
      failed: 1,
      skipped: 600,
      more: false,
      campaignId: 'camp',
    });
    expect(second).toEqual({
      sent: 1000,
      failed: 1,
      skipped: 600,
      more: false,
      campaignId: 'camp',
    });
  });

  it('arma el texto de confirmación', () => {
    expect(noticeConfirmLine({
      audience: 'all',
      sendDm: true,
      sendMail: true,
      mailCount: 120,
    })).toBe('Se envía un mensaje interno a todos los socios y mail a 120 direcciones.');
    expect(noticeConfirmLine({
      audience: 'one',
      sendDm: false,
      sendMail: true,
      memberName: 'Ana Pérez',
    })).toBe('Se envía un mail a Ana Pérez.');
  });

  it('lee el borrador de Jev aunque venga envuelto', () => {
    expect(parseComposeDraft({
      subject: 'Asamblea',
      body: 'Estimados socios,\n\nLos esperamos.',
    })).toEqual({
      subject: 'Asamblea',
      body: 'Estimados socios,\n\nLos esperamos.',
    });
    expect(parseComposeDraft('```json\n{"subject":"Zonda","body":"Canchas cerradas."}\n```')).toEqual({
      subject: 'Zonda',
      body: 'Canchas cerradas.',
    });
    expect(parseComposeDraft({
      text: '{"verdict":"Asamblea","text":"Estimados socios,\\n\\nLos esperamos."}',
      source: 'gemini',
    })).toEqual({
      subject: 'Asamblea',
      body: 'Estimados socios,\n\nLos esperamos.',
    });
    expect(parseComposeDraft({
      verdict: 'Cierre de canchas',
      text: 'Estimados socios,\n\nMañana no hay tenis.',
      source: 'gemini',
    })).toEqual({
      subject: 'Cierre de canchas',
      body: 'Estimados socios,\n\nMañana no hay tenis.',
    });
    expect(parseComposeDraft('{"verdict":"Asamblea","text":"Estimados socios,\\n\\nLos esperamos el viernes')).toEqual({
      subject: 'Asamblea',
      body: 'Estimados socios,\n\nLos esperamos el viernes',
    });
    expect(parseComposeDraft('{\n  "verdict": "Asamblea el viernes",\n  "text": "Estimados socios,\n\nLos esperamos.')).toEqual({
      subject: 'Asamblea el viernes',
      body: 'Estimados socios,\n\nLos esperamos.',
    });
  });

  it('agrupa la bandeja de mail por campaña', () => {
    const grouped = groupMailCampaigns([
      { campaignId: 'a', subject: 'Asamblea', sent: true, createdAt: '2026-10-17T12:00:00Z' },
      { campaignId: 'a', subject: 'Asamblea', sent: false, createdAt: '2026-10-17T12:01:00Z' },
      { campaignId: 'b', subject: 'Zonda', sent: true, createdAt: '2026-10-17T13:00:00Z' },
    ]);
    expect(grouped.map((row) => ({ id: row.id, sent: row.sent, failed: row.failed }))).toEqual([
      { id: 'b', sent: 1, failed: 0 },
      { id: 'a', sent: 1, failed: 1 },
    ]);
  });
});
