import { describe, expect, it } from 'vitest';
import {
  deliverableEmail,
  mailAudienceCount,
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
});
