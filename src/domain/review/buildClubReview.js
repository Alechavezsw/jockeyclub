import { isBalanced, normalizeLines } from '../accounting/journal';
import { getConcessionExpiryStatus } from '../concessions/concessions';
import { selectMembersForInterest } from '../accounting/interestGenerators';
import {
  familyPrincipalOf,
  isFamilyDependent,
  isLiveMember,
  isTitularMember,
  listFamilyGroups,
  memberNumberOf,
  normalizePersonName,
  buildPadronHouseholdStats,
} from '../members/households';
import { uniqueBajas } from '../members/membershipMoves';
import { memberHasPortalAccess } from '../members/memberAdminActions';
import { latestMemberPaymentDate } from '../accounting/currentAccountBalances';
import { MAILBOX } from '../messaging/messages';
import { getMedicalStatus, listDayAccesses } from '../pool/poolAccess';

export const REVIEW_TIERS = [
  { id: 'contabilidad', label: 'Contabilidad', tone: 'urgent' },
  { id: 'vence', label: 'Plata que vence', tone: 'watch' },
  { id: 'conteo', label: 'El número', tone: 'urgent' },
  { id: 'ficha', label: 'Ficha', tone: 'watch' },
  { id: 'puerta', label: 'Puerta de hoy', tone: 'watch' },
  { id: 'cierre', label: 'Cierre del mes', tone: 'watch' },
  { id: 'nota', label: 'Para leer', tone: 'note' },
];

const TIER_TONE = Object.fromEntries(REVIEW_TIERS.map((t) => [t.id, t.tone]));

function isoOf(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addIsoDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + days, 12));
}

function ageOn(birth, todayIso) {
  const b = String(birth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [y, m, d] = b.split('-').map(Number);
  const [ty, tm, td] = todayIso.split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

function docDigits(member) {
  return String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
}

function personName(member) {
  return String(member?.name || member?.full_name || '').trim();
}

function isLive(member) {
  return isLiveMember(member);
}

function isPosted(entry) {
  const status = entry?.status;
  if (!status) return true;
  return status !== 'void' && status !== 'draft' && status !== 'cancelled';
}

function hasCategory(member) {
  const tier = String(member?.tier || member?.tierId || '').trim();
  return Boolean(tier) && tier !== 'sin_categoria';
}

function wantsAutomaticDebit(member) {
  const raw = String(member?.paymentMethod || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return raw === 'debito' || raw === 'debito_automatico' || raw === 'debito automatico';
}

function mpAdhesionStatus(member) {
  return String(member?.mpAdhesion || member?.mercadoPagoAdhesion || '')
    .toLowerCase()
    .trim();
}

function isMpAdhered(member) {
  const status = mpAdhesionStatus(member);
  return status === 'authorized' || status === 'active' || status === 'adherido';
}

function numberKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

function usableEmail(...values) {
  return values.some((value) => {
    const email = String(value || '').trim();
    return email.includes('@') && email.length >= 6;
  });
}

function memberCanBeReached(member) {
  return usableEmail(
    member?.email,
    member?.societasEmail,
    member?.meta?.email,
    member?.meta?.societasEmail,
  );
}

function memberHasClubAccess(member) {
  return memberHasPortalAccess(member);
}

function messageDay(message) {
  const raw = String(message?.createdAt || message?.date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function isMpPaymentNotice(message) {
  const method = String(message?.meta?.method || '').toLowerCase();
  const kind = String(message?.meta?.kind || '');
  return method === 'mercadopago' && (kind === 'dues_payment' || kind === 'booking_payment');
}

function labelOf(member) {
  const id = memberNumberOf(member);
  const name = personName(member) || 'Sin nombre';
  return id ? `${name} · Nº ${id}` : name;
}

function asSample(label, href = null) {
  return { label: String(label || ''), href: href || null };
}

function memberHref(member) {
  const id = memberNumberOf(member) || member?.memberId;
  return id ? `/panel/members/${encodeURIComponent(id)}?editar=1` : null;
}

function memberSample(member) {
  return asSample(labelOf(member), memberHref(member));
}

function birthIso(member) {
  const raw = String(member?.birthDate || member?.birth_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

/** Misma persona en más de una credencial: DNI, o nombre con la misma fecha, o nombre sin otro DNI. */
function duplicateFichaGroups(list) {
  const people = [];
  const indexById = new Map();
  for (const member of list) {
    const id = memberNumberOf(member);
    if (!id || indexById.has(id)) continue;
    indexById.set(id, people.length);
    people.push(member);
  }
  const parent = people.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    return cursor;
  };
  const uniteIds = (ids) => {
    const indexes = [...new Set(ids)].map((id) => indexById.get(id)).filter((index) => index != null);
    for (let i = 1; i < indexes.length; i += 1) {
      const left = find(indexes[0]);
      const right = find(indexes[i]);
      if (left !== right) parent[right] = left;
    }
  };

  const byDni = new Map();
  const byBirth = new Map();
  const byName = new Map();
  for (const member of people) {
    const id = memberNumberOf(member);
    const doc = docDigits(member);
    if (doc.length >= 7) {
      if (!byDni.has(doc)) byDni.set(doc, []);
      byDni.get(doc).push(id);
    }
    const name = normalizePersonName(personName(member));
    if (name.length < 8) continue;
    const birth = birthIso(member);
    if (birth) {
      const key = `${name}|${birth}`;
      if (!byBirth.has(key)) byBirth.set(key, []);
      byBirth.get(key).push(id);
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(member);
  }
  for (const ids of byDni.values()) uniteIds(ids);
  for (const ids of byBirth.values()) uniteIds(ids);
  for (const members of byName.values()) uniteIds(members.map(memberNumberOf));

  const buckets = new Map();
  for (let index = 0; index < people.length; index += 1) {
    const root = find(index);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(people[index]);
  }
  return [...buckets.values()]
    .filter((members) => new Set(members.map(memberNumberOf)).size > 1 && members.some(isLive))
    .sort((a, b) => personName(a.find(isLive) || a[0]).localeCompare(personName(b.find(isLive) || b[0]), 'es'));
}

function duplicateReason(members) {
  const dnis = new Set(members.map(docDigits).filter((doc) => doc.length >= 7));
  if (dnis.size === 1) return 'mismo DNI';
  const births = new Set(members.map(birthIso).filter(Boolean));
  const names = new Set(members.map((member) => normalizePersonName(personName(member))));
  if (names.size === 1 && births.size === 1) return 'mismo nombre y fecha de nacimiento';
  if (dnis.size >= 2) return 'mismo nombre, documentos distintos';
  return 'mismo nombre';
}

function duplicateSample(members) {
  const lead = members.find(isLive) || members[0];
  const numbers = [...new Set(members.map(memberNumberOf))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const listed = numbers.length === 2
    ? `Nº ${numbers[0]} y Nº ${numbers[1]}`
    : numbers.map((id) => `Nº ${id}`).join(', ');
  return asSample(
    `${personName(lead) || 'Sin nombre'} · ${listed} · ${duplicateReason(members)}`,
    memberHref(lead),
  );
}

function take(rows, toSample) {
  return (rows || []).map((row) => {
    const out = toSample(row);
    if (out && typeof out === 'object' && 'label' in out) return out;
    return asSample(out);
  });
}

function row(items, spec) {
  if (!spec || !spec.count) return;
  const tier = spec.tier;
  items.push({
    id: spec.id,
    tier,
    tone: TIER_TONE[tier] || 'watch',
    title: spec.title,
    detail: spec.detail,
    why: spec.why,
    tab: spec.tab,
    focus: spec.focus || null,
    count: spec.count,
    samples: spec.samples || [],
  });
}

function guessMember(text, members) {
  const folded = normalizePersonName(text);
  const digits = String(text || '').replace(/\D/g, '');
  const hits = [];
  for (const member of members) {
    const id = memberNumberOf(member);
    if (id && id.length >= 3 && digits.includes(id)) {
      hits.push(member);
      continue;
    }
    const parts = normalizePersonName(personName(member)).split(' ').filter((p) => p.length >= 4);
    if (parts.length >= 2 && parts.every((p) => folded.includes(p))) hits.push(member);
  }
  const seen = new Set();
  const unique = [];
  for (const member of hits) {
    const key = memberNumberOf(member) || personName(member);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Cola de revisión del club. Orden fija: plata, número, ficha, puerta, cierre, nota.
 * No modifica datos: cada fila es algo para abrir.
 */
export function buildClubReview({
  members = [],
  journalEntries = [],
  chartOfAccounts = [],
  unidentifiedCollections = [],
  cheques = [],
  concessions = [],
  suppliers = [],
  retenciones = [],
  discounts = [],
  reservations = [],
  poolAccesses = [],
  entryLogs = [],
  cashSessions = [],
  interestGenerators = [],
  interestRuns = [],
  bajas = [],
  expenses = [],
  paymentOrders = [],
  galiciaDebits = [],
  feePeriods = [],
  membershipApplications = [],
  claims = [],
  messages = [],
  accountBalances = null,
  feeChargedNumbers = [],
  accountLedgers = null,
  today = new Date(),
  loading = false,
} = {}) {
  const todayIso = isoOf(today);
  const soonIso = addIsoDays(todayIso, 7);
  const month = todayIso.slice(0, 7);
  const items = [];
  const stained = new Set();
  const stain = (member) => {
    const id = memberNumberOf(member);
    if (id) stained.add(id);
  };

  const list = Array.isArray(members) ? members : [];
  const byNumber = new Map();
  for (const member of list) {
    const id = memberNumberOf(member);
    if (id && !byNumber.has(id)) byNumber.set(id, member);
  }
  const findMember = (memberId) => {
    const key = memberNumberOf({ memberId }) || String(memberId || '');
    return byNumber.get(key) || list.find((member) => String(member.memberId) === String(memberId)) || null;
  };
  const live = list.filter(isLive);
  const groups = listFamilyGroups(list);

  const unbalanced = (journalEntries || []).filter((entry) => {
    if (!isPosted(entry)) return false;
    const lines = normalizeLines(entry.lines || [], chartOfAccounts);
    return lines.length >= 2 && !isBalanced(lines);
  });
  row(items, {
    id: 'journal-unbalanced',
    tier: 'contabilidad',
    count: unbalanced.length,
    title: unbalanced.length === 1
      ? '1 asiento con el debe distinto del haber'
      : `${unbalanced.length} asientos con el debe distinto del haber`,
    detail: 'El libro no cierra mientras estos asientos sigan así.',
    why: 'Primero, porque es plata.',
    tab: 'accounting',
    focus: 'diary',
    samples: take(unbalanced, (entry) => asSample(
      entry.description || entry.concept || entry.date || 'Asiento',
      '/panel/accounting?sub=diary',
    )),
  });

  const pendingPay = (unidentifiedCollections || [])
    .filter((item) => item.status === 'pending')
    .toSorted((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  row(items, {
    id: 'unidentified',
    tier: 'contabilidad',
    count: pendingPay.length,
    title: pendingPay.length === 1
      ? '1 cobranza sin identificar'
      : `${pendingPay.length} cobranzas sin identificar`,
    detail: 'Siguen fuera de la cuenta de un socio.',
    why: 'La más vieja va primero.',
    tab: 'accounting',
    focus: 'unidentified',
    samples: take(pendingPay, (item) => {
      const guess = guessMember(`${item.note || ''} ${item.originLabel || ''} ${item.bankRef || ''}`, list);
      const base = `${item.date || 'sin fecha'} · ${item.originLabel || item.bankRef || 'cobranza'}`;
      return asSample(
        guess ? `${base} · parece ${labelOf(guess)}` : base,
        guess ? memberHref(guess) : '/panel/accounting?sub=unidentified',
      );
    }),
  });

  const balanceBook = accountBalances?.byNumber || null;
  const balanceAsOf = String(accountBalances?.asOf || '').slice(0, 10);
  const balanceGap = balanceBook ? live.filter((member) => {
    const key = numberKey(memberNumberOf(member));
    if (!key) return false;
    if (member.outstandingBalance == null || member.outstandingBalance === '') return false;
    const hit = balanceBook[key] || balanceBook[String(memberNumberOf(member) || '')];
    if (!hit || hit.balance == null || hit.balance === '') return false;
    const ficha = Number(member.outstandingBalance);
    const book = Number(hit.balance);
    if (!Number.isFinite(ficha) || !Number.isFinite(book)) return false;
    if (Math.abs(ficha - book) <= 0.5) return false;
    const paid = latestMemberPaymentDate(member);
    return !(paid && balanceAsOf && paid > balanceAsOf);
  }) : [];
  row(items, {
    id: 'balance-gap',
    tier: 'contabilidad',
    count: balanceGap.length,
    title: balanceGap.length === 1
      ? '1 saldo de socio no coincide con la cuenta corriente'
      : `${balanceGap.length} saldos de socio no coinciden con la cuenta corriente`,
    detail: 'La ficha dice una cifra y el libro otra, y no hay un cobro posterior que lo explique.',
    why: 'Hasta mirarlo, no se sabe cuál de las dos cifras es la deuda.',
    tab: 'accounting',
    focus: 'balances',
    samples: take(balanceGap, (member) => {
      const key = numberKey(memberNumberOf(member));
      const hit = balanceBook[key] || balanceBook[String(memberNumberOf(member) || '')];
      return asSample(
        `${labelOf(member)} · ficha ${Number(member.outstandingBalance)} / cuenta ${Number(hit?.balance)}`,
        memberHref(member),
      );
    }),
  });

  const ledgersLoaded = accountLedgers && Number.isFinite(Number(accountLedgers.loaded))
    ? Number(accountLedgers.loaded)
    : null;
  row(items, {
    id: 'ledgers-missing',
    tier: 'contabilidad',
    count: ledgersLoaded === 0 ? 1 : 0,
    title: 'El resumen de cuenta todavía no abre los movimientos',
    detail: 'El saldo de cada socio está en Saldos. El detalle del extracto no.',
    why: 'Jev solo avisa. No los carga.',
    tab: 'jev',
    samples: [asSample('Abrir el resumen de cuenta', '/panel/dues?vista=saldos')],
  });

  const mpNotices = (messages || []).filter((message) => (
    message.recipientId === MAILBOX.OPERATIONS
    && !message.isRead
    && isMpPaymentNotice(message)
  ));
  row(items, {
    id: 'mp-notice',
    tier: 'contabilidad',
    count: mpNotices.length,
    title: mpNotices.length === 1
      ? '1 aviso de Mercado Pago sin imputar'
      : `${mpNotices.length} avisos de Mercado Pago sin imputar`,
    detail: 'El socio generó el QR y el pago no quedó cargado en la cuota.',
    why: 'Esa plata puede haber entrado y la deuda sigue igual.',
    tab: 'dues',
    samples: take(mpNotices, (message) => {
      const member = findMember(message.senderId);
      return asSample(
        message.sender || message.subject || 'Mercado Pago',
        member ? memberHref(member) : '/panel/dues',
      );
    }),
  });

  const badJournalDates = (journalEntries || []).filter((entry) => {
    if (!isPosted(entry)) return false;
    const date = String(entry.date || entry.entry_date || '').slice(0, 10);
    return !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayIso;
  });
  row(items, {
    id: 'journal-date',
    tier: 'contabilidad',
    count: badJournalDates.length,
    title: badJournalDates.length === 1
      ? '1 asiento sin fecha o con fecha futura'
      : `${badJournalDates.length} asientos sin fecha o con fecha futura`,
    detail: 'El libro diario no puede ordenarlos.',
    why: 'Una fecha mal puesta desordena el mes.',
    tab: 'accounting',
    focus: 'diary',
    samples: take(badJournalDates, (entry) => asSample(
      entry.description || entry.concept || 'Asiento',
      '/panel/accounting?sub=diary',
    )),
  });

  const pendingExpenses = (expenses || []).filter((expense) => (
    expense.status === 'pending_approval' || expense.status === 'draft'
  ));
  row(items, {
    id: 'expenses-pending',
    tier: 'contabilidad',
    count: pendingExpenses.length,
    title: pendingExpenses.length === 1
      ? '1 gasto sin aprobar'
      : `${pendingExpenses.length} gastos sin aprobar`,
    detail: 'Siguen en borrador o esperando aprobación.',
    why: 'No entran al libro hasta que alguien los aprueba.',
    tab: 'accounting',
    focus: 'expenses',
    samples: take(pendingExpenses, (expense) => asSample(
      expense.concept || expense.vendorName || 'Gasto',
      '/panel/accounting?sub=expenses',
    )),
  });

  const openOrders = (paymentOrders || []).filter((order) => (
    order.orderKind === 'member'
    && !order.deletedAt
    && (order.status === 'pending' || order.status === 'processing')
  ));
  row(items, {
    id: 'payment-orders-open',
    tier: 'contabilidad',
    count: openOrders.length,
    title: openOrders.length === 1
      ? '1 orden de pago sin imputar'
      : `${openOrders.length} órdenes de pago sin imputar`,
    detail: 'El cobro del socio todavía está pendiente o en proceso.',
    why: 'Hasta que se impute, la cuota sigue impaga.',
    tab: 'accounting',
    focus: 'payment_orders',
    samples: take(openOrders, (order) => asSample(
      order.responsible || order.memberNumber || 'Orden de pago',
      '/panel/accounting?sub=payment_orders',
    )),
  });
  const overdueCheques = (cheques || []).filter((c) => (
    c.status === 'in_portfolio' && c.dueAt && String(c.dueAt).slice(0, 10) < todayIso
  ));
  const soonCheques = (cheques || []).filter((c) => {
    const due = String(c.dueAt || '').slice(0, 10);
    return c.status === 'in_portfolio' && due >= todayIso && due <= soonIso;
  });
  row(items, {
    id: 'cheques-overdue',
    tier: 'vence',
    count: overdueCheques.length,
    title: overdueCheques.length === 1 ? '1 cheque vencido en cartera' : `${overdueCheques.length} cheques vencidos en cartera`,
    detail: 'Siguen en cartera con la fecha de pago pasada.',
    why: 'Cobrar o depositar antes de mirar los que todavía vencen.',
    tab: 'accounting',
    focus: 'cash',
    samples: take(overdueCheques, (c) => asSample(
      `${c.checkNumber || c.drawer || 'Cheque'} · ${String(c.dueAt).slice(0, 10)}`,
      '/panel/accounting?sub=cash',
    )),
  });
  row(items, {
    id: 'cheques-soon',
    tier: 'vence',
    count: soonCheques.length,
    title: soonCheques.length === 1 ? '1 cheque vence en 7 días' : `${soonCheques.length} cheques vencen en 7 días`,
    detail: 'Están en cartera y la fecha cae esta semana.',
    why: 'Después de los ya vencidos.',
    tab: 'accounting',
    focus: 'cash',
    samples: take(soonCheques, (c) => asSample(
      `${c.checkNumber || c.drawer || 'Cheque'} · ${String(c.dueAt).slice(0, 10)}`,
      '/panel/accounting?sub=cash',
    )),
  });

  const undatedCheques = (cheques || []).filter((c) => c.status === 'in_portfolio' && !c.dueAt);
  row(items, {
    id: 'cheques-undated',
    tier: 'vence',
    count: undatedCheques.length,
    title: undatedCheques.length === 1
      ? '1 cheque en cartera sin fecha de pago'
      : `${undatedCheques.length} cheques en cartera sin fecha de pago`,
    detail: 'No se puede saber si ya vencieron.',
    why: 'Sin fecha quedan fuera del orden de cobro.',
    tab: 'accounting',
    focus: 'cash',
    samples: take(undatedCheques, (c) => asSample(
      c.checkNumber || c.drawer || 'Cheque',
      '/panel/accounting?sub=cash',
    )),
  });

  const concessionRows = (concessions || []).map((c) => ({
    concession: c,
    expiry: getConcessionExpiryStatus(c, { today }),
  }));
  const expiredConc = concessionRows.filter((r) => r.expiry.status === 'expired');
  const expiringConc = concessionRows.filter((r) => r.expiry.status === 'expiring');
  row(items, {
    id: 'concessions-expired',
    tier: 'vence',
    count: expiredConc.length,
    title: expiredConc.length === 1 ? '1 concesión vencida' : `${expiredConc.length} concesiones vencidas`,
    detail: 'El contrato o el canon ya pasó la fecha.',
    why: 'El canon vencido no entra solo.',
    tab: 'concessions',
    samples: take(expiredConc, (r) => asSample(
      r.concession.name || r.concession.concessionaire || 'Concesión',
      r.concession.id ? `/concesiones?id=${encodeURIComponent(r.concession.id)}` : '/concesiones',
    )),
  });
  row(items, {
    id: 'concessions-expiring',
    tier: 'vence',
    count: expiringConc.length,
    title: expiringConc.length === 1 ? '1 concesión por vencer' : `${expiringConc.length} concesiones por vencer`,
    detail: 'Entran en el aviso de renovación.',
    why: 'Después de las ya vencidas.',
    tab: 'concessions',
    samples: take(expiringConc, (r) => asSample(
      r.concession.name || 'Concesión',
      r.concession.id ? `/concesiones?id=${encodeURIComponent(r.concession.id)}` : '/concesiones',
    )),
  });

  const suppliersNoCuit = (suppliers || []).filter((s) => (
    s.status !== 'inactive' && String(s.cuit || '').replace(/\D/g, '').length < 11
  ));
  row(items, {
    id: 'suppliers-cuit',
    tier: 'vence',
    count: suppliersNoCuit.length,
    title: suppliersNoCuit.length === 1 ? '1 proveedor sin CUIT' : `${suppliersNoCuit.length} proveedores sin CUIT`,
    detail: 'Sin CUIT no se puede cerrar la retención ni el SIAP.',
    why: 'El dato fiscal falta en la ficha del proveedor.',
    tab: 'accounting',
    focus: 'suppliers',
    samples: take(suppliersNoCuit, (s) => asSample(
      s.legalName || s.tradeName || 'Proveedor',
      s.id ? `/panel/accounting?sub=suppliers&supplier=${encodeURIComponent(s.id)}` : '/panel/accounting?sub=suppliers',
    )),
  });

  const supplierByName = new Map();
  for (const supplier of suppliers || []) {
    const key = normalizePersonName(supplier.legalName || supplier.tradeName);
    if (key) supplierByName.set(key, supplier);
  }
  const retencionesSinCuit = (retenciones || []).filter((ret) => {
    if (ret.status === 'void') return false;
    const key = normalizePersonName(ret.supplierName || ret.clientName);
    const supplier = key ? supplierByName.get(key) : null;
    if (!supplier) return false;
    return String(supplier.cuit || '').replace(/\D/g, '').length < 11;
  });
  row(items, {
    id: 'retenciones-cuit',
    tier: 'vence',
    count: retencionesSinCuit.length,
    title: retencionesSinCuit.length === 1
      ? '1 retención de un proveedor sin CUIT'
      : `${retencionesSinCuit.length} retenciones de proveedores sin CUIT`,
    detail: 'La retención está cargada y el CUIT del proveedor no.',
    why: 'El SIAP las va a rechazar.',
    tab: 'accounting',
    focus: 'retenciones',
    samples: take(retencionesSinCuit, (r) => {
      const key = normalizePersonName(r.supplierName || r.clientName);
      const supplier = key ? supplierByName.get(key) : null;
      return asSample(
        r.supplierName || r.clientName || 'Retención',
        supplier?.id
          ? `/panel/accounting?sub=suppliers&supplier=${encodeURIComponent(supplier.id)}`
          : '/panel/accounting?sub=retenciones',
      );
    }),
  });

  const pendingAdhesion = live.filter((member) => (
    wantsAutomaticDebit(member) && !isMpAdhered(member) && mpAdhesionStatus(member) !== 'rejected'
  ));
  row(items, {
    id: 'mp-adhesion',
    tier: 'vence',
    count: pendingAdhesion.length,
    title: pendingAdhesion.length === 1
      ? '1 socio con débito automático sin adhesión a Mercado Pago'
      : `${pendingAdhesion.length} socios con débito automático sin adhesión a Mercado Pago`,
    detail: 'Pidieron el débito y Mercado Pago todavía no los tiene adheridos.',
    why: 'Sin adhesión, esa cuota no se cobra sola.',
    tab: 'members',
    samples: take(pendingAdhesion, memberSample),
  });

  const rejectedDebits = (galiciaDebits || []).filter((debit) => debit.status === 'rejected');
  const rejectedAdhesion = live.filter((member) => mpAdhesionStatus(member) === 'rejected');
  const rejectedCount = rejectedDebits.length + rejectedAdhesion.length;
  row(items, {
    id: 'mp-rejected',
    tier: 'vence',
    count: rejectedCount,
    title: rejectedCount === 1
      ? '1 cobro de Mercado Pago rechazado'
      : `${rejectedCount} cobros de Mercado Pago rechazados`,
    detail: 'El débito no entró. Hay que volver a pasarlo por Mercado Pago.',
    why: 'Esa cuota sigue sin entrar.',
    tab: 'accounting',
    focus: 'galicia',
    samples: [
      ...take(rejectedDebits, (debit) => asSample(
        debit.memberName || debit.memberId || 'Débito',
        debit.memberId
          ? `/panel/members/${encodeURIComponent(debit.memberId)}?editar=1`
          : '/panel/accounting?sub=galicia',
      )),
      ...take(rejectedAdhesion, memberSample),
    ],
  });

  const noBirth = live.filter((member) => (
    isFamilyDependent(member) && ageOn(member.birthDate, todayIso) == null
  ));
  row(items, {
    id: 'no-birth',
    tier: 'conteo',
    count: noBirth.length,
    title: noBirth.length === 1
      ? '1 familiar activo sin fecha de nacimiento'
      : `${noBirth.length} familiares activos sin fecha de nacimiento`,
    detail: 'Sin esa fecha no se puede saber si ya cumplió 26.',
    why: 'El número de socios queda a ciegas en ese grupo.',
    tab: 'members',
    samples: take(noBirth, memberSample),
  });

  const tooOld = live.filter((member) => (
    isFamilyDependent(member) && ageOn(member.birthDate, todayIso) >= 26
  ));
  tooOld.forEach(stain);
  row(items, {
    id: 'age-26',
    tier: 'conteo',
    count: tooOld.length,
    title: tooOld.length === 1
      ? '1 familiar activo ya cumplió 26'
      : `${tooOld.length} familiares activos ya cumplieron 26`,
    detail: 'Siguen en el padrón como grupo familiar.',
    why: 'Cambian el número de socios.',
    tab: 'members',
    samples: take(tooOld, memberSample),
  });

  const orphanGroups = groups.filter((group) => {
    if (!group.titular || isLive(group.titular)) return false;
    return group.members.some((person) => person.role !== 'titular' && isLive(person));
  });
  orphanGroups.forEach((group) => {
    group.members.forEach((person) => {
      if (person.role !== 'titular' && isLive(person) && person.memberId) {
        stained.add(String(person.memberId));
      }
    });
  });
  row(items, {
    id: 'titular-baja',
    tier: 'conteo',
    count: orphanGroups.length,
    title: orphanGroups.length === 1
      ? '1 grupo sigue activo con el titular de baja'
      : `${orphanGroups.length} grupos siguen activos con el titular de baja`,
    detail: 'Los integrantes cuentan y el titular ya no.',
    why: 'El hogar quedó abierto.',
    tab: 'members',
    samples: take(orphanGroups, (group) => {
      const liveMember = group.members.find((person) => person.role !== 'titular' && isLive(person));
      const target = liveMember || group.titular;
      return asSample(group.name || `Grupo ${group.id}`, memberHref(target));
    }),
  });

  const principalsByDoc = new Map();
  for (const member of live) {
    if (!isFamilyDependent(member)) continue;
    const doc = docDigits(member);
    if (doc.length < 7) continue;
    const principal = familyPrincipalOf(member);
    if (!principalsByDoc.has(doc)) principalsByDoc.set(doc, new Set());
    principalsByDoc.get(doc).add(principal);
  }
  const inTwoGroups = [];
  for (const [doc, principals] of principalsByDoc) {
    if (principals.size < 2) continue;
    const member = live.find((m) => docDigits(m) === doc);
    if (member) {
      inTwoGroups.push(member);
      stain(member);
    }
  }
  row(items, {
    id: 'two-groups',
    tier: 'conteo',
    count: inTwoGroups.length,
    title: inTwoGroups.length === 1
      ? '1 persona está en dos grupos'
      : `${inTwoGroups.length} personas están en dos grupos`,
    detail: 'El mismo DNI figura bajo dos titulares.',
    why: 'Se contaría dos veces.',
    tab: 'members',
    samples: take(inTwoGroups, memberSample),
  });

  const groupIds = new Set(groups.map((group) => String(group.id)));
  const orphanDiscounts = (discounts || []).filter((discount) => {
    if (discount.isActive === false || discount.category !== 'family') return false;
    const key = String(discount.familyGroup || '').replace(/\D/g, '');
    return key && !groupIds.has(key);
  });
  row(items, {
    id: 'discount-orphan',
    tier: 'conteo',
    count: orphanDiscounts.length,
    title: orphanDiscounts.length === 1
      ? '1 descuento de un grupo que ya no está'
      : `${orphanDiscounts.length} descuentos de grupos que ya no están`,
    detail: 'El descuento sigue activo y el grupo no.',
    why: 'Baja la cuota de alguien que no corresponde.',
    tab: 'accounting',
    focus: 'member_discounts',
    samples: take(orphanDiscounts, (d) => asSample(
      d.description || d.familyGroup || 'Descuento',
      '/panel/accounting?sub=member_discounts',
    )),
  });

  const expiredDiscounts = (discounts || []).filter((discount) => {
    if (discount.isActive === false) return false;
    const until = String(discount.validTo || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(until) && until < todayIso;
  });
  row(items, {
    id: 'discount-expired',
    tier: 'conteo',
    count: expiredDiscounts.length,
    title: expiredDiscounts.length === 1
      ? '1 descuento vencido que sigue activo'
      : `${expiredDiscounts.length} descuentos vencidos que siguen activos`,
    detail: 'La fecha de fin ya pasó y el descuento no se dio de baja.',
    why: 'Sigue bajando cuotas que ya no corresponden.',
    tab: 'accounting',
    focus: 'member_discounts',
    samples: take(expiredDiscounts, (discount) => asSample(
      discount.description || discount.familyGroup || 'Descuento',
      '/panel/accounting?sub=member_discounts',
    )),
  });

  const numberCounts = new Map();
  for (const member of list) {
    const id = memberNumberOf(member);
    if (!id) continue;
    numberCounts.set(id, (numberCounts.get(id) || 0) + 1);
  }
  const duplicateNumbers = list.filter((member) => {
    const id = memberNumberOf(member);
    return id && numberCounts.get(id) > 1;
  });
  duplicateNumbers.forEach(stain);
  const duplicateNumberIds = new Set(duplicateNumbers.map((member) => memberNumberOf(member)));
  row(items, {
    id: 'dup-number',
    tier: 'ficha',
    count: duplicateNumberIds.size,
    title: duplicateNumberIds.size === 1
      ? '1 número de socio repetido'
      : `${duplicateNumberIds.size} números de socio repetidos`,
    detail: 'Dos fichas comparten la misma credencial.',
    why: 'No se puede saber cuál es la buena.',
    tab: 'members',
    samples: take([...duplicateNumberIds], (id) => asSample(
      `Nº ${id}`,
      `/panel/members/${encodeURIComponent(id)}?editar=1`,
    )),
  });

  const duplicateGroups = duplicateFichaGroups(list);
  duplicateGroups.forEach((members) => members.forEach(stain));
  row(items, {
    id: 'dup-dni',
    tier: 'ficha',
    count: duplicateGroups.length,
    title: duplicateGroups.length === 1
      ? '1 ficha duplicada'
      : `${duplicateGroups.length} fichas duplicadas`,
    detail: 'La misma persona está en más de una credencial: mismo DNI, mismo nombre o misma fecha. También si los documentos no coinciden o una está de baja.',
    why: 'Hay que dejar una sola ficha.',
    tab: 'members',
    samples: duplicateGroups.map(duplicateSample),
  });

  const noCategory = live.filter((member) => !hasCategory(member));
  noCategory.forEach(stain);
  row(items, {
    id: 'no-category',
    tier: 'ficha',
    count: noCategory.length,
    title: noCategory.length === 1 ? '1 activo sin categoría' : `${noCategory.length} activos sin categoría`,
    detail: 'Sin categoría no hay cuota ni conteo por rubro.',
    why: 'La ficha no dice qué socio es.',
    tab: 'members',
    samples: take(noCategory, memberSample),
  });

  const noTitular = live.filter((member) => (
    isFamilyDependent(member) && !byNumber.has(familyPrincipalOf(member))
  ));
  noTitular.forEach(stain);
  row(items, {
    id: 'no-titular',
    tier: 'ficha',
    count: noTitular.length,
    title: noTitular.length === 1
      ? '1 familiar sin titular en el padrón'
      : `${noTitular.length} familiares sin titular en el padrón`,
    detail: 'El número de titular no existe.',
    why: 'El grupo no se puede armar.',
    tab: 'members',
    samples: take(noTitular, memberSample),
  });

  const noDoc = live.filter((member) => docDigits(member).length < 7);
  noDoc.forEach(stain);
  row(items, {
    id: 'no-dni',
    tier: 'ficha',
    count: noDoc.length,
    title: noDoc.length === 1 ? '1 activo sin DNI' : `${noDoc.length} activos sin DNI`,
    detail: 'Falta el documento o tiene menos de 7 dígitos.',
    why: 'Sin DNI no se puede cruzar la ficha.',
    tab: 'members',
    samples: take(noDoc, memberSample),
  });

  const noName = live.filter((member) => !personName(member));
  noName.forEach(stain);
  row(items, {
    id: 'no-name',
    tier: 'ficha',
    count: noName.length,
    title: noName.length === 1 ? '1 activo sin nombre' : `${noName.length} activos sin nombre`,
    detail: 'La ficha no tiene nombre.',
    why: 'No se puede atender ni contar con nombre.',
    tab: 'members',
    samples: take(noName, (member) => asSample(
      `Nº ${memberNumberOf(member) || 'sin número'}`,
      memberHref(member),
    )),
  });

  const emailCounts = new Map();
  for (const member of live) {
    const email = String(member.email || '').trim().toLowerCase();
    if (!email.includes('@') || email.length < 6) continue;
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }
  const duplicateEmails = live.filter((member) => {
    const email = String(member.email || '').trim().toLowerCase();
    return emailCounts.get(email) > 1;
  });
  duplicateEmails.forEach(stain);
  const duplicateEmailKeys = new Set(duplicateEmails.map((member) => String(member.email || '').trim().toLowerCase()));
  row(items, {
    id: 'dup-email',
    tier: 'ficha',
    count: duplicateEmailKeys.size,
    title: duplicateEmailKeys.size === 1
      ? '1 correo repetido entre activos'
      : `${duplicateEmailKeys.size} correos repetidos entre activos`,
    detail: 'Dos fichas activas comparten el mismo mail.',
    why: 'Los avisos y el portal pueden ir a la persona equivocada.',
    tab: 'members',
    samples: take(duplicateEmails, memberSample),
  });

  const portalWithoutEmail = live.filter((member) => (
    isTitularMember(member) && memberHasClubAccess(member) && !memberCanBeReached(member)
  ));
  portalWithoutEmail.forEach(stain);
  row(items, {
    id: 'portal-email',
    tier: 'ficha',
    count: portalWithoutEmail.length,
    title: portalWithoutEmail.length === 1
      ? '1 titular con portal y sin correo'
      : `${portalWithoutEmail.length} titulares con portal y sin correo`,
    detail: 'Entran al portal y no hay un mail para la cuota ni para Mercado Pago.',
    why: 'El aviso no tiene a dónde ir.',
    tab: 'members',
    samples: take(portalWithoutEmail, memberSample),
  });

  const noNumber = live.filter((member) => !memberNumberOf(member));
  row(items, {
    id: 'no-number',
    tier: 'ficha',
    count: noNumber.length,
    title: noNumber.length === 1 ? '1 activo sin número de socio' : `${noNumber.length} activos sin número de socio`,
    detail: 'La ficha no tiene credencial.',
    why: 'Sin número no entra en el conteo de socios bien.',
    tab: 'members',
    samples: take(noNumber, (member) => asSample(personName(member) || 'Sin nombre', memberHref(member))),
  });

  const pendingToday = (reservations || []).filter((res) => {
    const day = String(res.date || res.reservation_date || '').slice(0, 10);
    return day === todayIso && res.status === 'pending' && !res.occupancyOnly;
  });
  row(items, {
    id: 'booking-pending',
    tier: 'puerta',
    count: pendingToday.length,
    title: pendingToday.length === 1
      ? '1 turno de hoy sigue sin confirmar'
      : `${pendingToday.length} turnos de hoy siguen sin confirmar`,
    detail: 'La reserva está pedida y administración no la aceptó ni la rechazó.',
    why: 'Es la puerta de hoy.',
    tab: 'bookings',
    samples: take(pendingToday, (res) => {
      const member = findMember(res.memberId);
      return asSample(
        `${String(res.time || res.time_slot || '').slice(0, 5)} · ${personName(member) || res.memberName || 'Socio'}`,
        member ? memberHref(member) : '/panel/bookings',
      );
    }),
  });

  const badBookings = (reservations || []).filter((res) => {
    const day = String(res.date || res.reservation_date || '').slice(0, 10);
    if (day !== todayIso) return false;
    if (res.status === 'cancelled' || res.occupancyOnly) return false;
    const member = findMember(res.memberId);
    return member && !isLive(member);
  });
  row(items, {
    id: 'booking-closed',
    tier: 'puerta',
    count: badBookings.length,
    title: badBookings.length === 1
      ? '1 reserva de hoy es de un socio que no está activo'
      : `${badBookings.length} reservas de hoy son de socios que no están activos`,
    detail: 'El turno sigue y la ficha está de baja o suspendida.',
    why: 'Portería lo va a ver hoy.',
    tab: 'bookings',
    samples: take(badBookings, (res) => {
      const member = findMember(res.memberId);
      return asSample(
        `${String(res.time || res.time_slot || '').slice(0, 5)} · ${personName(member) || res.memberName || 'Socio'}`,
        member ? memberHref(member) : '/panel/bookings',
      );
    }),
  });

  const bookingHorizon = addIsoDays(todayIso, 14);
  const upcomingClosed = (reservations || []).filter((res) => {
    const day = String(res.date || res.reservation_date || '').slice(0, 10);
    if (!day || day <= todayIso || day > bookingHorizon) return false;
    if (res.status === 'cancelled' || res.occupancyOnly) return false;
    const member = findMember(res.memberId);
    return member && !isLive(member);
  });
  row(items, {
    id: 'booking-upcoming-closed',
    tier: 'puerta',
    count: upcomingClosed.length,
    title: upcomingClosed.length === 1
      ? '1 reserva de los próximos 14 días es de un socio que no está activo'
      : `${upcomingClosed.length} reservas de los próximos 14 días son de socios que no están activos`,
    detail: 'El turno todavía no es hoy, pero la ficha ya está de baja o suspendida.',
    why: 'Se puede cancelar antes de que llegue el día.',
    tab: 'bookings',
    samples: take(upcomingClosed, (res) => {
      const member = findMember(res.memberId);
      const day = String(res.date || res.reservation_date || '').slice(0, 10);
      return asSample(
        `${day} · ${personName(member) || res.memberName || 'Socio'}`,
        member ? memberHref(member) : '/panel/bookings',
      );
    }),
  });

  const poolToday = listDayAccesses(poolAccesses, todayIso).filter((access) => access.kind === 'member');
  const poolMedical = poolToday.filter((access) => {
    const member = findMember(access.memberId);
    if (!member) return false;
    return !getMedicalStatus(member, { today: todayIso }).ok;
  });
  row(items, {
    id: 'pool-medical',
    tier: 'puerta',
    count: poolMedical.length,
    title: poolMedical.length === 1
      ? '1 ingreso de pileta de hoy sin apto vigente'
      : `${poolMedical.length} ingresos de pileta de hoy sin apto vigente`,
    detail: 'Entró o está habilitado y la revisación no está vigente.',
    why: 'Es la puerta de hoy, no el padrón entero.',
    tab: 'pool',
    samples: take(poolMedical, (access) => {
      const member = findMember(access.memberId);
      return asSample(
        access.memberName || labelOf(member || {}),
        member ? memberHref(member) : '/panel/pool',
      );
    }),
  });

  const badEntries = (entryLogs || []).filter((log) => {
    if (String(log.date || '').slice(0, 10) !== todayIso) return false;
    if (log.status && log.status !== 'granted') return false;
    const member = findMember(log.memberId);
    return member && !isLive(member);
  });
  row(items, {
    id: 'gate-closed',
    tier: 'puerta',
    count: badEntries.length,
    title: badEntries.length === 1
      ? '1 ingreso de hoy es de un socio que no está activo'
      : `${badEntries.length} ingresos de hoy son de socios que no están activos`,
    detail: 'El molinete registró a alguien de baja o suspendido.',
    why: 'Conviene ver el registro antes de que cierre el día.',
    tab: 'access',
    samples: take(badEntries, (log) => {
      const member = findMember(log.memberId);
      return asSample(
        log.memberName || labelOf(member || {}),
        member ? memberHref(member) : '/panel/access',
      );
    }),
  });

  const openDiscrepancy = (cashSessions || []).filter((session) => session.status === 'discrepancy');
  row(items, {
    id: 'cash-discrepancy',
    tier: 'cierre',
    count: openDiscrepancy.length,
    title: openDiscrepancy.length === 1
      ? '1 arqueo con diferencia'
      : `${openDiscrepancy.length} arqueos con diferencia`,
    detail: 'Lo contado no coincide con lo registrado.',
    why: 'La caja del día no cierra.',
    tab: 'accounting',
    focus: 'cash',
    samples: take(openDiscrepancy, (session) => asSample(
      session.closedAt ? String(session.closedAt).slice(0, 10) : 'Arqueo',
      '/panel/accounting?sub=cash',
    )),
  });

  const interestPending = (interestGenerators || []).filter((generator) => {
    if (!generator.isActive || generator.period !== 'monthly') return false;
    if (selectMembersForInterest(list, generator).length === 0) return false;
    return !(interestRuns || []).some((run) => (
      run.generatorId === generator.id
      && run.status === 'completed'
      && String(run.imputationDate || '').startsWith(month)
    ));
  });
  row(items, {
    id: 'interest-month',
    tier: 'cierre',
    count: interestPending.length,
    title: interestPending.length === 1
      ? '1 interés del mes sin generar'
      : `${interestPending.length} intereses del mes sin generar`,
    detail: 'Hay socios por encima de la tolerancia y la corrida de este mes no está.',
    why: 'El cierre del mes queda incompleto.',
    tab: 'accounting',
    focus: 'interest_generators',
    samples: take(interestPending, (generator) => asSample(
      generator.identifier || 'Interés',
      '/panel/accounting?sub=interest_generators',
    )),
  });

  const staleOpenSessions = (cashSessions || []).filter((session) => {
    if (session.status !== 'open') return false;
    const opened = String(session.openedAt || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(opened) && opened < todayIso;
  });
  row(items, {
    id: 'cash-still-open',
    tier: 'cierre',
    count: staleOpenSessions.length,
    title: staleOpenSessions.length === 1
      ? '1 caja sigue abierta de un día anterior'
      : `${staleOpenSessions.length} cajas siguen abiertas de un día anterior`,
    detail: 'El arqueo de ese día no se cerró.',
    why: 'El cierre de caja queda colgado.',
    tab: 'accounting',
    focus: 'cash',
    samples: take(staleOpenSessions, (session) => asSample(
      String(session.openedAt).slice(0, 10),
      '/panel/accounting?sub=cash',
    )),
  });

  const [periodYear, periodMonth] = month.split('-').map(Number);
  const currentFeePeriod = (feePeriods || []).find((period) => (
    Number(period.year) === periodYear && Number(period.month) === periodMonth
  ));
  const feeMonthOpen = currentFeePeriod
    && currentFeePeriod.status !== 'processed'
    && currentFeePeriod.status !== 'cancelled';
  row(items, {
    id: 'fee-month',
    tier: 'cierre',
    count: feeMonthOpen ? 1 : 0,
    title: 'Las cuotas de este mes no están liquidadas',
    detail: 'El período del mes sigue pendiente.',
    why: 'Sin liquidar, el padrón activo no tiene la cuota del mes.',
    tab: 'dues',
    samples: feeMonthOpen
      ? [asSample(`${periodMonth}/${periodYear}`, '/panel/dues')]
      : [],
  });

  const chargedKeys = new Set((feeChargedNumbers || []).map(numberKey).filter(Boolean));
  const feeClosed = currentFeePeriod && currentFeePeriod.status === 'processed' && chargedKeys.size > 0;
  const titularesToCharge = feeClosed
    ? live.filter((member) => isTitularMember(member) && numberKey(memberNumberOf(member)))
    : [];
  const missingFee = titularesToCharge.filter((member) => !chargedKeys.has(numberKey(memberNumberOf(member))));
  const feeGapTooWide = chargedKeys.size >= 50
    && missingFee.length > Math.max(20, Math.round(titularesToCharge.length * 0.05));
  const feeMissing = feeGapTooWide ? [] : missingFee;
  row(items, {
    id: 'fee-missing',
    tier: 'cierre',
    count: feeMissing.length,
    title: feeMissing.length === 1
      ? '1 titular activo no está en la liquidación de este mes'
      : `${feeMissing.length} titulares activos no están en la liquidación de este mes`,
    detail: 'El mes figura liquidado y a estos socios no les salió la cuota.',
    why: 'El cierre del mes quedó incompleto para esa ficha.',
    tab: 'dues',
    samples: take(feeMissing, memberSample),
  });

  const unclearPays = pendingPay.filter((item) => (
    !guessMember(`${item.note || ''} ${item.originLabel || ''} ${item.bankRef || ''}`, list)
  ));
  row(items, {
    id: 'unidentified-unclear',
    tier: 'nota',
    count: unclearPays.length,
    title: unclearPays.length === 1
      ? '1 cobranza sin un socio claro'
      : `${unclearPays.length} cobranzas sin un socio claro`,
    detail: 'El texto no nombra a un solo socio.',
    why: 'Hay que leerla. No se asigna sola.',
    tab: 'accounting',
    focus: 'unidentified',
    samples: take(unclearPays, (item) => asSample(
      item.note || item.originLabel || item.bankRef || 'Sin nota',
      '/panel/accounting?sub=unidentified',
    )),
  });

  const otrasBajas = uniqueBajas(bajas).filter((baja) => baja.kind === 'otro');
  row(items, {
    id: 'bajas-otro',
    tier: 'nota',
    count: otrasBajas.length,
    title: otrasBajas.length === 1
      ? '1 baja con un motivo que no se pudo clasificar'
      : `${otrasBajas.length} bajas con un motivo que no se pudo clasificar`,
    detail: 'La nota no dice mora, licencia, renuncia ni grupo.',
    why: 'Queda para que alguien la lea.',
    tab: 'members',
    samples: take(otrasBajas, (baja) => asSample(
      `${baja.name || baja.memberId || 'Socio'} · ${baja.motivo || 'sin motivo'}`,
      baja.memberId ? `/panel/members/${encodeURIComponent(baja.memberId)}?editar=1` : '/panel/members',
    )),
  });

  const pendingJoins = (membershipApplications || []).filter((application) => application.status === 'pending');
  row(items, {
    id: 'join-pending',
    tier: 'nota',
    count: pendingJoins.length,
    title: pendingJoins.length === 1
      ? '1 solicitud de alta sin resolver'
      : `${pendingJoins.length} solicitudes de alta sin resolver`,
    detail: 'Alguien pidió asociarse y la ficha no se cerró.',
    why: 'Hasta resolverla, no entra en el número de socios.',
    tab: 'members',
    samples: take(pendingJoins, (application) => asSample(
      application.fullName || application.name || 'Solicitud',
      '/panel/members',
    )),
  });

  const weekAgo = addIsoDays(todayIso, -7);
  const oldClaims = (claims || []).filter((claim) => {
    if (claim.status === 'resolved') return false;
    const date = String(claim.date || claim.createdAt || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= weekAgo;
  });
  row(items, {
    id: 'claims-old',
    tier: 'nota',
    count: oldClaims.length,
    title: oldClaims.length === 1
      ? '1 reclamo lleva más de 7 días abierto'
      : `${oldClaims.length} reclamos llevan más de 7 días abiertos`,
    detail: 'Siguen pendientes o en curso.',
    why: 'Lo viejo sube en la lista para que no quede tapado.',
    tab: 'claims',
    samples: take(oldClaims, (claim) => asSample(
      claim.title || claim.memberName || 'Reclamo',
      '/panel/claims',
    )),
  });

  const replyRoots = new Set(
    (messages || [])
      .map((message) => message.parentId)
      .filter(Boolean)
      .map((id) => String(id)),
  );
  const staleSince = addIsoDays(todayIso, -2);
  const staleInbox = (messages || []).filter((message) => {
    if (message.recipientId !== MAILBOX.OPERATIONS || message.isRead) return false;
    if (isMpPaymentNotice(message)) return false;
    if (replyRoots.has(String(message.id))) return false;
    const day = messageDay(message);
    return Boolean(day) && day <= staleSince;
  });
  row(items, {
    id: 'inbox-stale',
    tier: 'nota',
    count: staleInbox.length,
    title: staleInbox.length === 1
      ? '1 mensaje a administración lleva más de 2 días sin respuesta'
      : `${staleInbox.length} mensajes a administración llevan más de 2 días sin respuesta`,
    detail: 'Siguen sin leer y nadie contestó el hilo.',
    why: 'El buzón no se ordena solo.',
    tab: 'messaging',
    samples: take(staleInbox, (message) => asSample(
      `${message.sender || 'Socio'} · ${message.subject || 'Mensaje'}`,
      '/panel/messaging',
    )),
  });

  const household = buildPadronHouseholdStats(list);
  const bien = loading ? 0 : live.filter((member) => {
    const id = memberNumberOf(member);
    if (!id) return false;
    return !stained.has(id);
  }).length;

  return {
    today: todayIso,
    counts: {
      ready: !loading,
      bien,
      activos: household.titularesActivos + household.integrantesActivos,
      titulares: household.titularesActivos,
      grupos: household.gruposFamiliares,
      integrantes: household.integrantesActivos,
      fichas: Math.max(0, live.length - bien),
    },
    items,
  };
}

export function reviewItemsForAccess(items = [], { tabs = [], concessions = false } = {}) {
  const allowed = new Set(tabs || []);
  return (items || []).filter((item) => {
    if (item.tab === 'concessions') return concessions || allowed.has('concessions');
    if (!item.tab) return true;
    return allowed.has(item.tab);
  });
}
