/**
 * Pool Season Pass Management
 * 
 * Manages the pool season pass status for members with proper state separation:
 * - paid: Canon effectively paid and confirmed
 * - exempt: Legitimate pool exemption (e.g., under age threshold)
 * - pending: Canon pending payment
 * - blocked: Entry not permitted (e.g., unpaid social dues, inactive status)
 * 
 * This is independent from daily attendance records.
 */

import { poolSeasonWindow } from './poolSeason';
import { ageYearsOn } from '../members/memberStats';
import { memberNumberOf } from '../members/households';

export const POOL_SEASON_PASS_STATUS = {
  PAID: 'paid',
  EXEMPT: 'exempt',
  PENDING: 'pending',
  BLOCKED: 'blocked',
};

export const POOL_EXEMPTION_REASONS = {
  UNDER_AGE: 'under_age',
  HOUSEHOLD_CAP: 'household_cap',
};

/**
 * Generate a unique season key for a given date.
 * Format: "YYYY-MM-DD:YYYY-MM-DD" (open:close)
 */
export function getSeasonKey(today = new Date()) {
  const win = poolSeasonWindow(today);
  return `${win.open}:${win.close}`;
}

/**
 * Generate a unique pass ID for a member in a season.
 * This ensures idempotency - same member+season always gets same ID base.
 */
export function generatePassId(memberId, seasonKey) {
  const cleanId = String(memberId || '').replace(/\D/g, '') || String(memberId || '');
  return `pool-pass-${cleanId}-${seasonKey.replace(/:/g, '-')}`;
}

/**
 * Determine the pool season pass status for a member.
 * 
 * @param {Object} member - The member object
 * @param {Object} options - Configuration options
 * @param {Date|string} options.today - Current date
 * @param {Object} options.settings - Pool settings (freeUnderAgeYears, etc.)
 * @param {Array} options.seasonPasses - Existing season passes from DB
 * @param {Object} options.householdQuote - Pre-computed household quote if available
 * @returns {Object} Pass status info
 */
export function getMemberSeasonPassStatus(member, {
  today = new Date(),
  settings = {},
  seasonPasses = [],
  householdQuote = null,
} = {}) {
  if (!member) {
    return {
      status: POOL_SEASON_PASS_STATUS.BLOCKED,
      reason: 'No member provided',
      canEnter: false,
      mustPay: false,
      amount: 0,
    };
  }

  const memberId = memberNumberOf(member) || String(member.memberId || '');
  const seasonKey = getSeasonKey(today);
  const freeUnderAge = Number(settings.freeUnderAgeYears) || 4;
  const seasonFee = Number(settings.memberSeasonFee) || 90000;

  // Check if member is under age threshold
  const age = ageYearsOn(member.birthDate || member.birth_date, today);
  if (age !== null && age < freeUnderAge) {
    return {
      status: POOL_SEASON_PASS_STATUS.EXEMPT,
      reason: `Menor de ${freeUnderAge} años`,
      exemptionType: POOL_EXEMPTION_REASONS.UNDER_AGE,
      canEnter: true,
      mustPay: false,
      amount: 0,
      memberId,
      seasonKey,
    };
  }

  // Check for existing paid pass in this season
  const existingPass = findMemberSeasonPass(seasonPasses, memberId, seasonKey);
  if (existingPass && existingPass.status === 'paid') {
    return {
      status: POOL_SEASON_PASS_STATUS.PAID,
      reason: 'Temporada abonada',
      canEnter: true,
      mustPay: false,
      amount: 0,
      passId: existingPass.id,
      paidAt: existingPass.paidAt,
      transactionRef: existingPass.transactionRef,
      memberId,
      seasonKey,
    };
  }

  // Check household cap (if quote provided)
  if (householdQuote) {
    const personQuote = householdQuote.people?.find(
      (p) => String(p.memberId) === String(memberId)
    );
    if (personQuote && !personQuote.pays && /tope/i.test(personQuote.reason || '')) {
      return {
        status: POOL_SEASON_PASS_STATUS.EXEMPT,
        reason: personQuote.reason,
        exemptionType: POOL_EXEMPTION_REASONS.HOUSEHOLD_CAP,
        canEnter: true,
        mustPay: false,
        amount: 0,
        memberId,
        seasonKey,
      };
    }
  }

  // Member needs to pay
  return {
    status: POOL_SEASON_PASS_STATUS.PENDING,
    reason: 'Canon de temporada pendiente',
    canEnter: false,
    mustPay: true,
    amount: seasonFee,
    memberId,
    seasonKey,
  };
}

/**
 * Find an existing season pass for a member in a specific season.
 */
export function findMemberSeasonPass(seasonPasses, memberId, seasonKey) {
  const cleanId = String(memberId || '').replace(/\D/g, '') || String(memberId || '');
  return (seasonPasses || []).find((pass) => {
    const passCleanId = String(pass.memberId || '').replace(/\D/g, '') || String(pass.memberId || '');
    return passCleanId === cleanId && pass.seasonKey === seasonKey && pass.status !== 'revoked';
  });
}

/**
 * Check if a payment record constitutes a valid season pass.
 * This validates that the payment is actually for the season pass, not just any payment.
 */
export function isValidSeasonPayment(payment, settings = {}) {
  if (!payment) return false;
  
  const amount = Number(payment.amount) || 0;
  const seasonFee = Number(settings.memberSeasonFee) || 90000;
  
  // Must have scope = 'season' OR concept mentioning 'temporada' OR amount >= season fee
  if (payment.scope === 'season') return true;
  if (/temporada/i.test(String(payment.concept || ''))) return true;
  
  // Amount must be close to or exceed the season fee (allow for small discounts)
  if (seasonFee > 0 && amount >= seasonFee * 0.95) return true;
  
  return false;
}

/**
 * Create a season pass record from a confirmed payment.
 */
export function createSeasonPassFromPayment({
  memberId,
  memberName,
  payment,
  today = new Date(),
  actorName = '',
}) {
  const seasonKey = getSeasonKey(today);
  const passId = generatePassId(memberId, seasonKey);
  
  return {
    id: passId,
    memberId: String(memberId),
    memberName: memberName || '',
    seasonKey,
    status: 'paid',
    paidAt: payment.paidAt || new Date().toISOString(),
    amount: Number(payment.amount) || 0,
    paymentMethod: payment.method || 'efectivo',
    transactionRef: payment.ref || payment.journalEntryId || null,
    journalEntryId: payment.journalEntryId || null,
    cashMovementId: payment.cashMovementId || null,
    createdBy: actorName || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create an exempt season pass record (for minors or household cap).
 */
export function createExemptSeasonPass({
  memberId,
  memberName,
  exemptionType,
  reason,
  today = new Date(),
  actorName = '',
}) {
  const seasonKey = getSeasonKey(today);
  const passId = `${generatePassId(memberId, seasonKey)}-exempt`;
  
  return {
    id: passId,
    memberId: String(memberId),
    memberName: memberName || '',
    seasonKey,
    status: 'exempt',
    exemptionType,
    reason,
    amount: 0,
    createdBy: actorName || null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Validate that a member can enter the pool based on their pass status.
 * This is separate from validating medical clearance and social dues.
 */
export function validatePoolEntryByPass(passStatus) {
  if (!passStatus) {
    return {
      allowed: false,
      reason: 'Estado de pase no determinado',
    };
  }

  if (passStatus.status === POOL_SEASON_PASS_STATUS.PAID) {
    return { allowed: true, reason: 'Temporada abonada' };
  }

  if (passStatus.status === POOL_SEASON_PASS_STATUS.EXEMPT) {
    return { allowed: true, reason: passStatus.reason };
  }

  if (passStatus.status === POOL_SEASON_PASS_STATUS.PENDING) {
    return { allowed: false, reason: 'Debe abonar el canon de temporada' };
  }

  return { allowed: false, reason: passStatus.reason || 'Acceso no permitido' };
}

/**
 * Determine if a pool access record represents a season pass payment.
 * This is used for backward compatibility with the existing pool_accesses table.
 */
export function poolAccessIsSeasonPass(access, settings = {}) {
  if (!access || access.status === 'revoked') return false;
  if (access.kind !== 'member') return false;
  
  const payment = access.payment || {};
  return isValidSeasonPayment(payment, settings);
}

/**
 * Extract season passes from pool_accesses for a specific season.
 * This bridges the existing system to the new pass-based model.
 */
export function extractSeasonPassesFromAccesses(accesses, today = new Date(), settings = {}) {
  const win = poolSeasonWindow(today);
  const seasonKey = getSeasonKey(today);
  const seen = new Set();
  const passes = [];

  for (const access of (accesses || [])) {
    if (!poolAccessIsSeasonPass(access, settings)) continue;
    
    const date = String(access.date || '').slice(0, 10);
    if (!date || date < win.open || date > win.close) continue;
    
    const memberId = String(access.memberId || '').replace(/\D/g, '') || String(access.memberId || '');
    if (!memberId || seen.has(memberId)) continue;
    seen.add(memberId);
    
    passes.push({
      id: access.id,
      memberId,
      memberName: access.memberName || '',
      seasonKey,
      status: 'paid',
      paidAt: access.enabledAt || access.payment?.paidAt || `${date}T12:00:00.000Z`,
      amount: Number(access.payment?.amount) || 0,
      paymentMethod: access.payment?.method || 'efectivo',
      transactionRef: access.payment?.ref || null,
      journalEntryId: access.journalEntryId || null,
      cashMovementId: access.cashMovementId || null,
      sourceAccessId: access.id,
    });
  }

  return passes;
}

/**
 * Check if a member has a valid season pass using pool_accesses data.
 * This is the corrected version that doesn't interpret free attendance as payment.
 */
export function memberHasValidSeasonPass(accesses, memberId, today = new Date(), settings = {}) {
  const cleanId = String(memberId || '').replace(/\D/g, '') || String(memberId || '');
  if (!cleanId) return false;

  const win = poolSeasonWindow(today);
  const seasonFee = Number(settings.memberSeasonFee) || 90000;

  return (accesses || []).some((row) => {
    if (row?.status === 'revoked') return false;
    if (row?.kind && row.kind !== 'member') return false;
    
    const mid = String(row?.memberId || '').replace(/\D/g, '') || String(row?.memberId || '');
    if (mid !== cleanId) return false;
    
    const date = String(row?.date || '').slice(0, 10);
    if (!date || date < win.open || date > win.close) return false;
    
    const payment = row?.payment || {};
    
    // Explicit season scope
    if (payment.scope === 'season') return true;
    
    // Concept indicates season
    if (/temporada/i.test(String(payment.concept || ''))) return true;
    
    // Amount is season fee (not $0 attendance)
    const amount = Number(payment.amount) || 0;
    if (seasonFee > 0 && amount >= seasonFee * 0.95) return true;
    
    return false;
  });
}
