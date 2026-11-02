import { describe, expect, it } from 'vitest';
import {
  applyMemberProfileUpdate,
  diffMemberProfile,
  withProfileEditTrace,
} from './profileEdit';

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

describe('withProfileEditTrace', () => {
  it('registra campos cambiados y el usuario que editó', () => {
    const before = { memberId: '10', phone: '111', email: 'a@club.com', meta: {} };
    const after = { ...before, phone: '222', email: 'b@club.com' };
    const traced = withProfileEditTrace(before, after, {
      actorId: 'u-1',
      actorName: 'Ana Pérez',
      source: 'panel',
    });
    expect(traced.meta.lastProfileEdit.actorName).toBe('Ana Pérez');
    expect(traced.meta.lastProfileEdit.actorId).toBe('u-1');
    expect(traced.meta.profileEditHistory).toHaveLength(1);
    const fields = traced.meta.lastProfileEdit.changes.map((c) => c.field).sort();
    expect(fields).toEqual(['email', 'phone']);
  });

  it('no escribe historial si no hubo cambios', () => {
    const member = { memberId: '10', phone: '111', meta: {} };
    const traced = withProfileEditTrace(member, { ...member }, {
      actorName: 'Ana',
    });
    expect(traced.meta?.profileEditHistory).toBeUndefined();
  });

  it('diffMemberProfile resume foto sin base64', () => {
    const changes = diffMemberProfile(
      { photo: '' },
      { photo: 'data:image/png;base64,AAAA' },
    );
    expect(changes).toEqual([
      { field: 'photo', label: 'Foto', from: 'sin foto', to: 'con foto' },
    ]);
  });
});
