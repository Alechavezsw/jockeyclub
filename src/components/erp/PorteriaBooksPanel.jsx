import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  isPorteriaIncomeItem,
  porterIncomeBooks,
  porterIncomeBooksByDate,
  PORTERIA_TABLE_PAGE_SIZE,
} from '../../domain/accounting/otherIncomes';
import { repos } from '../../data/bootstrap';
import { formatInstantAR, todayAR } from '../../lib/arDate';

/**
 * Acumulado por portero y por día — vista en tabla (subpágina de Ingresos portería).
 */
export default function PorteriaBooksPanel({
  items = [],
  rendererId = '',
  rendererName = '',
  rendererIsPorter = false,
}) {
  const [porters, setPorters] = useState([]);
  const [loadingPorters, setLoadingPorters] = useState(true);
  const [error, setError] = useState('');
  const [tablePage, setTablePage] = useState(0);
  const today = todayAR();

  const rows = useMemo(
    () => (items || []).filter(isPorteriaIncomeItem),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingPorters(true);
    repos.listGateOperators()
      .then((list) => {
        if (cancelled) return;
        const next = Array.isArray(list) ? list : [];
        const selfName = String(rendererName || '').trim();
        const withSelf = rendererIsPorter && rendererId && selfName && !next.some((row) => row.id === rendererId)
          ? [...next, { id: rendererId, fullName: selfName }]
          : next;
        withSelf.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
        setPorters(withSelf);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'No se pudieron cargar los porteros.');
      })
      .finally(() => {
        if (!cancelled) setLoadingPorters(false);
      });
    return () => { cancelled = true; };
  }, [rendererId, rendererName, rendererIsPorter]);

  const summaryBooks = useMemo(() => {
    const books = porterIncomeBooks(rows, porters, today);
    if (!(rendererIsPorter && rendererId)) return books;
    return books.filter((book) => book.id === rendererId);
  }, [rows, porters, today, rendererIsPorter, rendererId]);

  const flatRows = useMemo(() => {
    const groups = porterIncomeBooksByDate(rows, porters);
    const scoped = (rendererIsPorter && rendererId)
      ? groups
        .map((group) => ({
          ...group,
          books: group.books.filter((book) => book.id === rendererId),
        }))
        .filter((group) => group.books.length > 0)
      : groups;
    return scoped.flatMap((group) => group.books.map((book) => ({
      key: `${group.date}-${book.id}`,
      date: group.date,
      porterId: book.id,
      name: book.name,
      count: book.count,
      total: book.total,
    })));
  }, [rows, porters, rendererIsPorter, rendererId]);

  const totalPages = Math.max(1, Math.ceil(flatRows.length / PORTERIA_TABLE_PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages - 1);
  const pageRows = flatRows.slice(
    safePage * PORTERIA_TABLE_PAGE_SIZE,
    (safePage + 1) * PORTERIA_TABLE_PAGE_SIZE,
  );
  const pageFrom = flatRows.length === 0 ? 0 : safePage * PORTERIA_TABLE_PAGE_SIZE + 1;
  const pageTo = Math.min(flatRows.length, (safePage + 1) * PORTERIA_TABLE_PAGE_SIZE);

  useEffect(() => {
    setTablePage(0);
  }, [flatRows.length]);

  return (
    <div className="fade-in gate-income gate-porter-books">
      <header className="gate-porter-books-head">
        <div>
          <h2 className="gate-porter-books-title">Lo que lleva cada portero</h2>
          <p className="gate-porter-books-sub">
            {loadingPorters
              ? 'Cargando porteros…'
              : flatRows.length
                ? `${flatRows.length} ${flatRows.length === 1 ? 'renglón' : 'renglones'} · ${summaryBooks.length} ${summaryBooks.length === 1 ? 'portero' : 'porteros'}`
                : 'Sin movimientos'}
          </p>
        </div>
      </header>

      {error ? <p className="gate-income-error" role="alert">{error}</p> : null}

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Portero</th>
              <th>Hoy</th>
              <th>Total</th>
              <th>Rendiciones</th>
            </tr>
          </thead>
          <tbody>
            {summaryBooks.length === 0 ? (
              <tr>
                <td colSpan={4}>Todavía no hay rendiciones para acumular.</td>
              </tr>
            ) : summaryBooks.map((book) => (
              <tr key={book.id}>
                <td>{book.name}</td>
                <td className="tabular-nums">{formatCurrency(book.today)}</td>
                <td className="tabular-nums">{formatCurrency(book.total)}</td>
                <td className="tabular-nums">{book.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="gate-porter-books-section">Por día</h3>
      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Portero</th>
              <th>Rendiciones</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={4}>Todavía no hay rendiciones para acumular.</td>
              </tr>
            ) : pageRows.map((row) => (
              <tr key={row.key}>
                <td>{formatInstantAR(row.date)}</td>
                <td>{row.name}</td>
                <td className="tabular-nums">{row.count}</td>
                <td className="tabular-nums">{formatCurrency(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {flatRows.length > 0 ? (
        <div className="gate-income-pager" aria-live="polite">
          <span className="gate-income-pager-meta">
            {pageFrom}–{pageTo} de {flatRows.length}
          </span>
          <div className="gate-income-pager-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 0}
              aria-label="Hoja anterior"
              onClick={() => setTablePage((page) => Math.max(0, page - 1))}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Anterior
            </button>
            <span className="gate-income-pager-page">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= totalPages - 1}
              aria-label="Hoja siguiente"
              onClick={() => setTablePage((page) => Math.min(totalPages - 1, page + 1))}
            >
              Siguiente <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
