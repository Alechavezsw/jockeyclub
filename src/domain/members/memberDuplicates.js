/**
 * Detección preventiva de fichas duplicadas.
 * No fusiona personas: solo identifica candidatos y registros históricos.
 */

export function normalizeDocumentDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeMemberNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

export function foldPersonName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isHistoricalDuplicateMember(member) {
  if (!member) return false;
  if (member.historicalDuplicate === true || member.meta?.historicalDuplicate === true) return true;
  const canonical = normalizeMemberNumber(
    member.canonicalMemberNumber || member.meta?.canonicalMemberNumber,
  );
  const self = normalizeMemberNumber(member.memberId || member.memberNumber || member.id);
  return Boolean(canonical && self && canonical !== self);
}

export function canonicalMemberNumberOf(member) {
  const canonical = normalizeMemberNumber(
    member?.canonicalMemberNumber || member?.meta?.canonicalMemberNumber,
  );
  if (canonical) return canonical;
  return normalizeMemberNumber(member?.memberId || member?.memberNumber);
}

/** DNI usable para match (≥ 7 dígitos) o casi-match por truncado. */
export function documentsLikelySame(a, b) {
  const left = normalizeDocumentDigits(a);
  const right = normalizeDocumentDigits(b);
  if (!left || !right) return false;
  if (left === right) return left.length >= 7;
  if (left.length < 6 || right.length < 6) return false;
  // Truncado / dígito faltante (ej. 3859356 vs 38593056).
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (long.includes(short) && long.length - short.length <= 2) return true;
  if (Math.abs(left.length - right.length) === 1) {
    const minLen = Math.min(left.length, right.length);
    let mismatches = 0;
    for (let i = 0, j = 0; i < left.length && j < right.length;) {
      if (left[i] === right[j]) {
        i += 1;
        j += 1;
        continue;
      }
      mismatches += 1;
      if (mismatches > 1) return false;
      if (left.length > right.length) i += 1;
      else j += 1;
    }
    return mismatches <= 1 && minLen >= 6;
  }
  return false;
}

export function membersLikelySamePerson(a, b) {
  if (!a || !b) return false;
  const aNro = normalizeMemberNumber(a.memberId || a.memberNumber);
  const bNro = normalizeMemberNumber(b.memberId || b.memberNumber);
  if (aNro && bNro && aNro === bNro) return true;
  const sameDoc = documentsLikelySame(
    a.documentNumber || a.dni,
    b.documentNumber || b.dni,
  );
  const sameName = foldPersonName(a.name || a.fullName) === foldPersonName(b.name || b.fullName)
    && foldPersonName(a.name || a.fullName).length >= 8;
  // Solo nombre no alcanza: hace falta DNI compatible o vínculo explícito.
  if (sameDoc && sameName) return true;
  if (sameDoc && normalizeDocumentDigits(a.documentNumber || a.dni).length >= 7) return true;
  const aCanon = normalizeMemberNumber(a.canonicalMemberNumber || a.meta?.canonicalMemberNumber);
  const bCanon = normalizeMemberNumber(b.canonicalMemberNumber || b.meta?.canonicalMemberNumber);
  if (aCanon && aCanon === bNro) return true;
  if (bCanon && bCanon === aNro) return true;
  return false;
}

/**
 * Ocultar ficha histórica / baja cuando ya hay una operativa de la misma persona.
 * Los marcados historicalDuplicate no aparecen en padrón/cobranza salvo Nº exacto.
 */
export function shouldHideDuplicateFromOperationalSearch(member, { peers = [], query = '' } = {}) {
  if (!member) return true;
  const status = String(member.status || 'active').toLowerCase();
  const live = status === 'active';
  if (live && !isHistoricalDuplicateMember(member)) return false;

  const digits = String(query || '').replace(/\D/g, '');
  const nro = normalizeMemberNumber(member.memberId || member.memberNumber);
  if (digits.length >= 3 && nro && nro === digits) return false;

  // Ficha canónica reemplazada: no debe existir en listados operativos.
  if (isHistoricalDuplicateMember(member)) return true;

  if (status !== 'active') {
    const name = foldPersonName(member.name || member.fullName);
    const hasActiveSamePerson = (peers || []).some((row) => {
      if (row === member) return false;
      if (String(row.status || 'active').toLowerCase() !== 'active') return false;
      return membersLikelySamePerson(member, row)
        || (name && foldPersonName(row.name || row.fullName) === name);
    });
    if (hasActiveSamePerson) return true;
  }

  return false;
}

/**
 * Agrupa candidatos a duplicado (DNI normalizado / casi-igual + nombre).
 * No fusiona: solo reporta.
 */
export function findDuplicateMemberGroups(members = []) {
  const list = Array.isArray(members) ? members : [];
  const parent = new Map();
  const find = (key) => {
    const cur = parent.get(key) || key;
    if (cur !== key) {
      const root = find(cur);
      parent.set(key, root);
      return root;
    }
    return cur;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < list.length; i += 1) {
    const left = list[i];
    const leftKey = normalizeMemberNumber(left.memberId || left.memberNumber) || `i:${i}`;
    parent.set(leftKey, find(leftKey));
    for (let j = i + 1; j < list.length; j += 1) {
      const right = list[j];
      if (!membersLikelySamePerson(left, right)) continue;
      const rightKey = normalizeMemberNumber(right.memberId || right.memberNumber) || `i:${j}`;
      unite(leftKey, rightKey);
    }
  }

  const groups = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const member = list[i];
    const key = normalizeMemberNumber(member.memberId || member.memberNumber) || `i:${i}`;
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(member);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const active = group.filter((m) => String(m.status || 'active').toLowerCase() === 'active');
      const preferred = active[0] || group[0];
      return {
        severity: active.length > 1 ? 'high' : 'medium',
        canonicalMemberNumber: normalizeMemberNumber(preferred.memberId || preferred.memberNumber),
        members: group.map((m) => ({
          memberNumber: normalizeMemberNumber(m.memberId || m.memberNumber),
          name: m.name || m.fullName,
          status: m.status || 'active',
          documentNumber: m.documentNumber || m.dni || null,
          outstandingBalance: Number(m.outstandingBalance) || 0,
          historicalDuplicate: isHistoricalDuplicateMember(m),
        })),
      };
    })
    .toSorted((a, b) => b.members.length - a.members.length);
}

export function filterOperationalSearchHits(hits = [], query = '') {
  const list = Array.isArray(hits) ? hits : [];
  return list.filter((row) => !shouldHideDuplicateFromOperationalSearch(row, { peers: list, query }));
}
