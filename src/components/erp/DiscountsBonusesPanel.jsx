import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileSpreadsheet, Pencil, Percent, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import { DATITA_CUOTA_CATEGORY_NAMES } from '../../domain/members/tiers';
import {
  DISCOUNT_CATEGORIES,
  DISCOUNT_VALUE_TYPES,
  ACCESSIN_BONIFICACIONES_SNAPSHOT,
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
}) {
  const [hubTab, setHubTab] = useState('discounts');
  const [category, setCategory] = useState(null);
  const [view, setView] = useState('hub');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const fileRef = useRef(null);

  const isExpense = hubTab === 'expenses';
  const noun = isExpense ? 'gasto' : 'descuento';
  const Noun = isExpense ? 'Gasto' : 'Descuento';
  const valueTypes = isExpense ? FEE_EXPENSE_VALUE_TYPES : DISCOUNT_VALUE_TYPES;

  const counts = useMemo(
    () => (isExpense ? feeExpenseCategoryCounts(feeExpenses) : discountCategoryCounts(items)),
    [isExpense, feeExpenses, items]
  );
  const activeCategory = (isExpense ? FEE_EXPENSE_CATEGORIES : DISCOUNT_CATEGORIES)
    .find((c) => c.id === category) || null;

  const rows = useMemo(
    () => (isExpense
      ? filterFeeExpenses(feeExpenses, { category, query })
      : filterDiscounts(items, { category, query })),
    [isExpense, feeExpenses, items, category, query]
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
    setPage(0);
    setError('');
    setOk('');
  };

  const openCategory = (id) => {
    setCategory(id);
    setQuery('');
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

  const submit = (e) => {
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
        onUpsertFeeExpense?.(payload);
      } else {
        createDiscount(payload);
        onUpsert?.(payload);
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
                placeholder="Ej. GF - Laciar 8377"
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
              <input
                className="form-input"
                value={form.memberIds}
                onChange={(e) => setForm((f) => ({ ...f, memberIds: e.target.value }))}
                placeholder="Nros. de socio separados por coma"
                required
              />
              <p className="disc-field-hint">
                {category === 'member_fee'
                  ? `Socio al que se aplica el ${noun} sobre una cuota puntual.`
                  : `Seleccioná uno o varios socios a los cuales aplicará este ${noun}.`}
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
            <button type="submit" className="btn cash-lila-purple-btn">
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
            <button type="button" className="btn cash-lila-purple-btn" onClick={openCreate}>
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
            <input
              className="form-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Socio, categoría, descripción…"
            />
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
                          onClick={() => {
                            if (!window.confirm(`¿Eliminar este ${noun}?`)) return;
                            if (isExpense) onDeleteFeeExpense?.(row.id);
                            else onDelete?.(row.id);
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
            {formatCurrency(ACCESSIN_BONIFICACIONES_SNAPSHOT.totalAmount)} · al {ACCESSIN_BONIFICACIONES_SNAPSHOT.asOf}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fade-in disc-panel">
      <div className="disc-panel-head">
        <h4 className="disc-panel-title">
          <Percent size={18} /> Descuentos y gastos
        </h4>
      </div>

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
