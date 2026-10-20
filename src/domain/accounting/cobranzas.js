/** Helpers de cobranzas Accessin/LILA. */

import { readSnapshot } from '../../data/snapshots';
import { formatAccessinCashDate } from './cashLedger';

const EMPTY_COBRANZAS_SEED = Object.freeze({
  ACCESSIN_COBRANZAS: [],
  ACCESSIN_COBRANZAS_AS_OF: '',
  ACCESSIN_COBRANZAS_METHOD_LABELS: {},
  ACCESSIN_COBRANZAS_SNAPSHOT: {},
});

/** Snapshot `accessinCobranzas`; vacío hasta que carga (ver data/snapshots). */
export function cobranzasSeed() {
  return readSnapshot('accessinCobranzas', EMPTY_COBRANZAS_SEED);
}

export function cobranzasTotal(items = cobranzasSeed().ACCESSIN_COBRANZAS) {
  return Math.round((items || []).reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
}

const MONTH_NAME_TO_NUM = {
  enero: 1, febrero: 2, marzo: 3, abril: 4,
  mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function extractPeriodFromConcept(concept) {
  if (!concept) return null;
  const match = concept.match(/(\w+)\s+(?:del?\s+)?(\d{4})/i);
  if (!match) return null;
  const monthName = match[1].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const month = MONTH_NAME_TO_NUM[monthName];
  if (!month) return null;
  return `${match[2]}-${String(month).padStart(2, '0')}`;
}

function classifyCuotaTiming(conceptPeriod, paymentMonth) {
  if (!conceptPeriod || !paymentMonth) return null;
  if (conceptPeriod === paymentMonth) return 'del_mes';
  if (conceptPeriod < paymentMonth) return 'atrasada';
  return 'adelantada';
}

function isPorteriaEstacionamiento(concept) {
  if (!concept) return false;
  const lower = concept.toLowerCase();
  return lower.includes('porter') || lower.includes('estacion') || lower.includes('cochera');
}

function isNonSocioMember(memberNumber) {
  if (!memberNumber) return true;
  return !/^\d+$/.test(String(memberNumber).trim());
}

export function cobranzasSummary(
  items = cobranzasSeed().ACCESSIN_COBRANZAS,
  snapshot = cobranzasSeed().ACCESSIN_COBRANZAS_SNAPSHOT,
) {
  const list = items || [];
  const byType = {};
  const byMethod = {};
  const round = (v) => Math.round(v * 100) / 100;

  let cuotasDelMes = 0;
  let cuotasAtrasadas = 0;
  let cuotasAdelantadas = 0;
  let cuotasSinClasificar = 0;
  let recargos = 0;
  let reservasEventos = 0;
  let varios = 0;
  let alquileresATerceros = 0;
  let porteriaEstacionamiento = 0;
  let totalSocios = 0;
  let totalNoSocios = 0;

  list.forEach((row) => {
    const t = String(row.type || '').trim() || 'Otros';
    const m = row.paymentMethod || 'otros';
    const amount = Number(row.amount) || 0;
    const concept = row.concept || '';
    const memberNum = row.memberNumber;
    const paymentDate = String(row.date || '').slice(0, 10);
    const paymentMonth = paymentDate ? paymentDate.slice(0, 7) : null;
    const isNonSocio = isNonSocioMember(memberNum);

    byType[t] = (byType[t] || 0) + amount;
    byMethod[m] = (byMethod[m] || 0) + amount;

    if (isNonSocio) {
      totalNoSocios += amount;
      alquileresATerceros += amount;
    } else {
      totalSocios += amount;

      if (t === 'Cuotas') {
        const conceptPeriod = extractPeriodFromConcept(concept);
        const timing = classifyCuotaTiming(conceptPeriod, paymentMonth);
        if (timing === 'del_mes') {
          cuotasDelMes += amount;
        } else if (timing === 'atrasada') {
          cuotasAtrasadas += amount;
        } else if (timing === 'adelantada') {
          cuotasAdelantadas += amount;
        } else {
          cuotasSinClasificar += amount;
        }
      } else if (t === 'Recargos') {
        recargos += amount;
      } else if (t === 'Eventos') {
        reservasEventos += amount;
      } else if (t === 'Varios') {
        if (isPorteriaEstacionamiento(concept)) {
          porteriaEstacionamiento += amount;
        } else {
          varios += amount;
        }
      }
    }
  });

  return {
    asOf: snapshot?.asOf || cobranzasSeed().ACCESSIN_COBRANZAS_AS_OF,
    periodFrom: snapshot?.periodFrom,
    periodTo: snapshot?.periodTo,
    count: list.length,
    totalAmount: cobranzasTotal(list),
    byType: Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, round(v)])
    ),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([k, v]) => [k, round(v)])
    ),
    cuotasDelMes: round(cuotasDelMes),
    cuotasAtrasadas: round(cuotasAtrasadas),
    cuotasAdelantadas: round(cuotasAdelantadas),
    cuotasSinClasificar: round(cuotasSinClasificar),
    recargos: round(recargos),
    reservasEventos: round(reservasEventos),
    varios: round(varios),
    alquileresATerceros: round(alquileresATerceros),
    porteriaEstacionamiento: round(porteriaEstacionamiento),
    totalSocios: round(totalSocios),
    totalNoSocios: round(totalNoSocios),
  };
}

export function cobranzasBalanceCards(
  items = cobranzasSeed().ACCESSIN_COBRANZAS,
  snapshot = cobranzasSeed().ACCESSIN_COBRANZAS_SNAPSHOT,
) {
  const summary = cobranzasSummary(items, snapshot);
  const typeCards = Object.entries(summary.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => ({
      id: `type-${type}`,
      label: type,
      value,
      caption: 'Incluido en el total cobrado',
      filter: { type },
    }));

  return [
    {
      id: 'total',
      label: 'Total cobrado',
      value: summary.totalAmount,
      caption: `${summary.count} líneas · ${formatAccessinCashDate(summary.periodFrom)} → ${formatAccessinCashDate(summary.periodTo)}`,
      emphasize: true,
      filter: null,
    },
    ...typeCards,
  ];
}

export function filterAccessinCobranzas(items = [], filter = {}) {
  const {
    type = null,
    paymentMethod = null,
    bankName = null,
    memberNumbers = null,
    monthKey = null,
    query = '',
    limit = null,
  } = filter || {};
  const q = String(query || '').trim().toLowerCase();
  let rows = [...(items || [])];
  if (type) rows = rows.filter((r) => (r.type || 'Otros') === type);
  if (paymentMethod) rows = rows.filter((r) => r.paymentMethod === paymentMethod);
  const month = String(monthKey || '').slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(month)) {
    rows = rows.filter((r) => String(r.date || '').slice(0, 7) === month);
  }
  if (bankName) rows = rows.filter((r) => r.bankName === bankName);
  if (memberNumbers?.length) {
    const keys = new Set(
      memberNumbers.map((n) => String(n || '').replace(/\D/g, '')).filter(Boolean)
    );
    rows = rows.filter((r) => keys.has(String(r.memberNumber || '').replace(/\D/g, '')));
  }
  if (q) {
    rows = rows.filter((r) => {
      const hay = [
        r.receiptId,
        r.memberNumber,
        r.memberName,
        r.firstName,
        r.lastName,
        r.documentNumber,
        r.concept,
        r.type,
        r.bankName,
        r.paymentMethodLabel,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }
  rows.sort((a, b) => {
    const d = String(b.date || '').localeCompare(String(a.date || ''));
    if (d) return d;
    return String(b.receiptId || '').localeCompare(String(a.receiptId || ''));
  });
  if (limit != null && limit >= 0) return rows.slice(0, limit);
  return rows;
}
