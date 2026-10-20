import { describe, expect, it } from 'vitest';
import { applyMemberProfileUpdate } from './profileEdit';

describe('applyMemberProfileUpdate', () => {
  it('guarda la ficha completa, no el recorte de listado', () => {
    const next = applyMemberProfileUpdate(
      { memberId: '1622', recordScope: 'list', email: 'viejo@club.com' },
      { email: 'nuevo@correo.com', address: 'Calle 1', phone: '2645551234' },
    );
    expect(next.recordScope).toBe('full');
    expect(next.email).toBe('nuevo@correo.com');
    expect(next.address).toBe('Calle 1');
    expect(next.phone).toBe('2645551234');
  });
});
