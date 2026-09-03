/** Helpers de ledger Accessin para saldos y listados de caja. */

import {
  ACCESSIN_CASH_AS_OF,
  ACCESSIN_CASH_MOVEMENTS,
  ACCESSIN_CASH_REGISTERS,
  ACCESSIN_CASH_SNAPSHOT,
} from '../../data/seed/accessinCashMovements';
import {
  ACCESSIN_CHEQUES,
  ACCESSIN_CHEQUES_AS_OF,
  ACCESSIN_CHEQUES_SNAPSHOT,
} from '../../data/seed/accessinCheques';

export {
  ACCESSIN_CASH_AS_OF,
  ACCESSIN_CASH_MOVEMENTS,
  ACCESSIN_CASH_REGISTERS,
  ACCESSIN_CASH_SNAPSHOT,
  ACCESSIN_CHEQUES,
  ACCESSIN_CHEQUES_AS_OF,
  ACCESSIN_CHEQUES_SNAPSHOT,
};

export function formatAccessinCashDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y || !m || !d) return isoDate;
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  const mi = Number(m) - 1;
  return `${Number(d)} de ${months[mi] || m} del ${y}`;
}

export function recalculateAccessinCashTotal(snapshot = ACCESSIN_CASH_SNAPSHOT, movements = ACCESSIN_CASH_MOVEMENTS) {
  const opening = Number(snapshot?.openingBalance) || 0;
  const inflow = (movements || []).reduce((sum, m) => {
    const amt = Number(m.amount) || 0;
    if (m.movementType === 'expense' || m.movementType === 'transfer_out') return sum - amt;
    return sum + amt;
  }, 0);
  return Math.round((opening + inflow) * 100) / 100;
}

export function accessinChequesTotal(cheques = ACCESSIN_CHEQUES) {
  return Math.round(
    (cheques || [])
      .filter((c) => c.status === 'in_portfolio')
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0) * 100
  ) / 100;
}

export function filterAccessinCheques(cheques = [], filter = {}) {
  const { status = 'in_portfolio', query = '' } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(cheques || [])];
  if (status && status !== 'all') {
    rows = rows.filter((c) => c.status === status);
  }
  if (q) {
    rows = rows.filter((c) => {
      const hay = [
        c.accessinId,
        c.checkNumber,
        c.bankName,
        c.bankBranch,
        c.drawer,
        c.deliveredBy,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  return rows.sort((a, b) => String(b.enteredAt || '').localeCompare(String(a.enteredAt || '')));
}

export function accessinCashBalanceCards(
  snapshot = ACCESSIN_CASH_SNAPSHOT,
  movements = ACCESSIN_CASH_MOVEMENTS,
  cheques = ACCESSIN_CHEQUES,
  bankAccounts = null,
) {
  const periodFrom = snapshot?.periodFrom;
  const periodTo = snapshot?.periodTo;
  const periodCaption = periodFrom && periodTo
    ? `Ingresos ${formatAccessinCashDate(periodFrom)} → ${formatAccessinCashDate(periodTo)}`
    : 'Ingresos del período';

  const cashInflow = Number(snapshot?.cards?.efectivo?.periodInflow);
  const bankInflow = Number(snapshot?.cards?.bancos?.periodInflow);
  const efectivoValue = Number.isFinite(cashInflow)
    ? cashInflow
    : (movements || []).filter((m) => m.walletKind === 'cash').reduce((s, m) => s + (Number(m.amount) || 0), 0);

  const activeBanks = (bankAccounts || []).filter((a) => a && a.isActive !== false);
  const banksBalanceSum = activeBanks.length
    ? Math.round(activeBanks.reduce((s, a) => s + (Number(a.balance) || 0), 0) * 100) / 100
    : null;
  const bancosValue = banksBalanceSum != null
    ? banksBalanceSum
    : (Number.isFinite(bankInflow)
      ? bankInflow
      : (movements || []).filter((m) => m.walletKind === 'bank').reduce((s, m) => s + (Number(m.amount) || 0), 0));
  const bancosCaption = banksBalanceSum != null
    ? `Saldo cuentas al ${formatAccessinCashDate(snapshot?.asOf || ACCESSIN_CASH_AS_OF)}`
    : periodCaption;

  // Preferir saldo explícito del Excel; si no, recalcular apertura + movimientos.
  const totalValue = snapshot?.cards?.total?.balance != null
    ? Number(snapshot.cards.total.balance)
    : recalculateAccessinCashTotal(snapshot, movements);
  const chequesValue = accessinChequesTotal(cheques);

  return [
    {
      id: 'efectivo',
      label: 'Efectivo',
      value: efectivoValue,
      caption: periodCaption,
      actionLabel: 'Ver registro de efectivo',
      filter: { view: 'efectivo_registro', walletKind: 'cash' },
      icon: 'cash',
    },
    {
      id: 'cheques',
      label: 'Cheques en Cartera',
      value: chequesValue,
      caption: `Cartera al ${formatAccessinCashDate(ACCESSIN_CHEQUES_AS_OF)}`,
      actionLabel: 'Ver cheques',
      filter: { view: 'cheques' },
      icon: 'checks',
      muted: chequesValue === 0,
    },
    {
      id: 'bancos',
      label: 'Cuentas Bancarias',
      value: bancosValue,
      caption: bancosCaption,
      actionLabel: 'Ver cuentas bancarias',
      filter: { view: 'bank_accounts', walletKind: 'bank' },
      currencyHint: 'ARS',
      icon: 'bank',
    },
    {
      id: 'total',
      label: 'Total Caja',
      value: totalValue,
      caption: `Saldo Accessin al ${formatAccessinCashDate(snapshot?.asOf || ACCESSIN_CASH_AS_OF)}`,
      actionLabel: null,
      filter: null,
      emphasize: true,
      icon: 'total',
    },
  ];
}

export function filterAccessinCashMovements(movements = [], filter = {}) {
  const {
    walletKind = null,
    walletId = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(movements || [])];
  if (walletKind) rows = rows.filter((m) => m.walletKind === walletKind);
  if (walletId) rows = rows.filter((m) => m.walletId === walletId);
  if (q) {
    rows = rows.filter((m) => {
      const hay = [
        m.accessinId,
        m.typeLabel,
        m.description,
        m.memberNumber,
        m.memberName,
        m.familyGroup,
        m.walletName,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d) return d;
    return (Number(b.accessinId) || 0) - (Number(a.accessinId) || 0);
  });
  if (limit != null && limit >= 0) return rows.slice(0, limit);
  return rows;
}

/** Enriquece movimientos con nombre de socio desde el padrón local. */
export function enrichCashMovementsWithMembers(movements = [], members = []) {
  if (!members?.length) return movements;
  const byNumber = new Map();
  members.forEach((m) => {
    const num = String(m.memberId || m.member_number || '').replace(/\D/g, '');
    if (num) byNumber.set(num, m.name || m.full_name || '');
  });
  return movements.map((row) => {
    const num = String(row.memberNumber || row.description || '').replace(/\D/g, '');
    const name = num ? byNumber.get(num) : '';
    if (!name) return row;
    return {
      ...row,
      memberName: name,
      familyGroup: row.familyGroup || (num ? `G-F ${num}` : ''),
    };
  });
}
