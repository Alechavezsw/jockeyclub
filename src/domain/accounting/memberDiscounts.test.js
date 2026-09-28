import { beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshots } from '../../data/snapshots';
import {
  formatMemberDiscountRange,
  listMemberDiscounts,
  memberDiscountsSeed,
  memberDiscountsSummary,
} from './memberDiscounts';

let ACCESSIN_MEMBER_DISCOUNTS;
let ACCESSIN_MEMBER_DISCOUNTS_AS_OF;
let ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT;

beforeAll(async () => {
  await loadSnapshots(['accessinMemberDiscounts']);
  ({
    ACCESSIN_MEMBER_DISCOUNTS,
    ACCESSIN_MEMBER_DISCOUNTS_AS_OF,
    ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT,
  } = memberDiscountsSeed());
});

describe('memberDiscounts', () => {
  it('carga el corte LILA de descuentos extras', () => {
    expect(ACCESSIN_MEMBER_DISCOUNTS_AS_OF).toBe('2026-09-26');
    expect(ACCESSIN_MEMBER_DISCOUNTS.length).toBe(16);
    expect(ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT.activeCount).toBe(14);
    expect(ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT.expiredCount).toBe(2);
    expect(ACCESSIN_MEMBER_DISCOUNTS_SNAPSHOT.asOfLabel).toMatch(/26 de Septiembre del 2026/);
  });

  it('filtra vigentes, vencidos y por socio', () => {
    const summary = memberDiscountsSummary();
    expect(listMemberDiscounts({ status: 'active' })).toHaveLength(summary.activeCount);
    expect(listMemberDiscounts({ status: 'expired' })).toHaveLength(2);
    expect(listMemberDiscounts({ query: '9216' })[0]?.memberName).toMatch(/Puyg/i);
    expect(listMemberDiscounts({ scope: 'fee_category' }).every((r) => r.scope === 'fee_category')).toBe(true);
  });

  it('convierte la vigencia de Excel', () => {
    const puyg = ACCESSIN_MEMBER_DISCOUNTS.find((r) => r.memberNumber === '9216');
    expect(puyg?.validTo).toBe('2027-04-30');
    expect(puyg?.isActive).toBe(true);
    expect(formatMemberDiscountRange(puyg)).toMatch(/2027/);
  });
});
