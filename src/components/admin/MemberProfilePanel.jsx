import { useMemo, useState } from 'react';
import {
  ArrowLeft, User, CreditCard, Users, Wallet, DoorOpen, CalendarDays,
  MessageSquare, ClipboardList, Activity, Phone, Mail, MapPin,
} from 'lucide-react';
import VirtualCard from '../VirtualCard';
import { formatShortDate } from '../../domain/members/dues';

const SECTIONS = [
  { id: 'ficha', label: 'Ficha', icon: User },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { id: 'familia', label: 'Grupo familiar', icon: Users },
  { id: 'movimientos', label: 'Movimientos', icon: Wallet },
  { id: 'entradas', label: 'Entradas', icon: DoorOpen },
  { id: 'asistencia', label: 'Asistencia', icon: CalendarDays },
  { id: 'reclamos', label: 'Reclamos', icon: ClipboardList },
  { id: 'mensajes', label: 'Mensajes', icon: MessageSquare },
  { id: 'trazabilidad', label: 'Trazabilidad', icon: Activity },
];

function Field({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.68rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
        {value || '—'}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
      {text}
    </p>
  );
}

function TimelineItem({ when, title, detail, tone = 'neutral' }) {
  const color =
    tone === 'ok' ? 'var(--emerald-accent)'
      : tone === 'warn' ? 'var(--warning-accent)'
        : tone === 'danger' ? 'var(--danger-accent)'
          : 'var(--text-gold)';
  return (
    <div className="mp-row" style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border-glass)' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{when}</div>
      <div>
        <div style={{ fontSize: '0.88rem', fontWeight: 650, color }}>
          {title}
        </div>
        {detail && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>{detail}</div>
        )}
      </div>
    </div>
  );
}

/** Perfil institucional completo del socio titular. */
export default function MemberProfilePanel({
  member,
  onBack,
  formatCurrency,
  journalEntries = [],
  entryLogs = [],
  reservations = [],
  claims = [],
  messages = [],
}) {
  const [section, setSection] = useState('ficha');

  const movements = useMemo(() => {
    if (!member) return [];
    const idHint = member.memberId.slice(0, 6);
    const nameHint = member.name;
    return (journalEntries || [])
      .filter((e) => {
        const d = e.description || '';
        return d.includes(nameHint) || d.includes(idHint) || d.includes(member.memberId);
      })
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [journalEntries, member]);

  const entries = useMemo(() => {
    if (!member) return [];
    return (entryLogs || [])
      .filter((e) => e.memberId === member.memberId)
      .slice()
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  }, [entryLogs, member]);

  const bookings = useMemo(() => {
    if (!member) return [];
    return (reservations || [])
      .filter((r) => r.memberId === member.memberId || r.memberName === member.name)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [reservations, member]);

  const memberClaims = useMemo(() => {
    if (!member) return [];
    return (claims || []).filter((c) => c.memberId === member.memberId);
  }, [claims, member]);

  const memberMessages = useMemo(() => {
    if (!member) return [];
    return (messages || []).filter(
      (m) => m.recipientId === member.memberId || m.senderId === member.memberId
    );
  }, [messages, member]);

  const timeline = useMemo(() => {
    if (!member) return [];
    const items = [];

    items.push({
      when: formatShortDate(member.joinDate) || 'Alta',
      title: 'Alta de socio titular',
      detail: `Categoría ${member.tier?.toUpperCase()} · Credencial ${member.memberId}`,
      tone: 'ok',
      sort: member.joinDate || '1970-01-01',
    });

    movements.forEach((e) => {
      const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount;
      items.push({
        when: formatShortDate(e.date),
        title: e.description,
        detail: amount != null ? formatCurrency(amount) : null,
        tone: 'neutral',
        sort: e.date,
      });
    });

    entries.forEach((e) => {
      items.push({
        when: `${formatShortDate(e.date)} ${e.time || ''}`.trim(),
        title: e.status === 'granted' ? 'Ingreso al club autorizado' : 'Ingreso denegado',
        detail: e.notes || e.role,
        tone: e.status === 'granted' ? 'ok' : 'danger',
        sort: `${e.date}T${e.time || '00:00'}`,
      });
    });

    bookings.forEach((r) => {
      items.push({
        when: formatShortDate(r.date),
        title: `Reserva · ${r.facilityName || r.facilityId}`,
        detail: `${r.time || ''} · ${r.status}`,
        tone: r.status === 'confirmed' ? 'ok' : 'warn',
        sort: `${r.date}T${r.time || '00:00'}`,
      });
    });

    memberClaims.forEach((c) => {
      items.push({
        when: formatShortDate(c.date),
        title: `Reclamo · ${c.title}`,
        detail: c.status,
        tone: c.status === 'resolved' ? 'ok' : 'warn',
        sort: c.date,
      });
    });

    return items.sort((a, b) => String(b.sort).localeCompare(String(a.sort)));
  }, [member, movements, entries, bookings, memberClaims, formatCurrency]);

  if (!member) {
    return (
      <div className="glass-card fade-in" style={{ padding: '1.5rem' }}>
        <Empty text="Socio no encontrado." />
        <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: '1rem' }}>
          Volver al padrón
        </button>
      </div>
    );
  }

  const statusOk = member.status === 'active';

  return (
    <div className="glass-card fade-in member-profile" style={{ padding: '1.25rem 1.5rem' }}>
      <style>{`
        @media (max-width: 640px) {
          .member-profile .mp-row { grid-template-columns: 1fr !important; }
          .member-profile { padding: 1rem !important; }
          .member-profile .section-chips { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; }
          .member-profile .section-chips .btn { flex: 0 0 auto; white-space: nowrap; }
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1.1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', minWidth: 0 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <ArrowLeft size={14} /> Padrón
          </button>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            overflow: 'hidden',
            border: '1px solid var(--border-glass)',
            background: 'rgba(207,161,58,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontWeight: 800,
            color: 'var(--text-gold)',
          }}>
            {member.photo ? (
              <img src={member.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (member.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="serif-font" style={{ margin: 0, fontSize: '1.45rem', color: 'var(--text-gold)' }}>
              {member.name}
            </h3>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Cred. {member.memberId} · <span className={`badge-tier ${member.tier}`}>{member.tier}</span>
              {' · '}
              <span style={{ color: statusOk ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                {statusOk ? '● Cuenta habilitada' : '○ Cuenta suspendida'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Saldo cuota
          </div>
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            color: (member.outstandingBalance || 0) > 0 ? 'var(--warning-accent)' : 'var(--emerald-accent)',
          }}>
            {(member.outstandingBalance || 0) > 0 ? formatCurrency(member.outstandingBalance) : 'Al día'}
          </div>
        </div>
      </div>

      <div className="section-chips" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.15rem' }}>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className="btn btn-secondary btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderColor: active ? 'var(--primary-gold)' : undefined,
                color: active ? 'var(--text-gold)' : undefined,
                background: active ? 'rgba(207,161,58,0.12)' : undefined,
              }}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="glass-panel" style={{ padding: '1.15rem', border: '1px solid var(--border-glass)', borderRadius: 12 }}>
        {section === 'ficha' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                Datos personales
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
                <Field label="Documento" value={member.documentNumber ? `${member.documentType || 'DNI'} ${member.documentNumber}` : null} />
                <Field label="Nacimiento" value={formatShortDate(member.birthDate)} />
                <Field label="Género" value={member.gender} />
                <Field label="Estado civil" value={member.maritalStatus} />
                <Field label="Nacionalidad" value={member.nationality} />
                <Field label="Ingreso" value={formatShortDate(member.joinDate)} />
                <Field label="Antigüedad" value={member.yearsActive != null ? `${member.yearsActive} años` : null} />
              </div>
            </div>
            <div>
              <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                Contacto y domicilio
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
                <Field label="WhatsApp" value={member.phone ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> {member.phone}</span> : null} />
                <Field label="Tel. alternativo" value={member.phoneAlt} />
                <Field label="Email" value={member.email ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Mail size={13} /> {member.email}</span> : null} />
                <Field label="Domicilio" value={member.address ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><MapPin size={13} /> {member.address}</span> : null} />
                <Field label="Localidad" value={[member.city, member.province].filter(Boolean).join(', ')} />
                <Field label="CP" value={member.postalCode} />
                <Field label="Emergencia" value={[member.emergencyContact, member.emergencyPhone].filter(Boolean).join(' · ')} />
              </div>
            </div>
            <div>
              <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                Membresía y facturación
              </h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.9rem' }}>
                <Field label="Categoría" value={member.tier?.toUpperCase()} />
                <Field label="Estado" value={member.status} />
                <Field label="Próx. vencimiento" value={formatShortDate(member.nextDueDate)} />
                <Field label="Medio de pago" value={member.paymentMethod} />
                <Field label="Facturación" value={member.billingName} />
                <Field label="CUIT/CUIL" value={member.cuitCuil} />
                <Field label="Condición IVA" value={member.taxCondition} />
                <Field label="Disciplinas" value={(member.disciplines || []).join(', ')} />
              </div>
            </div>
            {member.notes && (
              <div>
                <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-gold)' }}>
                  Observaciones
                </h5>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{member.notes}</p>
              </div>
            )}
          </div>
        )}

        {section === 'tarjeta' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
            <VirtualCard member={member} />
          </div>
        )}

        {section === 'familia' && (
          <div>
            {!(member.adherents || []).length ? (
              <Empty text="Sin adherentes en el grupo familiar." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {member.adherents.map((adh) => (
                  <div
                    key={adh.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: '0.75rem',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: 10,
                      border: '1px solid var(--border-glass)',
                    }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, overflow: 'hidden',
                      background: 'rgba(207,161,58,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-gold)',
                    }}>
                      {adh.photo ? (
                        <img src={adh.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                      )}
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>{adh.name}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {adh.relationship} · {(adh.disciplines || []).join(', ') || 'Sin disciplina'}
                      </div>
                    </div>
                    <span className={`badge-tier ${adh.tier}`} style={{ fontSize: '0.7rem' }}>{adh.tier}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {section === 'movimientos' && (
          <div>
            {movements.length === 0 ? (
              <Empty text="Sin movimientos contables vinculados a este socio." />
            ) : (
              movements.map((e) => {
                const amount = (e.lines || []).find((l) => l.type === 'debit')?.amount;
                return (
                  <div key={e.id} className="mp-row" style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(e.date)}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{e.description}</span>
                    <strong style={{ color: 'var(--text-gold)', whiteSpace: 'nowrap' }}>
                      {amount != null ? formatCurrency(amount) : '—'}
                    </strong>
                  </div>
                );
              })
            )}
          </div>
        )}

        {section === 'entradas' && (
          <div>
            {entries.length === 0 ? (
              <Empty text="Sin registros de ingreso por QR / portería." />
            ) : (
              entries.map((e) => (
                <div key={e.id} className="mp-row" style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(e.date)} {e.time}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{e.notes || e.role}</span>
                  <strong style={{ color: e.status === 'granted' ? 'var(--emerald-accent)' : 'var(--danger-accent)' }}>
                    {e.status === 'granted' ? 'Ingreso OK' : 'Denegado'}
                  </strong>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'asistencia' && (
          <div>
            <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Reservas e instalaciones usadas por el socio (asistencia deportiva / turnos).
            </p>
            {bookings.length === 0 ? (
              <Empty text="Sin reservas registradas." />
            ) : (
              bookings.map((r) => (
                <div key={r.id} className="mp-row" style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: '0.75rem', padding: '0.7rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{formatShortDate(r.date)} {r.time}</span>
                  <span>
                    <strong style={{ color: 'var(--text-primary)' }}>{r.facilityName}</strong>
                    {r.guestNames && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Invitados: {r.guestNames}</div>
                    )}
                  </span>
                  <span style={{ color: r.status === 'confirmed' ? 'var(--emerald-accent)' : 'var(--warning-accent)' }}>
                    {r.status}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'reclamos' && (
          <div>
            {memberClaims.length === 0 ? (
              <Empty text="Sin reclamos asociados." />
            ) : (
              memberClaims.map((c) => (
                <div key={c.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{c.title}</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatShortDate(c.date)}</span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>{c.description || c.detail}</div>
                  <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--text-gold)' }}>Estado: {c.status}</div>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'mensajes' && (
          <div>
            {memberMessages.length === 0 ? (
              <Empty text="Sin mensajes vinculados a este socio." />
            ) : (
              memberMessages.map((m) => (
                <div key={m.id} style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{m.subject}</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatShortDate(m.date)}</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                    De: {m.sender} → {m.recipientId === member.memberId ? 'Este socio' : m.recipientId}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 6 }}>{m.content}</div>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'trazabilidad' && (
          <div>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Línea de tiempo unificada: alta, cobros, ingresos, reservas y reclamos.
            </p>
            {timeline.length === 0 ? (
              <Empty text="Sin eventos de trazabilidad." />
            ) : (
              timeline.map((item, idx) => (
                <TimelineItem key={`${item.sort}-${idx}`} when={item.when} title={item.title} detail={item.detail} tone={item.tone} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
