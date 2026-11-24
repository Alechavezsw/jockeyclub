import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Baby,
  CalendarDays,
  ClipboardList,
  Users,
  Wallet,
} from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { deliverableEmail } from '../../domain/messaging/clubNotice';
import { MAILBOX, createMessage } from '../../domain/messaging/messages';
import { toWhatsAppPhone } from '../../domain/members/dues';
import {
  familyPrincipalOf,
  householdRoleLabel,
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
  COLONIA_ATTENDANCE_STATUSES,
  COLONIA_PAYMENT_METHODS,
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
  planAmountFor,
} from '../../domain/colonia/coloniaTariffs';
import {
  buildColoniaAccountRows,
  buildColoniaEnrollmentsCsv,
  buildColoniaReceipt,
  summarizeColoniaAccount,
} from '../../domain/colonia/coloniaLedger';
import {
  buildColoniaPaymentDraft,
  coloniaMercadoPagoAdapterSpec,
} from '../../domain/colonia/coloniaPayments';
import {
  canAccessColonia,
  canAttendColonia,
  canCollectColonia,
  canManageColoniaHealth,
  canViewColoniaFinance,
} from '../../domain/auth/roles';
import {
  coloniaSourceLabel,
  coloniaStatusLabel,
} from '../../domain/colonia/coloniaPortal';
import {
  COLONIA_ACCOUNT_HEADERS,
  COLONIA_ACCOUNT_SHEETS,
  COLONIA_REPORT_HEADERS,
  COLONIA_REPORT_SHEETS,
  coloniaAccountCells,
  coloniaAccountOnSheet,
  coloniaAccountStatus,
  coloniaReportCells,
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

export default function ColoniaTab({
  roles = [],
  role,
  members = [],
  onlySection = '',
  onSendMessage,
}) {
  const canOperate = canAccessColonia({ roles, role });
  const canCollect = canCollectColonia({ roles, role });
  const canAttend = canAttendColonia({ roles, role });
  const canFinance = canViewColoniaFinance({ roles, role });
  const canHealth = canManageColoniaHealth({ roles, role });
  const [section, setSection] = useState('resumen');
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
  const [accountFilter, setAccountFilter] = useState('falta');
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
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [attendanceDay, setAttendanceDay] = useState(todayIso());
  const [attendanceStatus, setAttendanceStatus] = useState('presente');
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
  const [siblingQuery, setSiblingQuery] = useState('');
  const [slotQuery, setSlotQuery] = useState({});
  const [showFamilyPicker, setShowFamilyPicker] = useState(false);
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
  const mpSpec = coloniaMercadoPagoAdapterSpec();

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
  const memberParsed = clubMailMemberQuery(memberQuery);
  const memberSearchReady = student.memberKind === 'socio' && (
    memberParsed.kind === 'number'
    || (memberParsed.kind === 'text' && memberParsed.text.length >= 2)
  );
  const planPrice = planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, planKey);
  const inscriptionPrice = inscriptionAmount(COLONIA_OFFICIAL_TARIFFS_2026_2027);
  const pupilCount = rosterPreview.length;
  const rosterHits = rosterQuery.trim()
    ? enrollments.filter((row) => enrollmentMatchesRoster(row, rosterQuery)).slice(0, 12)
    : [];
  const siblingNeedle = siblingQuery.trim();
  const siblingGroupHits = siblingNeedle
    ? siblingGroups.filter((group) => {
      const folded = foldColoniaText(siblingNeedle);
      return foldColoniaText(group.label).includes(folded)
        || foldColoniaText(group.promotion_plan).includes(folded);
    })
    : siblingGroups;
  const siblingKidHits = siblingNeedle
    ? enrollments.filter((row) => enrollmentMatchesRoster(row, siblingQuery)).slice(0, 12)
    : [];
  const accountRows = useMemo(() => buildColoniaAccountRows({
    enrollments,
    charges: seasonCharges,
    payments: seasonPayments,
    tariffs: COLONIA_OFFICIAL_TARIFFS_2026_2027,
    periodicity: season?.promotion_periodicity || null,
  }), [enrollments, seasonCharges, seasonPayments, season?.promotion_periodicity]);
  const accountVisible = accountRows.filter((row) => coloniaAccountOnSheet(row, accountFilter));
  const enrollmentTotal = ((Number(inscriptionPrice) || 0) * pupilCount) + (Number(planPrice) || 0);
  const seasonAge = {
    activitiesStartOn: season?.activities_start_on || COLONIA_SEASON_2026_2027.activitiesStartOn,
    ageMin: season?.age_min ?? 3,
    ageMax: season?.age_max ?? 15,
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
  const chosenFamilyNames = chosenKeys
    .map((key) => household.find((row) => memberKey(row) === key))
    .filter(Boolean)
    .map((row) => memberDisplayName(row));

  useEffect(() => {
    if (student.memberKind !== 'socio') {
      setMemberHits([]);
      setMemberSearchBusy(false);
      return undefined;
    }
    const parsed = clubMailMemberQuery(memberQuery);
    if (parsed.kind === 'empty' || (parsed.kind === 'text' && parsed.text.length < 2)) {
      setMemberHits([]);
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

  function applyChosen(keys, rows, need = childSlots) {
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
    for (const sheet of COLONIA_ACCOUNT_SHEETS) {
      const lines = accountRows.filter((row) => coloniaAccountOnSheet(row, sheet.key));
      const aoa = [COLONIA_ACCOUNT_HEADERS, ...lines.map(coloniaAccountCells)];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = COLONIA_ACCOUNT_HEADERS.map((header, index) => {
        const widest = aoa.reduce((max, line) => Math.max(max, String(line[index] ?? '').length), header.length);
        return { wch: Math.min(42, Math.max(12, widest + 2)) };
      });
      XLSX.utils.book_append_sheet(book, ws, sheet.label.slice(0, 31));
    }
    XLSX.writeFile(book, `colonia-cuenta-${season?.code || 'temporada'}.xlsx`);
    setAccountNotice('Excel descargado con las hojas Falta pagar, Próximo mes, Pagaron y Todos.');
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
    setSection('alumnos');
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
    applyChosen(keys, household.length ? household : pool, need);
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
      setHousehold([]);
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

  async function saveHealth() {
    if (!selectedEnrollment?.student?.id || !canHealth) return;
    setBusy(true);
    try {
      await repos.coloniaUpsertStudentHealth({
        studentId: selectedEnrollment.student.id,
        healthNotes,
        allergies: healthAllergies,
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

  async function submitEnrollment() {
    setMsg('');
    if (!formOk) {
      setMsg(formErrors[0]?.message || 'Revisá el formulario.');
      return;
    }
    if (!seasonId) {
      setMsg('Seleccioná una temporada publicada en la base.');
      return;
    }
    const promo = evaluatePromotionCharge({
      planKey,
      season: { promotionPeriodicity: season?.promotion_periodicity ?? null },
      siblingCount,
      memberKinds: rosterPreview.map(() => student.memberKind),
    });
    if (!promo.ok) {
      setMsg(promo.errors[0]?.message || 'Plan no confirmable.');
      return;
    }
    setBusy(true);
    try {
      const g = await repos.upsertColoniaGuardian({
        full_name: guardian.fullName.trim(),
        document_number: guardian.documentNumber || null,
        relationship: guardian.relationship || null,
        phone: guardian.phone || null,
        email: guardian.email || null,
        emergency_contact: guardian.emergencyContact || null,
        authorized_pickup: guardian.authorizedPickup || null,
      });
      const planAmount = planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, planKey);
      const planConcept = planKey === 'temporada'
        ? 'colonia_temporada'
        : (String(planKey).startsWith('promo') ? 'colonia_promocion' : 'colonia_cuota');
      let enrollment = null;
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
          status: 'pendiente',
          source: 'admin',
          observations: index === 0 ? (student.notes || null) : null,
        });
        await repos.coloniaPostCharge({
          enrollmentId: savedEnrollment.id,
          concept: 'colonia_inscripcion',
          planKey: 'inscripcion',
          amount: inscriptionAmount(COLONIA_OFFICIAL_TARIFFS_2026_2027),
          note: 'Inscripción (incluye remera)',
        });
        if (index === 0 && planAmount != null && planAmount > 0) {
          await repos.coloniaPostCharge({
            enrollmentId: savedEnrollment.id,
            concept: planConcept,
            planKey,
            amount: planAmount,
            note: `Plan ${planKey}`,
          });
        }
        enrollment = enrollment || savedEnrollment;
      }
      setMsg(rosterPreview.length > 1
        ? 'Inscripciones del grupo registradas con cargos de Colonia (sin tocar cuota social).'
        : 'Inscripción registrada con cargos de Colonia (sin tocar cuota social).');
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
      const en = await repos.listColoniaEnrollments(seasonId);
      setEnrollments(en);
      setSelectedEnrollment(enrollment);
      await refreshAccount(enrollment.id);
      setSection('alumnos');
    } catch (err) {
      setMsg(err?.message || 'No se pudo inscribir.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment() {
    setMsg('');
    if (!selectedEnrollment?.id) {
      setMsg('Elegí una inscripción.');
      return;
    }
    if (!canCollect) {
      setMsg('Sin permiso de cobranza Colonia.');
      return;
    }
    setBusy(true);
    try {
      const draft = buildColoniaPaymentDraft({
        enrollmentId: selectedEnrollment.id,
        seasonId,
        method: payMethod,
        amount: payAmount,
        operatorConfirmed: cardConfirmed,
        externalReference: payRef,
        idempotencyKey: `colonia-${selectedEnrollment.id}-${payMethod}-${payAmount}-${payRef || 'x'}`,
      });
      const result = await repos.coloniaRecordPayment({
        enrollmentId: draft.enrollmentId,
        method: draft.method,
        amount: draft.amount,
        status: draft.status,
        externalReference: draft.externalReference,
        idempotencyKey: draft.idempotencyKey,
        operatorName: 'Mostrador Colonia',
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
        : `Pago ${coloniaMethodLabel(draft.method)} registrado como ${draft.status}.`);
      setPayAmount('');
      setPayRef('');
      setCardConfirmed(false);
      await refreshAccount(selectedEnrollment.id);
      const st = await repos.coloniaDashboardStats(seasonId).catch(() => null);
      setStats(st);
    } catch (err) {
      setMsg(err?.details?.[0]?.message || err?.message || 'No se pudo cobrar.');
    } finally {
      setBusy(false);
    }
  }

  async function markAttendance(enrollmentId) {
    setMsg('');
    if (!canAttend) {
      setMsg('Sin permiso de asistencia Colonia.');
      return;
    }
    setBusy(true);
    try {
      await repos.coloniaUpsertAttendance({
        enrollmentId,
        day: attendanceDay,
        status: attendanceStatus,
        operatorName: 'Asistencia Colonia',
      });
      setMsg('Asistencia guardada.');
    } catch (err) {
      setMsg(err?.message || 'No se pudo guardar asistencia.');
    } finally {
      setBusy(false);
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

  async function cancelSelectedEnrollment() {
    if (!selectedEnrollment?.id) return;
    const reason = window.prompt('Motivo de cancelación (mín. 5 caracteres):', 'Cancelada por Administración');
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    setMsg('');
    try {
      await repos.coloniaCancelEnrollment(selectedEnrollment.id, reason.trim());
      const en = await repos.listColoniaEnrollments(seasonId);
      setEnrollments(en);
      setSelectedEnrollment(en.find((e) => e.id === selectedEnrollment.id) || null);
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
      setMsg('Pago confirmado. Comprobante interno generado.');
      if (selectedEnrollment?.id) await refreshAccount(selectedEnrollment.id);
      const st = await repos.coloniaDashboardStats(seasonId).catch(() => null);
      setStats(st);
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
      ['Inscriptos', enrollments.length],
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
    const csv = buildColoniaEnrollmentsCsv(enrollments);
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
    const hits = pupilFilled && !searchReady ? [] : pupilGroupHits(query);
    const familyName = anchorMember ? memberDisplayName(anchorMember) : '';
    return (
      <div className="colonia-pupil">
        <div className="colonia-pupil-head">
          <h4>{title}</h4>
          {onRemove ? (
            <button type="button" className="btn" onClick={onRemove}>Quitar</button>
          ) : null}
        </div>
        {student.memberKind === 'socio' ? (
          <div className="colonia-member-search">
            <label><span>{familyName ? `Grupo familiar de ${familyName}` : 'Grupo familiar del socio'}</span>
              <input
                value={query}
                placeholder="Nombre, Nº o DNI"
                onChange={(e) => setSlotQuery((prev) => ({ ...prev, [slot]: e.target.value }))}
                disabled={!anchorMember}
              />
            </label>
            {!anchorMember ? (
              <p className="muted">Primero elegí el socio de arriba. Acá aparecen los de su grupo.</p>
            ) : null}
            {anchorMember && householdBusy ? <p className="muted">Buscando el grupo familiar…</p> : null}
            {anchorMember && !householdBusy && !pupilFilled && !hits.length && !searchReady ? (
              <p className="muted">Ese socio no tiene otros integrantes en el grupo. Cargá el alumno a mano.</p>
            ) : null}
            {anchorMember && !householdBusy && searchReady && !hits.length ? (
              <p className="colonia-search-miss">No está en el grupo familiar de {familyName}.</p>
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
        <p className="muted">Edad al inicio: {age} años</p>
        {student.memberKind === 'socio' ? (
          <label><span>Nº socio (padrón)</span>
            <input value={pupil.memberNumber} onChange={(e) => onChange({ ...pupil, memberNumber: e.target.value })} />
          </label>
        ) : null}
        <label><span>Talle remera</span>
          <input value={pupil.shirtSize} onChange={(e) => onChange({ ...pupil, shirtSize: e.target.value })} />
        </label>
      </div>
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
      {!onlySection ? <header className="colonia-hero-band">
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
        <label className="colonia-field colonia-season-pick">
          <span>Temporada</span>
          <select
            value={seasonId || ''}
            onChange={(e) => setSeasonId(e.target.value || null)}
            disabled={!seasons.length}
          >
            {!seasons.length ? <option value="">Sin temporada en base</option> : null}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
        </label>
      </header> : null}

      {!isSupabaseConfigured || !cloudReady ? (
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
            <div className="colonia-form">
              <div className="colonia-kind" role="group" aria-label="Condición del alumno">
                <button
                  type="button"
                  className={student.memberKind === 'socio' ? 'is-on' : ''}
                  onClick={() => switchMemberKind('socio')}
                >
                  <strong>Socio</strong>
                  <span>Cuota {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'socio', 'cuota'))}</span>
                </button>
                <button
                  type="button"
                  className={student.memberKind === 'no_socio' ? 'is-on' : ''}
                  onClick={() => switchMemberKind('no_socio')}
                >
                  <strong>No socio</strong>
                  <span>Cuota {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, 'no_socio', 'cuota'))}</span>
                </button>
              </div>
              {student.memberKind === 'socio' ? (
                <div className="colonia-member-search">
                  <label><span>Buscar socio del padrón</span>
                    <input
                      value={memberQuery}
                      placeholder="Nombre, Nº o DNI"
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
                  {pickedMemberLabel ? <p className="colonia-picked">{pickedMemberLabel}</p> : null}
                </div>
              ) : (
                <p className="muted">No socio: ficha solo de Colonia, sin alta en padrón. Tarifa de no socio.</p>
              )}
              <label><span>Plan · {student.memberKind === 'socio' ? 'tarifa socio' : 'tarifa no socio'}</span>
                <select value={planKey} onChange={(e) => changePlan(e.target.value)}>
                  <option value="cuota">Cuota Colonia · {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, 'cuota'))}</option>
                  <option value="temporada">Temporada completa · {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, 'temporada'))}</option>
                  <option value="promo_2">Promoción 2 hermanos · {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, 'promo_2'))}</option>
                  <option value="promo_3">Promoción 3 hermanos · {money(planAmountFor(COLONIA_OFFICIAL_TARIFFS_2026_2027, student.memberKind, 'promo_3'))}</option>
                  <option value="hermano_4">Cuarto hermano · solo inscripción</option>
                </select>
              </label>
              <p className="colonia-price">
                Inscripción {money(inscriptionPrice)}{pupilCount > 1 ? ` × ${pupilCount}` : ''}
                {Number(planPrice) > 0 ? ` + plan ${money(planPrice)}` : ''}
                {' · '}
                <strong>Total {money(enrollmentTotal)}</strong>
              </p>
              {student.memberKind === 'socio' && anchorMember && householdBusy ? (
                <p className="muted">Buscando el grupo familiar…</p>
              ) : null}
              {student.memberKind === 'socio' && anchorMember && !householdBusy && household.length > 1 ? (
                <div className="colonia-member-search">
                  {showFamilyList ? (
                    <>
                      <p className="muted">
                        {childSlots === 1
                          ? 'Elegí qué hijo del grupo familiar se inscribe.'
                          : `Elegí ${childSlots} hijos del grupo familiar.`}
                      </p>
                      <ul className="colonia-member-hits">
                        {household.map((row) => {
                          const key = memberKey(row);
                          const age = isoBirth(row)
                            ? ageYearsOn(isoBirth(row), seasonAge.activitiesStartOn)
                            : null;
                          return (
                            <li key={key || row.id}>
                              <button
                                type="button"
                                className={chosenKeys.includes(key) ? 'is-on' : ''}
                                onClick={() => toggleChild(row)}
                              >
                                <strong>{memberDisplayName(row)}</strong>
                                <span>
                                  {householdRoleLabel(row, familyPrincipalOf(anchorMember) || memberNumberOf(anchorMember))}
                                  {' · Nº '}
                                  {row.memberId || '—'}
                                  {' · DNI '}
                                  {row.documentNumber || '—'}
                                  {age != null ? ` · ${age} años` : ''}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="colonia-picked">
                      {chosenFamilyNames.join(', ') || 'Hijo elegido'}
                      <button type="button" className="btn" onClick={() => setShowFamilyPicker(true)}>Cambiar</button>
                    </p>
                  )}
                  <button type="button" className="btn" onClick={addPupil}>
                    Agregar hijo que no está en el grupo
                  </button>
                </div>
              ) : null}
              {student.memberKind === 'socio' && anchorMember && !householdBusy && household.length <= 1 ? (
                <div className="colonia-member-search">
                  <p className="muted">No está en un grupo familiar. Cargá el alumno acá abajo.</p>
                  <button type="button" className="btn" onClick={useAnchorAsPupil}>
                    Usar a {memberDisplayName(anchorMember)} como alumno
                  </button>
                </div>
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
              <button type="button" className="btn" onClick={addPupil}>Agregar hijo</button>
              <p className="muted">También se puede cargar un hijo que no esté en el padrón: se agrega la ficha y se completa a mano.</p>
              <h4>Responsable</h4>
              <label><span>Nombre</span>
                <input value={guardian.fullName} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, fullName: e.target.value }); }} />
              </label>
              <label><span>Teléfono</span>
                <input value={guardian.phone} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, phone: e.target.value }); }} />
              </label>
              <label><span>Email</span>
                <input value={guardian.email} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, email: e.target.value }); }} />
              </label>
              <label><span>Emergencia</span>
                <input value={guardian.emergencyContact} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, emergencyContact: e.target.value }); }} />
              </label>
              <label><span>Autorizados a retirar</span>
                <input value={guardian.authorizedPickup} onChange={(e) => { guardianLockedRef.current = true; setGuardian({ ...guardian, authorizedPickup: e.target.value }); }} />
              </label>
              {formErrors.length ? (
                <ul className="colonia-errors">
                  {formErrors.map((e) => <li key={e.code}>{e.message}</li>)}
                </ul>
              ) : null}
              {draftValidation.warnings.map((w) => (
                <p key={w.code} className="colonia-banner warn">{w.message}</p>
              ))}
              <button type="button" className="btn primary" disabled={busy || !formOk} onClick={submitEnrollment}>
                Registrar inscripción
              </button>
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
                onChange={(e) => setRosterQuery(e.target.value)}
              />
            </label>
          </div>
          {rosterQuery.trim() && !rosterHits.length ? (
            <p className="colonia-search-miss">{clubMailSearchMissMessage(rosterQuery)}</p>
          ) : null}
          {rosterHits.length ? (
            <ul className="colonia-member-hits">
              {rosterHits.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => openEnrollment(row)}>
                    <strong>{row.student?.full_name || '—'}</strong>
                    <span>
                      {row.student?.member_number ? `Nº ${row.student.member_number} · ` : ''}
                      DNI {row.student?.document_number || '—'}
                      {' · '}
                      {row.plan_key}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!selectedEnrollment ? (
            <p className="muted">Buscá un inscripto o elegilo desde Inscripciones.</p>
          ) : (
            <div className="colonia-ficha">
              <p><strong>{selectedEnrollment.student?.full_name}</strong></p>
              <p>DNI {selectedEnrollment.student?.document_number || '—'} · {selectedEnrollment.student?.member_kind}</p>
              <p>
                Plan {selectedEnrollment.plan_key}
                {' · '}
                {coloniaStatusLabel(selectedEnrollment.status)}
                {' · '}
                origen {coloniaSourceLabel(selectedEnrollment.source)}
              </p>
              <p>Responsable: {selectedEnrollment.guardian?.full_name || '—'} · {selectedEnrollment.guardian?.phone || ''}</p>
              <p className="muted">Cuenta Colonia — contratado {money(accountSummary.totalContracted)} · cobrado {money(accountSummary.totalCollected)} · saldo {money(accountSummary.balanceDue)}</p>
              {selectedEnrollment.student?.member_number ? (
                <p className="muted">Padrón Nº {selectedEnrollment.student.member_number} (navegación a ficha de socio sin mezclar cuentas).</p>
              ) : (
                <p className="muted">No socio: ficha solo Colonia (no ingresa al padrón institucional).</p>
              )}
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
          )}
        </section>
      ) : null}

      {activeSection === 'cuenta' ? (
        <section className="colonia-panel">
          <h3><Wallet size={16} /> Cuenta de Colonia</h3>
          <p className="muted">
            Quién pagó, quién falta y, si el plan es mensual, el mes que viene. No es la cuota social.
          </p>
          <div className="colonia-sheet-bar">
            <div className="colonia-sheets" role="tablist" aria-label="Hojas de la cuenta">
              {COLONIA_ACCOUNT_SHEETS.map((sheet) => (
                <button
                  key={sheet.key}
                  type="button"
                  role="tab"
                  aria-selected={accountFilter === sheet.key}
                  className={accountFilter === sheet.key ? 'is-on' : ''}
                  onClick={() => setAccountFilter(sheet.key)}
                >
                  {sheet.label}
                  <b>
                    {accountRows.filter((row) => coloniaAccountOnSheet(row, sheet.key)).length}
                  </b>
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={downloadAccountSheets}>
              Descargar hojas
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
                </tr>
              </thead>
              <tbody>
                {accountVisible.map((row) => {
                  const student = row.enrollment.student || {};
                  const payer = coloniaPayer(row);
                  const canNotify = row.noticeAmount > 0;
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
                    </tr>
                  );
                })}
                {!accountVisible.length ? (
                  <tr>
                    <td colSpan={8} className="muted">Nadie en esta hoja.</td>
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
            Periodicidad actual: {season?.promotion_periodicity || 'sin definir (promos bloqueadas)'}.
          </p>
          <div className="colonia-form">
            <label><span>Buscar hermano</span>
              <input
                value={siblingQuery}
                placeholder="Nombre, Nº o DNI"
                onChange={(e) => setSiblingQuery(e.target.value)}
              />
            </label>
          </div>
          {siblingNeedle && !siblingKidHits.length && !siblingGroupHits.length ? (
            <p className="colonia-search-miss">{clubMailSearchMissMessage(siblingQuery)}</p>
          ) : null}
          {siblingKidHits.length ? (
            <ul className="colonia-member-hits">
              {siblingKidHits.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => openEnrollment(row)}>
                    <strong>{row.student?.full_name || '—'}</strong>
                    <span>
                      {row.student?.member_number ? `Nº ${row.student.member_number} · ` : ''}
                      DNI {row.student?.document_number || '—'}
                      {' · '}
                      {row.plan_key}
                      {' · '}
                      {row.student?.member_kind === 'no_socio' ? 'No socio' : 'Socio'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="colonia-list">
            {siblingGroupHits.map((g) => (
              <li key={g.id}><strong>{g.label || g.id}</strong> · promo {g.promotion_plan || '—'}</li>
            ))}
            {!siblingGroupHits.length && !siblingNeedle ? <li className="muted">Sin grupos cargados.</li> : null}
          </ul>
        </section>
      ) : null}

      {activeSection === 'cobranzas' ? (
        <section className="colonia-panel">
          <ColoniaCashPanel roles={roles} role={role} />
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
            <label className="colonia-field"><span>Medio</span>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {COLONIA_PAYMENT_METHODS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="colonia-field"><span>Importe</span>
              <input type="number" min="0" step="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            <label className="colonia-field"><span>Referencia / comprobante</span>
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </label>
            {(payMethod === 'tarjeta' || payMethod === 'pos' || payMethod === 'debito') ? (
              <>
                <p className="colonia-banner warn">
                  Tarjeta/POSNET/débito no se acreditan solos: requieren confirmación verificable del resultado en terminal (autorización administrativa).
                </p>
                <label className="colonia-check">
                  <input type="checkbox" checked={cardConfirmed} onChange={(e) => setCardConfirmed(e.target.checked)} />
                  Confirmo resultado aprobado en terminal/POS
                </label>
              </>
            ) : null}
            {payMethod === 'transferencia' ? (
              <p className="colonia-banner warn">
                Transferencia queda pendiente hasta validación administrativa. No acredita el saldo Colonia hasta confirmar.
              </p>
            ) : null}
            {payMethod === 'mercadopago' ? (
              <p className="colonia-banner warn">
                Mercado Pago Colonia deshabilitado hasta webhook específico (kind={mpSpec.kind}). Estado: {mpSpec.status}.
              </p>
            ) : null}
            <button type="button" className="btn primary" disabled={busy || !canCollect} onClick={submitPayment}>
              Registrar cobro Colonia
            </button>
            <p className="muted">Saldo inscripción: {money(accountSummary.balanceDue)} · Pend. confirmar {money(accountSummary.pendingConfirmation)}</p>
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
        <section className="colonia-panel">
          <h3><CalendarDays size={16} /> Asistencia</h3>
          {!canAttend ? (
            <p className="colonia-banner warn">Sin permiso de asistencia Colonia.</p>
          ) : null}
          <div className="colonia-form inline">
            <label><span>Día</span>
              <input type="date" value={attendanceDay} onChange={(e) => setAttendanceDay(e.target.value)} />
            </label>
            <label><span>Estado</span>
              <select value={attendanceStatus} onChange={(e) => setAttendanceStatus(e.target.value)}>
                {COLONIA_ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <ul className="colonia-list">
            {enrollments.filter((e) => e.status !== 'cancelada').map((row) => (
              <li key={row.id} className="colonia-row-actions">
                <span>{row.student?.full_name}</span>
                <button type="button" className="btn" disabled={busy || !canAttend} onClick={() => markAttendance(row.id)}>
                  Marcar
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">Un profesor puede marcar asistencia; no puede cobrar ni anular cargos.</p>
        </section>
      ) : null}

      {activeSection === 'grupos' ? (
        <section className="colonia-panel">
          <h3>Grupos</h3>
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
                  <b>{sheet.key === 'resumen' ? enrollments.length : coloniaReportRows(enrollments, sheet.key).length}</b>
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
                  total={enrollments.length}
                  label="Estado de las inscripciones"
                  parts={[
                    { label: 'Confirmadas', value: coloniaReportRows(enrollments, 'confirmadas').length, color: '#e7a23a' },
                    { label: 'Pendientes', value: coloniaReportRows(enrollments, 'pendientes').length, color: '#1a7a8c' },
                    { label: 'Canceladas', value: coloniaReportRows(enrollments, 'canceladas').length, color: '#8ea197' },
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
                  <span style={{ flex: Math.max(coloniaReportRows(enrollments, 'socios').length, 0.2) }}>
                    Socios {coloniaReportRows(enrollments, 'socios').length}
                  </span>
                  <span style={{ flex: Math.max(coloniaReportRows(enrollments, 'no_socios').length, 0.2) }}>
                    No socios {coloniaReportRows(enrollments, 'no_socios').length}
                  </span>
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
