import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, UserRound } from 'lucide-react';
import { formatShortDate } from '../../domain/members/dues';

const PAGE_SIZE = 10;

function claimTitle(claim) {
  return String(claim?.subject || claim?.title || 'Solicitud').trim() || 'Solicitud';
}

function claimType(claim) {
  return String(claim?.category || claim?.type || 'General').trim() || 'General';
}

function claimResponse(claim) {
  return String(claim?.resolution || claim?.response || '').trim();
}

function claimMemberLabel(claim) {
  const name = String(claim?.memberName || 'Socio').trim() || 'Socio';
  const number = String(claim?.memberId || '').trim();
  return number ? `${name} · Nº ${number}` : name;
}

function statusLabel(status) {
  if (status === 'pending') return 'Pendiente';
  if (status === 'in_progress') return 'En proceso';
  if (status === 'resolved') return 'Resuelto';
  return String(status || 'Pendiente');
}

function statusTone(status) {
  if (status === 'pending') return 'is-pending';
  if (status === 'in_progress') return 'is-progress';
  if (status === 'resolved') return 'is-resolved';
  return 'is-pending';
}

function sortClaims(list = []) {
  const rank = { pending: 0, in_progress: 1, resolved: 2 };
  return [...(list || [])].sort((a, b) => {
    const ra = rank[a?.status] ?? 9;
    const rb = rank[b?.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(b?.createdAt || b?.date || '').localeCompare(String(a?.createdAt || a?.date || ''));
  });
}

/** Buzón de pedidos y reclamos de socios, con asignación al personal de guardia. */
export default function ClaimsTab({ claims = [], setClaims, staffMembers = [], setStaffMembers }) {
  const [editingClaimId, setEditingClaimId] = useState(null);
  const [claimResponseText, setClaimResponseText] = useState('');
  const [claimAssignStaff, setClaimAssignStaff] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('open');

  const sorted = useMemo(() => sortClaims(claims), [claims]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return sorted;
    if (statusFilter === 'open') {
      return sorted.filter((c) => c.status === 'pending' || c.status === 'in_progress');
    }
    return sorted.filter((c) => c.status === statusFilter);
  }, [sorted, statusFilter]);

  const pendingCount = sorted.filter((c) => c.status === 'pending').length;
  const progressCount = sorted.filter((c) => c.status === 'in_progress').length;
  const resolvedCount = sorted.filter((c) => c.status === 'resolved').length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleAssignAndResolveClaim = (claimId, newStatus) => {
    const claim = claims.find((c) => c.id === claimId);
    if (!claim) return;

    const assignedEmpName = claimAssignStaff || claim.assignedStaff;
    const response = claimResponseText.trim() || claimResponse(claim);

    if (assignedEmpName && assignedEmpName !== claim.assignedStaff && typeof setStaffMembers === 'function') {
      const targetEmp = staffMembers.find((s) => s.name === assignedEmpName);
      if (targetEmp) {
        const newActivity = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          description: `Asignación de reclamo: "${claimTitle(claim)}" por Administración.`,
        };

        setStaffMembers(staffMembers.map((s) => {
          if (s.id !== targetEmp.id) return s;
          return {
            ...s,
            currentTask: `Atendiendo: ${claimTitle(claim).slice(0, 30)}…`,
            activities: [newActivity, ...(s.activities || [])],
          };
        }));
      }
    }

    setClaims(claims.map((c) => {
      if (c.id !== claimId) return c;
      return {
        ...c,
        status: newStatus,
        assignedStaff: assignedEmpName,
        response,
        resolution: response,
      };
    }));

    setEditingClaimId(null);
    setClaimResponseText('');
    setClaimAssignStaff('');
  };

  const from = filtered.length === 0 ? 0 : ((safePage - 1) * PAGE_SIZE) + 1;
  const to = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <section className="claims-desk glass-card fade-in" aria-labelledby="claims-desk-title">
      <header className="claims-desk__head">
        <div className="claims-desk__title-row">
          <span className="claims-desk__icon" aria-hidden="true">
            <ClipboardList size={22} />
          </span>
          <div>
            <h2 id="claims-desk-title" className="serif-font claims-desk__title">
              Buzón de pedidos y reclamos
            </h2>
            <p className="claims-desk__lead">
              Solicitudes de socios para asignar a guardia o área técnica. Hasta {PAGE_SIZE} por hoja.
            </p>
          </div>
        </div>
        <div className="claims-desk__stats" aria-label="Resumen del buzón">
          <span className="claims-desk__stat is-pending">
            <strong>{pendingCount}</strong>
            pendientes
          </span>
          <span className="claims-desk__stat is-progress">
            <strong>{progressCount}</strong>
            en proceso
          </span>
          <span className="claims-desk__stat is-resolved">
            <strong>{resolvedCount}</strong>
            resueltos
          </span>
        </div>
      </header>

      <div className="claims-desk__filters" role="toolbar" aria-label="Filtro de estado">
        {[
          { id: 'open', label: 'Abiertos', value: pendingCount + progressCount },
          { id: 'pending', label: 'Pendientes', value: pendingCount },
          { id: 'in_progress', label: 'En proceso', value: progressCount },
          { id: 'resolved', label: 'Resueltos', value: resolvedCount },
          { id: 'all', label: 'Todos', value: sorted.length },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`claims-desk__filter${statusFilter === opt.id ? ' is-on' : ''}`}
            aria-pressed={statusFilter === opt.id}
            onClick={() => setStatusFilter(opt.id)}
          >
            <strong>{opt.value}</strong>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="claims-desk__empty">
          {claims.length === 0
            ? 'Todavía no hay pedidos ni reclamos de socios.'
            : 'No hay solicitudes en este filtro.'}
        </p>
      ) : (
        <>
          <ul className="claims-desk__list">
            {pageRows.map((clm) => {
              const editing = editingClaimId === clm.id;
              const reply = claimResponse(clm);
              return (
                <li
                  key={clm.id}
                  className={`claims-desk__card ${statusTone(clm.status)}${editing ? ' is-editing' : ''}`}
                >
                  <div className="claims-desk__card-top">
                    <div className="claims-desk__card-titles">
                      <span className="claims-desk__type">{claimType(clm)}</span>
                      <strong className="claims-desk__subject">{claimTitle(clm)}</strong>
                    </div>
                    <span className={`claims-desk__status ${statusTone(clm.status)}`}>
                      {statusLabel(clm.status)}
                    </span>
                  </div>

                  <div className="claims-desk__meta">
                    <span>
                      <UserRound size={13} aria-hidden="true" />
                      {claimMemberLabel(clm)}
                    </span>
                    <span>Enviado {formatShortDate(clm.date || String(clm.createdAt || '').slice(0, 10))}</span>
                    <span>
                      Asignado:{' '}
                      <em>{clm.assignedStaff || 'Sin asignar'}</em>
                    </span>
                  </div>

                  {clm.description ? (
                    <p className="claims-desk__body">{clm.description}</p>
                  ) : null}

                  {reply && !editing ? (
                    <p className="claims-desk__reply">
                      <strong>Respuesta del Club</strong>
                      {reply}
                    </p>
                  ) : null}

                  <div className="claims-desk__actions">
                    {!editing ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingClaimId(clm.id);
                          setClaimResponseText(reply);
                          setClaimAssignStaff(clm.assignedStaff || '');
                        }}
                      >
                        Gestionar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setEditingClaimId(null);
                          setClaimResponseText('');
                          setClaimAssignStaff('');
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {editing ? (
                    <div className="claims-desk__editor fade-in">
                      <div className="claims-desk__editor-grid">
                        <label className="claims-desk__field">
                          <span>Asignar a guardia</span>
                          <select
                            className="form-input"
                            value={claimAssignStaff}
                            onChange={(e) => setClaimAssignStaff(e.target.value)}
                          >
                            <option value="">Sin asignar</option>
                            {staffMembers.map((emp) => (
                              <option key={emp.id} value={emp.name}>
                                {emp.name} · {emp.role}
                                {emp.status === 'active' ? ' · en guardia' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="claims-desk__field">
                          <span>Respuesta del Club</span>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Ej.: Derivado a mantenimiento de canchas."
                            value={claimResponseText}
                            onChange={(e) => setClaimResponseText(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="claims-desk__editor-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleAssignAndResolveClaim(clm.id, 'in_progress')}
                        >
                          En proceso
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm claims-desk__resolve"
                          onClick={() => handleAssignAndResolveClaim(clm.id, 'resolved')}
                        >
                          Resolver e informar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <nav className="claims-desk__pager" aria-label="Paginación del buzón">
            <span className="claims-desk__pager-range">
              {from}–{to} de {filtered.length}
            </span>
            <div className="claims-desk__pager-controls">
              <button
                type="button"
                className="claims-desk__pager-btn"
                disabled={safePage <= 1}
                aria-label="Hoja anterior"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="claims-desk__pager-page">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="claims-desk__pager-btn"
                disabled={safePage >= totalPages}
                aria-label="Hoja siguiente"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
