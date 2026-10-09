import { describe, it, expect } from 'vitest';
import {
  SESSION_DESK,
  canUseMemberDesk,
  canUseOpsDesk,
  isDualDeskUser,
  resolveSessionDesk,
  effectiveRoleForDesk,
} from './sessionDesk';

const superadminSocio = {
  role: 'member',
  memberId: '10412',
  roles: [
    { roleKey: 'member', label: 'Socio' },
    { roleKey: 'superadmin', label: 'Superadministrador' },
  ],
};

const onlyAdmin = {
  role: 'superadmin',
  memberId: null,
  roles: [{ roleKey: 'superadmin' }],
};

const onlyMember = {
  role: 'member',
  memberId: '2201',
  roles: [{ roleKey: 'member' }],
};

describe('session desks', () => {
  it('el superadmin con ficha de socio es dual y no entra solo', () => {
    expect(canUseOpsDesk(superadminSocio)).toBe(true);
    expect(canUseMemberDesk(superadminSocio)).toBe(true);
    expect(isDualDeskUser(superadminSocio)).toBe(true);
    expect(resolveSessionDesk(superadminSocio, null)).toBe(null);
  });

  it('respeta la puerta que eligió en esta pestaña', () => {
    expect(resolveSessionDesk(superadminSocio, SESSION_DESK.member)).toBe('member');
    expect(resolveSessionDesk(superadminSocio, SESSION_DESK.ops)).toBe('ops');
    expect(effectiveRoleForDesk(superadminSocio, 'member')).toBe('member');
    expect(effectiveRoleForDesk(superadminSocio, 'ops')).toBe('superadmin');
  });

  it('sin ficha ni rol de socio, el superadmin no ve el portal', () => {
    expect(isDualDeskUser(onlyAdmin)).toBe(false);
    expect(resolveSessionDesk(onlyAdmin, null)).toBe('ops');
    expect(canUseMemberDesk(onlyAdmin)).toBe(false);
  });

  it('con rol de socio, aunque no esté la ficha vinculada, hay que elegir puerta', () => {
    const dualSinFicha = {
      role: 'superadmin',
      memberId: null,
      roles: [{ roleKey: 'superadmin' }, { roleKey: 'member' }, { roleKey: 'socio_titular' }],
    };
    expect(isDualDeskUser(dualSinFicha)).toBe(true);
    expect(resolveSessionDesk(dualSinFicha, null)).toBe(null);
  });

  it('el socio solo entra al portal', () => {
    expect(isDualDeskUser(onlyMember)).toBe(false);
    expect(resolveSessionDesk(onlyMember, 'ops')).toBe('member');
    expect(effectiveRoleForDesk(onlyMember, 'member')).toBe('member');
  });

  it('un profiles.role de socio no tapa el superadmin en administración', () => {
    expect(effectiveRoleForDesk({
      role: 'member',
      roles: [{ roleKey: 'member' }, { roleKey: 'superadmin' }],
    }, 'ops')).toBe('superadmin');
  });
});
