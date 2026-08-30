import { useMemo, useState } from 'react';
import {
  ArrowLeft, User, CreditCard, Users, Wallet, DoorOpen, CalendarDays,
  MessageSquare, ClipboardList, Activity, Phone, Mail, MapPin,
  Pencil, FileText, Ticket, Bell, IdCard, Cake, Heart, Flag, Clock,
  ShieldCheck, CalendarClock, Banknote, Building2, AlertTriangle,
} from 'lucide-react';
import VirtualCard from '../VirtualCard';
import GuestPassPanel from '../GuestPassPanel';
import { formatShortDate } from '../../domain/members/dues';
import { formatDateTimeAR } from '../../lib/arDate';
import { getTierDisplayName, tierBadgeStyle } from '../../domain/members/tiers';
import { resolveFamilyForDisplay } from '../../domain/members/households';
import {
  applyMemberProfileUpdate,
  upsertMemberDocument,
  DOCUMENT_TYPES,
} from '../../domain/members/profileEdit';

const SECTIONS = [
  { id: 'ficha', label: 'Ficha', icon: User },
  { id: 'editar', label: 'Editar', icon: Pencil, memberOnly: true },
  { id: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
  { id: 'invitados', label: 'Invitados', icon: Ticket, memberOnly: true },
  { id: 'docs', label: 'Documentos', icon: FileText, memberOnly: true },
  { id: 'familia', label: 'Grupo familiar', icon: Users },
  { id: 'movimientos', label: 'Movimientos', icon: Wallet },
  { id: 'entradas', label: 'Entradas', icon: DoorOpen },
  { id: 'asistencia', label: 'Asistencia', icon: CalendarDays },
  { id: 'reclamos', label: 'Reclamos', icon: ClipboardList },
  { id: 'mensajes', label: 'Mensajes', icon: MessageSquare },
  { id: 'trazabilidad', label: 'Trazabilidad', icon: Activity },
];

const STATUS_COPY = {
  active: { label: 'Cuenta habilitada', hint: 'Puede ingresar y usar instalaciones', tone: 'ok' },
  pending: { label: 'Pendiente de aprobación', hint: 'Alta en revisión de Secretaría', tone: 'warn' },
  suspended: { label: 'Cuenta suspendida', hint: 'Acceso restringido hasta regularizar', tone: 'danger' },
};

const PAYMENT_LABELS = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  debito: 'Débito automático',
  debito_automatico: 'Débito automático',
};

const TAX_LABELS = {
  consumidor_final: 'Consumidor final',
  monotributo: 'Monotributo',
  responsable_inscripto: 'Responsable inscripto',
  exento: 'Exento',
};

function titleCase(value) {
  if (!value) return null;
  return String(value)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDocument(type, number) {
  if (!number) return null;
  const digits = String(number).replace(/\D/g, '');
  const formatted = digits.length >= 7
    ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : String(number);
  return `${type || 'DNI'} ${formatted}`;
}

function ageFromBirth(iso) {
  if (!iso) return null;
  const birth = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function membershipTenure(member) {
  if (member?.joinDate) {
    const join = new Date(`${String(member.joinDate).slice(0, 10)}T12:00:00`);
    if (!Number.isNaN(join.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - join.getFullYear();
      const m = now.getMonth() - join.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < join.getDate())) years -= 1;
      if (years <= 0) {
        let months = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
        if (now.getDate() < join.getDate()) months -= 1;
        if (months <= 0) return 'Recién ingresado';
        return months === 1 ? '1 mes en el club' : `${months} meses en el club`;
      }
      return years === 1 ? '1 año de antigüedad' : `${years} años de antigüedad`;
    }
  }
  const y = Number(member?.yearsActive);
  if (!Number.isFinite(y)) return null;
  return y === 1 ? '1 año de antigüedad' : `${y} años de antigüedad`;
}

function Fact({ icon: Icon, label, value, hint }) {
  if (value == null || value === '') {
    return (
      <div className="mp-fact is-empty">
        {Icon ? <Icon size={14} className="mp-fact-icon" aria-hidden /> : null}
        <div>
          <div className="mp-fact-label">{label}</div>
          <div className="mp-fact-value muted">Sin dato</div>
        </div>
      </div>
    );
  }
  return (
    <div className="mp-fact">
      {Icon ? <Icon size={14} className="mp-fact-icon" aria-hidden /> : null}
      <div>
        <div className="mp-fact-label">{label}</div>
        <div className="mp-fact-value">{value}</div>
        {hint ? <div className="mp-fact-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, href }) {
  if (!value) {
    return (
      <div className="mp-contact-row is-empty">
        <Icon size={15} aria-hidden />
        <div>
          <span className="mp-contact-label">{label}</span>
          <span className="mp-contact-value muted">No cargado</span>
        </div>
      </div>
    );
  }
  const content = href ? (
    <a href={href} className="mp-contact-value link">{value}</a>
  ) : (
    <span className="mp-contact-value">{value}</span>
  );
  return (
    <div className="mp-contact-row">
      <Icon size={15} aria-hidden />
      <div>
        <span className="mp-contact-label">{label}</span>
        {content}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="mp-empty">{text}</p>;
}

function TimelineItem({ when, title, detail, tone = 'neutral' }) {
  return (
    <div className={`mp-timeline-item tone-${tone}`}>
      <div className="mp-timeline-when">{when}</div>
      <div>
        <div className="mp-timeline-title">{title}</div>
        {detail && <div className="mp-timeline-detail">{detail}</div>}
      </div>
    </div>
  );
}

/** Perfil institucional completo del socio titular. */
export default function MemberProfilePanel({
  member,
  members = [],
  onBack,
  onOpenMember = null,
  backLabel = 'Padrón',
  formatCurrency,
  journalEntries = [],
  entryLogs = [],
  reservations = [],
  claims = [],
  messages = [],
  updateMember = null,
  guestPasses = [],
  setGuestPasses = null,
  selfService = false,
  tierCatalog,
}) {
  const [section, setSection] = useState('ficha');
  const [editForm, setEditForm] = useState(null);
  const [editMsg, setEditMsg] = useState('');
  const visibleSections = SECTIONS.filter((s) => !s.memberOnly || selfService);

  const familyGroup = useMemo(
    () => resolveFamilyForDisplay(member, members.length ? members : [member].filter(Boolean)),
    [member, members]
  );

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
    const tierName = getTierDisplayName(member.tier, tierCatalog);

    items.push({
      when: formatShortDate(member.joinDate) || 'Alta',
      title: 'Alta de socio titular',
      detail: `Categoría ${tierName} · Credencial ${member.memberId}`,
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
  }, [member, movements, entries, bookings, memberClaims, formatCurrency, tierCatalog]);

  if (!member) {
    return (
      <div className="glass-card fade-in member-profile">
        <Empty text="Socio no encontrado." />
        <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginTop: '1rem' }}>
          Volver al padrón
        </button>
      </div>
    );
  }

  const status = STATUS_COPY[member.status] || STATUS_COPY.pending;
  const balance = Number(member.outstandingBalance) || 0;
  const hasDebt = balance > 0;
  const tierName = getTierDisplayName(member.tier, tierCatalog);
  const age = ageFromBirth(member.birthDate);
  const tenure = membershipTenure(member);
  const joinLabel = member.joinDate
    ? (member.joinTime
      ? formatDateTimeAR(member.joinDate, member.joinTime)
      : formatShortDate(member.joinDate))
    : null;
  const initials = (member.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const phoneHref = member.phone
    ? `https://wa.me/${String(member.phone).replace(/\D/g, '')}`
    : null;
  const mailHref = member.email ? `mailto:${member.email}` : null;
  const addressLine = [
    member.address,
    [member.city, member.province].filter(Boolean).join(', '),
    member.postalCode ? `CP ${member.postalCode}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="glass-card fade-in member-profile">
      <header className="mp-hero">
        <div className="mp-hero-main">
          <button type="button" className="btn btn-secondary btn-sm mp-back" onClick={onBack}>
            <ArrowLeft size={14} /> {backLabel}
          </button>

          <div className="mp-identity">
            <div
              className="mp-avatar"
              style={{ '--tier-ring': tierBadgeStyle(member.tier, tierCatalog).borderColor || 'var(--primary-gold)' }}
            >
              {member.photo ? <img src={member.photo} alt="" /> : <span>{initials}</span>}
            </div>
            <div className="mp-identity-copy">
              <p className="mp-kicker">Ficha del socio</p>
              <h3 className="serif-font mp-name">{member.name}</h3>
              <div className="mp-meta-row">
                <span className="mp-cred">Credencial {member.memberId}</span>
                <span className="mp-tier-pill" style={tierBadgeStyle(member.tier, tierCatalog)}>
                  {tierName}
                </span>
                <span className={`mp-status mp-status--${status.tone}`} title={status.hint}>
                  <span className="mp-status-dot" aria-hidden />
                  {status.label}
                </span>
              </div>
              {tenure ? <p className="mp-tenure">{tenure}</p> : null}
            </div>
          </div>
        </div>

        <aside className={`mp-balance ${hasDebt ? 'has-debt' : 'is-clear'}`} aria-label="Estado de cuota">
          <div className="mp-balance-label">{hasDebt ? 'Saldo de cuota' : 'Estado de cuota'}</div>
          <div className="mp-balance-value">
            {hasDebt ? formatCurrency(balance) : 'Al día'}
          </div>
          <div className="mp-balance-hint">
            {hasDebt
              ? (member.nextDueDate
                ? `Venció / vence ${formatShortDate(member.nextDueDate)}`
                : 'Pendiente de cobro')
              : (member.nextDueDate
                ? `Próximo vencimiento ${formatShortDate(member.nextDueDate)}`
                : 'Sin vencimiento cargado')}
          </div>
        </aside>
      </header>

      <nav className="mp-nav section-chips" aria-label="Secciones del perfil">
        {visibleSections.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSection(s.id);
                if (s.id === 'editar' && member) {
                  setEditForm({
                    phone: member.phone || '',
                    phoneAlt: member.phoneAlt || '',
                    email: member.email || '',
                    address: member.address || '',
                    city: member.city || '',
                    province: member.province || '',
                    postalCode: member.postalCode || '',
                    emergencyContact: member.emergencyContact || '',
                    emergencyPhone: member.emergencyPhone || '',
                    photo: member.photo || '',
                    preferredSports: (member.preferredSports || member.disciplines || []).join(', '),
                    notifyDues: member.notifyDues !== false,
                    notifyReservations: member.notifyReservations !== false,
                    notifyEvents: member.notifyEvents !== false,
                  });
                  setEditMsg('');
                }
              }}
              className={`mp-nav-btn${active ? ' is-active' : ''}`}
            >
              <Icon size={13} /> {s.label}
            </button>
          );
        })}
      </nav>

      <div className="mp-panel glass-panel">
        {section === 'ficha' && (
          <div className="mp-dossier">
            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Identidad</h5>
                <p>Documento y datos personales del padrón</p>
              </header>
              <div className="mp-facts">
                <Fact icon={IdCard} label="Documento" value={formatDocument(member.documentType, member.documentNumber)} />
                <Fact
                  icon={Cake}
                  label="Nacimiento"
                  value={formatShortDate(member.birthDate)}
                  hint={age != null ? `${age} años` : null}
                />
                <Fact icon={User} label="Género" value={titleCase(member.gender)} />
                <Fact icon={Heart} label="Estado civil" value={titleCase(member.maritalStatus)} />
                <Fact icon={Flag} label="Nacionalidad" value={member.nationality || 'Argentina'} />
                <Fact icon={Clock} label="Ingreso al club" value={joinLabel} />
              </div>
            </section>

            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Contacto y domicilio</h5>
                <p>Cómo ubicar al socio y a su emergencia</p>
              </header>
              <div className="mp-contact-grid">
                <ContactRow icon={Phone} label="WhatsApp" value={member.phone} href={phoneHref} />
                <ContactRow icon={Phone} label="Tel. alternativo" value={member.phoneAlt} />
                <ContactRow icon={Mail} label="Email" value={member.email} href={mailHref} />
                <ContactRow icon={MapPin} label="Domicilio" value={addressLine || null} />
                <ContactRow
                  icon={AlertTriangle}
                  label="Emergencia"
                  value={[member.emergencyContact, member.emergencyPhone].filter(Boolean).join(' · ') || null}
                />
              </div>
            </section>

            <section className="mp-block">
              <header className="mp-block-head">
                <h5>Membresía y cobranza</h5>
                <p>Categoría, cuota y datos de facturación</p>
              </header>
              <div className="mp-facts">
                <Fact icon={ShieldCheck} label="Categoría" value={tierName} hint={status.hint} />
                <Fact icon={ShieldCheck} label="Estado de cuenta" value={status.label} />
                <Fact icon={CalendarClock} label="Próximo vencimiento" value={formatShortDate(member.nextDueDate)} />
                <Fact
                  icon={Banknote}
                  label="Medio de pago"
                  value={PAYMENT_LABELS[member.paymentMethod] || titleCase(member.paymentMethod)}
                />
                <Fact icon={Building2} label="Facturar a" value={member.billingName || member.name} />
                <Fact icon={IdCard} label="CUIT / CUIL" value={member.cuitCuil} />
                <Fact
                  icon={FileText}
                  label="Condición IVA"
                  value={TAX_LABELS[member.taxCondition] || titleCase(member.taxCondition)}
                />
              </div>
              <div className="mp-disciplines">
                <div className="mp-fact-label">Disciplinas</div>
                {(member.disciplines || []).length ? (
                  <div className="mp-chips">
                    {member.disciplines.map((d) => (
                      <span key={d} className="mp-chip">{d}</span>
                    ))}
                  </div>
                ) : (
                  <p className="mp-fact-value muted">Sin disciplinas cargadas</p>
                )}
              </div>
            </section>

            {member.notes ? (
              <section className="mp-block mp-notes">
                <header className="mp-block-head">
                  <h5>Observaciones</h5>
                </header>
                <p>{member.notes}</p>
              </section>
            ) : null}
          </div>
        )}

        {section === 'tarjeta' && (
          <div className="mp-card-wrap">
            <VirtualCard member={member} />
            <p className="mp-card-hint">
              Credencial disponible offline (PWA). En móvil, tocá para pantalla completa.
            </p>
          </div>
        )}

        {section === 'editar' && selfService && editForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!updateMember) return;
              const updated = applyMemberProfileUpdate(member, {
                ...editForm,
                preferredSports: editForm.preferredSports
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                disciplines: editForm.preferredSports
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              updateMember(updated);
              setEditMsg('Datos actualizados correctamente.');
            }}
            className="mp-edit-form"
          >
            {[
              ['phone', 'WhatsApp'],
              ['phoneAlt', 'Tel. alternativo'],
              ['email', 'Email'],
              ['address', 'Domicilio'],
              ['city', 'Localidad'],
              ['province', 'Provincia'],
              ['postalCode', 'CP'],
              ['emergencyContact', 'Contacto emergencia'],
              ['emergencyPhone', 'Tel. emergencia'],
              ['photo', 'URL foto'],
              ['preferredSports', 'Disciplinas (separadas por coma)'],
            ].map(([key, label]) => (
              <div
                key={key}
                className="mp-edit-field"
                style={{ gridColumn: key === 'preferredSports' || key === 'address' || key === 'photo' ? '1 / -1' : undefined }}
              >
                <label className="form-label">{label}</label>
                <input
                  className="form-input"
                  value={editForm[key] || ''}
                  onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.value })}
                />
              </div>
            ))}
            <div className="mp-edit-notices">
              {[
                ['notifyDues', 'Avisos de cuota'],
                ['notifyReservations', 'Avisos de reservas'],
                ['notifyEvents', 'Avisos de eventos'],
              ].map(([key, label]) => (
                <label key={key} className="mp-edit-check">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm[key])}
                    onChange={(ev) => setEditForm({ ...editForm, [key]: ev.target.checked })}
                  />
                  <Bell size={13} /> {label}
                </label>
              ))}
            </div>
            <div className="mp-edit-actions">
              <button type="submit" className="btn btn-primary" disabled={!updateMember}>Guardar cambios</button>
              {editMsg && <span className="mp-edit-ok">{editMsg}</span>}
            </div>
          </form>
        )}

        {section === 'invitados' && selfService && setGuestPasses && (
          <GuestPassPanel
            member={member}
            guestPasses={guestPasses}
            setGuestPasses={setGuestPasses}
          />
        )}

        {section === 'docs' && selfService && (
          <div className="mp-docs">
            <p className="mp-section-lead">
              Subí documentación para revisión de Secretaría.
            </p>
            {DOCUMENT_TYPES.map((doc) => {
              const existing = (member.documents || []).find((d) => d.type === doc.id);
              return (
                <div key={doc.id} className="mp-doc-row">
                  <div>
                    <strong>{doc.label}</strong>
                    <div className="mp-doc-meta">
                      {existing
                        ? `${existing.fileName} · ${existing.status === 'pending_review' ? 'En revisión' : existing.status}`
                        : 'Sin archivo'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!updateMember}
                    onClick={() => {
                      if (!updateMember) return;
                      updateMember(upsertMemberDocument(member, {
                        type: doc.id,
                        fileName: `${doc.id}-${member.memberId}.pdf`,
                        note: 'Carga desde portal socio',
                      }));
                    }}
                  >
                    {existing ? 'Reemplazar' : 'Cargar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {section === 'familia' && (
          <div>
            {!(familyGroup.members || []).length ? (
              <Empty text="Sin adherentes en el grupo familiar." />
            ) : (
              <div className="mp-family">
                {(member.familyGroupName || familyGroup.titular?.familyGroupName) && (
                  <p className="mp-section-lead" style={{ marginBottom: '0.75rem' }}>
                    {member.familyGroupName || familyGroup.titular?.familyGroupName}
                    {' · '}
                    {familyGroup.members.length} integrante{familyGroup.members.length === 1 ? '' : 's'}
                  </p>
                )}
                {familyGroup.members.map((adh) => {
                  const canOpen = Boolean(onOpenMember && adh.memberId && adh.memberId !== String(member.memberId));
                  return (
                    <div
                      key={adh.id}
                      className={`mp-family-row${canOpen ? ' is-clickable' : ''}`}
                      role={canOpen ? 'button' : undefined}
                      tabIndex={canOpen ? 0 : undefined}
                      onClick={canOpen ? () => onOpenMember(adh.memberId) : undefined}
                      onKeyDown={canOpen ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenMember(adh.memberId);
                        }
                      } : undefined}
                    >
                      <div className="mp-family-avatar">
                        {adh.photo ? (
                          <img src={adh.photo} alt="" />
                        ) : (
                          (adh.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
                        )}
                      </div>
                      <div>
                        <strong>{adh.name}</strong>
                        <div className="mp-family-meta">
                          {adh.relationship}
                          {adh.memberId ? ` · Nº ${adh.memberId}` : ''}
                          {' · '}
                          {(adh.disciplines || []).join(', ') || 'Sin disciplina'}
                        </div>
                      </div>
                      <span className="mp-tier-pill" style={tierBadgeStyle(adh.tier, tierCatalog)}>
                        {getTierDisplayName(adh.tier, tierCatalog)}
                      </span>
                    </div>
                  );
                })}
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
                  <div key={e.id} className="mp-list-row">
                    <span className="mp-list-when">{formatShortDate(e.date)}</span>
                    <span className="mp-list-main">{e.description}</span>
                    <strong className="mp-list-amount">
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
                <div key={e.id} className="mp-list-row">
                  <span className="mp-list-when">{formatShortDate(e.date)} {e.time}</span>
                  <span className="mp-list-main muted">{e.notes || e.role}</span>
                  <strong className={e.status === 'granted' ? 'tone-ok' : 'tone-danger'}>
                    {e.status === 'granted' ? 'Ingreso OK' : 'Denegado'}
                  </strong>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'asistencia' && (
          <div>
            <p className="mp-section-lead">
              Reservas e instalaciones usadas por el socio.
            </p>
            {bookings.length === 0 ? (
              <Empty text="Sin reservas registradas." />
            ) : (
              bookings.map((r) => (
                <div key={r.id} className="mp-list-row">
                  <span className="mp-list-when">{formatShortDate(r.date)} {r.time}</span>
                  <span className="mp-list-main">
                    <strong>{r.facilityName}</strong>
                    {r.guestNames && (
                      <div className="mp-list-sub">Invitados: {r.guestNames}</div>
                    )}
                  </span>
                  <span className={r.status === 'confirmed' ? 'tone-ok' : 'tone-warn'}>
                    {r.status === 'confirmed' ? 'Confirmada' : titleCase(r.status)}
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
                <div key={c.id} className="mp-claim-row">
                  <div className="mp-claim-top">
                    <strong>{c.title}</strong>
                    <span>{formatShortDate(c.date)}</span>
                  </div>
                  <div className="mp-claim-body">{c.description || c.detail}</div>
                  <div className="mp-claim-status">Estado: {titleCase(c.status)}</div>
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
                <div key={m.id} className="mp-claim-row">
                  <div className="mp-claim-top">
                    <strong>{m.subject}</strong>
                    <span>{formatShortDate(m.date)}</span>
                  </div>
                  <div className="mp-list-sub">
                    De: {m.sender} → {m.recipientId === member.memberId ? 'Este socio' : m.recipientId}
                  </div>
                  <div className="mp-claim-body">{m.content}</div>
                </div>
              ))
            )}
          </div>
        )}

        {section === 'trazabilidad' && (
          <div>
            <p className="mp-section-lead">
              Línea de tiempo: alta, cobros, ingresos, reservas y reclamos.
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
