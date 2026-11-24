import { useEffect, useState } from 'react';
import { AlertTriangle, Link2, Search, User } from 'lucide-react';
import {
  HOUSEHOLD_ISSUE_LABELS,
  scanPadronHouseholdIssues,
  summarizeHouseholdIssues,
} from '../../domain/members/householdIntegrity';
import { repos } from '../../data/bootstrap';
import { canCorrectFamilyLinks } from '../../domain/auth/roles';
import { useAuth } from '../../context/AuthContext';
import FamilyLinkCorrectionModal from './FamilyLinkCorrectionModal';
import { memberNumberOf } from '../../domain/members/households';

/**
 * Revisión administrativa de vínculos y fichas incompletas.
 * La corrección asistida abre modal con preview; no reasigna sola.
 */
export default function HouseholdIntegrityPanel({
  embedded = false,
  members = [],
  onOpenProfile,
}) {
  const { roles, role } = useAuth();
  const canFix = canCorrectFamilyLinks({ roles, role });
  const issues = scanPadronHouseholdIssues(members);
  const summary = summarizeHouseholdIssues(issues);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity !== 'error');
  const [reviewMember, setReviewMember] = useState(null);
  const [audits, setAudits] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canFix || typeof repos.listFamilyLinkAudits !== 'function') {
        if (!cancelled) setAudits([]);
        return;
      }
      try {
        const rows = await repos.listFamilyLinkAudits({ limit: 20 });
        if (!cancelled) setAudits(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setAudits([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canFix, members.length]);

  function openReview(memberId) {
    const id = String(memberId || '').replace(/\D/g, '');
    const found = (members || []).find((row) => memberNumberOf(row) === id) || null;
    if (found) setReviewMember(found);
    else if (onOpenProfile) onOpenProfile(id);
  }

  return (
    <section
      className={`household-integrity-panel${embedded ? ' is-embedded' : ''}`}
      aria-label="Revisión de grupos familiares y fichas"
    >
      <header className="household-integrity-head">
        <div>
          <p className="household-integrity-kicker">Detección + corrección asistida</p>
          <h3 className="serif-font">Revisión de vínculos y fichas</h3>
          <p className="household-integrity-lead">
            Detecta integrantes sin titular, titulares inactivos con familia activa,
            DNI repetidos y campos faltantes. La corrección pide preview, motivo y confirmación;
            no inventa relaciones ni toca saldos.
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
                  const showFix = canFix && issue.memberId && (
                    issue.code === 'dependent_missing_titular'
                    || issue.code === 'inactive_titular_active_dependent'
                    || issue.code === 'inactive_titular_active_dependents'
                    || issue.code === 'same_document_multiple_households'
                  );
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
                      <div className="household-integrity-item-actions">
                        {canOpen ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onOpenProfile(issue.memberId)}
                          >
                            <User size={13} aria-hidden /> Ficha
                          </button>
                        ) : null}
                        {showFix ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => openReview(issue.memberId)}
                          >
                            <Link2 size={13} aria-hidden /> Revisar vínculo
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canFix ? (
        <section className="household-integrity-audits" aria-label="Auditoría de vínculos">
          <h4>Últimas correcciones</h4>
          {!audits.length ? (
            <p className="muted">Sin correcciones registradas en esta base (o la RPC aún no está publicada).</p>
          ) : (
            <ul className="household-integrity-list">
              {audits.map((row) => (
                <li key={row.id} className="household-integrity-item">
                  <Link2 size={15} aria-hidden />
                  <div>
                    <strong>Nº {row.member_number}</strong>
                    <p>
                      {row.previous_principal || '—'} → {row.new_principal}
                      {row.actor_name ? ` · ${row.actor_name}` : ''}
                    </p>
                    <span className="household-integrity-meta">{row.reason}</span>
                  </div>
                  {onOpenProfile ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenProfile(row.member_number)}
                    >
                      Ficha
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <FamilyLinkCorrectionModal
        open={Boolean(reviewMember)}
        member={reviewMember}
        members={members}
        onClose={() => setReviewMember(null)}
        onApplied={() => {
          setReviewMember(null);
          if (typeof repos.listFamilyLinkAudits === 'function') {
            repos.listFamilyLinkAudits({ limit: 20 }).then((rows) => setAudits(Array.isArray(rows) ? rows : [])).catch(() => {});
          }
        }}
      />
    </section>
  );
}
