import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Pencil, Percent, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { DATITA_CUOTA_CATEGORY_NAMES } from '../../domain/members/tiers';
import { bonificacionesSeed } from '../../domain/accounting/discountsSeed';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import {
  DISCOUNT_CATEGORIES,
  DISCOUNT_VALUE_TYPES,
  appliedToLabel as discountAppliedToLabel,
  createDiscount,
  discountCategoryCounts,
  filterDiscounts,
  formatDiscountValue,
  formatValidity as formatDiscountValidity,
} from '../../domain/accounting/discounts';
import {
  FEE_EXPENSE_CATEGORIES,
  FEE_EXPENSE_VALUE_TYPES,
  appliedToLabel as expenseAppliedToLabel,
  createFeeExpense,
  feeExpenseCategoryCounts,
  filterFeeExpenses,
  formatFeeExpenseValue,
  formatValidity as formatExpenseValidity,
} from '../../domain/accounting/feeExpenses';

const PAGE_SIZE = 10;

const EMPTY_FORM = {
  memberIds: '',
  memberName: '',
  feeCategories: '',
  familyGroup: '',
  description: '',
  validFrom: '',
  validTo: '',
  valueType: 'percent',
  value: '',
};

function emptyFormFor(category, isExpense) {
  return {
    ...EMPTY_FORM,
    validFrom: new Date().toISOString().slice(0, 10),
    valueType: isExpense ? 'amount' : 'percent',
  };
}

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function memberNumberOf(member) {
  return String(member?.memberId || member?.memberNumber || '').trim();
}

function splitMemberDraft(value) {
  const ids = [];
  const words = [];
  String(value || '').split(/[,;]+/).forEach((part) => {
    const token = part.trim();
    if (!token) return;
    if (/^\d+$/.test(token)) ids.push(token);
    else words.push(token);
  });
  return { ids, query: words.join(' ') };
}

function matchCategories(query) {
  const q = foldText(String(query || '').trim());
  if (q.length < 2) return [];
  return DATITA_CUOTA_CATEGORY_NAMES.filter((name) => foldText(name).includes(q)).slice(0, 8);
}

function matchMembers(members, query, exclude = new Set()) {
  const raw = String(query || '').trim();
  const q = foldText(raw);
  if (q.length < 2) return [];
  const hits = [];
  const rest = [];
  for (const member of members || []) {
    const num = memberNumberOf(member);
    if (!num || exclude.has(num)) continue;
    const name = String(member.name || '');
    const hay = foldText(`${name} ${num} ${member.documentNumber || ''}`);
    if (!hay.includes(q)) continue;
    if (foldText(name).startsWith(q) || num.startsWith(raw)) hits.push(member);
    else rest.push(member);
  }
  return [...hits, ...rest].slice(0, 8);
}

function MemberPickField({ members, value, onChange }) {
  const selectedIds = splitMemberDraft(value).ids;
  const [query, setQuery] = useState(() => splitMemberDraft(value).query);
  const matches = matchMembers(members, query, new Set(selectedIds));

  const write = (ids, name) => {
    onChange({
      memberIds: ids.join(', '),
      memberName: name || '',
    });
  };

  const nameFor = (id) => (members || []).find((m) => memberNumberOf(m) === id)?.name || '';

  const addMember = (member) => {
    const num = memberNumberOf(member);
    const ids = selectedIds.includes(num) ? selectedIds : [...selectedIds, num];
    const names = ids.map((id) => (id === num ? member.name : nameFor(id))).filter(Boolean);
    write(ids, names.join(', '));
    setQuery('');
  };

  const removeMember = (id) => {
    const ids = selectedIds.filter((item) => item !== id);
    write(ids, ids.map(nameFor).filter(Boolean).join(', '));
  };

  return (
    <div className="disc-member-pick">
      <input
        className="form-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) {
            e.preventDefault();
            addMember(matches[0]);
          }
        }}
        placeholder="Nombre, DNI o número de socio"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
      />
      <input type="hidden" value={selectedIds.join(',')} required />
      {matches.length > 0 ? (
        <ul className="disc-member-hits" role="listbox">
          {matches.map((member) => (
            <li key={memberNumberOf(member)}>
              <button type="button" className="disc-member-hit" onClick={() => addMember(member)}>
                <span>{member.name}</span>
                <span>Nº {memberNumberOf(member)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selectedIds.length > 0 ? (
        <div className="disc-member-chips">
          {selectedIds.map((id) => (
            <button key={id} type="button" className="disc-member-chip" onClick={() => removeMember(id)}>
              {nameFor(id) ? `${nameFor(id)} · ${id}` : id}
              <span aria-hidden="true"> ×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DiscountsBonusesPanel({
  items = [],
  feeExpenses = [],
  fixedExpenses = [],
  members = [],
  onUpsert,
  onDelete,
  onUpsertFeeExpense,
  onDeleteFeeExpense,
  onGoExpenses,
  discountsOnly = false,
}) {
  const { ACCESSIN_BONIFICACIONES_SNAPSHOT } = useSnapshotSeed(
    ['accessinBonificaciones'],
    bonificacionesSeed,
  );
  const [hubTab, setHubTab] = useState('discounts');
  const [category, setCategory] = useState(null);
  const [view, setView] = useState('hub');
  const [query, setQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);

  const isExpense = !discountsOnly && hubTab === 'expenses';
  const noun = isExpense ? 'gasto' : 'descuento';
  const Noun = isExpense ? 'Gasto' : 'Descuento';
  const valueTypes = isExpense ? FEE_EXPENSE_VALUE_TYPES : DISCOUNT_VALUE_TYPES;

  const counts = useMemo(
    () => (isExpense ? feeExpenseCategoryCounts(feeExpenses) : discountCategoryCounts(items)),
    [isExpense, feeExpenses, items]
  );
  const activeCategory = (isExpense ? FEE_EXPENSE_CATEGORIES : DISCOUNT_CATEGORIES)
    .find((c) => c.id === category) || null;

  const listQuery = memberFilter || query;
  const categoryHits = suggestOpen ? matchCategories(query) : [];
  const memberHits = matchMembers(members, suggestOpen ? query : '');
  const searchHits = [
    ...categoryHits.map((name) => ({ kind: 'category', id: name, title: name, meta: 'Categoría' })),
    ...memberHits.map((member) => ({
      kind: 'member',
      id: memberNumberOf(member),
      title: member.name,
      meta: `Nº ${memberNumberOf(member)}`,
    })),
  ].slice(0, 8);

  const applySearchHit = (hit) => {
    if (!hit) return;
    if (hit.kind === 'category') setCategory('fee_category');
    setQuery(hit.title || '');
    setMemberFilter(hit.kind === 'member' ? hit.id : '');
    setSuggestOpen(false);
    setPage(0);
  };
  const rows = useMemo(
    () => (isExpense
      ? filterFeeExpenses(feeExpenses, { category, query: listQuery })
      : filterDiscounts(items, { category, query: listQuery })),
    [isExpense, feeExpenses, items, category, listQuery]
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from = rows.length ? safePage * PAGE_SIZE + 1 : 0;
  const to = Math.min(rows.length, (safePage + 1) * PAGE_SIZE);

  const switchHub = (tab) => {
    setHubTab(tab);
    setCategory(null);
    setView('hub');
    setQuery('');
    setMemberFilter('');
    setSuggestOpen(false);
    setPage(0);
    setError('');
    setOk('');
  };

  const openCategory = (id) => {
    setCategory(id);
    setQuery('');
    setMemberFilter('');
    setSuggestOpen(false);
    setPage(0);
    setView('list');
    setError('');
    setOk('');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyFormFor(category, isExpense));
    setError('');
    setOk('');
    setView('form');
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      memberIds: (item.memberIds || []).join(', ') || item.memberNumber || '',
      memberName: item.memberName || '',
      feeCategories: (item.feeCategories || []).join(', ') || item.appliedTo || '',
      familyGroup: item.familyGroup || '',
      description: item.description || item.reason || '',
      validFrom: item.validFrom || item.date || '',
      validTo: item.validTo || '',
      valueType: item.valueType || (item.percentage != null ? 'percent' : 'amount'),
      value: String(item.value ?? item.percentage ?? item.amount ?? ''),
    });
    setError('');
    setOk('');
    setView('form');
  };

  const resolveMemberName = (idsCsv) => {
    const first = String(idsCsv || '').split(/[,;]/)[0]?.trim();
    if (!first) return '';
    const hit = (members || []).find((m) => String(m.memberId) === first);
    return hit?.name || '';
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        id: editingId || undefined,
        category: category || 'members',
        memberIds: form.memberIds,
        memberName: form.memberName || resolveMemberName(form.memberIds),
        feeCategories: form.feeCategories,
        familyGroup: form.familyGroup,
        description: form.description,
        validFrom: form.validFrom,
        validTo: form.validTo,
        valueType: form.valueType,
        value: form.value,
      };
      if (isExpense) {
        createFeeExpense(payload);
        await onUpsertFeeExpense?.(payload);
      } else {
        createDiscount(payload);
        await onUpsert?.(payload);
      }
      setOk(`${Noun} ${editingId ? 'actualizado' : 'creado'}.`);
      setView('list');
    } catch (err) {
      setError(err.message || `No se pudo guardar el ${noun}.`);
    }
  };

  const importCsv = async (file) => {
    setError('');
    setOk('');
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('El archivo no tiene filas de datos.');
      const header = lines[0].toLowerCase();
      const sep = header.includes(';') ? ';' : ',';
      const cols = header.split(sep).map((c) => c.trim());
      const idx = (name) => cols.findIndex((c) => c.includes(name));
      const iMember = idx('socio') >= 0 ? idx('socio') : idx('member');
      const iDesc = idx('desc') >= 0 ? idx('desc') : idx('concepto');
      const iValue = idx('valor') >= 0 ? idx('valor') : idx('value');
      const iType = idx('tipo');
      let created = 0;
      for (let i = 1; i < lines.length; i += 1) {
        const parts = lines[i].split(sep).map((p) => p.trim());
        const memberIds = iMember >= 0 ? parts[iMember] : '';
        const description = iDesc >= 0 ? parts[iDesc] : `Import ${i}`;
        const value = iValue >= 0 ? parts[iValue] : '0';
        const typeRaw = iType >= 0 ? parts[iType] : '';
        const valueType = /%|porcent/i.test(typeRaw) ? 'percent' : 'amount';
        const payload = {
          category: 'member_fee',
          memberIds,
          memberName: resolveMemberName(memberIds),
          description,
          valueType,
          value,
          validFrom: new Date().toISOString().slice(0, 10),
        };
        if (isExpense) {
          createFeeExpense(payload);
          onUpsertFeeExpense?.(payload);
        } else {
          createDiscount(payload);
          onUpsert?.(payload);
        }
        created += 1;
      }
      setOk(`Carga masiva: ${created} ${noun}(s) importados.`);
    } catch (err) {
      setError(err.message || 'No se pudo importar el archivo.');
    }
  };

  const appliedLabel = isExpense ? expenseAppliedToLabel : discountAppliedToLabel;
  const formatValue = isExpense ? formatFeeExpenseValue : formatDiscountValue;
  const formatValidity = isExpense ? formatExpenseValidity : formatDiscountValidity;

  if (view === 'form') {
    const isFeeCat = category === 'fee_category';
    const isFamily = category === 'family';
    const isGeneral = category === 'general';
    const needsMembers = category === 'members' || category === 'member_fee';

    return (
      <div className="fade-in disc-panel">
        <div className="disc-panel-head">
          <h4 className="disc-panel-title">{activeCategory?.label || Noun}</h4>
        </div>
        <form className="disc-form" onSubmit={submit}>
          {isFeeCat ? (
            <div className="disc-field">
              <label className="disc-field-label">Cuotas</label>
              <input
                className="form-input"
                list="disc-fee-categories"
                value={form.feeCategories}
                onChange={(e) => setForm((f) => ({ ...f, feeCategories: e.target.value }))}
                placeholder="Ej. COMISION"
                required
              />
              <datalist id="disc-fee-categories">
                {DATITA_CUOTA_CATEGORY_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p className="disc-field-hint">
                Seleccioná una o varias categorías de cuota a las cuales aplicará este {noun}
              </p>
            </div>
          ) : null}

          {isFamily ? (
            <div className="disc-field">
              <label className="disc-field-label">Grupo familiar</label>
              <input
                className="form-input"
                value={form.familyGroup}
                onChange={(e) => setForm((f) => ({ ...f, familyGroup: e.target.value }))}
                placeholder="Ej. GF - Pérez 1234"
                required
              />
              <p className="disc-field-hint">
                Grupo familiar al que aplicará el {noun} sobre el total de sus cuotas.
              </p>
            </div>
          ) : null}

          {needsMembers ? (
            <div className="disc-field">
              <label className="disc-field-label">Socios</label>
              <MemberPickField
                members={members}
                value={form.memberIds}
                onChange={({ memberIds, memberName }) => setForm((f) => ({ ...f, memberIds, memberName }))}
              />
              <p className="disc-field-hint">
                {category === 'member_fee'
                  ? `Escribí el nombre y elegí el socio. El ${noun} aplica sobre una cuota puntual.`
                  : 'Escribí el nombre y elegí uno o varios socios. Enter toma el primero.'}
              </p>
            </div>
          ) : null}

          {isGeneral ? (
            <div className="disc-field">
              <p className="disc-field-hint" style={{ marginTop: 0 }}>
                Este {noun} se aplicará de forma general a todo el padrón de socios del club.
              </p>
            </div>
          ) : null}

          <div className="disc-field">
            <label className="disc-field-label">Descripción</label>
            <input
              className="form-input"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              required
            />
            <p className="disc-field-hint">Concepto que aparecerá en el detalle de cuotas y boleto de pago</p>
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Válido desde</label>
            <input
              className="form-input"
              type="date"
              value={form.validFrom}
              onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
            />
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Válido hasta</label>
            <input
              className="form-input"
              type="date"
              value={form.validTo}
              onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))}
            />
            <p className="disc-field-hint">
              Fecha hasta la cual será válido, se comparará con la fecha de imputación de la liquidación
            </p>
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Tipo</label>
            <select
              className="form-input"
              value={form.valueType}
              onChange={(e) => setForm((f) => ({ ...f, valueType: e.target.value }))}
            >
              {valueTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <p className="disc-field-hint">Forma en la que se calculará el {noun}</p>
          </div>
          <div className="disc-field">
            <label className="disc-field-label">Valor</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              required
            />
          </div>
          {error ? <p className="ig-error">{error}</p> : null}
          <div className="ig-form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setView('list')}>Volver</button>
            <button type="submit" className="btn btn-tan">
              {editingId ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'list' && activeCategory) {
    return (
      <div className="fade-in disc-panel">
        <div className="disc-panel-head">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setView('hub'); setCategory(null); }}>
            <ArrowLeft size={14} /> Volver
          </button>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {category === 'member_fee' ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importCsv(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn disc-bulk-btn"
                  onClick={() => fileRef.current?.click()}
                >
                  <FileSpreadsheet size={14} /> Carga masiva (Excel)
                </button>
              </>
            ) : null}
            <button type="button" className="btn btn-tan" onClick={openCreate}>
              <Plus size={14} /> {Noun}
            </button>
          </div>
        </div>

        <div className="disc-list-title-row">
          <h4 className="disc-panel-title">
            {activeCategory.label}
            <span className="disc-badge">{rows.length}</span>
          </h4>
        </div>

        <div className="disc-info-banner">{activeCategory.hint}</div>
        {error ? <p className="ig-error">{error}</p> : null}
        {ok ? <p className="ig-ok">{ok}</p> : null}

        <div className="disc-search-bar">
          <span>Buscar por</span>
          <label className="disc-search-input">
            <Search size={14} />
            <div className="disc-member-pick">
              <input
                className="form-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setMemberFilter('');
                  setSuggestOpen(true);
                  setPage(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchHits[0]) {
                    e.preventDefault();
                    applySearchHit(searchHits[0]);
                  }
                }}
                placeholder="Socio, categoría, descripción…"
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={searchHits.length > 0}
              />
              {searchHits.length > 0 ? (
                <ul className="disc-member-hits" role="listbox">
                  {searchHits.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button type="button" className="disc-member-hit" onClick={() => applySearchHit(hit)}>
                        <span>{hit.title}</span>
                        <span>{hit.meta}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>
        </div>

        <div className="disc-pager">
          <span>
            {rows.length === 0
              ? 'No se encontraron resultados'
              : rows.length === 1
                ? 'Se encontró 1 resultado'
                : `Mostrando ${from} - ${to} de ${rows.length}`}
          </span>
          {rows.length > PAGE_SIZE ? (
            <div className="cash-efectivo-pager">
              <button type="button" className="btn btn-secondary btn-sm" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</button>
              <button type="button" className={`cash-efectivo-page-btn${safePage === 0 ? ' is-active' : ''}`} onClick={() => setPage(0)}>1</button>
              {totalPages > 1 ? (
                <button type="button" className={`cash-efectivo-page-btn${safePage === totalPages - 1 ? ' is-active' : ''}`} onClick={() => setPage(totalPages - 1)}>{totalPages}</button>
              ) : null}
              <button type="button" className="btn btn-secondary btn-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Siguiente</button>
            </div>
          ) : null}
        </div>

        <div className="table-responsive">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Aplicado a</th>
                <th>Descripción</th>
                <th>Validez</th>
                <th>Valor</th>
                <th>Funciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                    No hay registros para este alcance.
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.accessinId || row.id.slice(-4)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{appliedLabel(row)}</div>
                      {row.memberNumber && category !== 'fee_category' ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>N° {row.memberNumber}</div>
                      ) : null}
                    </td>
                    <td>{row.description || row.reason || row.concept}</td>
                    <td style={{ fontSize: '0.8rem' }}>{formatValidity(row)}</td>
                    <td style={{ fontWeight: 700, color: isExpense ? 'var(--danger-accent)' : 'var(--emerald-accent)' }}>
                      {formatValue(row)}
                    </td>
                    <td>
                      <div className="cash-lila-row-actions">
                        <button type="button" className="cash-lila-icon-btn is-edit" title="Editar" onClick={() => openEdit(row)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="cash-lila-icon-btn is-del"
                          title="Eliminar"
                          onClick={async () => {
                            if (!window.confirm(`¿Eliminar este ${noun}?`)) return;
                            try {
                              if (isExpense) await onDeleteFeeExpense?.(row.id);
                              else await onDelete?.(row.id);
                            } catch (err) {
                              setError(err.message || `No se pudo eliminar el ${noun}.`);
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!isExpense && category === 'members' && ACCESSIN_BONIFICACIONES_SNAPSHOT?.totalAmount ? (
          <p className="disc-field-hint" style={{ margin: 0 }}>
            Export Accessin: {ACCESSIN_BONIFICACIONES_SNAPSHOT.count} bonificaciones · total{' '}
            {formatCurrency(ACCESSIN_BONIFICACIONES_SNAPSHOT.totalAmount)} · al {ACCESSIN_BONIFICACIONES_SNAPSHOT.asOfLabel || ACCESSIN_BONIFICACIONES_SNAPSHOT.asOf}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fade-in disc-panel">
      <div className="disc-panel-head">
        <h4 className="disc-panel-title">
          <Percent size={18} /> {discountsOnly ? 'Descuentos extras' : 'Descuentos y gastos'}
        </h4>
      </div>

      {discountsOnly ? null : (
        <div className="disc-hub-tabs">
          <button
            type="button"
            className={`disc-hub-tab${hubTab === 'discounts' ? ' is-active' : ''}`}
            onClick={() => switchHub('discounts')}
          >
            <Receipt size={16} /> Descuentos
          </button>
          <button
            type="button"
            className={`disc-hub-tab${hubTab === 'expenses' ? ' is-active' : ''}`}
            onClick={() => switchHub('expenses')}
          >
            <Receipt size={16} /> Gastos
          </button>
        </div>
      )}

      <div className="disc-cat-list">
        {counts.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="disc-cat-row"
            onClick={() => openCategory(cat.id)}
          >
            <span className="disc-cat-label">
              {cat.label}
              <span className="disc-badge">{cat.count}</span>
            </span>
            <span className="disc-cat-more">Ver más +</span>
          </button>
        ))}
      </div>

      {isExpense && onGoExpenses ? (
        <div className="disc-expenses-box" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Gastos fijos recurrentes del club: {fixedExpenses.filter((x) => x.active !== false).length} activos.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onGoExpenses?.()}>
            Ir a gastos fijos
          </button>
        </div>
      ) : null}
    </div>
  );
}
