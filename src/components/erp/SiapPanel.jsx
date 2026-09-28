import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { listSiapOccupants, siapSeed, siapSummary } from '../../domain/accounting/siap';
import { useSnapshotSeed } from '../../hooks/useSnapshots';
import SnapshotGate from '../SnapshotGate';

export default function SiapPanel() {
  return (
    <SnapshotGate names={['accessinSiap']}>
      <SiapContent />
    </SnapshotGate>
  );
}

function SiapContent() {
  useSnapshotSeed(['accessinSiap'], siapSeed);
  const [query, setQuery] = useState('');
  const summary = useMemo(() => siapSummary(), []);
  const rows = useMemo(() => listSiapOccupants({ query }), [query]);

  return (
    <div className="fade-in mb-folio">
      <header className="mb-folio-head">
        <div>
          <p className="mb-folio-kicker">Contabilidad</p>
          <h3 className="mb-folio-title">SIAP</h3>
          <p className="mb-folio-meta">
            Identificación de ocupantes.
            {summary.generatedAt ? ` Generado el ${summary.generatedAt}.` : ''}
            {summary.fileName ? ` ${summary.fileName.replace(/^LILA\s*[-–]\s*/i, '')}` : ''}
          </p>
        </div>
        <span className="mb-folio-seal">{summary.count.toLocaleString('es-AR')} ocupantes</span>
      </header>

      <dl className="mb-folio-kpis">
        <div className="mb-folio-kpi">
          <dt>Ocupantes</dt>
          <dd>{summary.count.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi is-net">
          <dt>Con CUIT</dt>
          <dd>{summary.withCuit.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Documentos</dt>
          <dd>{summary.uniqueDocuments.toLocaleString('es-AR')}</dd>
        </div>
        <div className="mb-folio-kpi">
          <dt>Corte</dt>
          <dd>{summary.asOfLabel || summary.asOf || '—'}</dd>
        </div>
      </dl>

      <label className="ld-search">
        <span className="form-label">Buscar</span>
        <span className="ld-search-field">
          <Search size={14} aria-hidden="true" />
          <input
            className="form-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ocupante, socio, DNI o CUIT"
          />
        </span>
      </label>

      <div className="table-responsive">
        <table className="admin-table cash-lila-table">
          <thead>
            <tr>
              <th>Ocupante</th>
              <th>Documento</th>
              <th>Socio</th>
              <th>CUIT</th>
              <th>Localidad</th>
              <th>Persona</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="mb-folio-empty">
                  {summary.count === 0
                    ? 'El corte SIAP no trae ocupantes.'
                    : 'No hay ocupantes con este filtro.'}
                </td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td>{row.occupantName || row.occupantId || '—'}</td>
                <td>{[row.documentType, row.documentNumber].filter(Boolean).join(' ') || '—'}</td>
                <td>{row.memberName || row.memberFlag || '—'}</td>
                <td>{row.cuit || '—'}</td>
                <td>{row.locality || '—'}</td>
                <td>{row.personType || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
