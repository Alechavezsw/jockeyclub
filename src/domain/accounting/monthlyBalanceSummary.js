/** Balance mensual resumido Accessin / LILA. */

import { readSnapshot } from '../../data/snapshots';
import { monthlyBalanceCards, findMonthlyBalanceSection } from './monthlyBalance';

const EMPTY_SUMMARY_SEED = Object.freeze({
  ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF: '',
  ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS: [],
  ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT: {},
});

/** Snapshot `accessinMonthlyBalanceSummary`; vacío hasta que carga. */
export function monthlyBalanceSummarySeed() {
  return readSnapshot('accessinMonthlyBalanceSummary', EMPTY_SUMMARY_SEED);
}

export function monthlyBalanceSummaryCards(
  snapshot = monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SNAPSHOT,
) {
  const cards = monthlyBalanceCards(snapshot);
  return {
    ...cards,
    asOf: cards.asOf || monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_AS_OF,
    summarized: true,
  };
}

export function findMonthlyBalanceSummarySection(
  sections = monthlyBalanceSummarySeed().ACCESSIN_MONTHLY_BALANCE_SUMMARY_SECTIONS,
  id,
) {
  return findMonthlyBalanceSection(sections, id);
}
