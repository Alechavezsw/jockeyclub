/**
 * No socio de pileta al entrar a la app de socio.
 * Ve inicio, cuenta, Colonia (tarifa de no socio) y novedades.
 * No cobra cuota social, no reserva instalaciones y la mora de socio no lo frena.
 */
import { describe, expect, it } from 'vitest';
import { navItemsForRole } from '../auth/roles';
import { feePackLinesFromMembers } from '../accounting/feeBilling';
import {
  buildPortalEnrollmentPayload,
  coloniaPortalMemberKind,
  validatePortalEnrollmentWizard,
} from '../colonia/coloniaPortal';
import { COLONIA_SEASON_2026_2027 } from '../colonia/coloniaConstants';
import { quoteColoniaEnrollmentDue } from '../colonia/coloniaLate';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027, planAmountFor } from '../colonia/coloniaTariffs';
import { clubEntryGate } from '../pool/seasonDuesGate';
import { quotePersonPoolSeason } from '../pool/poolSeasonBilling';
import { validateMemberBooking } from '../reservations/bookingRules';
import { FACILITIES, getFacilityById } from '../reservations/facilities';
import { buildFacilityCatalog } from '../reservations/facilityConfig';
import { deriveMemberTier, slugifyTierId } from './tiers';
import {
  canChargeSocialDues,
  collectionPeriodChoices,
  dbMemberIsDuesExempt,
  duesAmountForMember,
  isDuesExemptMember,
  isPoolGuestMember,
  quotaHeadline,
} from './dues';
import { duesCollectionGate } from './memberPayments';

const TODAY = new Date('2026-11-26T12:00:00-03:00');
const IN_SEASON = new Date('2026-12-15T12:00:00-03:00');
const anhelo = getFacilityById('salon_anhelo', buildFacilityCatalog(FACILITIES));

function guest(overrides = {}) {
  return {
    id: 'pool-guest-1',
    memberId: '88001',
    name: 'Ana Pérez',
    status: 'active',
    tier: 'pileta_no_socio',
    cuotaCategories: ['PILETA (No socio)'],
    outstandingBalance: 0,
    nextDueDate: '2026-12-10',
    email: 'ana@example.com',
    birthDate: '1990-04-02',
    ...overrides,
  };
}

function familiar(overrides = {}) {
  return {
    memberId: '10935',
    name: 'Miguel',
    status: 'active',
    tier: 'socio_familiar',
    cuotaCategories: ['SOCIO FAMILIAR'],
    outstandingBalance: 70000,
    nextDueDate: '2026-12-10',
    birthDate: '1980-01-01',
    ...overrides,
  };
}

const guardian = {
  fullName: 'Ana Pérez',
  phone: '2644000000',
  email: 'ana@example.com',
  documentNumber: '30111222',
  relationship: 'Madre',
  emergencyContact: 'Abuela 2644111111',
  authorizedPickup: 'Abuela',
};

const pupil = {
  fullName: 'Lola Pérez',
  birthDate: '2016-03-01',
  documentNumber: '55111000',
  memberKind: 'no_socio',
  memberNumber: '',
  shirtSize: '8',
};

describe('el no socio de pileta entra a la app', () => {
  it('la categoría del padrón es PILETA (No socio)', () => {
    expect(slugifyTierId('PILETA (No socio)')).toBe('pileta_no_socio');
    expect(deriveMemberTier(['PILETA (No socio)'])).toBe('pileta_no_socio');
    expect(isPoolGuestMember(guest())).toBe(true);
    expect(isPoolGuestMember(guest({ cuotaCategories: ['pileta (no socio)'] }))).toBe(true);
    expect(isPoolGuestMember(guest({ cuotaCategories: [], tier: 'pileta_no_socio' }))).toBe(true);
  });

  it('un familiar, un liga o una ficha vacía no se confunden con él', () => {
    expect(isPoolGuestMember(familiar())).toBe(false);
    expect(isPoolGuestMember(familiar({
      cuotaCategories: ['SOCIO FAMILIAR', 'PILETA (No socio)'],
    }))).toBe(false);
    expect(isPoolGuestMember({
      tier: 'liga_no_socio',
      cuotaCategories: ['LIGA (No socio)'],
    })).toBe(false);
    expect(isPoolGuestMember({
      tier: 'colonia_no_socio',
      cuotaCategories: ['COLONIA (No socio)'],
    })).toBe(false);
    expect(isPoolGuestMember({ tier: '', cuotaCategories: [] })).toBe(false);
    expect(isPoolGuestMember(null)).toBe(false);
  });

  it('el menú es inicio, cuenta, Colonia y novedades', () => {
    expect(navItemsForRole('member', { poolGuest: true }).map((item) => item.id)).toEqual([
      'dashboard',
      'payments',
      'colonia',
      'news',
    ]);
    expect(navItemsForRole('member', {
      poolGuest: true,
      membersCanViewCurrentAccounts: false,
    }).map((item) => item.id)).toEqual(['dashboard', 'colonia', 'news']);
    const socio = navItemsForRole('member').map((item) => item.id);
    expect(socio).toContain('reservations');
    expect(socio).toContain('colonia');
  });

  it('la ficha dice Pileta y no inventa cuota social', () => {
    const headline = quotaHeadline(guest({ outstandingBalance: 70000 }));
    expect(headline.title).toBe('Pileta');
    expect(headline.hint).toMatch(/sin cuota social/i);
    expect(headline.kind).not.toBe('debt');
    expect(isDuesExemptMember(guest())).toBe(true);
    expect(canChargeSocialDues(guest())).toBe(false);
    expect(duesAmountForMember(guest(), TODAY)).toBe(0);
    expect(collectionPeriodChoices(guest({ outstandingBalance: 70000 }), TODAY)).toEqual([]);
    expect(dbMemberIsDuesExempt('pileta_no_socio', {
      cuotaCategories: ['PILETA (No socio)'],
    })).toBe(true);
    expect(dbMemberIsDuesExempt('pileta_no_socio', null)).toBe(true);
    expect(dbMemberIsDuesExempt('socio_familiar', {
      cuotaCategories: ['SOCIO FAMILIAR', 'PILETA (No socio)'],
    })).toBe(false);
  });

  it('un saldo viejo no se cobra como cuota social', () => {
    const member = guest({ outstandingBalance: 70000 });
    const gate = duesCollectionGate(member, { amount: 70000, paidOn: TODAY });
    expect(gate.blocked).toBe(true);
    expect(gate.theoretical).toBe(0);
    expect(gate.lines).toEqual([]);
    expect(gate.message).toMatch(/no abona cuota social/i);
    expect(duesCollectionGate(member, { amount: 0, paidOn: TODAY }).blocked).toBe(false);
    const socio = duesCollectionGate(familiar(), { amount: 70000, paidOn: IN_SEASON });
    expect(socio.blocked).toBe(false);
    expect(socio.theoretical).toBeGreaterThan(0);
  });

  it('no reserva salones ni Espacio Verde desde la app', () => {
    const denied = validateMemberBooking({
      facility: anhelo,
      member: guest(),
      date: '2026-12-20',
      time: '11:00',
      now: IN_SEASON,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/pileta/i);
    const staff = validateMemberBooking({
      facility: anhelo,
      member: guest(),
      date: '2026-12-20',
      time: '11:00',
      now: IN_SEASON,
      asAdmin: true,
    });
    expect(staff.ok).toBe(true);
    const socio = validateMemberBooking({
      facility: anhelo,
      member: familiar({ outstandingBalance: 0 }),
      date: '2026-12-20',
      time: '11:00',
      now: IN_SEASON,
    });
    expect(socio.ok).toBe(true);
  });

  it('en temporada la mora de cuota no le cierra la puerta', () => {
    const entry = clubEntryGate(guest({ outstandingBalance: 70000 }), { today: IN_SEASON });
    expect(entry.blocked).toBe(false);
    expect(entry.season.mora).toBe(false);
    const socio = clubEntryGate(familiar(), { today: IN_SEASON });
    expect(socio.blocked).toBe(true);
    expect(socio.season.inSeason).toBe(true);
  });

  it('el canon de pileta sigue siendo el de temporada, no la cuota', () => {
    const quote = quotePersonPoolSeason(guest(), { today: IN_SEASON, accesses: [] });
    expect(quote.pays).toBe(true);
    expect(quote.amount).toBe(90000);
    expect(quote.amount).not.toBe(70000);
  });

  it('Colonia se abre como no socio y no usa la tarifa del socio', () => {
    expect(coloniaPortalMemberKind(guest())).toBe('no_socio');
    expect(coloniaPortalMemberKind(familiar())).toBe('socio');
    const check = validatePortalEnrollmentWizard({
      step: 10,
      student: pupil,
      guardian,
      planKey: 'cuota',
      season: COLONIA_SEASON_2026_2027,
      todayIso: '2026-11-25',
      authorized: true,
    });
    expect(check.ok).toBe(true);
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student: { ...pupil, memberKind: coloniaPortalMemberKind(guest()) },
      guardian,
      planKey: 'cuota',
      memberId: guest().id,
    });
    expect(payload.student.member_kind).toBe('no_socio');
    expect(payload.student.member_number).toBeNull();
    expect(payload.memberId).toBe(guest().id);

    for (const plan of ['cuota', 'temporada', 'promo_2', 'promo_3']) {
      const external = quoteColoniaEnrollmentDue({
        planKey: plan,
        memberKind: 'no_socio',
        tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
        paidOn: '2026-11-05',
        season: COLONIA_SEASON_2026_2027,
      });
      const member = quoteColoniaEnrollmentDue({
        planKey: plan,
        memberKind: 'socio',
        tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
        paidOn: '2026-11-05',
        season: COLONIA_SEASON_2026_2027,
      });
      expect(external.planCapital).toBe(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', plan));
      expect(external.planCapital).toBeGreaterThan(member.planCapital);
      expect(external.inscription).toBe(member.inscription);
    }
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota')).toBe(180000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota')).toBe(150000);
  });

  it('sigue siendo no socio aunque esté de baja o también tenga abono de tenis', () => {
    const baja = guest({ status: 'baja', outstandingBalance: 40000 });
    expect(isPoolGuestMember(baja)).toBe(true);
    expect(canChargeSocialDues(baja)).toBe(false);
    expect(duesCollectionGate(baja, { amount: 40000, paidOn: TODAY, adelanto: true }).blocked).toBe(true);
    const withTennis = guest({ cuotaCategories: ['PILETA (No socio)', 'ABONO TENIS'] });
    expect(isPoolGuestMember(withTennis)).toBe(true);
    expect(canChargeSocialDues(withTennis)).toBe(false);
    expect(duesAmountForMember(withTennis, TODAY, { chargeScope: 'social' })).toBe(0);
  });

  it('si ya pagó la temporada, el canon de hoy es cero', () => {
    const quote = quotePersonPoolSeason(guest(), {
      today: IN_SEASON,
      accesses: [{
        date: '2026-12-01',
        kind: 'member',
        memberId: '88001',
        status: 'active',
        payment: { amount: 90000, scope: 'season', concept: 'Canon pileta temporada' },
      }],
    });
    expect(quote.alreadyPaid).toBe(true);
    expect(quote.amount).toBe(0);
  });

  it('la liquidación de cuotas no lo mete en el pack', () => {
    const lines = feePackLinesFromMembers([
      guest(),
      familiar({ outstandingBalance: 0 }),
      { memberId: '3', status: 'active', cuotaCategories: ['LIGA (No socio)'] },
    ], TODAY);
    expect(lines.map((row) => row.tierId)).toEqual(['socio_familiar']);
  });
});
