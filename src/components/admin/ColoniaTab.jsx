import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Baby,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileDown,
  Users,
  Wallet,
} from 'lucide-react';
import MercadoPagoCheckout from '../MercadoPagoCheckout';
import PaymentMethodTiles from '../PaymentMethodTiles';
import ColoniaPosFields from './ColoniaPosFields';
import { CLUB_BANK_ACCOUNTS } from '../../domain/members/clubBanks';
import { repos } from '../../data/bootstrap';
import { deliverableEmail } from '../../domain/messaging/clubNotice';
import { MAILBOX, createMessage } from '../../domain/messaging/messages';
import { toWhatsAppPhone } from '../../domain/members/dues';
import {
  familyPrincipalOf,
  isFamilyDependent,
  memberNumberOf,
  rankMemberSearchHit,
} from '../../domain/members/households';
import { filterOperationalSearchHits } from '../../domain/members/memberDuplicates';
import {
  clubMailMemberQuery,
  clubMailSearchMissMessage,
} from '../../domain/messaging/clubMailSearch';
import { isSupabaseConfigured } from '../../lib/supabase';
import { loadXlsx } from '../../lib/office';
import {
  COLONIA_ACTIVITY_KINDS,
  COLONIA_PLAN_KEYS,
  COLONIA_SECTIONS,
  COLONIA_SEASON_2026_2027,
  coloniaMethodLabel,
} from '../../domain/colonia/coloniaConstants';
import { ageYearsOn, validateColoniaAge } from '../../domain/colonia/coloniaAge';
import { validateEnrollmentDraft, enrollmentIdentityKey } from '../../domain/colonia/coloniaEnrollment';
import {
  COLONIA_OFFICIAL_TARIFFS_2026_2027,
  evaluatePromotionCharge,
  inscriptionAmount,
} from '../../domain/colonia/coloniaTariffs';
import {
  buildColoniaAccountRows,
  buildColoniaEnrollmentsCsv,
  buildColoniaMonthRows,
  buildColoniaReceipt,
  coloniaAccountMonths,
  coloniaAmountForPayScope,
  coloniaCollectableScopes,
  summarizeColoniaAccount,
} from '../../domain/colonia/coloniaLedger';
import { coloniaEnrollPayChoices, quoteColoniaEnrollmentDue, quoteColoniaOpenDue } from '../../domain/colonia/coloniaLate';
import {
  buildColoniaEnrollmentReceipt,
  buildColoniaPaidReceiptFromEnrollment,
  downloadColoniaEnrollmentReceipt,
} from '../../domain/colonia/coloniaReceipt';
import {
  buildColoniaPaymentDraft,
  coloniaEnrollPayReady,
  coloniaMethodUsesBank,
  coloniaMethodUsesCard,
  coloniaMethodUsesCash,
  quoteColoniaPos,
  splitColoniaPosMeta,
} from '../../domain/colonia/coloniaPayments';
import {
  canAccessColonia,
  canAttendColonia,
  canCollectColonia,
  canManageColoniaHealth,
  canViewColoniaFinance,
} from '../../domain/auth/roles';
import {
  coloniaOperationalStatus,
  coloniaSourceLabel,
  coloniaStatusLabel,
} from '../../domain/colonia/coloniaPortal';
import {
  COLONIA_ACCOUNT_HEADERS,
  COLONIA_REPORT_HEADERS,
  COLONIA_REPORT_SHEETS,
  coloniaAccountCells,
  coloniaAccountStatus,
  coloniaDayHeading,
  coloniaHasAllergy,
  coloniaPickup,
  coloniaReportCells,
  coloniaShirtTally,
  coloniaReportRows,
  coloniaSocioHits,
  enrollmentMatchesRoster,
  foldColoniaText,
  householdKids,
  householdSearchPool,
  isoBirth,
  memberKey,
  planChildSlots,
} from '../../domain/colonia/coloniaDesk';
import ColoniaCashPanel from '../erp/ColoniaCashPanel';

const EMPTY_PUPIL = {
  fullName: '',
  documentNumber: '',
  birthDate: '',
  memberNumber: '',
  shirtSize: '',
};

function money(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0);
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const EMPTY_STUDENT = {
  fullName: '',
  documentNumber: '',
  birthDate: '',
  memberKind: 'socio',
  memberNumber: '',
  shirtSize: '',
  notes: '',
};
const EMPTY_GUARDIAN = {
  fullName: '',
  documentNumber: '',
  relationship: 'Padre/Madre',
  phone: '',
  email: '',
  emergencyContact: '',
  authorizedPickup: '',
};

/**
 * Operación → Colonia. Módulo funcional; sin datos ficticios como estadísticas.
 */
function ColoniaDonut({ parts, total, label }) {
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let walked = 0;
  return (
    <figure className="colonia-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={label}>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e4efe8" strokeWidth="14" />
        {sum > 0 ? parts.map((part) => {
          const length = (part.value / sum) * circumference;
          const dash = `${length} ${circumference - length}`;
          const turn = (walked / sum) * 360 - 90;
          walked += part.value;
          if (!part.value) return null;
          return (
            <circle
              key={part.label}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={part.color}
              strokeWidth="14"
              strokeDasharray={dash}
              transform={`rotate(${turn} 60 60)`}
            />
          );
        }) : null}
        <text x="60" y="58" textAnchor="middle" className="colonia-donut-num">{total}</text>
        <text x="60" y="74" textAnchor="middle" className="colonia-donut-cap">inscriptos</text>
      </svg>
      <figcaption>
        {parts.map((part) => (
          <span key={part.label}>
            <i style={{ background: part.color }} />
            {part.label}
            <b>{part.value}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function ColoniaBars({ items }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="colonia-bars">
      {items.map((item) => (
        <div key={item.label} className="colonia-bar">
          <span>{item.label}</span>
          <div>
            <i style={{ width: `${Math.max(item.value ? 6 : 0, (item.value / max) * 100)}%`, background: item.color }} />
          </div>
          <b>{item.value}</b>
        </div>
      ))}
    </div>
  );
}

const COLONIA_PAGE_SIZE = 8;

const COLONIA_ROLL_STATUSES = Object.freeze([
  { id: 'presente', label: 'Presente' },
  { id: 'ausente', label: 'Ausente' },
  { id: 'justificada', label: 'Justificada' },
  { id: 'retiro_anticipado', label: 'Se retiró' },
]);

function rollStatusLabel(status) {
  return COLONIA_ROLL_STATUSES.find((item) => item.id === status)?.label || 'Sin marcar';
}

const COLONIA_AGE_BANDS = Object.freeze([
  { key: 'todos', label: 'Todos', match: () => true },
  { key: '3-5', label: '3 a 5', match: (age) => age >= 3 && age <= 5 },
  { key: '6-8', label: '6 a 8', match: (age) => age >= 6 && age <= 8 },
  { key: '9-11', label: '9 a 11', match: (age) => age >= 9 && age <= 11 },
  { key: '12-15', label: '12 a 15', match: (age) => age >= 12 && age <= 15 },
]);

function AllergyMark({ show }) {
  if (!show) return null;
  return <em className="colonia-allergy">Alergia</em>;
}

function PickupLines({ guardian }) {
  const pickup = coloniaPickup(guardian);
  return (
    <>
      <strong>{pickup.who || '—'}</strong>
      {pickup.phone ? <span className="muted">{pickup.phone}</span> : null}
    </>
  );
}

function ColoniaPager({ page, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / COLONIA_PAGE_SIZE));
  const safe = Math.min(Math.max(0, page), pages - 1);
  const from = total ? safe * COLONIA_PAGE_SIZE + 1 : 0;
  const to = total ? Math.min(total, (safe + 1) * COLONIA_PAGE_SIZE) : 0;
  return (
    <div className="dues-section-pager colonia-pager">
      <span className="dues-section-pager-meta">{total ? `${from}–${to} de ${total}` : '0'}</span>
      <div className="dues-section-pager-btns">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safe <= 0}
          onClick={() => onPage(safe - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="dues-section-pager-page">{safe + 1} / {pages}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={safe >= pages - 1}
          onClick={() => onPage(safe + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ColoniaPayDesk({
  method,
  onMethod,
  bankId,
  onBank,
  reference,
  onReference,
  disabled = false,
  notes = true,
  plans = [],
  amount = 0,
  posRef,
}) {
  return (
    <>
      <PaymentMethodTiles
        value={method}
        onChange={onMethod}
        disabled={disabled}
        ariaLabel="Método de pago de Colonia"
      />
      {notes && coloniaMethodUsesCash(method) ? (
        <p className="pool-pay-note">
          Confirme el cobro en efectivo. Se registrará en <strong>Caja General</strong>.
        </p>
      ) : null}
      {coloniaMethodUsesBank(method) ? (
        <>
          <label className="colonia-field"><span>Alias</span>
            <select value={bankId} onChange={(e) => onBank(e.target.value)} disabled={disabled}>
              {CLUB_BANK_ACCOUNTS.map((bank) => (
                <option key={bank.id} value={bank.id}>{bank.alias || bank.name}</option>
              ))}
            </select>
          </label>
          <label className="colonia-field"><span>Referencia</span>
            <input
              value={reference}
              onChange={(e) => onReference(e.target.value)}
              placeholder="Nº de operación"
              disabled={disabled}
            />
          </label>
        </>
      ) : null}
      {coloniaMethodUsesCard(method) ? (
        <ColoniaPosFields
          amount={amount}
          plans={plans}
          disabled={disabled}
          sessionRef={posRef}
        />
      ) : null}
    </>
  );
}

export default function ColoniaTab({
  roles = [],
  role,
  members = [],
  onlySection = '',
  onSendMessage,
  paymentPlans = [],
}) {
  const canOperate = canAccessColonia({ roles, role });
  const canCollect = canCollectColonia({ roles, role });
  const canAttend = canAttendColonia({ roles, role });
  const canFinance = canViewColoniaFinance({ roles, role });
  const canHealth = canManageColoniaHealth({ roles, role });
  const [section, setSection] = useState('hoy');
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);
  const [stats, setStats] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [selectedEnrollment, setSelectedEnrollment] = useState(null);
  const [charges, setCharges] = useState([]);
  const [payments, setPayments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activities, setActivities] = useState([]);
  const [siblingGroups, setSiblingGroups] = useState([]);
  const [seasonCharges, setSeasonCharges] = useState([]);
  const [seasonPayments, setSeasonPayments] = useState([]);
  const [accountMonth, setAccountMonth] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [reportSheet, setReportSheet] = useState('resumen');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [cloudReady, setCloudReady] = useState(true);

  const [student, setStudent] = useState(EMPTY_STUDENT);
  const [guardian, setGuardian] = useState(EMPTY_GUARDIAN);
  const [planKey, setPlanKey] = useState(COLONIA_PLAN_KEYS.cuota);
  const [payMethod, setPayMethod] = useState('efectivo');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [enrollPayMethod, setEnrollPayMethod] = useState('efectivo');
  /** todo | inscripcion | plan — cobro separable de inscripción y mes. */
  const [enrollPayScope, setEnrollPayScope] = useState('todo');
  const enrollPosRef = useRef(null);
  const payPosRef = useRef(null);
  const [enrollPayRef, setEnrollPayRef] = useState('');
  const [enrollBankId, setEnrollBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || 'macro');
  const [payBankId, setPayBankId] = useState(CLUB_BANK_ACCOUNTS[0]?.id || 'macro');
  const [enrollHold, setEnrollHold] = useState(null);
  const [attendanceDay, setAttendanceDay] = useState(todayIso());
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [todayFocus, setTodayFocus] = useState('todos');
  const [todayPage, setTodayPage] = useState(0);
  const [healthRows, setHealthRows] = useState([]);
  const [attendanceQuery, setAttendanceQuery] = useState('');
  const [attendancePage, setAttendancePage] = useState(0);
  const [attendanceBand, setAttendanceBand] = useState('todos');
  const [attendanceFocus, setAttendanceFocus] = useState('todos');
  const [attendanceSavingId, setAttendanceSavingId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [activityKind, setActivityKind] = useState('natacion');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDate, setActivityDate] = useState('');
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [healthNotes, setHealthNotes] = useState('');
  const [healthAllergies, setHealthAllergies] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberHits, setMemberHits] = useState([]);
  const [memberSearchBusy, setMemberSearchBusy] = useState(false);
  const [pickedMemberLabel, setPickedMemberLabel] = useState('');
  const [anchorMember, setAnchorMember] = useState(null);
  const [household, setHousehold] = useState([]);
  const [householdBusy, setHouseholdBusy] = useState(false);
  const [chosenKeys, setChosenKeys] = useState([]);
  const [extraStudents, setExtraStudents] = useState([]);
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterPage, setRosterPage] = useState(0);
  const [siblingPage, setSiblingPage] = useState(0);
  const [siblingQuery, setSiblingQuery] = useState('');
  const [slotQuery, setSlotQuery] = useState({});
  const [showFamilyPicker, setShowFamilyPicker] = useState(false);
  const [openPupil, setOpenPupil] = useState({});
  const guardianLockedRef = useRef(false);
  const membersRef = useRef(members);
  membersRef.current = members;

  const visibleSections = useMemo(
    () => COLONIA_SECTIONS.filter((item) => {
      if (['reportes', 'hermanos', 'cuenta'].includes(item.key)) return canFinance;
      if (item.key === 'inscripciones') return canOperate && canFinance;
      if (item.key === 'asistencia') return canAttend;
      return canOperate;
    }),
    [canFinance, canAttend, canOperate],
  );
  const activeSection = onlySection || (visibleSections.some((s) => s.key === section)
    ? section
    : (visibleSections[0]?.key || 'asistencia'));

  const season = useMemo(
    () => seasons.find((s) => s.id === seasonId) || null,
    [seasons, seasonId],
  );
  const seasonView = season || COLONIA_SEASON_2026_2027;

  const childSlots = planChildSlots(planKey);
  const extraCount = Math.max(Math.max(0, childSlots - 1), extraStudents.length);
  const rosterPreview = [
    student,
    ...Array.from({ length: extraCount }, (_, index) => extraStudents[index] || EMPTY_PUPIL),
  ];
  const filledSiblings = rosterPreview.filter((row) => row.fullName?.trim()).length;
  const householdChildren = household.filter((row) => isFamilyDependent(row)).length;
  const siblingCount = planKey === 'hermano_4'
    ? Math.max(householdChildren, filledSiblings)
    : (childSlots > 1 ? filledSiblings : 1);

  const draftValidation = useMemo(() => validateEnrollmentDraft({
    student,
    guardian,
    season: {
      ...COLONIA_SEASON_2026_2027,
      promotionPeriodicity: season?.promotion_periodicity ?? null,
      activitiesStartOn: season?.activities_start_on || COLONIA_SEASON_2026_2027.activitiesStartOn,
      ageMin: season?.age_min ?? 3,
      ageMax: season?.age_max ?? 15,
      enrollmentOpensOn: season?.enrollment_opens_on || COLONIA_SEASON_2026_2027.enrollmentOpensOn,
      enrollmentClosesOn: season?.enrollment_closes_on || COLONIA_SEASON_2026_2027.enrollmentClosesOn,
    },
    planKey,
    memberKind: student.memberKind,
    siblingCount,
    todayIso: todayIso(),
    existingKeys: enrollments.map((e) => enrollmentIdentityKey(e.student || e)).filter(Boolean),
  }), [student, guardian, planKey, season, enrollments, siblingCount]);

  const accountSummary = useMemo(
    () => summarizeColoniaAccount({ charges, payments }),
    [charges, payments],
  );
  const fichaScopes = useMemo(
    () => coloniaCollectableScopes({ charges, payments }),
    [charges, payments],
  );
  const fichaSocio = selectedEnrollment && selectedEnrollment.student?.member_kind !== 'no_socio'
    ? responsibleSocio(selectedEnrollment)
    : null;
  const openDue = useMemo(() => quoteColoniaOpenDue({
    charges,
    payments,
    paidOn: todayIso(),
    season: season || COLONIA_SEASON_2026_2027,
    planKey: selectedEnrollment?.plan_key || selectedEnrollment?.planKey,
  }), [charges, payments, season, selectedEnrollment]);
  const fichaDue = Math.max(0, (Number(accountSummary.balanceDue) || 0) - (Number(accountSummary.pendingConfirmation) || 0));
  const fichaInscriptionDue = Math.max(0, Number(fichaScopes.inscriptionOpen) || 0);
  const fichaPlanDue = Math.max(0, Number(fichaScopes.planOpen) || 0);
  const fichaLateInterest = openDue.late ? openDue.interest : 0;
  const fichaPayable = fichaDue + fichaLateInterest;
  const memberParsed = clubMailMemberQuery(memberQuery);
  const memberSearchReady = student.memberKind === 'socio' && (
    memberParsed.kind === 'number'
    || (memberParsed.kind === 'text' && memberParsed.text.length >= 2)
  );
  const inscriptionPrice = inscriptionAmount(COLONIA_OFFICIAL_TARIFFS_2026_2027);
  const pupilCount = rosterPreview.length;
  const enrollQuote = quoteColoniaEnrollmentDue({
    planKey,
    memberKind: student.memberKind,
    pupilCount,
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    paidOn: todayIso(),
    season: season || COLONIA_SEASON_2026_2027,
  });
  const rosterRows = useMemo(() => {
    const source = rosterQuery.trim()
      ? enrollments.filter((row) => enrollmentMatchesRoster(row, rosterQuery))
      : enrollments;
    return source.toSorted((a, b) => String(a.student?.full_name || '').localeCompare(String(b.student?.full_name || ''), 'es'));
  }, [enrollments, rosterQuery]);
  const rosterPages = Math.max(1, Math.ceil(rosterRows.length / COLONIA_PAGE_SIZE));
  const rosterPageSafe = Math.min(rosterPage, rosterPages - 1);
  const rosterSlice = rosterRows.slice(rosterPageSafe * COLONIA_PAGE_SIZE, rosterPageSafe * COLONIA_PAGE_SIZE + COLONIA_PAGE_SIZE);
  const siblingNeedle = siblingQuery.trim();
  const siblingTableRows = useMemo(() => {
    const folded = foldColoniaText(siblingNeedle);
    const groupById = new Map(siblingGroups.map((group) => [group.id, group]));
    const groupMatches = (group) => foldColoniaText(group?.label).includes(folded)
      || foldColoniaText(group?.promotion_plan).includes(folded);
    const used = new Set();
    const rows = [];
    const kids = siblingNeedle
      ? enrollments.filter((row) => enrollmentMatchesRoster(row, siblingQuery))
      : enrollments.filter((row) => groupById.has(row.sibling_group_id));
    kids
      .toSorted((a, b) => String(a.student?.full_name || '').localeCompare(String(b.student?.full_name || ''), 'es'))
      .forEach((row) => {
        const group = groupById.get(row.sibling_group_id) || null;
        if (group) used.add(group.id);
        rows.push({ id: `kid-${row.id}`, enrollment: row, group });
      });
    siblingGroups.forEach((group) => {
      if (used.has(group.id)) return;
      if (siblingNeedle && !groupMatches(group)) return;
      rows.push({ id: `group-${group.id}`, enrollment: null, group });
    });
    return rows;
  }, [enrollments, siblingGroups, siblingNeedle, siblingQuery]);
  const siblingPages = Math.max(1, Math.ceil(siblingTableRows.length / COLONIA_PAGE_SIZE));
  const siblingPageSafe = Math.min(siblingPage, siblingPages - 1);
  const siblingSlice = siblingTableRows.slice(
    siblingPageSafe * COLONIA_PAGE_SIZE,
    siblingPageSafe * COLONIA_PAGE_SIZE + COLONIA_PAGE_SIZE,
  );
  const accountRows = useMemo(() => buildColoniaAccountRows({
    enrollments,
    charges: seasonCharges,
    payments: seasonPayments,
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    periodicity: season?.promotion_periodicity || null,
  }), [enrollments, seasonCharges, seasonPayments, season?.promotion_periodicity]);
  const accountById = useMemo(
    () => new Map(accountRows.map((row) => [row.enrollment?.id, row])),
    [accountRows],
  );
  const monthBooks = useMemo(() => coloniaAccountMonths(seasonView).map((month) => ({
    ...month,
    lines: buildColoniaMonthRows({
      enrollments,
      charges: seasonCharges,
      payments: seasonPayments,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      periodicity: season?.promotion_periodicity || null,
      monthKey: month.key,
      season: seasonView,
    }),
  })), [enrollments, seasonCharges, seasonPayments, season?.promotion_periodicity, seasonView]);
  const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const accountMonthKey = accountMonth === 'todos' || monthBooks.some((month) => month.key === accountMonth)
    ? accountMonth
    : (monthBooks.find((month) => month.key === currentMonthKey)?.key || monthBooks[0]?.key || 'todos');
  const monthRows = accountMonthKey === 'todos'
    ? accountRows
    : (monthBooks.find((month) => month.key === accountMonthKey)?.lines || []);
  const accountVisible = monthRows;
  const inscriptionDue = Number(enrollQuote.inscriptionEach) || 0;
  const enrollmentInscriptionTotal = Number(enrollQuote.inscription) || 0;
  const enrollmentPlanTotal = Number(enrollQuote.planCapital) || 0;
  const enrollOffer = coloniaEnrollPayChoices({
    planKey,
    memberKind: student.memberKind,
    pupilCount,
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    paidOn: todayIso(),
    season: season || COLONIA_SEASON_2026_2027,
  });
  const enrollScope = enrollOffer.choices.some((row) => row.key === enrollPayScope)
    ? enrollPayScope
    : (enrollOffer.choices[0]?.key || 'todo');
  const enrollmentInterest = enrollScope === 'inscripcion' ? 0 : (Number(enrollQuote.interest) || 0);
  const enrollmentTotal = enrollmentInscriptionTotal + enrollmentPlanTotal + (Number(enrollQuote.interest) || 0);
  const enrollmentCollectAmount = coloniaAmountForPayScope(enrollScope, {
    inscriptionAmount: enrollmentInscriptionTotal,
    planAmount: enrollmentPlanTotal,
  }) + enrollmentInterest;
  const seasonAge = {
    activitiesStartOn: season?.activities_start_on || COLONIA_SEASON_2026_2027.activitiesStartOn,
    ageMin: season?.age_min ?? 3,
    ageMax: season?.age_max ?? 15,
  };
  const rollCall = useMemo(() => {
    const marks = new Map(
      attendanceRows
        .filter((row) => String(row.day || '').slice(0, 10) === attendanceDay)
        .map((row) => [row.enrollment_id, row.status]),
    );
    const groupName = new Map(groups.map((group) => [group.id, group.name]));
    return enrollments
      .filter((row) => row.status !== 'cancelada')
      .map((row) => {
        const birth = String(row.student?.birth_date || row.student?.birthDate || '').slice(0, 10);
        const age = ageYearsOn(birth, seasonAge.activitiesStartOn);
        return {
          row,
          age,
          groupName: groupName.get(row.group_id) || '',
          status: marks.get(row.id) || '',
        };
      })
      .toSorted((a, b) => String(a.row.student?.full_name || '').localeCompare(String(b.row.student?.full_name || ''), 'es'));
  }, [attendanceRows, attendanceDay, enrollments, groups, season?.activities_start_on]);
  const rollBand = COLONIA_AGE_BANDS.find((band) => band.key === attendanceBand) || COLONIA_AGE_BANDS[0];
  const rollFiltered = rollCall.filter((item) => {
    if (!rollBand.match(item.age)) return false;
    if (attendanceFocus === 'sin_marcar') return !item.status;
    if (attendanceFocus !== 'todos' && item.status !== attendanceFocus) return false;
    if (attendanceQuery.trim() && !enrollmentMatchesRoster(item.row, attendanceQuery)) return false;
    return true;
  });
  const rollPages = Math.max(1, Math.ceil(rollFiltered.length / COLONIA_PAGE_SIZE));
  const rollPageSafe = Math.min(attendancePage, rollPages - 1);
  const rollSlice = rollFiltered.slice(rollPageSafe * COLONIA_PAGE_SIZE, rollPageSafe * COLONIA_PAGE_SIZE + COLONIA_PAGE_SIZE);
  const rollCounts = {
    presente: rollCall.filter((item) => item.status === 'presente').length,
    ausente: rollCall.filter((item) => item.status === 'ausente').length,
    justificada: rollCall.filter((item) => item.status === 'justificada').length,
    retiro_anticipado: rollCall.filter((item) => item.status === 'retiro_anticipado').length,
    sin_marcar: rollCall.filter((item) => !item.status).length,
  };
  const today = todayIso();
  const healthByStudent = useMemo(
    () => new Map(healthRows.map((row) => [row.student_id, row])),
    [healthRows],
  );
  const shirtTally = useMemo(() => coloniaShirtTally(enrollments), [enrollments]);
  const todayBoard = useMemo(() => {
    const marks = new Map(
      todayAttendance
        .filter((row) => String(row.day || '').slice(0, 10) === today)
        .map((row) => [row.enrollment_id, row.status]),
    );
    return enrollments
      .filter((row) => row.status !== 'cancelada')
      .map((row) => ({
        row,
        status: marks.get(row.id) || '',
        owed: Number(accountById.get(row.id)?.owed) || 0,
      }))
      .toSorted((a, b) => String(a.row.student?.full_name || '').localeCompare(String(b.row.student?.full_name || ''), 'es'));
  }, [todayAttendance, today, enrollments, accountById]);
  const todayFiltered = todayBoard.filter((item) => {
    if (todayFocus === 'sin_marcar') return !item.status;
    if (todayFocus === 'debe') return item.owed > 0.009;
    if (todayFocus !== 'todos' && item.status !== todayFocus) return false;
    return true;
  });
  const todayPages = Math.max(1, Math.ceil(todayFiltered.length / COLONIA_PAGE_SIZE));
  const todayPageSafe = Math.min(todayPage, todayPages - 1);
  const todaySlice = todayFiltered.slice(todayPageSafe * COLONIA_PAGE_SIZE, todayPageSafe * COLONIA_PAGE_SIZE + COLONIA_PAGE_SIZE);
  const todayOwed = todayBoard.filter((item) => item.owed > 0.009).length;
  const todayCounts = {
    presente: todayBoard.filter((item) => item.status === 'presente').length,
    ausente: todayBoard.filter((item) => item.status === 'ausente').length,
    sin_marcar: todayBoard.filter((item) => !item.status).length,
  };
  const extraProblems = [];
  rosterPreview.slice(1).forEach((extra, index) => {
    const label = `Hijo ${index + 2}`;
    if (!extra.fullName?.trim()) {
      extraProblems.push({ code: `extra_name_${index}`, message: `Falta el nombre del ${label.toLowerCase()}.` });
    }
    const age = validateColoniaAge(extra.birthDate, seasonAge);
    if (!age.ok) {
      age.errors.forEach((error) => {
        extraProblems.push({ code: `${error.code}_${index}`, message: `${label}: ${error.message}` });
      });
    }
  });
  const identityKeys = rosterPreview.map((row) => enrollmentIdentityKey(row)).filter(Boolean);
  if (new Set(identityKeys).size !== identityKeys.length) {
    extraProblems.push({ code: 'dup_kids', message: 'Hay dos hijos con los mismos datos.' });
  }
  const formErrors = [...draftValidation.errors, ...extraProblems];
  const formOk = draftValidation.ok && extraProblems.length === 0;
  const familyFilled = chosenKeys.filter(Boolean).length >= childSlots;
  const showFamilyList = !familyFilled || showFamilyPicker;

  useEffect(() => {
    if (student.memberKind !== 'socio') {
      setMemberHits((curr) => (curr.length ? [] : curr));
      setMemberSearchBusy(false);
      return undefined;
    }
    const parsed = clubMailMemberQuery(memberQuery);
    if (parsed.kind === 'empty' || (parsed.kind === 'text' && parsed.text.length < 2)) {
      setMemberHits((curr) => (curr.length ? [] : curr));
      setMemberSearchBusy(false);
      return undefined;
    }
    const needle = parsed.kind === 'number' ? parsed.canonical : parsed.text;
    const rank = (rows) => filterOperationalSearchHits(coloniaSocioHits(rows, memberQuery), needle)
      .toSorted((a, b) => rankMemberSearchHit(a, needle) - rankMemberSearchHit(b, needle))
      .slice(0, 8);
    const local = Array.isArray(members) ? members : [];
    if (!isSupabaseConfigured) {
      setMemberHits(rank(local));
      setMemberSearchBusy(false);
      return undefined;
    }
    let cancelled = false;
    setMemberSearchBusy(true);
    const timer = window.setTimeout(() => {
      repos.searchMembersDirectory(needle, { limit: 40 })
        .then((rows) => {
          if (cancelled) return;
          const seen = new Set(local.map((row) => String(row?.memberId || '')));
          const extra = (rows || []).filter((row) => {
            const id = String(row?.memberId || '');
            return id && !seen.has(id);
          });
          setMemberHits(rank([...local, ...extra]));
        })
        .catch(() => { if (!cancelled) setMemberHits(rank(local)); })
        .finally(() => { if (!cancelled) setMemberSearchBusy(false); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberQuery, student.memberKind, members]);

  function pupilGroupHits(query) {
    const pool = householdSearchPool(household, anchorMember, seasonAge.activitiesStartOn);
    if (!anchorMember || !pool.length) return [];
    const parsed = clubMailMemberQuery(query);
    if (parsed.kind === 'empty') return pool;
    if (parsed.kind === 'text' && parsed.text.length < 2) return [];
    const needle = parsed.kind === 'number' ? parsed.canonical : parsed.text;
    return filterOperationalSearchHits(coloniaSocioHits(pool, query), needle)
      .toSorted((a, b) => rankMemberSearchHit(a, needle) - rankMemberSearchHit(b, needle));
  }

  function memberDisplayName(row) {
    return row?.name
      || [row?.firstName, row?.lastName].filter(Boolean).join(' ')
      || 'Socio';
  }

  function pupilFromMember(row, previous = EMPTY_PUPIL) {
    return {
      fullName: memberDisplayName(row),
      documentNumber: row?.documentNumber || row?.document_number || '',
      birthDate: isoBirth(row),
      memberNumber: String(row?.memberId || row?.memberNumber || ''),
      shirtSize: previous?.shirtSize || '',
    };
  }

  function applyChosen(keys, rows, need = childSlots, { trim = false } = {}) {
    const picked = keys.map((key) => rows.find((row) => memberKey(row) === key)).filter(Boolean);
    setChosenKeys(keys);
    if (picked[0]) {
      setStudent((prev) => ({
        ...prev,
        ...pupilFromMember(picked[0], prev),
        memberKind: 'socio',
      }));
    } else {
      setStudent((prev) => (
        prev.memberNumber
          ? { ...EMPTY_STUDENT, memberKind: 'socio', shirtSize: prev.shirtSize }
          : prev
      ));
    }
    const size = Math.max(0, need - 1);
    setExtraStudents((prev) => {
      const planned = Array.from({ length: size }, (_, index) => {
        const row = picked[index + 1];
        if (row) return pupilFromMember(row, prev[index]);
        if (prev[index]?.memberNumber) return { ...EMPTY_PUPIL, shirtSize: prev[index]?.shirtSize || '' };
        return prev[index] || { ...EMPTY_PUPIL };
      });
      if (trim) return planned;
      return [...planned, ...prev.slice(size)];
    });
  }

  function switchMemberKind(kind) {
    guardianLockedRef.current = false;
    setStudent({ ...EMPTY_STUDENT, memberKind: kind });
    setExtraStudents([]);
    setGuardian({ ...EMPTY_GUARDIAN });
    setPickedMemberLabel('');
    setMemberQuery('');
    setMemberHits([]);
    setMemberSearchBusy(false);
    setAnchorMember(null);
    setHousehold([]);
    setHouseholdBusy(false);
    setChosenKeys([]);
    setSlotQuery({});
    setShowFamilyPicker(false);
    setOpenPupil({});
  }

  function coloniaNoticeText(row) {
    const student = row.enrollment?.student || {};
    const who = student.full_name || 'familia';
    const amount = money(row.noticeAmount);
    if (row.status === 'proximo') {
      return `Hola, te saludamos del Jockey Club San Juan. En ${row.nextLabel} corresponde la cuota de Colonia de ${who} por ${amount}. La cuenta de Colonia es aparte de la cuota social.`;
    }
    return `Hola, te saludamos del Jockey Club San Juan. Queda pendiente la cuenta de Colonia de ${who} por ${amount}. Podés regularizarla en el club. La cuenta de Colonia es aparte de la cuota social.`;
  }

  function responsibleSocio(enrollment) {
    const student = enrollment?.student || {};
    const guardian = enrollment?.guardian || {};
    if (student.member_kind === 'no_socio') return null;
    const phone = String(guardian.phone || '').replace(/\D/g, '');
    const name = foldColoniaText(guardian.full_name);
    const studentNumber = String(student.member_number || '').replace(/\D/g, '').replace(/^0+/, '');
    const list = members || [];
    const sameNumber = (item) => {
      const id = String(item?.memberId || item?.memberNumber || '').replace(/\D/g, '').replace(/^0+/, '');
      return studentNumber && id === studentNumber;
    };
    const sameGuardian = (item) => {
      const itemPhone = String(item?.phone || item?.phoneAlt || '').replace(/\D/g, '');
      if (phone.length >= 8 && itemPhone.length >= 8 && (itemPhone.endsWith(phone.slice(-8)) || phone.endsWith(itemPhone.slice(-8)))) {
        return true;
      }
      const itemName = foldColoniaText(item?.fullName || item?.name);
      return name.length > 3 && itemName === name;
    };
    const hit = list.find(sameGuardian) || list.find(sameNumber) || null;
    const memberNumber = String(hit?.memberId || hit?.memberNumber || student.member_number || '').replace(/\D/g, '').replace(/^0+/, '');
    return {
      name: guardian.full_name || hit?.fullName || hit?.name || student.full_name || 'el socio',
      memberNumber,
    };
  }

  function coloniaPayer(row) {
    const student = row.enrollment?.student || {};
    const guardian = row.enrollment?.guardian || {};
    const number = String(student.member_number || '').replace(/\D/g, '').replace(/^0+/, '');
    const member = number
      ? (members || []).find((item) => String(item.memberId || '').replace(/\D/g, '').replace(/^0+/, '') === number)
      : null;
    return {
      member,
      phone: guardian.phone || member?.phone || member?.phoneAlt || '',
      email: deliverableEmail(guardian.email) || deliverableEmail(member?.email),
      memberNumber: member?.memberId || student.member_number || '',
    };
  }

  function openColoniaWhatsApp(row) {
    const payer = coloniaPayer(row);
    const phone = toWhatsAppPhone(payer.phone);
    if (!phone) {
      setAccountNotice('Ese responsable no tiene un teléfono para WhatsApp.');
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(coloniaNoticeText(row))}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function sendColoniaMd(row) {
    const payer = coloniaPayer(row);
    if (!payer.memberNumber || typeof onSendMessage !== 'function') {
      setAccountNotice('El mensaje interno sale solo si el alumno está en el padrón.');
      return;
    }
    setAccountNotice('');
    try {
      const period = row.status === 'proximo' ? row.nextLabel : 'saldo';
      await onSendMessage(createMessage({
        sender: 'Administración Jockey Club',
        senderId: MAILBOX.OPERATIONS,
        recipientId: payer.memberNumber,
        subject: 'Cuenta de Colonia',
        content: coloniaNoticeText(row),
        meta: { kind: 'colonia_payment_reminder', paymentId: `colonia:${row.enrollment.id}:${period}` },
      }));
      setAccountNotice('Mensaje interno enviado al buzón del socio.');
    } catch (err) {
      setAccountNotice(err?.message || 'No se pudo enviar el mensaje interno.');
    }
  }

  async function downloadAccountSheets() {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    const sheets = [
      ...monthBooks.map((month) => ({ key: month.key, label: month.label, lines: month.lines })),
      { key: 'todos', label: 'Todos', lines: accountRows },
    ];
    for (const sheet of sheets) {
      const lines = sheet.lines;
      const aoa = [COLONIA_ACCOUNT_HEADERS, ...lines.map(coloniaAccountCells)];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = COLONIA_ACCOUNT_HEADERS.map((header, index) => {
        const widest = aoa.reduce((max, line) => Math.max(max, String(line[index] ?? '').length), header.length);
        return { wch: Math.min(42, Math.max(12, widest + 2)) };
      });
      XLSX.utils.book_append_sheet(book, ws, sheet.label.slice(0, 31));
    }
    XLSX.writeFile(book, `colonia-cuenta-${season?.code || 'temporada'}.xlsx`);
    setAccountNotice('Excel descargado con una hoja por mes.');
  }

  async function sendColoniaMail(row) {
    const payer = coloniaPayer(row);
    if (!payer.memberNumber || !payer.email) {
      setAccountNotice('No hay un mail real del padrón para ese socio.');
      return;
    }
    setAccountNotice('');
    try {
      const subject = 'Cuenta de Colonia';
      const text = coloniaNoticeText(row);
      const preview = await repos.previewClubMail({
        subject,
        text,
        audience: 'one',
        memberNumber: payer.memberNumber,
      });
      await repos.sendClubMailCampaign({
        subject,
        text,
        audience: 'one',
        memberNumber: payer.memberNumber,
        previewId: preview?.previewId || preview?.id,
      });
      setAccountNotice('Mail enviado.');
    } catch (err) {
      setAccountNotice(err?.message || 'No se pudo enviar el mail.');
    }
  }

  function openEnrollment(row) {
    if (!row) return;
    setSelectedEnrollment(row);
    refreshAccount(row.id);
    if (canHealth) {
      const health = healthByStudent.get(row.student?.id) || {};
      setHealthAllergies(health.allergies || '');
      setHealthNotes(health.health_notes || '');
    }
    setSection('alumnos');
  }

  function paidReceiptForEnrollment(enrollment) {
    if (!enrollment?.id) return null;
    const socio = responsibleSocio(enrollment);
    return buildColoniaPaidReceiptFromEnrollment({
      enrollment,
      charges: seasonCharges,
      payments: seasonPayments,
      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
      socioName: socio?.name || enrollment.guardian?.full_name || '',
      socioNumber: socio?.memberNumber || enrollment.student?.member_number || '',
    });
  }

  async function downloadPaidReceipt(enrollment, event) {
    event?.stopPropagation?.();
    setMsg('');
    const receipt = paidReceiptForEnrollment(enrollment);
    if (!receipt) {
      setMsg('Todavía no hay pago acreditado para descargar inscripción + mes.');
      return;
    }
    setBusy(true);
    try {
      await downloadColoniaEnrollmentReceipt(receipt);
      setMsg('Se descargó el comprobante de inscripción y mes de Colonia.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo descargar el comprobante.');
    } finally {
      setBusy(false);
    }
  }

  function addPupil() {
    setExtraStudents((prev) => {
      const min = Math.max(0, childSlots - 1);
      const next = prev.slice();
      while (next.length < min) next.push({ ...EMPTY_PUPIL });
      next.push({ ...EMPTY_PUPIL });
      return next;
    });
  }

  function removeAddedPupil(slot) {
    const index = slot - 1;
    if (index < Math.max(0, childSlots - 1)) return;
    setExtraStudents((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    setSlotQuery((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  function toggleChild(row) {
    const key = memberKey(row);
    if (!key) return;
    const has = chosenKeys.includes(key);
    let next;
    if (has) next = chosenKeys.filter((item) => item !== key);
    else if (childSlots === 1) next = [key];
    else if (chosenKeys.length >= childSlots) next = [...chosenKeys.slice(0, childSlots - 1), key];
    else next = [...chosenKeys, key];
    applyChosen(next, household, childSlots);
    setShowFamilyPicker(false);
  }

  function changePlan(nextKey) {
    const need = planChildSlots(nextKey);
    setPlanKey(nextKey);
    setEnrollHold(null);
    const pool = householdKids(household, anchorMember, seasonAge.activitiesStartOn);
    const keys = [];
    const seen = new Set();
    for (const key of chosenKeys) {
      if (keys.length >= need) break;
      if (!seen.has(key)) {
        keys.push(key);
        seen.add(key);
      }
    }
    for (const row of pool) {
      if (keys.length >= need) break;
      const key = memberKey(row);
      if (!seen.has(key)) {
        keys.push(key);
        seen.add(key);
      }
    }
    applyChosen(keys, household.length ? household : pool, need, { trim: true });
  }

  function fillPupilFromPadron(slot, row) {
    const pupil = pupilFromMember(row, slot === 0 ? student : extraStudents[slot - 1]);
    if (slot === 0) {
      setStudent((prev) => ({ ...prev, ...pupil, memberKind: 'socio' }));
    } else {
      setExtraStudents((prev) => {
        const next = prev.slice();
        while (next.length < slot) next.push({ ...EMPTY_PUPIL });
        next[slot - 1] = pupil;
        return next;
      });
    }
    const key = memberKey(row);
    setChosenKeys((prev) => {
      const next = prev.filter((item) => item !== key);
      next[slot] = key;
      return next.filter(Boolean);
    });
    setSlotQuery((prev) => ({ ...prev, [slot]: '' }));
  }

  function useAnchorAsPupil() {
    if (!anchorMember) return;
    applyChosen([memberKey(anchorMember)], [anchorMember, ...household], childSlots);
  }

  function clearGroupSelection() {
    setChosenKeys([]);
    setStudent((prev) => ({ ...EMPTY_STUDENT, memberKind: prev.memberKind || 'socio', shirtSize: prev.shirtSize }));
    setExtraStudents((prev) => prev.map((row) => ({ ...EMPTY_PUPIL, shirtSize: row.shirtSize || '' })));
  }

  function pickMember(row) {
    guardianLockedRef.current = false;
    setAnchorMember(row);
    setChosenKeys([]);
    setExtraStudents(Array.from({ length: Math.max(0, childSlots - 1) }, () => ({ ...EMPTY_PUPIL })));
    setStudent({ ...EMPTY_STUDENT, memberKind: 'socio' });
    setPickedMemberLabel(`${memberDisplayName(row)} · Nº ${row?.memberId || row?.memberNumber || '—'}`);
    setMemberQuery('');
    setMemberHits([]);
    setSlotQuery({});
    setShowFamilyPicker(false);
    setOpenPupil({});
    setGuardian({
      ...EMPTY_GUARDIAN,
      fullName: memberDisplayName(row),
      documentNumber: row?.documentNumber || row?.document_number || '',
      phone: row?.phone || '',
      email: row?.email || '',
    });
  }

  useEffect(() => {
    if (student.memberKind !== 'socio' || !anchorMember) {
      setHousehold((curr) => (curr.length ? [] : curr));
      setHouseholdBusy(false);
      return undefined;
    }
    const principal = familyPrincipalOf(anchorMember) || memberNumberOf(anchorMember);
    if (!principal) {
      setHousehold([anchorMember]);
      return undefined;
    }
    if (!isSupabaseConfigured || typeof repos.listHouseholdByPrincipal !== 'function') {
      const local = (membersRef.current || []).filter((row) => {
        const self = memberNumberOf(row);
        const group = familyPrincipalOf(row);
        return self === principal || group === principal;
      });
      const list = local.length ? local : [anchorMember];
      setHousehold(list);
      const kids = householdKids(list, anchorMember, seasonAge.activitiesStartOn);
      const need = planChildSlots(planKey);
      if (kids.length) applyChosen(kids.slice(0, need).map((row) => memberKey(row)), list, need);
      return undefined;
    }
    let cancelled = false;
    setHouseholdBusy(true);
    repos.listHouseholdByPrincipal(principal)
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) && rows.length ? rows : [anchorMember];
        setHousehold(list);
        const kids = householdKids(list, anchorMember, seasonAge.activitiesStartOn);
        const need = planChildSlots(planKey);
        if (kids.length) {
          applyChosen(kids.slice(0, need).map((row) => memberKey(row)), list, need);
        }
        if (guardianLockedRef.current) return;
        const titular = list.find((row) => memberNumberOf(row) === principal) || anchorMember;
        setGuardian((prev) => ({
          ...prev,
          fullName: memberDisplayName(titular),
          documentNumber: titular.documentNumber || titular.document_number || prev.documentNumber,
          phone: titular.phone || prev.phone,
          email: titular.email || prev.email,
        }));
      })
      .catch(() => { if (!cancelled) setHousehold([anchorMember]); })
      .finally(() => { if (!cancelled) setHouseholdBusy(false); });
    return () => { cancelled = true; };
  }, [anchorMember, student.memberKind]);

  useEffect(() => {
    if (!canOperate || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const rows = await repos.listColoniaSeasons();
        if (cancelled) return;
        setSeasons(rows);
        setSeasonId((prev) => prev || rows[0]?.id || null);
        setCloudReady(true);
      } catch (err) {
        if (cancelled) return;
        setCloudReady(err?.code !== 'COLONIA_RPC_MISSING');
        setMsg(err?.message || 'No se pudo cargar Colonia.');
      }
    })();
    return () => { cancelled = true; };
  }, [canOperate]);

  useEffect(() => {
    if (!seasonId || !isSupabaseConfigured) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const [st, en, gr, act, sib, seasonChargesRows, seasonPaymentRows] = await Promise.all([
          canFinance ? repos.coloniaDashboardStats(seasonId).catch(() => null) : Promise.resolve(null),
          repos.listColoniaEnrollments(seasonId),
          repos.listColoniaGroups(seasonId).catch(() => []),
          repos.listColoniaActivities(seasonId).catch(() => []),
          canFinance ? repos.listColoniaSiblingGroups(seasonId).catch(() => []) : Promise.resolve([]),
          canFinance && typeof repos.listColoniaSeasonCharges === 'function'
            ? repos.listColoniaSeasonCharges(seasonId).catch(() => [])
            : Promise.resolve([]),
          canFinance && typeof repos.listColoniaSeasonPayments === 'function'
            ? repos.listColoniaSeasonPayments(seasonId).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setStats(st);
        setEnrollments(en);
        setGroups(gr);
        setActivities(act);
        setSiblingGroups(sib);
        setSeasonCharges(seasonChargesRows || []);
        setSeasonPayments(seasonPaymentRows || []);
      } catch (err) {
        if (!cancelled) setMsg(err?.message || 'Error al refrescar Colonia');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seasonId, canFinance]);

  useEffect(() => {
    if ((activeSection !== 'asistencia' && activeSection !== 'hoy') || !seasonId || !isSupabaseConfigured) return undefined;
    const day = activeSection === 'hoy' ? todayIso() : attendanceDay;
    let cancelled = false;
    repos.listColoniaAttendance(seasonId, day)
      .then((rows) => {
        if (cancelled) return;
        const list = rows || [];
        if (activeSection === 'hoy' || day === todayIso()) setTodayAttendance(list);
        if (activeSection === 'asistencia') setAttendanceRows(list);
      })
      .catch(() => {
        if (cancelled) return;
        if (activeSection === 'asistencia') setAttendanceRows([]);
        if (activeSection === 'hoy') setTodayAttendance([]);
      });
    return () => { cancelled = true; };
  }, [activeSection, seasonId, attendanceDay]);

  useEffect(() => {
    if (!canHealth || !isSupabaseConfigured) {
      setHealthRows((curr) => (curr.length ? [] : curr));
      return undefined;
    }
    const ids = enrollments.map((row) => row.student?.id).filter(Boolean);
    if (!ids.length) {
      setHealthRows((curr) => (curr.length ? [] : curr));
      return undefined;
    }
    let cancelled = false;
    repos.listColoniaStudentHealth(ids)
      .then((rows) => { if (!cancelled) setHealthRows(rows || []); })
      .catch(() => { if (!cancelled) setHealthRows([]); });
    return () => { cancelled = true; };
  }, [canHealth, enrollments]);

  async function saveHealth() {
    if (!selectedEnrollment?.student?.id || !canHealth) return;
    setBusy(true);
    try {
      const studentId = selectedEnrollment.student.id;
      await repos.coloniaUpsertStudentHealth({
        studentId,
        healthNotes,
        allergies: healthAllergies,
      });
      setHealthRows((curr) => {
        const rest = curr.filter((row) => row.student_id !== studentId);
        return [...rest, { student_id: studentId, allergies: healthAllergies, health_notes: healthNotes }];
      });
      setMsg('Datos de salud guardados (solo personal autorizado).');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar salud.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccount(enrollmentId) {
    if (!enrollmentId || !canFinance) {
      setCharges([]);
      setPayments([]);
      return;
    }
    const [c, p] = await Promise.all([
      repos.listColoniaCharges(enrollmentId),
      repos.listColoniaPayments(enrollmentId),
    ]);
    setCharges(c);
    setPayments(p);
  }

  async function reloadSeasonLists() {
    if (!seasonId || !isSupabaseConfigured) return null;
    const [st, en, seasonChargesRows, seasonPaymentRows] = await Promise.all([
      canFinance ? repos.coloniaDashboardStats(seasonId).catch(() => null) : Promise.resolve(null),
      repos.listColoniaEnrollments(seasonId),
      canFinance && typeof repos.listColoniaSeasonCharges === 'function'
        ? repos.listColoniaSeasonCharges(seasonId).catch(() => [])
        : Promise.resolve([]),
      canFinance && typeof repos.listColoniaSeasonPayments === 'function'
        ? repos.listColoniaSeasonPayments(seasonId).catch(() => [])
        : Promise.resolve([]),
    ]);
    setStats(st);
    setEnrollments(en);
    setSeasonCharges(seasonChargesRows || []);
    setSeasonPayments(seasonPaymentRows || []);
    return en;
  }

  function clearEnrollmentForm() {
    setStudent(EMPTY_STUDENT);
    setGuardian(EMPTY_GUARDIAN);
    setPickedMemberLabel('');
    setMemberQuery('');
    setMemberHits([]);
    setAnchorMember(null);
    setHousehold([]);
    setChosenKeys([]);
    setExtraStudents([]);
    setSlotQuery({});
    setShowFamilyPicker(false);
    setOpenPupil({});
    setEnrollHold(null);
    setEnrollPayRef('');
    setEnrollPayScope('todo');
  }

  async function createPendingEnrollment() {
    const promo = evaluatePromotionCharge({
      planKey,
      season: { promotionPeriodicity: season?.promotion_periodicity ?? null },
      siblingCount,
      memberKinds: rosterPreview.map(() => student.memberKind),
    });
    if (!promo.ok) {
      throw new Error(promo.errors[0]?.message || 'Plan no confirmable.');
    }
    const g = await repos.upsertColoniaGuardian({
      full_name: guardian.fullName.trim(),
      document_number: guardian.documentNumber || null,
      relationship: guardian.relationship || null,
      phone: guardian.phone || null,
      email: guardian.email || null,
      emergency_contact: guardian.emergencyContact || null,
      authorized_pickup: guardian.authorizedPickup || null,
    });
    const planEach = Number(enrollQuote.planEach) || 0;
    const planConcept = planKey === 'temporada'
      ? 'colonia_temporada'
      : (String(planKey).startsWith('promo') || planKey === 'hermano_4' ? 'colonia_promocion' : 'colonia_cuota');
    const inscription = Number(enrollQuote.inscriptionEach) || 0;
    const perPupil = enrollQuote.perPupil === true;
    const slices = [];
    for (let index = 0; index < rosterPreview.length; index += 1) {
      const pupil = rosterPreview[index];
      const savedStudent = await repos.upsertColoniaStudent({
        full_name: pupil.fullName.trim(),
        document_number: pupil.documentNumber || null,
        birth_date: pupil.birthDate,
        member_kind: student.memberKind,
        member_number: pupil.memberNumber || null,
        shirt_size: pupil.shirtSize || null,
        notes: index === 0 ? (student.notes || null) : null,
        identity_key: enrollmentIdentityKey(pupil),
      });
      const savedEnrollment = await repos.createColoniaEnrollment({
        season_id: seasonId,
        student_id: savedStudent.id,
        guardian_id: g.id,
        plan_key: planKey,
        status: 'pendiente_pago',
        source: 'admin',
        observations: index === 0 ? (student.notes || null) : null,
      });
      let amount = 0;
      if (inscription > 0) {
        await repos.coloniaPostCharge({
          enrollmentId: savedEnrollment.id,
          concept: 'colonia_inscripcion',
          planKey: 'inscripcion',
          amount: inscription,
          note: 'Inscripción (incluye remera)',
        });
        amount += inscription;
      }
      if (planEach > 0 && (perPupil || index === 0)) {
        await repos.coloniaPostCharge({
          enrollmentId: savedEnrollment.id,
          concept: planConcept,
          planKey,
          amount: planEach,
          note: `Plan ${planKey}`,
        });
        amount += planEach;
      }
      const interest = index === 0 ? (enrollQuote.interest || 0) : 0;
      slices.push({
        id: savedEnrollment.id,
        amount: amount + interest,
        interest,
        enrollment: savedEnrollment,
      });
    }
    return slices;
  }

  function posFor(ref, amount) {
    const cur = ref?.current;
    return quoteColoniaPos({
      amount,
      plans: cur?.plans || paymentPlans,
      planId: cur?.planId,
      percent: cur?.percent,
      fixedAmount: cur?.fixed,
      confirmed: cur?.confirmed === true,
    });
  }

  async function collectEnrollmentPayment() {
    setMsg('');
    if (!formOk) {
      setMsg(formErrors[0]?.message || 'Revisá el formulario.');
      return;
    }
    if (!seasonId) {
      setMsg('Seleccioná una temporada publicada en la base.');
      return;
    }
    if (enrollHold?.ids?.length) {
      setMsg('El pago ya está registrado. Ahora se puede inscribir.');
      return;
    }
    if (enrollPayMethod === 'mercadopago' && pupilCount > 1) {
      setMsg('Mercado Pago es de a un alumno. Para un grupo usá otro medio.');
      return;
    }
    if (!(enrollmentCollectAmount > 0)) {
      setMsg('Elegí qué cobrar: inscripción, mes/plan o todo.');
      return;
    }
    const ready = coloniaEnrollPayReady({
      method: enrollPayMethod,
      amount: enrollmentCollectAmount,
      operatorConfirmed: coloniaMethodUsesCard(enrollPayMethod),
      externalReference: enrollPayRef,
      mpApproved: false,
    });
    if (enrollPayMethod !== 'mercadopago' && !ready.ok) {
      setMsg(ready.message);
      return;
    }
    let enrollPos = null;
    if (coloniaMethodUsesCard(enrollPayMethod)) {
      enrollPos = posFor(enrollPosRef, enrollmentCollectAmount);
      if (!enrollPos.ok) {
        setMsg(enrollPos.message);
        return;
      }
    }
    setBusy(true);
    try {
      const slices = await createPendingEnrollment();
      const paySlices = slices.map((slice, index) => {
        const inscriptionPart = inscriptionDue > 0 ? inscriptionDue : 0;
        const planPart = (enrollQuote.perPupil || index === 0) ? (Number(enrollQuote.planEach) || 0) : 0;
        const interest = index === 0 && enrollScope !== 'inscripcion' ? (enrollQuote.interest || 0) : 0;
        const amount = coloniaAmountForPayScope(enrollScope, {
          inscriptionAmount: inscriptionPart,
          planAmount: planPart,
        }) + interest;
        return { ...slice, amount, interest, inscriptionPart, planPart };
      });
      if (enrollPayMethod === 'mercadopago') {
        const mpAmount = paySlices[0]?.amount || enrollmentCollectAmount;
        setEnrollHold({
          ids: paySlices.map((slice) => slice.id),
          primaryId: paySlices[0]?.id,
          amount: mpAmount,
          scope: enrollScope,
          payStatus: 'awaiting_mp',
          method: 'mercadopago',
        });
        setMsg('Falta la confirmación de Mercado Pago. Después se puede inscribir.');
        await reloadSeasonLists();
        return;
      }
      const posSlices = enrollPos
        ? splitColoniaPosMeta(enrollPos.meta, paySlices.map((slice) => slice.amount).filter((n) => n > 0))
        : [];
      let posIndex = 0;
      for (const slice of paySlices) {
        if (!(slice.amount > 0)) continue;
        const pos = enrollPos ? posSlices[posIndex] : null;
        posIndex += 1;
        const draft = buildColoniaPaymentDraft({
          enrollmentId: slice.id,
          seasonId,
          method: enrollPayMethod,
          amount: slice.amount,
          operatorConfirmed: coloniaMethodUsesCard(enrollPayMethod),
          externalReference: enrollPayRef,
          bankId: enrollBankId,
          idempotencyKey: `alta:${slice.id}:${enrollPayMethod}:${enrollScope}:${slice.amount}:${enrollPayRef || 'x'}`,
        });
        await repos.coloniaRecordPayment({
          enrollmentId: draft.enrollmentId,
          method: draft.method,
          amount: draft.amount,
          status: draft.status,
          externalReference: draft.externalReference,
          idempotencyKey: draft.idempotencyKey,
          operatorName: 'Mostrador Colonia',
          bankId: draft.bankId,
          pos,
          interest: slice.interest || 0,
        });
      }
      setEnrollHold({
        ids: paySlices.map((slice) => slice.id),
        primaryId: paySlices[0]?.id,
        amount: enrollmentCollectAmount,
        scope: enrollScope,
        payStatus: ready.status,
        method: enrollPayMethod,
      });
      const scopeNote = enrollScope === 'inscripcion'
        ? 'Inscripción cobrada'
        : enrollScope === 'plan'
          ? 'Plan cobrado'
          : enrollScope === 'todo' && inscriptionDue <= 0
            ? 'Plan cobrado'
            : 'Inscripción y plan cobrados';
      setMsg(ready.status === 'confirmed'
        ? `${scopeNote}. Ya se puede inscribir.`
        : `${scopeNote} (pendiente de confirmar). Ya se puede inscribir.`);
      await reloadSeasonLists();
    } catch (err) {
      setMsg(err?.details?.[0]?.message || err?.message || 'No se pudo cobrar.');
    } finally {
      setBusy(false);
    }
  }

  async function submitEnrollment() {
    setMsg('');
    const ready = enrollHold
      ? coloniaEnrollPayReady({
        method: enrollHold.method,
        amount: enrollHold.amount || enrollmentTotal,
        operatorConfirmed: true,
        externalReference: enrollPayRef || 'ya',
        mpApproved: enrollHold.payStatus === 'confirmed',
      })
      : { ok: false, message: 'Primero cobrá por un medio.' };
    if (!enrollHold?.ids?.length || enrollHold.payStatus === 'awaiting_mp' || !ready.ok) {
      setMsg(ready.message || 'Primero cobrá por un medio.');
      return;
    }
    const principalNumber = familyPrincipalOf(anchorMember) || memberNumberOf(anchorMember) || student.memberNumber;
    const titular = (household || []).find((row) => memberNumberOf(row) === principalNumber) || anchorMember;
    const holdScope = enrollHold.scope || 'todo';
    const receipt = buildColoniaEnrollmentReceipt({
      pupils: rosterPreview.filter((row) => row.fullName?.trim()),
      planKey,
      memberKind: student.memberKind,
      inscriptionAmount: holdScope === 'plan' ? 0 : inscriptionDue,
      planAmount: holdScope === 'inscripcion' ? 0 : (Number(enrollQuote.planEach) || 0),
      interestAmount: holdScope === 'inscripcion' ? 0 : enrollQuote.interest,
      socioName: student.memberKind === 'no_socio'
        ? guardian.fullName
        : (titular?.fullName || titular?.name || titular?.full_name || guardian.fullName),
      socioNumber: student.memberKind === 'no_socio'
        ? ''
        : (memberNumberOf(titular) || student.memberNumber || ''),
      method: enrollHold.method,
      paymentStatus: enrollHold.payStatus === 'confirmed' ? 'confirmed' : 'pending',
    });
    setBusy(true);
    try {
      const status = enrollHold.payStatus === 'confirmed' ? 'confirmada' : 'pendiente_pago';
      for (const id of enrollHold.ids) {
        await repos.coloniaUpdateEnrollment({ enrollmentId: id, status });
      }
      let downloaded = false;
      try {
        await downloadColoniaEnrollmentReceipt(receipt);
        downloaded = true;
      } catch {
        downloaded = false;
      }
      const listed = await reloadSeasonLists();
      const first = (listed || []).find((row) => row.id === enrollHold.primaryId) || null;
      setSelectedEnrollment(first);
      if (first?.id) await refreshAccount(first.id);
      clearEnrollmentForm();
      setSection('alumnos');
      setMsg(status === 'confirmada'
        ? (downloaded
          ? 'Inscripción confirmada. Se descargó el comprobante de Colonia.'
          : 'Inscripción confirmada. No se pudo descargar el comprobante.')
        : (downloaded
          ? 'Inscripción cargada. Se descargó el comprobante; se confirma cuando entre el pago.'
          : 'Inscripción cargada. Se confirma cuando entre el pago.'));
    } catch (err) {
      setMsg(err?.message || 'No se pudo inscribir.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(amountOverride) {
    setMsg('');
    if (!selectedEnrollment?.id) {
      setMsg('Elegí una inscripción.');
      return;
    }
    if (!canCollect) {
      setMsg('Sin permiso de cobranza Colonia.');
      return;
    }
    const dueNow = fichaPayable;
    const charged = Number(amountOverride) > 0
      ? Number(amountOverride)
      : (Number(payAmount) > 0 ? Number(payAmount) : dueNow);
    const interest = fichaLateInterest > 0 && (
      Math.abs(charged - fichaPayable) < 0.5
      || Math.abs(charged - (fichaPlanDue + fichaLateInterest)) < 0.5
    ) ? fichaLateInterest : 0;
    let payPos = null;
    if (coloniaMethodUsesCard(payMethod)) {
      payPos = posFor(payPosRef, charged);
      if (!payPos.ok) {
        setMsg(payPos.message);
        return;
      }
    }
    setBusy(true);
    try {
      const draft = buildColoniaPaymentDraft({
        enrollmentId: selectedEnrollment.id,
        seasonId,
        method: payMethod,
        amount: charged,
        operatorConfirmed: coloniaMethodUsesCard(payMethod),
        externalReference: payRef,
        bankId: payBankId,
        idempotencyKey: `colonia-${selectedEnrollment.id}-${payMethod}-${charged}-${payRef || 'x'}`,
      });
      const result = await repos.coloniaRecordPayment({
        enrollmentId: draft.enrollmentId,
        method: draft.method,
        amount: draft.amount,
        status: draft.status,
        externalReference: draft.externalReference,
        idempotencyKey: draft.idempotencyKey,
        operatorName: 'Mostrador Colonia',
        bankId: draft.bankId,
        pos: payPos?.meta || null,
        interest,
      });
      const payment = result?.payment || result;
      if (draft.status === 'confirmed' && payment) {
        setReceiptPreview(buildColoniaReceipt({
          payment,
          student: selectedEnrollment?.student,
          guardian: selectedEnrollment?.guardian,
          season,
        }));
      }
      setMsg(result?.duplicate
        ? 'Pago duplicado (idempotencia): se reutilizó el registro existente.'
        : draft.status === 'confirmed'
          ? (result?.cash_movement_id
            ? `Pago ${coloniaMethodLabel(draft.method)} acreditado. Entró a la caja del día y al asiento de Colonia.`
            : `Pago ${coloniaMethodLabel(draft.method)} acreditado. Quedó el asiento de Colonia, sin pasar por la caja en efectivo.`)
          : `Pago ${coloniaMethodLabel(draft.method)} quedó pendiente. Entra al asiento cuando se confirme.`);
      setPayAmount('');
      setPayRef('');
      await refreshAccount(selectedEnrollment.id);
      await reloadSeasonLists();
    } catch (err) {
      setMsg(err?.details?.[0]?.message || err?.message || 'No se pudo cobrar.');
    } finally {
      setBusy(false);
    }
  }

  async function markAttendance(enrollmentId, status) {
    setMsg('');
    if (!canAttend) {
      setMsg('Sin permiso de asistencia Colonia.');
      return;
    }
    const previous = attendanceRows;
    const previousToday = todayAttendance;
    const markedDay = attendanceDay;
    const markedToday = markedDay === todayIso();
    setAttendanceSavingId(enrollmentId);
    const nextMarks = (curr) => {
      const rest = curr.filter((row) => row.enrollment_id !== enrollmentId || String(row.day || '').slice(0, 10) !== markedDay);
      return [...rest, { enrollment_id: enrollmentId, day: markedDay, status }];
    };
    setAttendanceRows(nextMarks);
    if (markedToday) setTodayAttendance(nextMarks);
    try {
      await repos.coloniaUpsertAttendance({
        enrollmentId,
        day: markedDay,
        status,
        operatorName: 'Asistencia Colonia',
      });
    } catch (err) {
      setAttendanceRows(previous);
      if (markedToday) setTodayAttendance(previousToday);
      setMsg(err?.message || 'No se pudo guardar la asistencia.');
    } finally {
      setAttendanceSavingId('');
    }
  }

  async function savePromotionPeriodicity(value) {
    if (!seasonId) return;
    setBusy(true);
    try {
      const updated = await repos.updateColoniaSeason(seasonId, {
        promotion_periodicity: value || null,
      });
      setSeasons((prev) => prev.map((s) => (s.id === seasonId ? updated : s)));
      setMsg(value
        ? `Periodicidad de promociones: ${value === 'monthly' ? 'mensual' : 'temporada'}.`
        : 'Promociones vuelven a quedar bloqueadas hasta definir periodicidad.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar la configuración.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelAccountEnrollment(enrollment) {
    if (!enrollment?.id || !canOperate) return;
    const reason = window.prompt('Motivo de cancelación (mín. 5 caracteres):', 'Cancelada por Administración');
    if (!reason || reason.trim().length < 5) {
      setAccountNotice('La cancelación necesita un motivo de al menos 5 caracteres.');
      return;
    }
    setBusy(true);
    setAccountNotice('');
    try {
      await repos.coloniaCancelEnrollment(enrollment.id, reason.trim());
      await reloadSeasonLists();
      setAccountNotice(`Inscripción de ${enrollment.student?.full_name || 'el alumno'} cancelada. Los pagos ya confirmados quedan registrados.`);
    } catch (err) {
      setAccountNotice(err?.message || 'No se pudo cancelar.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSelectedEnrollment() {
    if (!selectedEnrollment?.id) return;
    const reason = window.prompt('Motivo de cancelación (mín. 5 caracteres):', 'Cancelada por Administración');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setMsg('');
    try {
      await repos.coloniaCancelEnrollment(selectedEnrollment.id, reason.trim());
      const en = await reloadSeasonLists();
      setSelectedEnrollment((en || []).find((e) => e.id === selectedEnrollment.id) || null);
      setMsg('Inscripción cancelada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo cancelar.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPendingPayment(paymentId) {
    if (!canCollect) {
      setMsg('Sin permiso de cobranza Colonia.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const result = await repos.coloniaConfirmPayment(paymentId, 'Mostrador Colonia');
      const payment = result?.payment || result;
      setReceiptPreview(buildColoniaReceipt({
        payment,
        student: selectedEnrollment?.student,
        guardian: selectedEnrollment?.guardian,
        season,
      }));
      setMsg(result?.cash_movement_id
        ? 'Pago confirmado. Entró a la caja del día y al asiento de Colonia.'
        : 'Pago confirmado. Quedó el asiento de Colonia.');
      if (selectedEnrollment?.id) await refreshAccount(selectedEnrollment.id);
      await reloadSeasonLists();
    } catch (err) {
      setMsg(err?.message || 'No se pudo confirmar el pago.');
    } finally {
      setBusy(false);
    }
  }

  async function voidSelectedCharge(chargeId) {
    const reason = window.prompt('Motivo de anulación (mín. 5 caracteres):');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setMsg('');
    try {
      await repos.coloniaVoidCharge(chargeId, reason.trim());
      setMsg('Cargo anulado.');
      if (selectedEnrollment?.id) await refreshAccount(selectedEnrollment.id);
      await reloadSeasonLists();
    } catch (err) {
      setMsg(err?.message || 'No se pudo anular el cargo.');
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    if (!seasonId || !groupName.trim()) {
      setMsg('Indicá el nombre del grupo.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaCreateGroup({ seasonId, name: groupName.trim() });
      setGroupName('');
      setGroups(await repos.listColoniaGroups(seasonId));
      setMsg('Grupo creado.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo crear el grupo.');
    } finally {
      setBusy(false);
    }
  }

  async function createActivity() {
    if (!seasonId || !activityTitle.trim()) {
      setMsg('Indicá el título de la actividad.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaCreateActivity({
        seasonId,
        kind: activityKind,
        title: activityTitle.trim(),
        activityDate: activityDate || null,
      });
      setActivityTitle('');
      setActivities(await repos.listColoniaActivities(seasonId));
      setMsg('Actividad registrada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo crear la actividad.');
    } finally {
      setBusy(false);
    }
  }

  async function grantExcursionAuth(enrollmentId) {
    setBusy(true);
    try {
      await repos.coloniaSetAuthorization({
        enrollmentId,
        kind: 'excursion',
        granted: true,
        grantedByName: 'Operación Colonia',
      });
      setMsg('Autorización de excursión registrada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo registrar la autorización.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadReportSheets() {
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    const summary = [
      ['Concepto', 'Valor'],
      ['Inscriptos', coloniaReportRows(enrollments, 'inscriptos').length],
      ['Desde Administración', coloniaReportRows(enrollments, 'admin').length],
      ['Desde portal', coloniaReportRows(enrollments, 'portal').length],
      ['Externas', coloniaReportRows(enrollments, 'externas').length],
      ['Pendientes / observadas', coloniaReportRows(enrollments, 'pendientes').length],
      ['Confirmadas', coloniaReportRows(enrollments, 'confirmadas').length],
      ['Canceladas', coloniaReportRows(enrollments, 'canceladas').length],
      ['Socios', coloniaReportRows(enrollments, 'socios').length],
      ['No socios', coloniaReportRows(enrollments, 'no_socios').length],
      ['Deuda exclusiva Colonia', Number(stats?.balance_due) || 0],
      ['Ingresos confirmados', Number(stats?.payments_confirmed) || 0],
    ];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summary), 'Resumen');
    for (const sheet of COLONIA_REPORT_SHEETS) {
      if (sheet.key === 'resumen') continue;
      const lines = coloniaReportRows(enrollments, sheet.key);
      const aoa = [COLONIA_REPORT_HEADERS, ...lines.map(coloniaReportCells)];
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), sheet.label.slice(0, 31));
    }
    XLSX.writeFile(book, `colonia-reportes-${season?.code || 'temporada'}.xlsx`);
    setMsg('Excel de reportes descargado, una hoja por corte.');
  }

  function exportEnrollmentsCsv() {
    const csv = buildColoniaEnrollmentsCsv(coloniaReportRows(enrollments, 'inscriptos'));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colonia-inscriptos-${season?.code || 'temporada'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Reporte CSV descargado.');
  }

  function renderPupil(pupil, onChange, title, slot, onRemove) {
    const age = pupil.birthDate
      ? (ageYearsOn(pupil.birthDate, seasonAge.activitiesStartOn) ?? '—')
      : '—';
    const query = slotQuery[slot] || '';
    const parsed = clubMailMemberQuery(query);
    const searchReady = parsed.kind === 'number' || (parsed.kind === 'text' && parsed.text.length >= 2);
    const pupilFilled = Boolean(String(pupil.fullName || '').trim());
    const familyPool = householdSearchPool(household, anchorMember, seasonAge.activitiesStartOn);
    const showGroupSearch = student.memberKind === 'socio' && anchorMember && familyPool.length === 0;
    const hits = !showGroupSearch || (pupilFilled && !searchReady) ? [] : pupilGroupHits(query);
    const familyName = anchorMember ? memberDisplayName(anchorMember) : '';
    const expanded = Boolean(openPupil[slot]) || (!pupilFilled && familyPool.length === 0);
    return (
      <article className="colonia-pass">
        <header className="colonia-pass-head">
          <div>
            <small>{title}</small>
            <strong>{pupilFilled ? pupil.fullName : 'Todavía sin alumno'}</strong>
            {pupilFilled ? (
              <span>
                {pupil.memberNumber ? `Nº ${pupil.memberNumber}` : 'Sin Nº'}
                {pupil.documentNumber ? ` · DNI ${pupil.documentNumber}` : ''}
                {age !== '—' ? ` · ${age} años` : ''}
              </span>
            ) : (
              <span>{student.memberKind === 'socio' ? 'Elegilo en el grupo, o cargalo a mano.' : 'Nombre, DNI y nacimiento.'}</span>
            )}
          </div>
          <div className="colonia-pass-actions">
            {pupilFilled || familyPool.length ? (
              <button type="button" className="btn" onClick={() => setOpenPupil((prev) => ({ ...prev, [slot]: !prev[slot] }))}>
                {expanded ? 'Listo' : (pupilFilled ? 'Corregir' : 'Cargar a mano')}
              </button>
            ) : null}
            {onRemove ? <button type="button" className="btn" onClick={onRemove}>Quitar</button> : null}
          </div>
        </header>
        {expanded ? (
          <div className="colonia-pass-fields">
            {showGroupSearch ? (
              <div className="colonia-member-search">
                <label><span>Buscar en el grupo de {familyName}</span>
                  <input
                    value={query}
                    placeholder="Nombre, Nº o DNI"
                    onChange={(e) => setSlotQuery((prev) => ({ ...prev, [slot]: e.target.value }))}
                  />
                </label>
                {searchReady && !hits.length ? (
                  <p className="colonia-search-miss">No está en el grupo. Completá la ficha a mano.</p>
                ) : null}
                {hits.length ? (
                  <ul className="colonia-member-hits">
                    {hits.map((row) => (
                      <li key={memberKey(row) || row.id}>
                        <button type="button" onClick={() => fillPupilFromPadron(slot, row)}>
                          <strong>{memberDisplayName(row)}</strong>
                          <span>Nº {row.memberId || '—'} · DNI {row.documentNumber || '—'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <label><span>Nombre</span>
              <input value={pupil.fullName} onChange={(e) => onChange({ ...pupil, fullName: e.target.value })} />
            </label>
            <label><span>DNI</span>
              <input value={pupil.documentNumber} onChange={(e) => onChange({ ...pupil, documentNumber: e.target.value })} />
            </label>
            <label><span>Nacimiento</span>
              <input type="date" value={pupil.birthDate} onChange={(e) => onChange({ ...pupil, birthDate: e.target.value })} />
            </label>
            {student.memberKind === 'socio' ? (
              <label><span>Nº socio</span>
                <input value={pupil.memberNumber} onChange={(e) => onChange({ ...pupil, memberNumber: e.target.value })} />
              </label>
            ) : null}
          </div>
        ) : null}
        <label className="colonia-shirt"><span>Talle de remera</span>
          <input value={pupil.shirtSize} placeholder="8, 10, 12, M…" onChange={(e) => onChange({ ...pupil, shirtSize: e.target.value })} />
        </label>
      </article>
    );
  }

  if (!canOperate && !onlySection) {
    return (
      <div className="colonia-shell">
        <p className="colonia-banner warn">Sin permiso para Operación → Colonia.</p>
      </div>
    );
  }

  return (
    <div className="colonia-shell">
      {!onlySection ? <header className={`colonia-hero-band${seasons.length ? ' has-season' : ''}`}>
        <div className="colonia-hero-copy">
          <p className="colonia-kicker">Temporada {seasonView.code || '2026-2027'}</p>
          <h2 className="serif-font">Colonia de Verano</h2>
          <p>
            Mañanas en el club, de lunes a viernes. La cuenta de Colonia no toca la cuota social.
          </p>
        </div>
        <div className="colonia-wrist" aria-label="Horario">
          <span>09:00</span>
          <i aria-hidden="true" />
          <span>13:00</span>
          <small>lun a vie</small>
        </div>
        {seasons.length ? (
          <label className="colonia-field colonia-season-pick">
            <span>Temporada</span>
            <select
              value={seasonId || ''}
              onChange={(e) => setSeasonId(e.target.value || null)}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header> : null}

      {isSupabaseConfigured && !cloudReady ? (
        <p className="colonia-banner warn">
          <AlertTriangle size={16} /> La migración de Colonia aún no está publicada. El dominio y la UI están listos; no se inventan estadísticas.
        </p>
      ) : null}

      {msg ? <p className="colonia-banner">{msg}</p> : null}

      {!onlySection && !canFinance ? (
        <p className="colonia-banner warn">
          Vista de asistencia: sin acceso a cobranzas, tarifas ni reportes financieros.
        </p>
      ) : null}

      {!onlySection ? <nav className="colonia-nav" aria-label="Secciones Colonia">
        {visibleSections.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeSection === item.key ? 'is-active' : ''}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav> : null}

      {activeSection === 'hoy' ? (
        <section className="colonia-panel colonia-day">
          <header className="colonia-day-head">
            <div>
              <p className="colonia-kicker">{coloniaDayHeading(today)}</p>
              <h3><CalendarDays size={16} /> Hoy</h3>
              <p>
                {canFinance
                  ? 'Quién está inscripto, quién ya se marcó, quién retira y quién debe la cuota de Colonia.'
                  : 'Quién está inscripto, quién ya se marcó y quién retira.'}
              </p>
            </div>
            <div className="colonia-day-jumps">
              {canAttend ? (
                <button type="button" className="btn" onClick={() => setSection('asistencia')}>Pasar lista</button>
              ) : null}
              {canFinance ? (
                <button type="button" className="btn" onClick={() => setSection('cuenta')}>Ver cuenta</button>
              ) : null}
            </div>
          </header>
          <div className="colonia-roll-counts" role="tablist" aria-label="Hoy en Colonia">
            {[
              ['todos', 'Inscriptos', todayBoard.length],
              ['presente', 'Presentes', todayCounts.presente],
              ['ausente', 'Ausentes', todayCounts.ausente],
              ['sin_marcar', 'Sin marcar', todayCounts.sin_marcar],
              ...(canFinance ? [['debe', 'Deben cuota', todayOwed]] : []),
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={todayFocus === key}
                className={todayFocus === key ? 'is-on' : ''}
                onClick={() => {
                  setTodayFocus(key);
                  setTodayPage(0);
                }}
              >
                <b>{count}</b>
                <small>{label}</small>
              </button>
            ))}
          </div>
          <div className="colonia-shirts-block">
            <h4>Remeras</h4>
            <p>Talles de los inscriptos, para encargar.</p>
            {shirtTally.length ? (
              <div className="colonia-shirts">
                {shirtTally.map((item) => (
                  <article key={item.size}>
                    <b>{item.count}</b>
                    <span>{item.size}</span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">Todavía no hay inscriptos para encargar remeras.</p>
            )}
          </div>
          <div className="table-container">
            <table className="admin-table colonia-account-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Lista</th>
                  <th>Retira</th>
                  {canFinance ? <th>Cuota Colonia</th> : null}
                </tr>
              </thead>
              <tbody>
                {todaySlice.map((item) => {
                  const student = item.row.student || {};
                  const allergic = canHealth && coloniaHasAllergy(healthByStudent.get(student.id)?.allergies);
                  return (
                    <tr key={item.row.id}>
                      <td>
                        <strong>{student.full_name || '—'}</strong>
                        <AllergyMark show={allergic} />
                        <span className="muted">{student.member_kind === 'no_socio' ? 'No socio' : 'Socio'}</span>
                      </td>
                      <td>
                        <span className={`colonia-day-status${item.status ? ` is-${item.status}` : ' is-sin'}`}>
                          {rollStatusLabel(item.status)}
                        </span>
                      </td>
                      <td><PickupLines guardian={item.row.guardian} /></td>
                      {canFinance ? (
                        <td>{item.owed > 0.009 ? money(item.owed) : 'Al día'}</td>
                      ) : null}
                    </tr>
                  );
                })}
                {!todaySlice.length ? (
                  <tr>
                    <td colSpan={canFinance ? 4 : 3} className="muted">
                      {todayBoard.length ? 'Nadie en este filtro.' : 'Todavía no hay inscriptos para hoy.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ColoniaPager page={todayPageSafe} total={todayFiltered.length} onPage={setTodayPage} />
        </section>
      ) : null}

      {activeSection === 'resumen' ? (
        <section className="colonia-panel">
          <h3><ClipboardList size={16} /> Resumen</h3>
          {!stats ? (
            <p className="muted">Sin datos cargados todavía (o migración pendiente).</p>
          ) : (
            <div className="colonia-kpi-grid">
              <article><span>Inscriptos</span><strong>{stats.enrolled ?? 0}</strong></article>
              <article><span>Confirmadas</span><strong>{stats.confirmed ?? 0}</strong></article>
              <article><span>Pendientes</span><strong>{stats.pending ?? 0}</strong></article>
              <article><span>Socios</span><strong>{stats.socio ?? 0}</strong></article>
              <article><span>No socios</span><strong>{stats.no_socio ?? 0}</strong></article>
              <article><span>Cargos</span><strong>{money(stats.charges_total)}</strong></article>
              <article><span>Cobradas</span><strong>{money(stats.payments_confirmed)}</strong></article>
              <article><span>Pend. confirmar</span><strong>{money(stats.payments_pending)}</strong></article>
              <article><span>Saldo Colonia</span><strong>{money(stats.balance_due)}</strong></article>
              <article><span>Asistencia hoy</span><strong>{stats.attendance_today ?? 0}</strong></article>
              <article><span>Grupos hermanos</span><strong>{stats.sibling_groups ?? 0}</strong></article>
            </div>
          )}
        </section>
      ) : null}

      {activeSection === 'inscripciones' ? (
        <section className="colonia-panel colonia-grid-2">
          <div>
            <h3><Baby size={16} /> Nueva inscripción</h3>
            <div className="colonia-form colonia-enroll">
              <div className="colonia-step">
                <p>1 · Quién</p>
                <div className="colonia-kind" role="group" aria-label="Condición del alumno">
                  <button
                    type="button"
                    className={student.memberKind === 'socio' ? 'is-on' : ''}
                    onClick={() => switchMemberKind('socio')}
                  >
                    <strong>Socio</strong>
                    <span>Sale del padrón</span>
                  </button>
                  <button
                    type="button"
                    className={student.memberKind === 'no_socio' ? 'is-on' : ''}
                    onClick={() => switchMemberKind('no_socio')}
                  >
                    <strong>No socio</strong>
                    <span>Ficha solo de Colonia</span>
                  </button>
                </div>
                {student.memberKind === 'socio' ? (
                  <div className="colonia-member-search">
                    <label><span>{pickedMemberLabel ? 'Socio' : 'Buscar en el padrón'}</span>
                      <input
                        value={memberQuery}
                        placeholder={pickedMemberLabel || 'Nombre, Nº o DNI'}
                        onChange={(e) => setMemberQuery(e.target.value)}
                      />
                    </label>
                    {memberSearchBusy ? <p className="muted">Buscando…</p> : null}
                    {!memberSearchBusy && memberSearchReady && !memberHits.length ? (
                      <p className="colonia-search-miss">{clubMailSearchMissMessage(memberQuery)}</p>
                    ) : null}
                    {memberHits.length ? (
                      <ul className="colonia-member-hits">
                        {memberHits.map((row) => (
                          <li key={row.id || row.memberId}>
                            <button type="button" onClick={() => pickMember(row)}>
                              <strong>{memberDisplayName(row)}</strong>
                              <span>Nº {row.memberId || '—'} · DNI {row.documentNumber || '—'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="colonia-step">
                <p>2 · Plan</p>
                <div className="colonia-plans" role="listbox" aria-label="Plan de Colonia">
                  {[
                    ['cuota', 'Mes a mes'],
                    ['temporada', 'Temporada'],
                    ['promo_2', '2 hermanos · temporada'],
                    ['promo_3', '3 hermanos · temporada'],
                    ['hermano_4', '4º hermano · solo inscripción'],
                  ].map(([key, label]) => {
                    const offer = coloniaEnrollPayChoices({
                      planKey: key,
                      memberKind: student.memberKind,
                      pupilCount,
                      tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
                      paidOn: todayIso(),
                      season: season || COLONIA_SEASON_2026_2027,
                    });
                    const planNote = offer.perPupil && pupilCount > 1
                      ? `${money(offer.planEach)} cada uno`
                      : money(offer.planCapital);
                    const note = offer.planCapital > 0 && offer.inscription > 0
                      ? `${planNote} + inscripción ${money(offer.inscription)}`
                      : offer.planCapital > 0
                        ? `${planNote} · sin inscripción`
                        : offer.inscription > 0
                          ? `Solo inscripción ${money(offer.inscription)}`
                          : 'Sin canon';
                    return (
                      <button
                        key={key}
                        type="button"
                        role="option"
                        aria-selected={planKey === key}
                        className={planKey === key ? 'is-on' : ''}
                        onClick={() => changePlan(key)}
                      >
                        <strong>{label}</strong>
                        <span>{note}{offer.interest > 0 ? ` + interés ${money(offer.interest)}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {student.memberKind === 'socio' && anchorMember && householdBusy ? (
                <p className="muted">Buscando el grupo familiar…</p>
              ) : null}
              {student.memberKind === 'socio' && anchorMember && !householdBusy && household.length > 1 && showFamilyList ? (
                <div className="colonia-step">
                  <p>{childSlots === 1 ? '3 · Un chico del grupo' : `3 · ${childSlots} chicos del grupo`}</p>
                  <div className="colonia-chips">
                    {householdSearchPool(household, anchorMember, seasonAge.activitiesStartOn).map((row) => {
                      const key = memberKey(row);
                      const age = isoBirth(row)
                        ? ageYearsOn(isoBirth(row), seasonAge.activitiesStartOn)
                        : null;
                      return (
                        <button
                          key={key || row.id}
                          type="button"
                          className={chosenKeys.includes(key) ? 'is-on' : ''}
                          onClick={() => toggleChild(row)}
                        >
                          <strong>{memberDisplayName(row)}</strong>
                          <span>{age != null ? `${age} años` : 'Sin edad'} · Nº {row.memberId || '—'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {student.memberKind === 'socio' && anchorMember && !householdBusy && household.length <= 1 ? (
                <button type="button" className="btn" onClick={useAnchorAsPupil}>
                  Usar a {memberDisplayName(anchorMember)} como alumno
                </button>
              ) : null}
              {renderPupil(
                student,
                (next) => setStudent({ ...student, ...next, memberKind: student.memberKind }),
                pupilCount > 1 ? 'Hijo 1' : 'Alumno',
                0,
              )}
              {Array.from({ length: extraCount }, (_, index) => {
                const extra = extraStudents[index] || EMPTY_PUPIL;
                const slot = index + 1;
                const removable = slot >= childSlots;
                return (
                  <div key={`hijo-${slot}`}>
                    {renderPupil(
                      extra,
                      (next) => setExtraStudents((prev) => {
                        const copy = prev.slice();
                        while (copy.length <= index) copy.push({ ...EMPTY_PUPIL });
                        copy[index] = next;
                        return copy;
                      }),
                      `Hijo ${slot + 1}`,
                      slot,
                      removable ? () => removeAddedPupil(slot) : null,
                    )}
                  </div>
                );
              })}
              <div className="colonia-more-kids">
                {student.memberKind === 'socio' && anchorMember && household.length > 1 && !showFamilyList ? (
                  <button type="button" className="btn" onClick={() => setShowFamilyPicker(true)}>Elegir otro del grupo</button>
                ) : null}
                <button type="button" className="btn" onClick={addPupil}>Agregar un chico a mano</button>
              </div>
              <div className="colonia-step">
                <p>Responsable</p>
                <div className="colonia-guard">
                  <label><span>Nombre</span>
                    <input value={guardian.fullName} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, fullName: e.target.value }); }} />
                  </label>
                  <label><span>Teléfono</span>
                    <input value={guardian.phone} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, phone: e.target.value }); }} />
                  </label>
                  <label><span>Email</span>
                    <input value={guardian.email} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, email: e.target.value }); }} />
                  </label>
                </div>
                <details className="colonia-extra">
                  <summary>Emergencia y quién retira</summary>
                  <label><span>Emergencia</span>
                    <input value={guardian.emergencyContact} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, emergencyContact: e.target.value }); }} />
                  </label>
                  <label><span>Autorizados a retirar</span>
                    <input value={guardian.authorizedPickup} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, authorizedPickup: e.target.value }); }} />
                  </label>
                </details>
              </div>
              {formErrors.length ? (
                <ul className="colonia-errors">
                  {formErrors.map((e) => <li key={e.code}>{e.message}</li>)}
                </ul>
              ) : null}
              {draftValidation.warnings.map((w) => (
                <p key={w.code} className="colonia-banner warn">{w.message}</p>
              ))}
              <div className="colonia-step">
                <p>Pago, y después la inscripción</p>
                <div className="colonia-pay-scopes" role="group" aria-label="Qué cobrar">
                  {enrollOffer.choices.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      className={enrollScope === row.key ? 'btn btn-sm primary' : 'btn btn-sm'}
                      disabled={busy || Boolean(enrollHold)}
                      onClick={() => {
                        setEnrollPayScope(row.key);
                        setEnrollHold(null);
                      }}
                    >
                      {row.label} · {money(row.amount)}
                    </button>
                  ))}
                </div>
                <ColoniaPayDesk
                  method={enrollPayMethod}
                  onMethod={(id) => {
                    setEnrollPayMethod(id);
                    setEnrollHold(null);
                  }}
                  bankId={enrollBankId}
                  onBank={setEnrollBankId}
                  reference={enrollPayRef}
                  onReference={setEnrollPayRef}
                  disabled={busy || Boolean(enrollHold)}
                  plans={paymentPlans}
                  amount={enrollmentCollectAmount}
                  posRef={enrollPosRef}
                />
                {enrollHold?.payStatus === 'awaiting_mp' && enrollHold.primaryId ? (
                  <MercadoPagoCheckout
                    kind="colonia"
                    mode="qr"
                    amount={enrollHold.amount}
                    enrollmentId={enrollHold.primaryId}
                    memberNumber={student.memberNumber || anchorMember?.memberId || ''}
                    concept={`Colonia de Verano · ${student.fullName || 'inscripción'}`}
                    disabled={busy}
                    onApproved={() => setEnrollHold((prev) => (prev ? { ...prev, payStatus: 'confirmed' } : prev))}
                  />
                ) : null}
              </div>
              <div className="colonia-total">
                <div>
                  <span>
                    {enrollScope === 'inscripcion'
                      ? `Inscripción ${money(enrollmentInscriptionTotal)}${pupilCount > 1 ? ` × ${pupilCount}` : ''}`
                      : enrollScope === 'plan'
                        ? `${planKey === 'cuota' ? 'Cuota' : planKey === 'temporada' ? 'Temporada' : 'Plan'} ${money(enrollmentPlanTotal)}${enrollmentInterest > 0 ? ` + interés 15 % ${money(enrollmentInterest)}` : ''}`
                        : planKey === 'hermano_4'
                          ? `Solo inscripción ${money(enrollmentInscriptionTotal)}`
                          : `Inscripción ${money(inscriptionPrice)}${pupilCount > 1 ? ` × ${pupilCount}` : ''}${enrollmentPlanTotal > 0 ? ` + ${planKey === 'cuota' ? 'cuota' : enrollQuote.perPupil && pupilCount > 1 ? `${money(enrollQuote.planEach)} cada uno` : 'plan'} ${enrollQuote.perPupil && pupilCount > 1 ? '' : money(enrollmentPlanTotal)}` : ''}${enrollmentInterest > 0 ? ` + interés 15 % ${money(enrollmentInterest)}` : ''}`}
                  </span>
                  <strong>{money(enrollmentCollectAmount)}</strong>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !formOk || Boolean(enrollHold) || !(enrollmentCollectAmount > 0)}
                  onClick={collectEnrollmentPayment}
                >
                  Cobrar
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !enrollHold || enrollHold.payStatus === 'awaiting_mp'}
                  onClick={submitEnrollment}
                >
                  Inscribir
                </button>
              </div>
            </div>
          </div>
          <div>
            <h3>Inscripciones ({enrollments.length})</h3>
            <ul className="colonia-list">
              {enrollments.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEnrollment(row);
                      refreshAccount(row.id);
                      setSection('alumnos');
                    }}
                  >
                    <strong>{row.student?.full_name || '—'}</strong>
                    <span>
                      {coloniaStatusLabel(row.status)}
                      {' · '}
                      {row.plan_key}
                      {' · '}
                      {row.student?.member_kind}
                      {' · '}
                      {coloniaSourceLabel(row.source)}
                    </span>
                  </button>
                </li>
              ))}
              {!enrollments.length ? <li className="muted">Sin inscripciones en esta temporada.</li> : null}
            </ul>
          </div>
        </section>
      ) : null}

      {activeSection === 'alumnos' ? (
        <section className="colonia-panel">
          <h3><Users size={16} /> Ficha del alumno</h3>
          <div className="colonia-form">
            <label><span>Buscar alumno</span>
              <input
                value={rosterQuery}
                placeholder="Nombre, Nº o DNI"
                onChange={(e) => {
                  setRosterQuery(e.target.value);
                  setRosterPage(0);
                }}
              />
            </label>
          </div>
          {rosterQuery.trim() && !rosterRows.length ? (
            <p className="colonia-search-miss">{clubMailSearchMissMessage(rosterQuery)}</p>
          ) : null}
          <div className="table-container">
            <table className="admin-table colonia-account-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Nº / DNI</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Origen</th>
                  <th>Responsable</th>
                  <th>Contratado</th>
                  <th>Cobrado</th>
                  <th>Saldo</th>
                  <th>Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {rosterSlice.map((row) => {
                  const account = accountById.get(row.id);
                  const summary = account?.summary;
                  const selected = selectedEnrollment?.id === row.id;
                  const canReceipt = Boolean(paidReceiptForEnrollment(row));
                  return (
                    <tr
                      key={row.id}
                      className={selected ? 'is-on is-pick' : 'is-pick'}
                      onClick={() => openEnrollment(row)}
                    >
                      <td>
                        <strong>{row.student?.full_name || '—'}</strong>
                        <AllergyMark show={canHealth && coloniaHasAllergy(healthByStudent.get(row.student?.id)?.allergies)} />
                        <span className="muted">{row.student?.member_kind === 'no_socio' ? 'No socio' : 'Socio'}</span>
                      </td>
                      <td>{row.student?.member_number || '—'} · {row.student?.document_number || '—'}</td>
                      <td>{row.plan_key || '—'}</td>
                      <td>{coloniaStatusLabel(coloniaOperationalStatus(row, summary))}</td>
                      <td>{coloniaSourceLabel(row.source)}</td>
                      <td>
                        {row.guardian?.full_name || '—'}
                        <span className="muted">{row.guardian?.phone || ''}</span>
                      </td>
                      <td>{money(summary?.totalContracted)}</td>
                      <td>{money(summary?.totalCollected)}</td>
                      <td>{money(summary?.balanceDue)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy || !canReceipt}
                          title={canReceipt ? 'Descargar inscripción + mes' : 'Sin pago acreditado'}
                          onClick={(event) => downloadPaidReceipt(row, event)}
                        >
                          <FileDown size={14} aria-hidden="true" />
                          PDF
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rosterSlice.length ? (
                  <tr>
                    <td colSpan={10} className="muted">Sin inscriptos en esta temporada.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ColoniaPager page={rosterPageSafe} total={rosterRows.length} onPage={setRosterPage} />
          {selectedEnrollment ? (
            <div className="colonia-ficha">
              {fichaSocio ? (
                <div className="colonia-ficha-charge">
                  <p>
                    Socio: se puede cobrar Colonia a {fichaSocio.name}
                    {fichaSocio.memberNumber ? ` · Nº ${fichaSocio.memberNumber}` : ''}.
                    No es la cuota social.
                  </p>
                  {canCollect && selectedEnrollment.status !== 'cancelada' && fichaDue > 0 ? (
                    <>
                      <p className="muted">
                        Abierto: inscripción {money(fichaInscriptionDue)} · mes/plan {money(fichaPlanDue)} · total {money(fichaDue)}.
                        Se pueden cobrar por separado; el saldo y el estado siguen la misma cuenta Colonia.
                      </p>
                      <div className="colonia-pay-scopes" role="group" aria-label="Cobro separable">
                        {fichaInscriptionDue > 0 ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy || payMethod === 'mercadopago'}
                            onClick={() => submitPayment(fichaInscriptionDue)}
                          >
                            {`Cobrar inscripción · ${money(fichaInscriptionDue)}`}
                          </button>
                        ) : null}
                        {fichaPlanDue > 0 ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy || payMethod === 'mercadopago'}
                            onClick={() => submitPayment(fichaPlanDue)}
                          >
                            {`Cobrar mes/plan · ${money(fichaPlanDue)}`}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm primary"
                          disabled={busy || payMethod === 'mercadopago'}
                          onClick={() => submitPayment(fichaDue)}
                        >
                          {`Cobrar todo · ${money(fichaDue)}`}
                        </button>
                      </div>
                      <ColoniaPayDesk
                        method={payMethod}
                        onMethod={setPayMethod}
                        bankId={payBankId}
                        onBank={setPayBankId}
                        reference={payRef}
                        onReference={setPayRef}
                        disabled={busy}
                        notes={false}
                        plans={paymentPlans}
                        amount={fichaPayable}
                        posRef={payPosRef}
                      />
                      {openDue.late ? (
                        <p className="colonia-banner warn">
                          Desde diciembre, la cuota paga después del 10 lleva 15 % de interés ({money(openDue.interest)}). Noviembre y la inscripción no.
                        </p>
                      ) : null}
                      {payMethod === 'mercadopago' ? (
                        <MercadoPagoCheckout
                          kind="colonia"
                          mode="qr"
                          amount={fichaPayable}
                          enrollmentId={selectedEnrollment.id}
                          memberNumber={fichaSocio.memberNumber}
                          concept={`Colonia de Verano · ${selectedEnrollment.student?.full_name || ''}`}
                          disabled={busy}
                          onApproved={() => {
                            void refreshAccount(selectedEnrollment.id);
                            void reloadSeasonLists();
                          }}
                        />
                      ) : (
                        <button type="button" className="btn primary" disabled={busy} onClick={() => submitPayment(fichaPayable)}>
                          {`Cobrar al socio · ${money(fichaPayable)}`}
                        </button>
                      )}
                    </>
                  ) : canCollect && selectedEnrollment.status !== 'cancelada' ? (
                    <p className="muted">Al día. No hay saldo de Colonia para cobrar.</p>
                  ) : null}
                </div>
              ) : (
                <div className="colonia-ficha-charge">
                  <p className="muted">No socio: el cobro queda solo en la ficha de Colonia (no es cuota social).</p>
                  {canCollect && selectedEnrollment.status !== 'cancelada' && fichaDue > 0 ? (
                    <>
                      <p className="muted">
                        Abierto: inscripción {money(fichaInscriptionDue)} · mes/plan {money(fichaPlanDue)} · total {money(fichaDue)}.
                      </p>
                      <div className="colonia-pay-scopes" role="group" aria-label="Cobro separable">
                        {fichaInscriptionDue > 0 ? (
                          <button type="button" className="btn btn-sm" disabled={busy || payMethod === 'mercadopago'} onClick={() => submitPayment(fichaInscriptionDue)}>
                            {`Cobrar inscripción · ${money(fichaInscriptionDue)}`}
                          </button>
                        ) : null}
                        {fichaPlanDue > 0 ? (
                          <button type="button" className="btn btn-sm" disabled={busy || payMethod === 'mercadopago'} onClick={() => submitPayment(fichaPlanDue)}>
                            {`Cobrar mes/plan · ${money(fichaPlanDue)}`}
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-sm primary" disabled={busy || payMethod === 'mercadopago'} onClick={() => submitPayment(fichaDue)}>
                          {`Cobrar todo · ${money(fichaDue)}`}
                        </button>
                      </div>
                      <ColoniaPayDesk
                        method={payMethod}
                        onMethod={setPayMethod}
                        bankId={payBankId}
                        onBank={setPayBankId}
                        reference={payRef}
                        onReference={setPayRef}
                        disabled={busy}
                        notes={false}
                        plans={paymentPlans}
                        amount={fichaDue}
                        posRef={payPosRef}
                      />
                      {payMethod !== 'mercadopago' ? (
                        <button type="button" className="btn primary" disabled={busy} onClick={() => submitPayment(fichaDue)}>
                          {`Registrar cobro · ${money(fichaDue)}`}
                        </button>
                      ) : (
                        <MercadoPagoCheckout
                          kind="colonia"
                          mode="qr"
                          amount={fichaDue}
                          enrollmentId={selectedEnrollment.id}
                          memberNumber=""
                          concept={`Colonia de Verano · ${selectedEnrollment.student?.full_name || ''}`}
                          disabled={busy}
                          onApproved={() => {
                            void refreshAccount(selectedEnrollment.id);
                            void reloadSeasonLists();
                          }}
                        />
                      )}
                    </>
                  ) : canCollect && selectedEnrollment.status !== 'cancelada' ? (
                    <p className="muted">Al día. No hay saldo de Colonia para cobrar.</p>
                  ) : null}
                </div>
              )}
              {paidReceiptForEnrollment(selectedEnrollment) ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(event) => downloadPaidReceipt(selectedEnrollment, event)}
                >
                  <FileDown size={14} aria-hidden="true" />
                  Descargar comprobante
                </button>
              ) : null}
              {selectedEnrollment.status !== 'cancelada' && canFinance ? (
                <button type="button" className="btn" disabled={busy} onClick={cancelSelectedEnrollment}>
                  Cancelar inscripción
                </button>
              ) : null}
              {canAttend ? (
                <button type="button" className="btn" disabled={busy} onClick={() => grantExcursionAuth(selectedEnrollment.id)}>
                  Autorizar excursión
                </button>
              ) : null}
              {canHealth ? (
                <div className="colonia-form">
                  <h4>Salud (restringido)</h4>
                  <label><span>Alergias</span>
                    <input value={healthAllergies} onChange={(e) => setHealthAllergies(e.target.value)} />
                  </label>
                  <label><span>Notas de salud</span>
                    <input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} />
                  </label>
                  <button type="button" className="btn" disabled={busy} onClick={saveHealth}>
                    Guardar salud
                  </button>
                </div>
              ) : (
                <p className="muted">Datos de salud de menores: solo personal administrativo autorizado.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeSection === 'cuenta' ? (
        <section className="colonia-panel">
          <h3><Wallet size={16} /> Cuenta de Colonia</h3>
          <p className="muted">
            Cada mes de la temporada por separado: lo cobrado y lo que falta de ese mes. No es la cuota social.
          </p>
          <div className="colonia-sheet-bar">
            <div className="colonia-sheets" role="tablist" aria-label="Hojas de la cuenta">
              {[...monthBooks, { key: 'todos', label: 'Todos', lines: accountRows }].map((sheet) => (
                <button
                  key={sheet.key}
                  type="button"
                  role="tab"
                  aria-selected={accountMonthKey === sheet.key}
                  className={accountMonthKey === sheet.key ? 'is-on' : ''}
                  onClick={() => setAccountMonth(sheet.key)}
                >
                  {sheet.label}
                  <b>{(sheet.lines || []).filter((row) => row.status === 'falta').length}</b>
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={downloadAccountSheets}>
              Excel
            </button>
          </div>
          {accountNotice ? <p className="colonia-banner">{accountNotice}</p> : null}
          <div className="table-container">
            <table className="admin-table colonia-account-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Nº / DNI</th>
                  <th>Plan</th>
                  <th>Cobrado</th>
                  <th>Falta</th>
                  <th>Próximo mes</th>
                  <th>Estado</th>
                  <th>Avisos</th>
                  <th>Comprobante</th>
                  <th>Cancelar</th>
                </tr>
              </thead>
              <tbody>
                {accountVisible.map((row) => {
                  const student = row.enrollment.student || {};
                  const payer = coloniaPayer(row);
                  const canNotify = row.noticeAmount > 0;
                  const canReceipt = Boolean(paidReceiptForEnrollment(row.enrollment));
                  return (
                    <tr key={row.enrollment.id}>
                      <td>
                        <strong>{student.full_name || '—'}</strong>
                        <span className="muted">
                          {student.member_kind === 'no_socio' ? 'No socio' : 'Socio'}
                        </span>
                      </td>
                      <td>{student.member_number || '—'} · {student.document_number || '—'}</td>
                      <td>{row.plan || '—'}</td>
                      <td>{money(row.summary.totalCollected)}</td>
                      <td>{money(row.owed)}</td>
                      <td>{row.nextAmount > 0 ? `${row.nextLabel} · ${money(row.nextAmount)}` : '—'}</td>
                      <td>{coloniaAccountStatus(row)}</td>
                      <td>
                        {canNotify ? (
                          <div className="colonia-account-actions">
                            <button type="button" className="btn" disabled={!payer.phone} onClick={() => openColoniaWhatsApp(row)}>WhatsApp</button>
                            <button type="button" className="btn" disabled={!payer.memberNumber} onClick={() => sendColoniaMd(row)}>MD</button>
                            <button type="button" className="btn" disabled={!payer.memberNumber || !payer.email} onClick={() => sendColoniaMail(row)}>Mail</button>
                          </div>
                        ) : (
                          <span className="muted">Al día</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy || !canReceipt}
                          title={canReceipt ? 'Descargar inscripción + mes' : 'Sin pago acreditado'}
                          onClick={(event) => downloadPaidReceipt(row.enrollment, event)}
                        >
                          <FileDown size={14} aria-hidden="true" />
                          PDF
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !canOperate}
                          onClick={() => cancelAccountEnrollment(row.enrollment)}
                        >
                          Cancelar
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!accountVisible.length ? (
                  <tr>
                    <td colSpan={10} className="muted">Nadie en este mes.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeSection === 'hermanos' ? (
        <section className="colonia-panel">
          <h3>Hermanos y promociones</h3>
          <p className="muted">
            El grupo de hermanos de Colonia es distinto del grupo familiar del padrón.
            Las promos de hermanos son de temporada completa.
          </p>
          <div className="colonia-form">
            <label><span>Buscar hermano</span>
              <input
                value={siblingQuery}
                placeholder="Nombre, Nº o DNI"
                onChange={(e) => {
                  setSiblingQuery(e.target.value);
                  setSiblingPage(0);
                }}
              />
            </label>
          </div>
          {siblingNeedle && !siblingTableRows.length ? (
            <p className="colonia-search-miss">{clubMailSearchMissMessage(siblingQuery)}</p>
          ) : null}
          <div className="table-container">
            <table className="admin-table colonia-account-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Nº / DNI</th>
                  <th>Plan</th>
                  <th>Socio</th>
                  <th>Grupo</th>
                  <th>Promo</th>
                </tr>
              </thead>
              <tbody>
                {siblingSlice.map((row) => {
                  const student = row.enrollment?.student;
                  return (
                    <tr
                      key={row.id}
                      className={row.enrollment ? (selectedEnrollment?.id === row.enrollment.id ? 'is-on is-pick' : 'is-pick') : ''}
                      onClick={row.enrollment ? () => openEnrollment(row.enrollment) : undefined}
                    >
                      <td><strong>{student?.full_name || '—'}</strong></td>
                      <td>{student ? `${student.member_number || '—'} · ${student.document_number || '—'}` : '—'}</td>
                      <td>{row.enrollment?.plan_key || row.group?.promotion_plan || '—'}</td>
                      <td>{student ? (student.member_kind === 'no_socio' ? 'No socio' : 'Socio') : '—'}</td>
                      <td>{row.group?.label || 'Sin grupo'}</td>
                      <td>{row.group?.promotion_plan || '—'}</td>
                    </tr>
                  );
                })}
                {!siblingSlice.length ? (
                  <tr>
                    <td colSpan={6} className="muted">Sin grupos cargados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ColoniaPager page={siblingPageSafe} total={siblingTableRows.length} onPage={setSiblingPage} />
        </section>
      ) : null}

      {activeSection === 'cobranzas' ? (
        <section className="colonia-panel">
          <ColoniaCashPanel roles={roles} role={role} paymentPlans={paymentPlans} />
          <div className="colonia-grid-2" style={{ marginTop: '1.25rem' }}>
          <div>
            <h3><Wallet size={16} /> Cobranza Colonia</h3>
            <p className="muted">Medios de Jockey Connect. Nunca imputa a cuota social ni tenis.</p>
            <label className="colonia-field"><span>Inscripción</span>
              <select
                value={selectedEnrollment?.id || ''}
                onChange={(e) => {
                  const row = enrollments.find((x) => x.id === e.target.value);
                  setSelectedEnrollment(row || null);
                  if (row) refreshAccount(row.id);
                }}
              >
                <option value="">Elegir…</option>
                {enrollments.map((row) => (
                  <option key={row.id} value={row.id}>{row.student?.full_name}</option>
                ))}
              </select>
            </label>
            <ColoniaPayDesk
              method={payMethod}
              onMethod={setPayMethod}
              bankId={payBankId}
              onBank={setPayBankId}
              reference={payRef}
              onReference={setPayRef}
              disabled={busy}
              plans={paymentPlans}
              amount={Number(payAmount) > 0 ? Number(payAmount) : fichaPayable}
              posRef={payPosRef}
            />
            <label className="colonia-field"><span>Importe</span>
              <input type="number" min="0" step="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            {selectedEnrollment && fichaDue > 0 ? (
              <div className="colonia-pay-scopes" role="group" aria-label="Cobro separable">
                {fichaInscriptionDue > 0 ? (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPayAmount(String(fichaInscriptionDue))}>
                    {`Inscripción · ${money(fichaInscriptionDue)}`}
                  </button>
                ) : null}
                {fichaPlanDue > 0 ? (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPayAmount(String(fichaPlanDue + fichaLateInterest))}>
                    {`Mes/plan · ${money(fichaPlanDue + fichaLateInterest)}`}
                  </button>
                ) : null}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPayAmount(String(fichaPayable))}>
                  {`Todo · ${money(fichaPayable)}`}
                </button>
              </div>
            ) : null}
            {payMethod === 'mercadopago' ? (
              <MercadoPagoCheckout
                kind="colonia"
                mode="qr"
                amount={Number(payAmount) > 0 ? Number(payAmount) : fichaPayable}
                enrollmentId={selectedEnrollment?.id}
                memberNumber={responsibleSocio(selectedEnrollment)?.memberNumber || selectedEnrollment?.student?.member_number || ''}
                concept={`Colonia de Verano${selectedEnrollment?.student?.full_name ? ` · ${selectedEnrollment.student.full_name}` : ''}`}
                disabled={!selectedEnrollment?.id || !canCollect}
                onApproved={() => {
                  if (!selectedEnrollment?.id) return;
                  void refreshAccount(selectedEnrollment.id);
                  void reloadSeasonLists();
                }}
              />
            ) : (
              <button type="button" className="btn primary" disabled={busy || !canCollect} onClick={submitPayment}>
                Registrar cobro Colonia
              </button>
            )}
            <p className="muted">
              Saldo {money(fichaDue)}
              {' · '}inscripción {money(fichaInscriptionDue)}
              {' · '}mes/plan {money(fichaPlanDue)}
              {fichaLateInterest > 0 ? ` · con interés 15 % ${money(fichaPayable)}` : ''}
              {' · '}pend. confirmar {money(accountSummary.pendingConfirmation)}
            </p>
          </div>
          <div>
            <h4>Cargos</h4>
            <ul className="colonia-list">
              {charges.map((c) => (
                <li key={c.id} className="colonia-row-actions">
                  <span>{c.concept} · {money(c.amount)} · {c.status}</span>
                  {c.status === 'posted' && canCollect ? (
                    <button type="button" className="btn" disabled={busy} onClick={() => voidSelectedCharge(c.id)}>
                      Anular
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <h4>Pagos</h4>
            <ul className="colonia-list">
              {payments.map((p) => {
                const receipt = p.status === 'confirmed'
                  ? buildColoniaReceipt({
                    payment: p,
                    student: selectedEnrollment?.student,
                    guardian: selectedEnrollment?.guardian,
                    season,
                  })
                  : null;
                return (
                  <li key={p.id} className="colonia-row-actions">
                    <span>
                      {coloniaMethodLabel(p.method)} · {money(p.amount)} · {p.status}
                      {receipt ? (
                        <span className="muted"> · op {receipt.operationId?.slice?.(0, 8) || '—'} · {receipt.fiscalNote}</span>
                      ) : null}
                    </span>
                    {p.status === 'pending' && canCollect && p.method !== 'mercadopago' ? (
                      <button type="button" className="btn" disabled={busy} onClick={() => confirmPendingPayment(p.id)}>
                        Confirmar
                      </button>
                    ) : null}
                    {receipt ? (
                      <button type="button" className="btn" onClick={() => setReceiptPreview(receipt)}>
                        Ver comprobante
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {receiptPreview ? (
              <div className="colonia-ficha">
                <h4>Comprobante interno</h4>
                <p>{receiptPreview.studentName} · Resp. {receiptPreview.guardianName}</p>
                <p>{receiptPreview.seasonName} · {receiptPreview.conceptLabel}</p>
                <p>{money(receiptPreview.amount)} · {receiptPreview.method} · {receiptPreview.paidAt || '—'}</p>
                <p className="muted">Op. {receiptPreview.operationId || receiptPreview.reference}</p>
                <p className="muted">{receiptPreview.fiscalNote}</p>
              </div>
            ) : null}
          </div>
          </div>
        </section>
      ) : null}

      {activeSection === 'asistencia' ? (
        <section className="colonia-panel colonia-roll">
          <header className="colonia-roll-head">
            <div>
              <h3><CalendarDays size={16} /> Asistencia</h3>
              <p>Pasá lista del día. Cada chico se marca en su fila.</p>
            </div>
            <label className="colonia-roll-day"><span>Día</span>
              <input
                type="date"
                value={attendanceDay}
                onChange={(e) => {
                  setAttendanceDay(e.target.value);
                  setAttendancePage(0);
                }}
              />
            </label>
          </header>
          {!canAttend ? (
            <p className="colonia-banner warn">Sin permiso de asistencia Colonia.</p>
          ) : null}
          <div className="colonia-roll-counts" role="tablist" aria-label="Resumen del día">
            {[
              ['todos', 'En lista', rollCall.length],
              ['presente', 'Presentes', rollCounts.presente],
              ['ausente', 'Ausentes', rollCounts.ausente],
              ['justificada', 'Justificadas', rollCounts.justificada],
              ['retiro_anticipado', 'Se retiraron', rollCounts.retiro_anticipado],
              ['sin_marcar', 'Sin marcar', rollCounts.sin_marcar],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={attendanceFocus === key}
                className={attendanceFocus === key ? 'is-on' : ''}
                onClick={() => {
                  setAttendanceFocus(key);
                  setAttendancePage(0);
                }}
              >
                <b>{count}</b>
                <small>{label}</small>
              </button>
            ))}
          </div>
          <div className="colonia-sheets" role="tablist" aria-label="Edades">
            {COLONIA_AGE_BANDS.map((band) => (
              <button
                key={band.key}
                type="button"
                role="tab"
                aria-selected={attendanceBand === band.key}
                className={attendanceBand === band.key ? 'is-on' : ''}
                onClick={() => {
                  setAttendanceBand(band.key);
                  setAttendancePage(0);
                }}
              >
                {band.label}
              </button>
            ))}
          </div>
          <div className="colonia-form">
            <label><span>Buscar</span>
              <input
                value={attendanceQuery}
                placeholder="Nombre, Nº o DNI"
                onChange={(e) => {
                  setAttendanceQuery(e.target.value);
                  setAttendancePage(0);
                }}
              />
            </label>
          </div>
          {attendanceQuery.trim() && !rollFiltered.length ? (
            <p className="colonia-search-miss">{clubMailSearchMissMessage(attendanceQuery)}</p>
          ) : null}
          <div className="table-container">
            <table className="admin-table colonia-account-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Edad</th>
                  <th>Grupo</th>
                  <th>Retira</th>
                  <th>Lista</th>
                </tr>
              </thead>
              <tbody>
                {rollSlice.map((item) => {
                  const student = item.row.student || {};
                  return (
                    <tr key={item.row.id}>
                      <td>
                        <strong>{student.full_name || '—'}</strong>
                        <AllergyMark show={canHealth && coloniaHasAllergy(healthByStudent.get(student.id)?.allergies)} />
                        <span className="muted">{student.member_number ? `Nº ${student.member_number}` : ''}</span>
                      </td>
                      <td>{item.age == null ? 'Sin edad' : `${item.age} años`}</td>
                      <td>{item.groupName || '—'}</td>
                      <td><PickupLines guardian={item.row.guardian} /></td>
                      <td>
                        <div className="colonia-roll-marks" role="group" aria-label={`Lista de ${student.full_name || 'alumno'}`}>
                          {COLONIA_ROLL_STATUSES.map((status) => (
                            <button
                              key={status.id}
                              type="button"
                              className={item.status === status.id ? `is-on is-${status.id}` : ''}
                              disabled={!canAttend || attendanceSavingId === item.row.id}
                              aria-pressed={item.status === status.id}
                              onClick={() => markAttendance(item.row.id, status.id)}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!rollSlice.length ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      {rollCall.length ? 'Nadie en este filtro.' : 'Todavía no hay inscriptos para pasar lista.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <ColoniaPager page={rollPageSafe} total={rollFiltered.length} onPage={setAttendancePage} />
        </section>
      ) : null}

      {activeSection === 'grupos' ? (
        <section className="colonia-panel">
          <h3>Grupos</h3>
          <div className="colonia-age-groups">
            {[
              ['3 a 5 años', (age) => age >= 3 && age <= 5],
              ['6 a 8 años', (age) => age >= 6 && age <= 8],
              ['9 a 11 años', (age) => age >= 9 && age <= 11],
              ['12 a 15 años', (age) => age >= 12 && age <= 15],
              ['Otra edad', (age) => age != null && (age < 3 || age > 15)],
              ['Sin fecha', (age) => age == null],
            ].map(([label, match]) => {
              const kids = enrollments
                .filter((row) => row.status !== 'cancelada')
                .map((row) => {
                  const birth = String(row.student?.birth_date || row.student?.birthDate || '').slice(0, 10);
                  const age = ageYearsOn(birth, seasonAge.activitiesStartOn);
                  return { row, age };
                })
                .filter((item) => match(item.age))
                .toSorted((a, b) => (a.age ?? 99) - (b.age ?? 99) || String(a.row.student?.full_name || '').localeCompare(String(b.row.student?.full_name || ''), 'es'));
              if (!kids.length) return null;
              return (
                <article key={label}>
                  <h4>{label} <b>{kids.length}</b></h4>
                  <ul className="colonia-list">
                    {kids.map(({ row, age }) => (
                      <li key={row.id}>
                        <span>
                          <strong>{row.student?.full_name || '—'}</strong>
                          <small>
                            {age == null ? 'Sin fecha de nacimiento' : `${age} años`}
                            {row.student?.member_number ? ` · Nº ${row.student.member_number}` : ''}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          {!enrollments.filter((row) => row.status !== 'cancelada').length ? (
            <p className="muted">Todavía no hay inscriptos para agrupar por edad.</p>
          ) : null}
          <div className="colonia-form inline">
            <label><span>Nombre</span>
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ej. Grupo A 6-8" />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canOperate} onClick={createGroup}>
              Crear grupo
            </button>
          </div>
          <ul className="colonia-list">
            {groups.map((g) => (
              <li key={g.id}>{g.name} · cupo {g.capacity ?? '—'} · {g.lead_name || 'sin responsable asignado'}</li>
            ))}
            {!groups.length ? <li className="muted">Sin grupos configurados.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'actividades' ? (
        <section className="colonia-panel">
          <h3>Actividades</h3>
          <div className="colonia-form">
            <label><span>Tipo</span>
              <select value={activityKind} onChange={(e) => setActivityKind(e.target.value)}>
                {COLONIA_ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label><span>Título</span>
              <input value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} />
            </label>
            <label><span>Fecha</span>
              <input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} />
            </label>
            <button type="button" className="btn primary" disabled={busy || !canOperate} onClick={createActivity}>
              Programar actividad
            </button>
          </div>
          <ul className="colonia-list">
            {activities.map((a) => (
              <li key={a.id}>{a.kind} · {a.title} · {a.activity_date || 'sin fecha'}</li>
            ))}
            {!activities.length ? <li className="muted">Sin actividades cargadas.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'reportes' ? (
        <section className="colonia-panel colonia-report">
          <header className="colonia-report-head">
            <div>
              <p className="colonia-kicker">Temporada {seasonView.code || '2026-2027'}</p>
              <h3>Reportes de la mañana</h3>
              <p>La deuda que ves es solo de Colonia.</p>
            </div>
            <div className="colonia-report-actions">
              <button type="button" className="btn" onClick={downloadReportSheets}>Descargar hojas</button>
              <button type="button" className="btn" disabled={!enrollments.length} onClick={exportEnrollmentsCsv}>
                CSV de inscriptos
              </button>
            </div>
          </header>
          <div className="colonia-sheet-bar">
            <div className="colonia-sheets" role="tablist" aria-label="Hojas de reportes">
              {COLONIA_REPORT_SHEETS.map((sheet) => (
                <button
                  key={sheet.key}
                  type="button"
                  role="tab"
                  aria-selected={reportSheet === sheet.key}
                  className={reportSheet === sheet.key ? 'is-on' : ''}
                  onClick={() => setReportSheet(sheet.key)}
                >
                  {sheet.label}
                  <b>{coloniaReportRows(enrollments, sheet.key).length}</b>
                </button>
              ))}
            </div>
          </div>
          {reportSheet === 'resumen' ? (
            <div className="colonia-report-board">
              <article className="colonia-money is-due">
                <span>Falta cobrar</span>
                <strong>{money(stats?.balance_due)}</strong>
                <i style={{ width: `${(() => {
                  const due = Number(stats?.balance_due) || 0;
                  const paid = Number(stats?.payments_confirmed) || 0;
                  const all = due + paid;
                  return all ? `${Math.round((due / all) * 100)}%` : '0%';
                })()}` }} />
              </article>
              <article className="colonia-money is-paid">
                <span>Ya entró</span>
                <strong>{money(stats?.payments_confirmed)}</strong>
                <i style={{ width: `${(() => {
                  const due = Number(stats?.balance_due) || 0;
                  const paid = Number(stats?.payments_confirmed) || 0;
                  const all = due + paid;
                  return all ? `${Math.round((paid / all) * 100)}%` : '0%';
                })()}` }} />
              </article>
              <article className="colonia-chart-card">
                <h4>Estado de las fichas</h4>
                <ColoniaDonut
                  total={coloniaReportRows(enrollments, 'inscriptos').length}
                  label="Estado de las inscripciones"
                  parts={[
                    { label: 'Confirmadas', value: coloniaReportRows(enrollments, 'confirmadas').length, color: '#e7a23a' },
                    { label: 'Pendientes', value: coloniaReportRows(enrollments, 'pendientes').length, color: '#1a7a8c' },
                  ]}
                />
              </article>
              <article className="colonia-chart-card">
                <h4>De dónde llegaron</h4>
                <ColoniaBars
                  items={[
                    { label: 'Administración', value: coloniaReportRows(enrollments, 'admin').length, color: '#14382c' },
                    { label: 'Portal', value: coloniaReportRows(enrollments, 'portal').length, color: '#1a7a8c' },
                    { label: 'Externas', value: coloniaReportRows(enrollments, 'externas').length, color: '#e7a23a' },
                  ]}
                />
                <div className="colonia-split" aria-label="Socios y no socios">
                  <span>Socios {coloniaReportRows(enrollments, 'socios').length}</span>
                  <span>No socios {coloniaReportRows(enrollments, 'no_socios').length}</span>
                </div>
              </article>
            </div>
          ) : (
            <div className="table-container">
              <table className="admin-table colonia-account-table">
                <thead>
                  <tr>
                    {COLONIA_REPORT_HEADERS.map((header) => <th key={header}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {coloniaReportRows(enrollments, reportSheet).map((row) => {
                    const cells = coloniaReportCells(row);
                    return (
                      <tr key={row.id}>
                        {cells.map((cell, index) => <td key={COLONIA_REPORT_HEADERS[index]}>{cell || '—'}</td>)}
                      </tr>
                    );
                  })}
                  {!coloniaReportRows(enrollments, reportSheet).length ? (
                    <tr><td colSpan={COLONIA_REPORT_HEADERS.length} className="muted">Nadie en esta hoja.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeSection === 'configuracion' ? (
        <section className="colonia-panel">
          <h3>Configuración</h3>
          <p>Contactos: {(season?.contacts || COLONIA_SEASON_2026_2027.contacts).join(' · ')}</p>
          <p>Inscripciones: {seasonView.enrollment_opens_on || seasonView.enrollmentOpensOn} → {seasonView.enrollment_closes_on || seasonView.enrollmentClosesOn} (incluye cierre).</p>
          <p>Fin de temporada: {season?.activities_end_on || 'configurable (sin fecha publicada)'}</p>
          <label className="colonia-field">
            <span>Periodicidad promociones hermanos</span>
            <select
              value={season?.promotion_periodicity || ''}
              onChange={(e) => savePromotionPeriodicity(e.target.value || null)}
            >
              <option value="">Sin definir (bloquear promos)</option>
              <option value="monthly">Mensual</option>
              <option value="season">Temporada completa</option>
            </select>
          </label>
          <p className="muted">Inscripción fija: {money(inscriptionAmount())}. Tarifas versionadas por temporada; no recalculan cargos históricos.</p>
        </section>
      ) : null}
    </div>
  );
}
