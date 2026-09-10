import { describe, expect, it } from 'vitest';
import {
  buildGuestPassPayload,
  createGuestPass,
  isGuestPassValid,
  parseGuestPassPayload,
} from './guestPass';

describe('guest pass payload', () => {
  it('firma el QR y valida el token', () => {
    const pass = createGuestPass({
      hostMemberId: '2026887744320988',
      hostName: 'Alejandro',
      guestName: 'Invitado Test',
      date: '2026-09-09',
    });
    expect(pass.token).toMatch(/^[a-f0-9]{32}$/);
    expect(pass.payload).toBe(
      buildGuestPassPayload({
        id: pass.id,
        hostMemberId: pass.hostMemberId,
        date: pass.date,
        token: pass.token,
      })
    );

    const parsed = parseGuestPassPayload(pass.payload);
    expect(parsed).toEqual({
      id: pass.id,
      hostMemberId: '2026887744320988',
      date: '2026-09-09',
      token: pass.token,
      signed: true,
    });
    expect(isGuestPassValid(pass, { today: '2026-09-09', parsed })).toBe(true);
    expect(isGuestPassValid(pass, {
      today: '2026-09-09',
      parsed: { ...parsed, token: 'aabbccddeeff00112233445566778899' },
    })).toBe(false);
  });

  it('rechaza pases de otro día', () => {
    const pass = createGuestPass({
      hostMemberId: '1',
      guestName: 'Ana',
      date: '2026-09-08',
    });
    const parsed = parseGuestPassPayload(pass.payload);
    expect(isGuestPassValid(pass, { today: '2026-09-09', parsed })).toBe(false);
  });
});
