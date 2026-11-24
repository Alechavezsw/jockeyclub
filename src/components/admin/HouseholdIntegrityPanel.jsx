import { AlertTriangle, Search, User } from 'lucide-react';
import {
  HOUSEHOLD_ISSUE_LABELS,
  scanPadronHouseholdIssues,
  summarizeHouseholdIssues,
} from '../../domain/members/householdIntegrity';

/**
 * Revisión administrativa de vínculos y fichas incompletas.
 * Solo lectura: no reasigna familiares ni corrige el padrón sola.
 */
export default function HouseholdIntegrityPanel({
  embedded = false,
  members = [],
  onOpenProfile,
}) {
  const issues = scanPadronHouseholdIssues(members);
  const summary = summarizeHouseholdIssues(issues);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity !== 'error');

  return (
    <section
      className={`household-integrity-panel${embedded ? ' is-embedded' : ''}`}
      aria-label="Revisión de grupos familiares y fichas"
    >
      <header className="household-integrity-head">
        <div>
          <p className="household-integrity-kicker">Solo lectura · sin reasignación automática</p>
          <h3 className="serif-font">Revisión de vínculos y fichas</h3>
          <p className="household-integrity-lead">
            Detecta integrantes sin titular, titulares inactivos con familia activa,
            DNI repetidos y campos faltantes en el padrón ya cargado.
            Abrí la ficha y corregí a mano con evidencia.
          </p>
        </div>
        <div className="household-integrity-summary" aria-live="polite">
          <span><b className="tabular-nums">{summary.errors}</b> graves</span>
          <span><b className="tabular-nums">{summary.warnings}</b> avisos</span>
          <span><b className="tabular-nums">{summary.total}</b> en total</span>
        </div>
      </header>

      {!issues.length ? (
        <p className="household-integrity-empty" role="status">
          <Search size={16} aria-hidden />
          Sin inconsistencias en el padrón cargado en esta sesión.
          Si el listado está incompleto, buscá el socio o ampliá el padrón.
        </p>
      ) : (
        <div className="household-integrity-lists">
          {[
            { title: 'Graves', rows: errors },
            { title: 'Avisos', rows: warnings },
          ].filter((block) => block.rows.length).map((block) => (
            <div key={block.title} className="household-integrity-block">
              <h4>{block.title}</h4>
              <ul className="household-integrity-list">
                {block.rows.map((issue) => {
                  const label = HOUSEHOLD_ISSUE_LABELS[issue.code] || issue.code;
                  const canOpen = Boolean(onOpenProfile && issue.memberId);
                  return (
                    <li
                      key={`${issue.code}-${issue.memberId}-${issue.documentNumber || ''}-${issue.principalNumber || ''}`}
                      className={`household-integrity-item is-${issue.severity || 'warn'}`}
                    >
                      <AlertTriangle size={15} aria-hidden />
                      <div>
                        <strong>{label}</strong>
                        <p>{issue.message}</p>
                        {issue.memberName ? (
                          <span className="household-integrity-meta">{issue.memberName}</span>
                        ) : null}
                      </div>
                      {canOpen ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onOpenProfile(issue.memberId)}
                        >
                          <User size={13} aria-hidden /> Ficha
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
