/**
 * No socio de Colonia al entrar a la app.
 * Ve inicio, cuenta, Colonia y novedades, con la tarifa de no socio.
 * No cobra cuota social y no reserva instalaciones.
 */
import { describe, expect, it } from 'vitest';
import { navItemsForRole } from '../auth/roles';
import { feePackLinesFromMembers } from '../accounting/feeBilling';
import { clubEntryGate } from '../pool/seasonDuesGate';
import { validateMemberBooking } from '../reservations/bookingRules';
import { FACILITIES, getFacilityById } from '../reservations/facilities';
import { buildFacilityCatalog } from '../reservations/facilityConfig';
import {
  canChargeSocialDues,
  collectionPeriodChoices,
  dbMemberIsDuesExempt,
  duesAmountForMember,
  isColoniaGuestMember,
  isDuesExemptMember,
  isPoolGuestMember,
  quotaHeadline,
} from '../members/dues';
import { duesCollectionGate } from '../members/memberPayments';
import { deriveMemberTier, slugifyTierId } from '../members/tiers';
import { COLONIA_SEASON_2026_2027 } from './coloniaConstants';
import { quoteColoniaEnrollmentDue } from './coloniaLate';
import {
  buildMemberColoniaHome,
  buildPortalEnrollmentPayload,
  coloniaPortalMemberKind,
  validatePortalEnrollmentWizard,
} from './coloniaPortal';
import { COLONIA_OFFICIAL_TARIFFS_2026_2027, planAmountFor } from './coloniaTariffs';

const TODAY = new Date('2026-11-26T12:00:00-03:00');
const IN_SEASON = new Date('2026-12-15T12:00:00-03:00');
const anhelo = getFacilityById('salon_anhelo', buildFacilityCatalog(FACILITIES));

function guest(overrides = {}) {
  return {
    id: 'colonia-guest-1',
    memberId: '88002',
    name: 'Laura Díaz',
    status: 'active',
    tier: 'colonia_no_socio',
    cuotaCategories: ['COLONIA (No socio)'],
    outstandingBalance: 0,
    nextDueDate: '2026-12-10',
    email: 'laura@example.com',
    birthDate: '1988-08-08',
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
  fullName: 'Laura Díaz',
  phone: '2644220000',
  email: 'laura@example.com',
  documentNumber: '30999888',
  relationship: 'Madre',
  emergencyContact: 'Tía 2644330000',
  authorizedPickup: 'Tía',
};

const pupil = {
  fullName: 'Sofía Díaz',
  birthDate: '2015-02-02',
  documentNumber: '55222000',
  memberKind: 'no_socio',
  memberNumber: '',
  shirtSize: '10',
};

describe('el no socio de colonia entra a la app', () => {
  it('la categoría del padrón es COLONIA (No socio)', () => {
    expect(slugifyTierId('COLONIA (No socio)')).toBe('colonia_no_socio');
    expect(deriveMemberTier(['COLONIA (No socio)'])).toBe('colonia_no_socio');
    expect(isColoniaGuestMember(guest())).toBe(true);
    expect(isColoniaGuestMember(guest({ cuotaCategories: [], tier: 'colonia_no_socio' }))).toBe(true);
    expect(isPoolGuestMember(guest())).toBe(false);
  });

  it('un familiar, un liga o un no socio de pileta no se confunden con él', () => {
    expect(isColoniaGuestMember(familiar())).toBe(false);
    expect(isColoniaGuestMember(familiar({
      cuotaCategories: ['SOCIO FAMILIAR', 'COLONIA (No socio)'],
    }))).toBe(false);
    expect(coloniaPortalMemberKind(familiar({
      cuotaCategories: ['SOCIO FAMILIAR', 'COLONIA (No socio)'],
    }))).toBe('socio');
    expect(isColoniaGuestMember({
      tier: 'liga_no_socio',
      cuotaCategories: ['LIGA (No socio)'],
    })).toBe(false);
    expect(isColoniaGuestMember({
      tier: 'pileta_no_socio',
      cuotaCategories: ['PILETA (No socio)'],
    })).toBe(false);
    expect(isColoniaGuestMember(null)).toBe(false);
  });

  it('el menú es inicio, cuenta, Colonia y novedades', () => {
    expect(navItemsForRole('member', { activityGuest: true }).map((item) => item.id)).toEqual([
      'dashboard',
      'payments',
      'colonia',
      'news',
    ]);
    expect(navItemsForRole('member', {
      activityGuest: true,
      membersCanViewCurrentAccounts: false,
    }).map((item) => item.id)).toEqual(['dashboard', 'colonia', 'news']);
    expect(navItemsForRole('member').map((item) => item.id)).toContain('reservations');
  });

  it('la ficha dice Colonia y no inventa cuota social', () => {
    const headline = quotaHeadline(guest({ outstandingBalance: 180000 }));
    expect(headline.title).toBe('Colonia');
    expect(headline.hint).toMatch(/no socio de colonia/i);
    expect(headline.hint).toMatch(/sin cuota social/i);
    expect(isDuesExemptMember(guest())).toBe(true);
    expect(canChargeSocialDues(guest())).toBe(false);
    expect(duesAmountForMember(guest(), TODAY)).toBe(0);
    expect(collectionPeriodChoices(guest({ outstandingBalance: 180000 }), TODAY)).toEqual([]);
    expect(dbMemberIsDuesExempt('colonia_no_socio', {
      cuotaCategories: ['COLONIA (No socio)'],
    })).toBe(true);
    expect(dbMemberIsDuesExempt('colonia_no_socio', null)).toBe(true);
    expect(dbMemberIsDuesExempt('socio_familiar', {
      cuotaCategories: ['SOCIO FAMILIAR', 'COLONIA (No socio)'],
    })).toBe(false);
  });

  it('un saldo viejo no se cobra como cuota social', () => {
    const member = guest({ outstandingBalance: 180000 });
    const gate = duesCollectionGate(member, { amount: 180000, paidOn: TODAY, adelanto: true });
    expect(gate.blocked).toBe(true);
    expect(gate.theoretical).toBe(0);
    expect(gate.lines).toEqual([]);
    expect(gate.message).toMatch(/colonia/i);
    expect(gate.message).toMatch(/no abona cuota social/i);
    const socio = duesCollectionGate(familiar(), { amount: 70000, paidOn: IN_SEASON });
    expect(socio.blocked).toBe(false);
    expect(socio.theoretical).toBeGreaterThan(0);
  });

  it('no reserva instalaciones desde la app', () => {
    const denied = validateMemberBooking({
      facility: anhelo,
      member: guest(),
      date: '2026-12-20',
      time: '11:00',
      now: IN_SEASON,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/colonia/i);
    const staff = validateMemberBooking({
      facility: anhelo,
      member: guest(),
      date: '2026-12-20',
      time: '11:00',
      now: IN_SEASON,
      asAdmin: true,
    });
    expect(staff.ok).toBe(true);
  });

  it('la mora de cuota social no le cierra la puerta', () => {
    const entry = clubEntryGate(guest({ outstandingBalance: 180000 }), { today: IN_SEASON });
    expect(entry.blocked).toBe(false);
    expect(entry.season.mora).toBe(false);
    expect(clubEntryGate(familiar(), { today: IN_SEASON }).blocked).toBe(true);
  });

  it('Colonia usa la tarifa de no socio en todos los planes', () => {
    expect(coloniaPortalMemberKind(guest())).toBe('no_socio');
    expect(coloniaPortalMemberKind(familiar())).toBe('socio');
    const check = validatePortalEnrollmentWizard({
      step: 10,
      student: pupil,
      guardian,
      planKey: 'temporada',
      season: COLONIA_SEASON_2026_2027,
      todayIso: '2026-11-25',
      authorized: true,
    });
    expect(check.ok).toBe(true);
    const payload = buildPortalEnrollmentPayload({
      seasonId: 'season-1',
      student: { ...pupil, memberKind: coloniaPortalMemberKind(guest()) },
      guardian,
      planKey: 'temporada',
      memberId: guest().id,
    });
    expect(payload.student.member_kind).toBe('no_socio');
    expect(payload.student.member_number).toBeNull();
    expect(payload).not.toHaveProperty('outstanding_balance');

    for (const plan of ['cuota', 'temporada', 'promo_2', 'promo_3']) {
      const external = quoteColoniaEnrollmentDue({
        planKey: plan,
        memberKind: coloniaPortalMemberKind(guest()),
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
      expect(external.total).toBeGreaterThan(member.total);
    }
    const fourthExternal = quoteColoniaEnrollmentDue({
      planKey: 'hermano_4',
      memberKind: 'no_socio',
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-05',
      season: COLONIA_SEASON_2026_2027,
    });
    const fourthMember = quoteColoniaEnrollmentDue({
      planKey: 'hermano_4',
      memberKind: 'socio',
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      paidOn: '2026-11-05',
      season: COLONIA_SEASON_2026_2027,
    });
    expect(fourthExternal.planCapital).toBe(0);
    expect(fourthMember.planCapital).toBe(0);
    expect(fourthExternal.total).toBe(50000);
    expect(fourthMember.total).toBe(50000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota')).toBe(180000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'temporada')).toBe(490000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota')).toBe(150000);
    expect(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'temporada')).toBe(390000);
  });

  it('la cuenta de Colonia anuncia la cuota de no socio, no la del socio', () => {
    const home = buildMemberColoniaHome([
      {
        id: 'enr-1',
        status: 'confirmada',
        plan_key: 'cuota',
        student_name: 'Sofía Díaz',
        charges_total: 180000,
        payments_confirmed: 180000,
        student: { member_kind: 'no_socio', full_name: 'Sofía Díaz' },
      },
    ]);
    expect(home.dueTotal).toBe(0);
    expect(home.mine[0].nextAmount).toBe(180000);
    expect(home.mine[0].nextAmount).not.toBe(150000);
  });

  it('sigue siendo no socio aunque esté de baja', () => {
    const baja = guest({ status: 'baja', outstandingBalance: 180000 });
    expect(isColoniaGuestMember(baja)).toBe(true);
    expect(canChargeSocialDues(baja)).toBe(false);
    expect(coloniaPortalMemberKind(baja)).toBe('no_socio');
    expect(duesCollectionGate(baja, { amount: 150000, paidOn: TODAY }).message).toMatch(/colonia/i);
  });

  it('la liquidación de cuotas no lo mete en el pack', () => {
    const lines = feePackLinesFromMembers([
      guest(),
      familiar({ outstandingBalance: 0 }),
      { memberId: '9', status: 'active', cuotaCategories: ['KARATE (No socio)'] },
    ], TODAY);
    expect(lines.map((row) => row.tierId)).toEqual(['socio_familiar']);
    expect(lines.some((row) => /colonia/i.test(row.tierId))).toBe(false);
  });
});
