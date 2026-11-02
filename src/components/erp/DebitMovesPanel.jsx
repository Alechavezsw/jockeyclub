import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, CreditCard, FileSpreadsheet, History, Search, Upload } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  DEBIT_LISTING_SECTIONS,
  DEBIT_LISTING_SHEETS,
  applyDebitCardEdit,
  collectDebitBrands,
  debitListingPeriodOptions,
  defaultBrandForSheetKind,
  filterDebitListings,
  groupDebitListings,
  isDebitListingPeriodAllowed,
  maskDebitCard,
  normalizeDebitBrand,
  periodLabelES,
  previousDebitListingPeriod,
  sheetKindForBrand,
  summarizeDebitListings,
} from '../../domain/accounting/debitListings';
import { exportDebitListingsExcel } from '../../domain/accounting/exportDebitListingsExcel';
import { parseDebitListingsExcelFile } from '../../domain/accounting/importDebitListingsExcel';
import {
  DEBIT_MOVE_COLORS,
  applyDebitAlta,
  applyDebitBaja,
  automaticDebitKindOf,
  buildDebitListingDraft,
  debitChannelOf,
  hasPrismaDebitCard,
  isDebitListingDraftReady,
  looksLikeCardNumber,
  normalizeDebitListingDraft,
  validateDebitListingDraft,
  wantsAutomaticDebit,
} from '../../domain/accounting/debitMoves';
import { isMpAdhered } from '../../domain/payments/mercadoPago';
import { canChargeSocialDues } from '../../domain/members/dues';
import { isLiveMember, isTitularMember } from '../../domain/members/households';
import { todayISODateAR } from '../../lib/arDate';
import { repos } from '../../data/bootstrap';
import { useAuth } from '../../context/AuthContext';

const ALTA_CARD_KINDS = Object.freeze({
  credito: { id: 'credito', label: 'Crédito automático' },
  debito: { id: 'debito', label: 'Débito automático' },
});

function foldSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function memberOnAutomaticDebit(member) {
  return wantsAutomaticDebit(member) || isMpAdhered(member) || hasPrismaDebitCard(member);
}

function kindLabelOf(member) {
  const kind = automaticDebitKindOf(member);
  if (kind === 'debito') return 'Débito';
  if (kind === 'credito') return 'Crédito';
  if (memberOnAutomaticDebit(member)) return 'Automático';
  return 'Sin débito';
}

function memberDisplayId(member) {
  const id = String(member?.memberId || '');
  if (looksLikeCardNumber(id)) return `Ficha ${id.slice(-4)}`;
  return id;
}

function formatAr(iso) {
  const raw = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || '—';
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

function DebitCardCell({ row, onSave, disabled = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.cardNumber || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(row.cardNumber || '');
  }, [row.cardNumber, editing]);

  const commit = async () => {
    if (saving || disabled) return;
    const same = String(draft || '').replace(/\D/g, '') === String(row.cardNumber || '').replace(/\D/g, '');
    if (same) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(row, draft);
      setEditing(false);
    } catch {
      /* el panel muestra el error; se queda en edición */
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <td className="tabular-nums debit-card-cell is-editing">
        <input
          className="form-input debit-card-input"
          value={draft}
          autoFocus
          disabled={saving}
          inputMode="numeric"
          autoComplete="off"
          aria-label="N° de tarjeta"
          onChange={(e) => setDraft(e.target.value.replace(/[^\d\s-]/g, ''))}
          onBlur={() => { void commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(row.cardNumber || '');
              setEditing(false);
            }
          }}
        />
      </td>
    );
  }

  return (
    <td className="tabular-nums debit-card-cell">
      <button
        type="button"
        className="debit-card-edit"
        title="Editar N° de tarjeta"
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        {maskDebitCard(row.cardNumber)}
      </button>
    </td>
  );
}

export default function DebitMovesPanel({ members = [], setMembers = null }) {
  const { user } = useAuth();
  const today = todayISODateAR();
  const defaultPeriod = today.slice(0, 7);

  const [view, setView] = useState('listado');
  const [sheetKind, setSheetKind] = useState('credito');
  const [periodKey, setPeriodKey] = useState(defaultPeriod);
  const [section, setSection] = useState('all');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [periodTotals, setPeriodTotals] = useState({ credito: 0, debito: 0 });
  const [periods, setPeriods] = useState(() => debitListingPeriodOptions());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pickId, setPickId] = useState('');
  const [altaKind, setAltaKind] = useState('credito');
  const [draft, setDraft] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const importInputRef = useRef(null);

  const [year, month] = periodKey.split('-').map(Number);
  const previousPeriod = previousDebitListingPeriod(year, month);
  const visiblePeriods = useMemo(
    () => (periods || []).filter((p) => isDebitListingPeriodAllowed(p.year, p.month)),
    [periods],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await repos.listDebitListingPeriods?.();
        const next = (Array.isArray(list) ? list : debitListingPeriodOptions())
          .filter((p) => isDebitListingPeriodAllowed(p.year, p.month));
        if (!cancelled && next.length) {
          setPeriods(next);
          if (!next.some((p) => p.key === periodKey)) {
            const current = next.find((p) => p.key === defaultPeriod)
              || next.find((p) => p.year === 2026 && p.month === 11)
              || next[Math.min(1, next.length - 1)];
            setPeriodKey(current.key);
          }
        }
      } catch {
        setPeriods(debitListingPeriodOptions());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (view !== 'listado') return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const list = await repos.listDebitListings({ year, month, sheetKind });
        if (!cancelled) setRows(list || []);
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setLoadError(err?.message || 'No se pudo cargar el listado de débitos.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, year, month, sheetKind]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof repos.sumDebitListingAmounts !== 'function') {
          const [credito, debito] = await Promise.all([
            repos.listDebitListings({ year, month, sheetKind: 'credito' }),
            repos.listDebitListings({ year, month, sheetKind: 'debito' }),
          ]);
          if (cancelled) return;
          setPeriodTotals({
            credito: summarizeDebitListings(credito || []).amount,
            debito: summarizeDebitListings(debito || []).amount,
          });
          return;
        }
        const totals = await repos.sumDebitListingAmounts({ year, month });
        if (!cancelled) setPeriodTotals(totals || { credito: 0, debito: 0 });
      } catch {
        if (!cancelled) setPeriodTotals({ credito: 0, debito: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  useEffect(() => {
    if (view !== 'historial' && view !== 'altas' && view !== 'bajas') return undefined;
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const list = await repos.listDebitMoveEvents({ year, month });
        if (!cancelled) setHistory(list || []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, year, month]);

  useEffect(() => {
    if ((view !== 'altas' && view !== 'bajas') || !pickId) {
      setDraft(null);
      return;
    }
    const member = (members || []).find((row) => String(row.memberId) === String(pickId));
    if (!member) {
      setDraft(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let nextMemberId = null;
      if (looksLikeCardNumber(member.memberId)) {
        try {
          nextMemberId = await repos.nextClubMemberNumber(members);
        } catch {
          nextMemberId = null;
        }
      }
      if (cancelled) return;
      setDraft(buildDebitListingDraft(member, {
        year,
        month,
        cardKind: view === 'bajas' ? (automaticDebitKindOf(member) || altaKind) : altaKind,
        moveType: view === 'bajas' ? 'baja' : 'alta',
        members,
        nextMemberId,
      }));
    })();
    return () => { cancelled = true; };
  }, [pickId, view, members, year, month, altaKind]);

  const filtered = useMemo(
    () => filterDebitListings(rows, { query, section }),
    [rows, query, section],
  );
  const groups = useMemo(() => groupDebitListings(filtered), [filtered]);
  const summary = useMemo(() => summarizeDebitListings(filtered), [filtered]);
  const brandOptions = useMemo(() => collectDebitBrands(rows), [rows]);
  const draftReady = isDebitListingDraftReady(draft);
  const creditoTotal = sheetKind === 'credito'
    ? (Number(summary.amount) || 0)
    : (Number(periodTotals.credito) || 0);
  const debitoTotal = sheetKind === 'debito'
    ? (Number(summary.amount) || 0)
    : (Number(periodTotals.debito) || 0);
  const combinedTotal = creditoTotal + debitoTotal;

  const candidates = useMemo(() => {
    if (view !== 'altas' && view !== 'bajas') return [];
    const q = foldSearch(query);
    const list = (members || [])
      .filter((member) => isLiveMember(member) && isTitularMember(member))
      .filter((member) => {
        if (view === 'altas') return canChargeSocialDues(member);
        // Sin búsqueda: solo quienes debitan. Con búsqueda: todo el padrón cobrable (por si la ficha ya bajó y falta la planilla).
        if (q) return canChargeSocialDues(member);
        return memberOnAutomaticDebit(member);
      })
      .filter((member) => {
        if (!q) return view === 'bajas';
        const hay = foldSearch([
          member.name,
          member.memberId,
          member.documentNumber,
          member.email,
          member.cardNumber,
          member.prismaId,
        ].join(' '));
        return hay.includes(q);
      })
      .toSorted((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es')
        || String(a.memberId || '').localeCompare(String(b.memberId || ''), 'es'));
    const limit = q ? 80 : 250;
    return list.slice(0, limit);
  }, [members, query, view]);

  const candidateTotalHint = useMemo(() => {
    if (view !== 'altas' && view !== 'bajas') return 0;
    return (members || []).filter((member) => {
      if (!isLiveMember(member) || !isTitularMember(member)) return false;
      if (view === 'altas') return canChargeSocialDues(member);
      return memberOnAutomaticDebit(member);
    }).length;
  }, [members, view]);

  const persist = async (next, previousMemberId = null) => {
    if (typeof setMembers !== 'function') {
      throw new Error('No tenés permiso para editar el padrón desde acá.');
    }
    const saved = await repos.upsertMember(next);
    setMembers((prev) => (prev || []).map((row) => {
      if (next.id && String(row.id) === String(next.id)) return { ...row, ...saved };
      if (String(row.memberId) === String(saved.memberId)) return { ...row, ...saved };
      if (previousMemberId && String(row.memberId) === String(previousMemberId)) {
        return { ...row, ...saved };
      }
      return row;
    }));
    return saved;
  };

  const saveCardNumber = async (row, nextCard) => {
    setError('');
    setStatus('');
    const patched = applyDebitCardEdit(row, nextCard, {
      by: user?.name || user?.email || '',
    });
    if (!patched) return;
    const saved = await repos.updateDebitListingCard(patched);
    setRows((prev) => (prev || []).map((item) => (
      String(item.id) === String(saved.id) ? { ...item, ...saved } : item
    )));
    setStatus(`Tarjeta actualizada: ${maskDebitCard(saved.cardNumber)}`);
  };

  const refreshPeriodTotals = async (y = year, m = month) => {
    if (typeof repos.sumDebitListingAmounts === 'function') {
      const totals = await repos.sumDebitListingAmounts({ year: y, month: m });
      setPeriodTotals(totals || { credito: 0, debito: 0 });
      return totals;
    }
    const [creditoRows, debitoRows] = await Promise.all([
      repos.listDebitListings({ year: y, month: m, sheetKind: 'credito' }),
      repos.listDebitListings({ year: y, month: m, sheetKind: 'debito' }),
    ]);
    const totals = {
      credito: summarizeDebitListings(creditoRows || []).amount,
      debito: summarizeDebitListings(debitoRows || []).amount,
    };
    setPeriodTotals(totals);
    return { ...totals, creditoRows, debitoRows };
  };

  const loadPreviousMonth = async () => {
    if (copyBusy || importBusy) return;
    const label = periodLabelES(year, month);
    const fromLabel = periodLabelES(previousPeriod.year, previousPeriod.month);
    const confirmed = window.confirm(
      rows.length
        ? `Esto reemplaza ${label} con la planilla de ${fromLabel}. ¿Continuar?`
        : `¿Cargar ${fromLabel} como base de ${label}?`,
    );
    if (!confirmed) return;
    setCopyBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await repos.copyDebitListingsFromPreviousMonth({ year, month });
      await refreshPeriodTotals(year, month);
      const list = await repos.listDebitListings({ year, month, sheetKind });
      setRows(list || []);
      const nextPeriods = (await repos.listDebitListingPeriods())
        .filter((p) => isDebitListingPeriodAllowed(p.year, p.month));
      if (nextPeriods.length) setPeriods(nextPeriods);
      setStatus(
        `Mes anterior cargado: ${fromLabel} → ${label}`
        + ` · ${result.count.toLocaleString('es-AR')} filas`,
      );
      setView('listado');
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el mes anterior.');
    } finally {
      setCopyBusy(false);
    }
  };

  const applyImportedListings = async (parsed) => {
    const result = await repos.importDebitListings(parsed.rows, { fileName: parsed.fileName });
    const nextPeriods = (await repos.listDebitListingPeriods())
      .filter((p) => isDebitListingPeriodAllowed(p.year, p.month));
    if (nextPeriods.length) setPeriods(nextPeriods);
    const first = result.periods?.find((p) => isDebitListingPeriodAllowed(p.year, p.month))
      || result.periods?.[0];
    if (first?.key && isDebitListingPeriodAllowed(first.year, first.month)) {
      setPeriodKey(first.key);
    }
    if (first?.sheetKind) setSheetKind(first.sheetKind);
    const targetYear = first ? Number(first.year) : year;
    const targetMonth = first ? Number(first.month) : month;
    const targetKind = first?.sheetKind || sheetKind;
    await refreshPeriodTotals(targetYear, targetMonth);
    if (Number(targetYear) === Number(year) && Number(targetMonth) === Number(month)) {
      const list = await repos.listDebitListings({
        year: targetYear,
        month: targetMonth,
        sheetKind: targetKind,
      });
      setRows(list || []);
    }
    setStatus(
      `Importado: ${result.count.toLocaleString('es-AR')} filas`
      + ` · ${result.periods.map((p) => periodLabelES(p.year, p.month)).join(', ')}`
      + (parsed.fileName ? ` · ${parsed.fileName}` : ''),
    );
    setView('listado');
    return result;
  };

  const uploadExcel = async (file) => {
    if (!file || importBusy) return;
    setImportBusy(true);
    setError('');
    setStatus('');
    try {
      const parsed = await parseDebitListingsExcelFile(file);
      await applyImportedListings(parsed);
    } catch (err) {
      setError(err?.message || 'No se pudo importar el Excel.');
    } finally {
      setImportBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const downloadExcel = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setError('');
    setStatus('');
    try {
      const otherKind = sheetKind === 'debito' ? 'credito' : 'debito';
      const otherRows = await repos.listDebitListings({ year, month, sheetKind: otherKind });
      const sheets = sheetKind === 'credito'
        ? [
          { sheetKind: 'credito', rows, sourceSheet: rows[0]?.sourceSheet },
          { sheetKind: 'debito', rows: otherRows || [], sourceSheet: otherRows?.[0]?.sourceSheet },
        ]
        : [
          { sheetKind: 'credito', rows: otherRows || [], sourceSheet: otherRows?.[0]?.sourceSheet },
          { sheetKind: 'debito', rows, sourceSheet: rows[0]?.sourceSheet },
        ];
      const result = await exportDebitListingsExcel({ year, month, sheets });
      setStatus(`Excel descargado: ${result.fileName} (${result.count.toLocaleString('es-AR')} filas)`);
    } catch (err) {
      setError(err?.message || 'No se pudo generar el Excel.');
    } finally {
      setExportBusy(false);
    }
  };

  const runMove = async (member, moveType) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const listing = validateDebitListingDraft({
        ...normalizeDebitListingDraft(draft || {}),
        moveType,
        year,
        month,
        cardKind: draft?.cardKind || altaKind,
      });
      const actor = {
        id: user?.id || null,
        name: user?.name || '',
        email: user?.email || '',
      };
      const by = actor.name || actor.email || '';
      const remumberTo = listing.memberId
        && looksLikeCardNumber(member.memberId)
        && String(listing.memberId) !== String(member.memberId)
        ? String(listing.memberId)
        : null;
      const previousMemberId = remumberTo ? String(member.memberId) : null;
      let nextMember = moveType === 'baja'
        ? applyDebitBaja(member, {
          today,
          by,
          note: listing.note || 'Baja desde Operación → Débitos',
          listing,
        })
        : applyDebitAlta(member, {
          today,
          by,
          note: listing.note || `Alta ${listing.cardKind === 'debito' ? 'débito' : 'crédito'} desde Operación → Débitos`,
          cardKind: listing.cardKind,
          listing,
        });
      if (remumberTo) {
        nextMember = { ...nextMember, memberId: remumberTo };
      }
      await persist(nextMember, previousMemberId);
      const registered = await repos.registerDebitMove({
        draft: listing,
        member: nextMember,
        actor,
      });
      setHistory((prev) => [registered.event, ...(prev || [])]);
      if (view === 'listado' || (registered.listing?.sheetKind === sheetKind
        && Number(registered.listing?.year) === year
        && Number(registered.listing?.month) === month)) {
        setRows((prev) => [...(prev || []), registered.listing]);
      }
      setStatus(
        `${moveType === 'baja' ? 'Baja' : 'Alta'} registrada en ficha + planilla`
        + ` · ${listing.holderName}`
        + ` · ${maskDebitCard(listing.cardNumber)}`
        + ` · por ${by || 'usuario'}`,
      );
      setPickId('');
      setDraft(null);
      setView('historial');
    } catch (err) {
      setError(err?.message || `No se pudo registrar la ${moveType === 'baja' ? 'baja' : 'alta'}.`);
    } finally {
      setBusy(false);
    }
  };

  const selected = (members || []).find((member) => String(member.memberId) === String(pickId));

  return (
    <div className="fade-in mb-folio debit-moves">
      <header className="mb-folio-head debit-moves-head">
        <div>
          <p className="mb-folio-kicker debit-moves-kicker">Operación contable</p>
          <h3 className="mb-folio-title debit-moves-title">Listados de débitos</h3>
        </div>
        <span className="mb-folio-seal debit-moves-seal">
          {summary.total.toLocaleString('es-AR')} filas
        </span>
      </header>

      <dl className="mb-folio-kpis debit-moves-kpis">
        <div className="mb-folio-kpi is-net">
          <dt>Total hoja</dt>
          <dd>{formatCurrency(summary.amount)}</dd>
          <p>{periodLabelES(year, month)} · {sheetKind === 'debito' ? 'Débito' : 'Crédito'}</p>
        </div>
        <div className="mb-folio-kpi is-cash">
          <dt>Crédito + débito</dt>
          <dd>{formatCurrency(combinedTotal)}</dd>
          <p>
            Créd. {formatCurrency(creditoTotal)}
            {' · '}
            Déb. {formatCurrency(debitoTotal)}
          </p>
        </div>
        <div className="mb-folio-kpi is-out">
          <dt>Altas</dt>
          <dd>{summary.altas.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Bajas</dt>
          <dd>{summary.bajas.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Padrón</dt>
          <dd>{summary.padron.toLocaleString('es-AR')}</dd>
        </div>
      </dl>

      <div className="debit-moves-toolbar">
        <div className="debit-moves-tabs" role="tablist" aria-label="Vista de débitos">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'listado'}
            className={view === 'listado' ? 'is-on' : ''}
            style={{ '--debit-accent': DEBIT_MOVE_COLORS.accent }}
            onClick={() => setView('listado')}
          >
            <CreditCard size={14} aria-hidden="true" />
            Listado
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'altas'}
            className={view === 'altas' ? 'is-on' : ''}
            style={{ '--debit-accent': DEBIT_MOVE_COLORS.alta }}
            onClick={() => setView('altas')}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
            Alta en ficha
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'bajas'}
            className={view === 'bajas' ? 'is-on' : ''}
            style={{ '--debit-accent': DEBIT_MOVE_COLORS.baja }}
            onClick={() => setView('bajas')}
          >
            <ArrowDownLeft size={14} aria-hidden="true" />
            Baja en ficha
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'historial'}
            className={view === 'historial' ? 'is-on' : ''}
            style={{ '--debit-accent': DEBIT_MOVE_COLORS.accent }}
            onClick={() => setView('historial')}
          >
            <History size={14} aria-hidden="true" />
            Historial
          </button>
        </div>
        <div className="debit-moves-actions">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadExcel(file);
            }}
          />
          <button
            type="button"
            className="debit-moves-action"
            disabled={copyBusy || importBusy || exportBusy || loading}
            title={`Copia ${periodLabelES(previousPeriod.year, previousPeriod.month)} → ${periodLabelES(year, month)}`}
            onClick={() => { void loadPreviousMonth(); }}
          >
            {copyBusy
              ? 'Copiando…'
              : `Copiar mes anterior (${periodLabelES(previousPeriod.year, previousPeriod.month)})`}
          </button>
          <button
            type="button"
            className="debit-moves-action"
            disabled={importBusy || exportBusy || copyBusy}
            title="Subí un Excel/XLSM de Listados de Débitos"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={14} aria-hidden="true" />
            {importBusy ? 'Importando…' : 'Subir Excel'}
          </button>
          <button
            type="button"
            className="debit-moves-action"
            disabled={exportBusy || importBusy || copyBusy || loading || (view === 'listado' && !rows.length)}
            onClick={() => { void downloadExcel(); }}
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            {exportBusy ? 'Generando…' : 'Excel'}
          </button>
        </div>
      </div>

      {view === 'listado' ? (
        <>
          <div className="ar-filters">
            <label>
              <span className="form-label">Mes</span>
              <select
                className="form-input"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {visiblePeriods.map((p) => (
                  <option key={p.key} value={p.key}>{periodLabelES(p.year, p.month)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Hoja</span>
              <select
                className="form-input"
                value={sheetKind}
                onChange={(e) => setSheetKind(e.target.value)}
              >
                {Object.values(DEBIT_LISTING_SHEETS).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">Sección</span>
              <select
                className="form-input"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="all">Todas</option>
                {Object.values(DEBIT_LISTING_SECTIONS).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="ld-search">
              <span className="form-label">Buscar</span>
              <span className="ld-search-field">
                <Search size={14} aria-hidden="true" />
                <input
                  className="form-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Socio, titular, tarjeta o nota"
                />
              </span>
            </label>
          </div>

          {loadError ? <p className="mb-folio-status is-error" role="alert">{loadError}</p> : null}
          {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}
          {status ? <p className="mb-folio-status" style={{ color: 'var(--emerald-accent)' }}>{status}</p> : null}
          {loading ? <p className="mb-folio-meta">Cargando planilla…</p> : null}

          {!loading && !loadError ? (
            <div className="table-responsive debit-listings-table-wrap">
              <table className="admin-table cash-lila-table debit-listings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>N° tarjeta</th>
                    <th>Comprobante</th>
                    <th>Vencimiento</th>
                    <th>Cuota</th>
                    <th>Abono</th>
                    <th>Total</th>
                    <th>N° socio</th>
                    <th>Estado</th>
                    <th>Titular</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="mb-folio-empty">
                        No hay filas para este mes / hoja. Si acabás de importar, recargá.
                      </td>
                    </tr>
                  ) : groups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="debit-listings-section">
                        <td colSpan={11}>
                          <strong>{group.brand}</strong>
                          {group.section !== 'padron' ? ` · ${group.sectionLabel}` : ''}
                          <span className="debit-listings-section-count">
                            {group.rows.length.toLocaleString('es-AR')}
                          </span>
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="tabular-nums">{row.sortOrder}</td>
                          <DebitCardCell
                            row={row}
                            disabled={busy}
                            onSave={async (target, nextCard) => {
                              try {
                                await saveCardNumber(target, nextCard);
                              } catch (err) {
                                setError(err?.message || 'No se pudo guardar el N° de tarjeta.');
                                throw err;
                              }
                            }}
                          />
                          <td className="tabular-nums">{row.receipt || '—'}</td>
                          <td>{formatAr(row.dueDate)}</td>
                          <td className="tabular-nums">{row.duesAmount ? formatCurrency(row.duesAmount) : '—'}</td>
                          <td className="tabular-nums">{row.abonoAmount ? formatCurrency(row.abonoAmount) : '—'}</td>
                          <td className="tabular-nums" style={{ fontWeight: 700 }}>
                            {formatCurrency(row.totalAmount)}
                          </td>
                          <td>
                            {row.memberId ? (
                              <Link
                                className="mb-folio-link"
                                to={`/panel/members/${encodeURIComponent(row.memberId)}`}
                              >
                                {row.memberId}
                              </Link>
                            ) : '—'}
                          </td>
                          <td>{row.statusCode || '—'}</td>
                          <td>{row.holderName || '—'}</td>
                          <td className="debit-listings-note">{row.note || ''}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : view === 'historial' ? (
        <>
          <div className="ar-filters">
            <label>
              <span className="form-label">Mes</span>
              <select
                className="form-input"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {visiblePeriods.map((p) => (
                  <option key={p.key} value={p.key}>{periodLabelES(p.year, p.month)}</option>
                ))}
              </select>
            </label>
          </div>
          {status ? <p className="mb-folio-status" style={{ color: 'var(--emerald-accent)' }}>{status}</p> : null}
          {historyLoading ? <p className="mb-folio-meta">Cargando historial…</p> : null}
          {!historyLoading && history.length === 0 ? (
            <p className="mb-folio-meta">Sin altas ni bajas registradas en {periodLabelES(year, month)}.</p>
          ) : null}
          {history.length > 0 ? (
            <div className="table-responsive debit-listings-table-wrap">
              <table className="admin-table cash-lila-table debit-listings-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Socio</th>
                    <th>Titular</th>
                    <th>Tarjeta</th>
                    <th>Hoja</th>
                    <th>Total</th>
                    <th>Usuario</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((event) => (
                    <tr key={event.id}>
                      <td className="tabular-nums">{formatAr(event.createdAt || event.dueDate)}</td>
                      <td>
                        <span
                          className="debit-moves-chip"
                          style={{
                            '--debit-accent': event.moveType === 'alta'
                              ? DEBIT_MOVE_COLORS.alta
                              : DEBIT_MOVE_COLORS.baja,
                          }}
                        >
                          {event.moveType === 'alta' ? 'Alta' : 'Baja'}
                        </span>
                      </td>
                      <td className="tabular-nums">
                        {event.memberId ? (
                          <Link className="mb-folio-link" to={`/panel/members/${encodeURIComponent(event.memberId)}`}>
                            {event.memberId}
                          </Link>
                        ) : '—'}
                      </td>
                      <td>{event.holderName || '—'}</td>
                      <td className="tabular-nums">{maskDebitCard(event.cardNumber)}</td>
                      <td>{event.cardKind === 'debito' ? 'Débito' : 'Crédito'}</td>
                      <td className="tabular-nums">{formatCurrency(event.totalAmount)}</td>
                      <td>{event.actorName || event.actorEmail || '—'}</td>
                      <td className="debit-listings-note">{event.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="ar-filters">
            <label>
              <span className="form-label">Mes planilla</span>
              <select
                className="form-input"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
              >
                {visiblePeriods.map((p) => (
                  <option key={p.key} value={p.key}>{periodLabelES(p.year, p.month)}</option>
                ))}
              </select>
            </label>
            <label className="ld-search">
              <span className="form-label">Buscar en el padrón</span>
              <span className="ld-search-field">
                <Search size={14} aria-hidden="true" />
                <input
                  className="form-input"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPickId('');
                  }}
                  placeholder="Nombre, nº de socio o DNI"
                  autoComplete="off"
                />
              </span>
            </label>
            {view === 'altas' ? (
              <label>
                <span className="form-label">Tipo</span>
                <select
                  className="form-input"
                  value={altaKind}
                  onChange={(e) => setAltaKind(e.target.value === 'debito' ? 'debito' : 'credito')}
                  disabled={busy}
                >
                  {Object.values(ALTA_CARD_KINDS).map((kind) => (
                    <option key={kind.id} value={kind.id}>{kind.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {error ? <p className="mb-folio-status is-error" role="alert">{error}</p> : null}

          {typeof setMembers !== 'function' ? (
            <p className="mb-folio-meta">No tenés permiso para editar fichas desde acá.</p>
          ) : (
            <div className="debit-moves-form glass-card" style={{ padding: '0.9rem 1rem' }}>
              <p className="mb-folio-meta" style={{ marginTop: 0 }}>
                {view === 'altas'
                  ? 'Buscá el titular, completá los datos que falten para la planilla y registrá el alta (ficha + sección Altas del mes).'
                  : 'Elegí quién sale del automático, completá la fila de planilla si falta algo y registrá la baja (ficha + sección Bajas).'}
              </p>
              <p className="mb-folio-meta">
                {view === 'altas'
                  ? (query.trim()
                    ? `${candidates.length.toLocaleString('es-AR')} coincidencia${candidates.length === 1 ? '' : 's'} · padrón cobrable ${candidateTotalHint.toLocaleString('es-AR')}`
                    : `Escribí para buscar entre ${candidateTotalHint.toLocaleString('es-AR')} titulares que abonan cuota.`)
                  : `${candidates.length.toLocaleString('es-AR')} en débito/crédito automático${query.trim() ? ' (filtrados)' : ''}.`}
              </p>

              {view === 'altas' && !query.trim() ? null : (
                <ul className="debit-moves-list" role="listbox" aria-label={view === 'altas' ? 'Resultados para alta' : 'Socios en débito'}>
                  {candidates.length === 0 ? (
                    <li className="debit-moves-row is-empty">
                      {view === 'altas'
                        ? 'Sin coincidencias en el padrón.'
                        : (query.trim() ? 'Sin coincidencias.' : 'Nadie marcado con débito/crédito automático todavía.')}
                    </li>
                  ) : candidates.map((member) => {
                    const onDebit = memberOnAutomaticDebit(member);
                    const active = String(pickId) === String(member.memberId);
                    return (
                      <li key={member.memberId}>
                        <button
                          type="button"
                          className={`debit-moves-row${active ? ' is-on' : ''}`}
                          disabled={busy}
                          onClick={() => setPickId(String(member.memberId))}
                        >
                          <span className="debit-moves-name">
                            <strong>{memberDisplayId(member)}</strong>
                            {' · '}
                            {member.name || 'Sin nombre'}
                            {looksLikeCardNumber(member.memberId) ? (
                              <span className="debit-moves-meta">
                                Ficha con ID inválido · se asigna N° socio real
                              </span>
                            ) : null}
                          </span>
                          <span className="debit-moves-meta">
                            {member.documentNumber ? `DNI ${member.documentNumber} · ` : ''}
                            {debitChannelOf(member)}
                          </span>
                          <span
                            className="debit-moves-chip"
                            style={{
                              '--debit-accent': onDebit ? DEBIT_MOVE_COLORS.vigente : DEBIT_MOVE_COLORS.baja,
                            }}
                          >
                            {kindLabelOf(member)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {selected && draft ? (
                <div className="debit-moves-draft">
                  <p className="mb-folio-meta" style={{ marginTop: '0.85rem' }}>
                    Datos para la planilla de {periodLabelES(year, month)}
                    {draft.missing?.memberId || draft.missing?.cardNumber
                      ? ' — completá lo que falta en la ficha'
                      : draft.remumber
                        ? ` — N° socio corregido (antes ${draft.previousMemberId})`
                        : ''}
                  </p>
                  <div className="ar-filters debit-moves-draft-grid">
                    <label>
                      <span className="form-label">N° socio</span>
                      <input
                        className="form-input"
                        value={draft.memberId || ''}
                        readOnly
                        title={draft.remumber
                          ? 'Correlativo de club (la ficha tenía un ID inválido)'
                          : 'Se toma automáticamente de la ficha'}
                      />
                    </label>
                    <label>
                      <span className="form-label">N° tarjeta</span>
                      <input
                        className="form-input"
                        value={draft.cardNumber || ''}
                        onChange={(e) => setDraft((prev) => ({
                          ...prev,
                          cardNumber: e.target.value.replace(/[^\d\s-]/g, ''),
                        }))}
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="Obligatorio · 13–19 dígitos"
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Tipo de tarjeta</span>
                      <select
                        className="form-input"
                        value={normalizeDebitBrand(draft.brand) || defaultBrandForSheetKind(draft.cardKind)}
                        onChange={(e) => {
                          const brand = normalizeDebitBrand(e.target.value) || e.target.value;
                          const kind = sheetKindForBrand(brand);
                          setAltaKind(kind);
                          setDraft((prev) => ({
                            ...prev,
                            brand,
                            cardKind: kind,
                            sheetKind: kind,
                          }));
                        }}
                        required
                        disabled={busy}
                      >
                        {brandOptions.map((brand) => (
                          <option key={brand.id} value={brand.id}>{brand.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Vto tarjeta</span>
                      <input
                        className="form-input"
                        value={draft.cardExpiry || ''}
                        onChange={(e) => setDraft((prev) => ({
                          ...prev,
                          cardExpiry: e.target.value.replace(/[^\d/]/g, '').slice(0, 5),
                        }))}
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="MM/AA (opcional)"
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Cód. seguridad</span>
                      <input
                        className="form-input"
                        value={draft.cardCvv || ''}
                        onChange={(e) => setDraft((prev) => ({
                          ...prev,
                          cardCvv: e.target.value.replace(/\D/g, '').slice(0, 4),
                        }))}
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        placeholder="Dorso (opcional)"
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Titular</span>
                      <input
                        className="form-input"
                        value={draft.holderName || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, holderName: e.target.value }))}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Tipo planilla</span>
                      <select
                        className="form-input"
                        value={draft.cardKind || altaKind}
                        onChange={(e) => {
                          const kind = e.target.value === 'debito' ? 'debito' : 'credito';
                          setAltaKind(kind);
                          setDraft((prev) => ({
                            ...prev,
                            cardKind: kind,
                            sheetKind: kind,
                            brand: defaultBrandForSheetKind(kind),
                          }));
                        }}
                        disabled={busy}
                      >
                        {Object.values(ALTA_CARD_KINDS).map((kind) => (
                          <option key={kind.id} value={kind.id}>{kind.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="form-label">Comprobante</span>
                      <input
                        className="form-input"
                        value={draft.receipt || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, receipt: e.target.value }))}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Vto cuota</span>
                      <input
                        className="form-input"
                        type="date"
                        value={draft.dueDate || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, dueDate: e.target.value }))}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Cuota</span>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="1"
                        value={draft.duesAmount ?? 0}
                        onChange={(e) => {
                          const duesAmount = Number(e.target.value) || 0;
                          setDraft((prev) => ({
                            ...prev,
                            duesAmount,
                            totalAmount: duesAmount + (Number(prev?.abonoAmount) || 0),
                          }));
                        }}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Abono</span>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="1"
                        value={draft.abonoAmount ?? 0}
                        onChange={(e) => {
                          const abonoAmount = Number(e.target.value) || 0;
                          setDraft((prev) => ({
                            ...prev,
                            abonoAmount,
                            totalAmount: (Number(prev?.duesAmount) || 0) + abonoAmount,
                          }));
                        }}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Total</span>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="1"
                        value={draft.totalAmount ?? 0}
                        onChange={(e) => setDraft((prev) => ({
                          ...prev,
                          totalAmount: Number(e.target.value) || 0,
                        }))}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <span className="form-label">Estado</span>
                      <input
                        className="form-input"
                        value="N"
                        readOnly
                        title="Estado de planilla (automático)"
                      />
                    </label>
                    <label className="debit-moves-draft-note">
                      <span className="form-label">Nota</span>
                      <input
                        className="form-input"
                        value={draft.note || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <p className="mb-folio-meta" style={{ marginTop: '0.35rem' }}>
                    El código de seguridad no se guarda; solo Vto tarjeta (opcional) queda en la ficha.
                  </p>
                </div>
              ) : null}

              {selected && draft ? (
                <div className="ar-filters" style={{ marginBottom: 0, marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        busy
                        || !draftReady
                        || (view === 'altas' && memberOnAutomaticDebit(selected))
                      }
                      title={!draftReady ? 'Completá N° de tarjeta y tipo de tarjeta' : undefined}
                      onClick={() => { void runMove(selected, view === 'bajas' ? 'baja' : 'alta'); }}
                    >
                      {busy
                        ? 'Guardando…'
                        : (view === 'altas'
                          ? `Registrar alta · ${normalizeDebitBrand(draft.brand) || ALTA_CARD_KINDS[draft.cardKind || altaKind]?.label || 'Automático'}`
                          : 'Registrar baja en planilla')}
                    </button>
                    <p className="mb-folio-meta" style={{ margin: 0 }}>
                      Seleccionado: {memberDisplayId(selected)} · {selected.name}
                      {!draftReady
                        ? ' — falta N° de tarjeta válido'
                        : ''}
                      {view === 'altas' && memberOnAutomaticDebit(selected)
                        ? ' (ya tiene automático — usá Baja en ficha)'
                        : ''}
                      {view === 'bajas' && !memberOnAutomaticDebit(selected)
                        ? ' (ficha ya sin automático — igual podés cargar la baja en planilla)'
                        : ''}
                    </p>
                  </div>
                </div>
              ) : null}

              {history.length > 0 ? (
                <div className="debit-moves-history-mini">
                  <p className="mb-folio-meta" style={{ marginTop: '1rem', marginBottom: '0.35rem' }}>
                    Movimientos de {periodLabelES(year, month)}
                  </p>
                  <ul className="debit-moves-list">
                    {history.slice(0, 8).map((event) => (
                      <li key={event.id} className="debit-moves-row is-empty">
                        <span className="debit-moves-name">
                          <strong>{event.moveType === 'alta' ? 'Alta' : 'Baja'}</strong>
                          {' · '}
                          {event.holderName || event.memberId}
                          <span className="debit-moves-meta">
                            {maskDebitCard(event.cardNumber)}
                            {' · '}
                            {event.actorName || event.actorEmail || 'sin usuario'}
                            {' · '}
                            {formatAr(event.createdAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
