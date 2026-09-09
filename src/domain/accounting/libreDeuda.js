/** Certificado de libre deuda (Accessin / LILA · Contabilidad). */

import { ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF } from './currentAccountBalances';
import { currentAccountBalanceOf, lookupCurrentAccountBalance } from './currentAccountBalances';
import { lookupMonthlyDebt } from './monthlyDebts';
import { lookupDetailedCc } from './detailedCurrentAccounts';
import { familyBalanceForMember, formatSpanishLongDate } from './memberBalances';
import { memberNumberOf } from '../members/households';
import { getTierDisplayName } from '../members/tiers';

export const LIBRE_DEUDA_MODULE = 'contabilidad';
export const LIBRE_DEUDA_REPORT_TYPE = 'libre_deuda';

export const ACCOUNTING_REPORT_MODULES = {
  contabilidad: 'Contabilidad',
};

export const ACCOUNTING_REPORT_TYPES = {
  libre_deuda: 'Libre deuda',
};

const MONEY_FMT = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function padMember(n) {
  return String(n || '').replace(/\D/g, '') || '';
}

function formatMoney(n) {
  return `$ ${MONEY_FMT.format(Math.abs(Number(n) || 0))}`;
}

export function findMemberForLibreDeuda(members = [], raw) {
  const nro = padMember(raw);
  if (!nro) return null;
  return (members || []).find((m) => padMember(memberNumberOf(m) || m.memberId) === nro) || null;
}

export function validateLibreDeudaInput({ member, memberNumber } = {}) {
  const nro = padMember(memberNumber || memberNumberOf(member) || member?.memberId);
  if (!nro) {
    const err = new Error('Socio. Es obligatorio');
    err.code = 'SOCIO_REQUIRED';
    throw err;
  }
  return nro;
}

/**
 * Saldo del socio a la fecha de corte.
 * Si la fecha es posterior o igual al snapshot LILA, usa el saldo de CC.
 * Si es anterior, reconstruye con deuda mes a mes / CC detallada.
 */
export function balanceAsOf(member, asOf = '') {
  const nro = padMember(memberNumberOf(member) || member?.memberId);
  const cutoff = String(asOf || '').slice(0, 10);
  const seedAsOf = ACCESSIN_CURRENT_ACCOUNT_BALANCES_AS_OF;
  const month = cutoff.slice(0, 7);

  if (!cutoff || cutoff >= seedAsOf) {
    return currentAccountBalanceOf(member);
  }

  const monthly = lookupMonthlyDebt(nro);
  if (monthly?.months?.length) {
    const upTo = monthly.months.filter((row) => row.periodKey && row.periodKey <= month);
    if (upTo.length) return Number(upTo[upTo.length - 1].accumulated) || 0;
    return 0;
  }

  const detailed = lookupDetailedCc(nro);
  if (detailed?.lines?.length) {
    return detailed.lines
      .filter((line) => !line.feeDate || line.feeDate <= cutoff)
      .reduce((sum, line) => sum + (Number(line.owed) || 0), 0);
  }

  return currentAccountBalanceOf(member);
}

export function buildLibreDeudaCertificate(member, {
  asOf = new Date().toISOString().slice(0, 10),
  extraInfo = '',
  allMembers = [],
} = {}) {
  const memberNumber = validateLibreDeudaInput({ member });
  const cc = lookupCurrentAccountBalance(memberNumber);
  const monthly = lookupMonthlyDebt(memberNumber);
  const detailed = lookupDetailedCc(memberNumber);
  const individualBalance = balanceAsOf(member, asOf);
  const family = familyBalanceForMember(member, allMembers);
  const familyAmount = family.isTitular ? Number(family.amount) || 0 : null;
  const isClear = individualBalance <= 0 && (familyAmount == null || familyAmount <= 0);

  const extra = String(extraInfo || '').replace(/<[^>]+>/g, '').trim();
  const extraClause = extra ? ` ${extra}` : '';
  const asOfLabel = formatSpanishLongDate(asOf);
  const memberName = member.name || cc?.memberName || '—';
  const dni = member.documentNumber || member.dni || cc?.dni || '—';
  const tierLabel = getTierDisplayName(member.tier) || cc?.socialFee || '—';

  let statusSentence = isClear
    ? 'no registra deudas pendientes'
    : `registra un saldo deudor de ${formatMoney(individualBalance)}`;
  if (!isClear && family.isTitular && familyAmount > individualBalance) {
    statusSentence += ` (balance familiar ${formatMoney(familyAmount)})`;
  }

  const constancia = [
    `El Jockey Club San Juan deja constancia${extraClause} del mismo que ${memberName},`,
    `DNI ${dni}, socio Nº ${memberNumber}, categoría ${tierLabel},`,
    `${statusSentence} al ${asOfLabel}.`,
  ].join(' ');

  return {
    module: LIBRE_DEUDA_MODULE,
    reportType: LIBRE_DEUDA_REPORT_TYPE,
    memberNumber,
    memberName,
    dni,
    tierLabel,
    asOf,
    asOfLabel,
    extraInfo: extra,
    individualBalance,
    familyAmount,
    isTitular: Boolean(family.isTitular),
    isClear,
    statusLabel: isClear ? 'Libre de deuda' : 'Con saldo deudor',
    constancia,
    unpaidMonths: (monthly?.months || []).length,
    unpaidLines: (monthly?.lines || detailed?.lines || []).filter((l) => (Number(l.owed) || 0) > 0).length,
    clubName: 'JOCKEY CLUB SAN JUAN',
  };
}
