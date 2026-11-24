import { readSnapshot } from '../../data/snapshots';

const EMPTY_HISTORY = Object.freeze({ ACCESSIN_DETAILED_CC_HISTORY: [] });

function memberKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length > 8) return '';
  return digits.replace(/^0+/, '') || '0';
}

function memberNumber(member) {
  return member?.memberNumber || member?.memberId || '';
}

/** Movimientos LILA de un socio. Lee el snapshot ya cargado y no lo modifica. */
export function accessinHistoryForMember(member) {
  if (Array.isArray(member?.accessinHistory) && member.accessinHistory.length) {
    return member.accessinHistory;
  }
  const key = memberKey(memberNumber(member));
  const history = readSnapshot('accessinDetailedCurrentAccounts', EMPTY_HISTORY).ACCESSIN_DETAILED_CC_HISTORY;
  if (!key || !Array.isArray(history)) return [];
  return history.filter((row) => memberKey(Array.isArray(row) ? row[0] : row?.memberNumber) === key);
}
