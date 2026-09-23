import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTierDisplayName } from '../../domain/members/tiers';
import FoldableSection from './FoldableSection';

const PAGE_SIZE = 40;

function memberStatusLabel(status) {
  if (status === 'inactive') return 'Baja';
  if (status === 'suspended') return 'Suspendido';
  return 'Activo';
}

function FamilyPager({ page, totalPages, total, onPage }) {
  if (total <= PAGE_SIZE) return null;
  const from = ((page - 1) * PAGE_SIZE) + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="members-pager">
      <span>
        {from}–{to} de {total.toLocaleString('es-AR')}
      </span>
      <div className="members-pager-controls">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft size={16} /> Anterior
        </button>
        <span className="members-pager-page">Hoja {page} / {totalPages}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPage((p) => Math.min(totalPages, p + 1))}
        >
          Siguiente <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default function FamilyGroupsPadron({
  groups = [],
  tierCatalog,
  onOpenProfile,
  forceOpen = false,
}) {
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageGroups = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return groups.slice(start, start + PAGE_SIZE);
  }, [groups, safePage]);

  useEffect(() => {
    setPage(1);
    setOpenId(null);
  }, [groups]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const range = groups.length === 0
    ? 'Sin familias'
    : `${((safePage - 1) * PAGE_SIZE) + 1}–${Math.min(safePage * PAGE_SIZE, groups.length)} de ${groups.length.toLocaleString('es-AR')}`;

  return (
    <FoldableSection
      as="div"
      className="members-family-padron"
      id="members-family-padron-title"
      title="Padrón de grupos familiares"
      subtitle={range}
      defaultOpen
      storageKey="padron-familias"
      forceOpen={forceOpen}
    >
      <FamilyPager page={safePage} totalPages={totalPages} total={groups.length} onPage={setPage} />

      {groups.length === 0 ? (
        <p className="family-padron-empty">No hay grupos familiares en este filtro.</p>
      ) : (
        <ul className="family-padron-list">
          {pageGroups.map((group) => {
            const open = openId === group.id;
            const titular = group.titular || group.members.find((m) => m.role === 'titular');
            return (
              <li key={group.id} className={`family-padron-item${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="family-padron-toggle"
                  aria-expanded={open}
                  aria-controls={`family-padron-${group.id}`}
                  onClick={() => setOpenId(open ? null : group.id)}
                >
                  <span className="family-padron-copy">
                    <strong>{group.name}</strong>
                    <span>
                      {titular?.name
                        ? `Titular · ${titular.name}${titular.memberId ? ` · Nº ${titular.memberId}` : ''}`
                        : `Integrantes · ${group.members[0]?.name || 'sin titular en el padrón'}`}
                    </span>
                  </span>
                  <span className="family-padron-meta">
                    <span className="family-padron-count">
                      {group.size === 1 ? '1 socio' : `${group.size} socios`}
                    </span>
                    <ChevronDown size={18} className={`family-padron-chevron${open ? ' is-open' : ''}`} aria-hidden />
                  </span>
                </button>
                {open ? (
                  <ul className="family-padron-members" id={`family-padron-${group.id}`}>
                    {group.members.map((member) => {
                      const key = member.memberId || member.id || member.name;
                      const canOpen = Boolean(member.memberId && onOpenProfile);
                      return (
                        <li key={key} className="family-padron-member">
                          <div className="family-padron-member-id">
                            <strong>{member.name}</strong>
                            <span>
                              {member.role === 'titular' ? 'Titular' : (member.relationship || 'Integrante')}
                              {member.memberId ? ` · Nº ${member.memberId}` : ''}
                            </span>
                          </div>
                          <span className="family-padron-member-tier">
                            {getTierDisplayName(member.tier, tierCatalog)}
                          </span>
                          <span className={`family-padron-member-status is-${member.status || 'active'}`}>
                            {memberStatusLabel(member.status)}
                          </span>
                          {canOpen ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onOpenProfile(member.memberId)}
                            >
                              Ver ficha
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <FamilyPager page={safePage} totalPages={totalPages} total={groups.length} onPage={setPage} />
    </FoldableSection>
  );
}
