import { canAccessAdmin, primaryRoleFromList } from './roles';

export const SESSION_DESK = {
  member: 'member',
  ops: 'ops',
};

export const SESSION_DESK_KEY = 'jockey-session-desk';

function roleKeysOf(user) {
  const keys = [];
  if (user?.role) keys.push(user.role);
  for (const role of user?.roles || []) {
    const key = typeof role === 'string' ? role : role?.roleKey || role?.key;
    if (key) keys.push(key);
  }
  return keys.map((key) => String(key).toLowerCase());
}

const MEMBER_ROLE_KEYS = new Set(['member', 'socio_titular', 'socio_adherente']);

function hasLinkedMemberCard(user) {
  const number = String(user?.memberId || '').trim();
  return Boolean(number && number !== 'session');
}

function hasMemberRole(user) {
  return roleKeysOf(user).some((key) => MEMBER_ROLE_KEYS.has(key));
}

/** Administración, portería, caja, docentes: cualquier oficio del club. */
export function canUseOpsDesk(user) {
  if (!user) return false;
  return roleKeysOf(user).some((key) => canAccessAdmin(key) || key === 'teacher');
}

/** Portal de socio: ficha real o rol de socio, aunque también tenga un oficio. */
export function canUseMemberDesk(user) {
  if (!user) return false;
  if (hasLinkedMemberCard(user) || hasMemberRole(user)) return true;
  const keys = roleKeysOf(user);
  if (keys.some((key) => canAccessAdmin(key) || key === 'teacher')) return false;
  return user.role === 'member';
}

/** La misma persona es socio y autoridad: las dos puertas no pueden convivir. */
export function isDualDeskUser(user) {
  return canUseOpsDesk(user) && (hasLinkedMemberCard(user) || hasMemberRole(user));
}

export function loadSessionDesk() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_DESK_KEY);
    if (raw === SESSION_DESK.member || raw === SESSION_DESK.ops) return raw;
    return null;
  } catch {
    return null;
  }
}

export function persistSessionDesk(desk) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (desk === SESSION_DESK.member || desk === SESSION_DESK.ops) {
      sessionStorage.setItem(SESSION_DESK_KEY, desk);
      return;
    }
    sessionStorage.removeItem(SESSION_DESK_KEY);
  } catch {
    /* privado / quota */
  }
}

export function clearSessionDesk() {
  persistSessionDesk(null);
}

/**
 * null = hay que elegir. Nunca adivina administración cuando también hay ficha.
 */
export function resolveSessionDesk(user, stored = loadSessionDesk()) {
  if (!user) return null;
  const memberOk = canUseMemberDesk(user);
  const opsOk = canUseOpsDesk(user);
  if (memberOk && opsOk) {
    if (stored === SESSION_DESK.member || stored === SESSION_DESK.ops) return stored;
    return null;
  }
  if (opsOk) return SESSION_DESK.ops;
  return SESSION_DESK.member;
}

export function effectiveRoleForDesk(user, desk) {
  if (!user) return null;
  if (desk === SESSION_DESK.member) return 'member';
  if (desk === SESSION_DESK.ops) {
    const opsKeys = roleKeysOf(user).filter((key) => canAccessAdmin(key) || key === 'teacher');
    return primaryRoleFromList(opsKeys.length ? opsKeys : [user.role]);
  }
  return user.role || null;
}

export function homePathForDesk(desk) {
  return desk === SESSION_DESK.ops ? '/panel' : '/';
}
