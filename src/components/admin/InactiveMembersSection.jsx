import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { memberMatchesDirectoryQuery, mergeMembersById } from '../../domain/members/households';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import FoldableSection from './FoldableSection';

const PAGE = 40;

function categoryOf(member) {
  if (Array.isArray(member?.cuotaCategories)) {
    const named = member.cuotaCategories.find(Boolean);
    if (named) return named;
  }
  return '';
}

export default function InactiveMembersSection({ members = [], openToken = 0 }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [remoteHits, setRemoteHits] = useState([]);

  useEffect(() => {
    const raw = query.trim();
    const digits = raw.replace(/\D/g, '');
    const enough = raw.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      repos.searchMembersDirectory(raw, { limit: 40 })
        .then((rows) => {
          if (cancelled) return;
          setRemoteHits((rows || []).filter((member) => (member.status || '') === 'inactive'));
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const inactive = useMemo(() => {
    const local = (members || []).filter((member) => (member.status || '') === 'inactive');
    return mergeMembersById(local, remoteHits);
  }, [members, remoteHits]);
  const filtered = useMemo(() => {
    const raw = query.trim();
    const remoteIds = new Set(remoteHits.map((hit) => String(hit?.memberId || '')));
    const rows = !raw
      ? inactive
      : inactive.filter((member) => (
        remoteIds.has(String(member.memberId || ''))
        || memberMatchesDirectoryQuery(member, raw)
      ));
    return rows.toSorted((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  }, [inactive, query, remoteHits]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);

  return (
    <FoldableSection
      className="membership-moves inactive-members"
      id="socios-inactivos-title"
      title="Socios inactivos"
      subtitle="Fichas dadas de baja. No entran en el padrón vigente."
      count={inactive.length.toLocaleString('es-AR')}
      defaultOpen={false}
      storageKey="sociosInactivos"
      openToken={openToken}
    >
      <div className="inactive-members-tools">
        <label className="inactive-members-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Nombre, número, documento, mail o motivo"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <p className="inactive-members-count">
          {filtered.length.toLocaleString('es-AR')} en esta vista
        </p>
      </div>

      {slice.length === 0 ? (
        <p className="inactive-members-empty">No hay fichas inactivas con ese criterio.</p>
      ) : (
        <ul className="membership-moves-list">
          {slice.map((member) => {
            const profileTo = member.memberId
              ? `/panel/members/${encodeURIComponent(member.memberId)}`
              : null;
            const category = categoryOf(member);
            return (
              <li key={member.id || member.memberId} className="membership-moves-row" style={{ '--move-color': '#7a3048' }}>
                <div>
                  {profileTo ? (
                    <Link to={profileTo} className="membership-moves-name">
                      {member.name || `Socio ${member.memberId}`}
                    </Link>
                  ) : (
                    <strong>{member.name || 'Sin nombre'}</strong>
                  )}
                  <span className="membership-moves-meta">
                    Nº {member.memberId || '—'}
                    {member.documentNumber ? ` · DNI ${member.documentNumber}` : ''}
                    {category ? ` · ${category}` : ''}
                    {member.familyTitular ? ' · Titular' : ''}
                    {Array.isArray(member.disciplines) && member.disciplines[0] ? ` · ${member.disciplines[0]}` : ''}
                    {member.bajaMotivo ? ` · ${member.bajaMotivo}` : ' · Sin motivo'}
                  </span>
                </div>
                {profileTo ? (
                  <Link to={profileTo} className="membership-moves-link">Ver ficha</Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <div className="members-pager members-pager--bottom" aria-live="polite">
          <span>
            {((safePage - 1) * PAGE) + 1}–{Math.min(safePage * PAGE, filtered.length)} de {filtered.length.toLocaleString('es-AR')}
          </span>
          <div className="members-pager-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="Hoja anterior"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <span className="members-pager-page">Hoja {safePage} / {pages}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={safePage >= pages}
              onClick={() => setPage(safePage + 1)}
              aria-label="Hoja siguiente"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </FoldableSection>
  );
}
