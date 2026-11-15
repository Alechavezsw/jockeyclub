import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, UserRound } from 'lucide-react';
import { formatShortDate } from '../../domain/members/dues';

const PAGE_SIZE = 10;

const FILTERS = [
  { id: 'open', label: 'Abiertos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'in_progress', label: 'En proceso' },
  { id: 'resolved', label: 'Resueltos' },
  { id: 'all', label: 'Todos' },
];

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

/** Normaliza status legacy (`open`) y variantes al set de la UI. */
function normalizeStatus(status) {
  const raw = String(status || 'pending').trim().toLowerCase();
  if (!raw || raw === 'open' || raw === 'nuevo' || raw === 'pendiente') return 'pending';
  if (raw === 'in_progress' || raw === 'in-progress' || raw === 'progress' || raw === 'en_proceso') {
    return 'in_progress';
  }
  if (raw === 'resolved' || raw === 'closed' || raw === 'done' || raw === 'resuelto') return 'resolved';
  return raw;
}

function statusLabel(status) {
  const s = normalizeStatus(status);
  if (s === 'pending') return 'Pendiente';
  if (s === 'in_progress') return 'En proceso';
  if (s === 'resolved') return 'Resuelto';
  return String(status || 'Pendiente');
}

function statusTone(status) {
  const s = normalizeStatus(status);
  if (s === 'pending') return 'is-pending';
  if (s === 'in_progress') return 'is-progress';
  if (s === 'resolved') return 'is-resolved';
  return 'is-pending';
}

function sortClaims(list = []) {
  const rank = { pending: 0, in_progress: 1, resolved: 2 };
  return [...(list || [])].sort((a, b) => {
    const ra = rank[normalizeStatus(a?.status)] ?? 9;
    const rb = rank[normalizeStatus(b?.status)] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(b?.createdAt || b?.date || '').localeCompare(String(a?.createdAt || a?.date || ''));
  });
}

function matchesFilter(claim, filterId) {
  const status = normalizeStatus(claim?.status);
  if (filterId === 'all') return true;
  if (filterId === 'open') return status === 'pending' || status === 'in_progress';
  return status === filterId;
}

/** Buzón de pedidos y reclamos de socios, con asignación al personal de guardia. */
export default function ClaimsTab({ claims = [], setClaims, staffMembers = [], setStaffMembers }) {
  const [editingClaimId, setEditingClaimId] = useState(null);
  const [claimResponseText, setClaimResponseText] = useState('');
  const [claimAssignStaff, setClaimAssignStaff] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('open');

  const sorted = useMemo(() => sortClaims(claims), [claims]);

  const counts = useMemo(() => {
    let pending = 0;
    let progress = 0;
    let resolved = 0;
    for (const c of sorted) {
      const s = normalizeStatus(c.status);
      if (s === 'pending') pending += 1;
      else if (s === 'in_progress') progress += 1;
      else if (s === 'resolved') resolved += 1;
    }
    return {
      open: pending + progress,
      pending,
      in_progress: progress,
      resolved,
      all: sorted.length,
    };
  }, [sorted]);

  const filtered = useMemo(
    () => sorted.filter((c) => matchesFilter(c, statusFilter)),
    [sorted, statusFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage(1);
    setEditingClaimId(null);
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

        setStaffMembers((prev) => (prev || []).map((s) => {
          if (s.id !== targetEmp.id) return s;
          return {
            ...s,
            currentTask: `Atendiendo: ${claimTitle(claim).slice(0, 30)}…`,
            activities: [newActivity, ...(s.activities || [])],
          };
        }));
      }
    }

    setClaims((prev) => (prev || []).map((c) => {
      if (c.id !== claimId) return c;
      return {
        ...c,
        status: newStatus,
        assignedStaff: assignedEmpName,
        response,
        resolution: response,
        meta: {
          ...(c.meta || {}),
          assignedStaff: assignedEmpName || null,
          response: response || null,
        },
      };
    }));

    setEditingClaimId(null);
    setClaimResponseText('');
    setClaimAssignStaff('');
  };

  const from = filtered.length === 0 ? 0 : ((safePage - 1) * PAGE_SIZE) + 1;
  const to = Math.min(safePage * PAGE_SIZE, filtered.length);
  const activeFilterLabel = FILTERS.find((f) => f.id === statusFilter)?.label || 'Abiertos';

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
      </header>

      <div className="claims-desk__filters" role="toolbar" aria-label="Filtro de estado">
        {FILTERS.map((opt) => {
          const value = counts[opt.id] ?? 0;
          const isOn = statusFilter === opt.id;
          const tone =
            opt.id === 'pending' || opt.id === 'open'
              ? 'is-pending'
              : opt.id === 'in_progress'
                ? 'is-progress'
                : opt.id === 'resolved'
                  ? 'is-resolved'
                  : '';
          return (
            <button
              key={opt.id}
              type="button"
              className={`claims-desk__filter${tone ? ` ${tone}` : ''}${isOn ? ' is-on' : ''}`}
              aria-pressed={isOn}
              onClick={() => setStatusFilter(opt.id)}
            >
              <strong>{value}</strong>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      <p className="claims-desk__result" aria-live="polite">
        {filtered.length === 0
          ? `Sin solicitudes en «${activeFilterLabel}».`
          : `Mostrando ${from}–${to} de ${filtered.length} · ${activeFilterLabel}`}
      </p>

      {filtered.length === 0 ? (
        <p className="claims-desk__empty">
          {claims.length === 0
            ? 'Todavía no hay pedidos ni reclamos de socios.'
            : 'Probá otro filtro para ver el resto del buzón.'}
        </p>
      ) : (
        <>
          <ul className="claims-desk__list" key={`claims-${statusFilter}-${safePage}`}>
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
