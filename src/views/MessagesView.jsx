import { useMemo, useState } from 'react';
import { Inbox, Send, PenSquare, MailOpen, ArrowLeft, CheckCheck, Search, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  MAILBOX,
  createMessage,
  getInbox,
  getSent,
  markInboxRead,
  markMessageRead,
  recipientLabel,
} from '../domain/messaging/messages';
import { canAccessAdmin } from '../domain/auth/roles';

export default function MessagesView({ messages, setMessages, members = [] }) {
  const { user, role } = useAuth();
  const isOps = canAccessAdmin(role);
  const identity = {
    userId: user?.id,
    memberId: user?.memberId || null,
    role: role || 'member',
  };

  const [tab, setTab] = useState('inbox');
  const [selectedId, setSelectedId] = useState(null);
  const [compose, setCompose] = useState({
    recipientId: isOps ? '' : MAILBOX.OPERATIONS,
    subject: '',
    content: '',
  });
  const [memberQuery, setMemberQuery] = useState('');
  const [sentOk, setSentOk] = useState(false);
  const [recipientError, setRecipientError] = useState('');

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.memberId.includes(q) ||
        (m.phone || '').includes(q)
      )
      .slice(0, 12);
  }, [members, memberQuery]);

  const selectedRecipientLabel = useMemo(() => {
    if (!compose.recipientId) return '';
    return recipientLabel(compose.recipientId, members);
  }, [compose.recipientId, members]);

  const inbox = useMemo(() => getInbox(messages, identity), [messages, identity.userId, identity.memberId, identity.role]);
  const sent = useMemo(() => getSent(messages, identity), [messages, identity.userId, identity.memberId]);
  const list = tab === 'inbox' ? inbox : sent;
  const selected = list.find((m) => m.id === selectedId) || null;

  const openMessage = (msg) => {
    setSelectedId(msg.id);
    if (tab === 'inbox' && !msg.isRead) {
      setMessages((prev) => markMessageRead(prev, msg.id));
    }
  };

  const pickRecipient = (id) => {
    setCompose((c) => ({ ...c, recipientId: id }));
    setRecipientError('');
    setMemberQuery('');
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!compose.recipientId) {
      setRecipientError('Seleccione un destinatario.');
      return;
    }
    if (!compose.subject.trim() || !compose.content.trim()) return;

    const msg = createMessage({
      sender: user?.fullName || 'Usuario',
      senderId: user?.memberId || user?.id,
      recipientId: compose.recipientId,
      subject: compose.subject,
      content: compose.content,
    });

    setMessages((prev) => [msg, ...prev]);
    setCompose({
      recipientId: isOps ? '' : MAILBOX.OPERATIONS,
      subject: '',
      content: '',
    });
    setMemberQuery('');
    setRecipientError('');
    setSentOk(true);
    setTab('sent');
    setSelectedId(msg.id);
    setTimeout(() => setSentOk(false), 2500);
  };

  const handleReply = () => {
    if (!selected) return;
    const replyTo =
      selected.senderId ||
      (isOps ? selected.recipientId : MAILBOX.OPERATIONS);
    setTab('compose');
    setCompose({
      recipientId: replyTo === MAILBOX.ALL_MEMBERS ? MAILBOX.OPERATIONS : replyTo,
      subject: selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
      content: '',
    });
    setMemberQuery('');
    setSelectedId(null);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>Mensajería interna</h1>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Comunicaciones entre socios y administración del club
          </p>
        </div>
        {tab === 'inbox' && inbox.some((m) => !m.isRead) && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setMessages((prev) => markInboxRead(prev, identity))}
          >
            <CheckCheck size={14} /> Marcar todos leídos
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { key: 'inbox', label: `Bandeja (${inbox.length})`, icon: <Inbox size={14} /> },
          { key: 'sent', label: `Enviados (${sent.length})`, icon: <Send size={14} /> },
          { key: 'compose', label: 'Redactar', icon: <PenSquare size={14} /> },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => { setTab(t.key); setSelectedId(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {sentOk && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid var(--emerald-accent)',
          color: 'var(--emerald-accent)',
          padding: '0.65rem 0.9rem',
          borderRadius: 8,
          fontSize: '0.85rem',
        }}>
          Mensaje enviado correctamente.
        </div>
      )}

      {tab === 'compose' ? (
        <form
          onSubmit={handleSend}
          className="glass-card"
          style={{ padding: '1.25rem', display: 'grid', gap: '0.85rem', maxWidth: 720 }}
        >
          <div>
            <label className="form-label">Destinatario</label>

            {!isOps ? (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  border: '1px solid var(--border-glass)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                }}
              >
                Administración / Secretaría
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {compose.recipientId ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      padding: '0.7rem 0.9rem',
                      borderRadius: 8,
                      border: '1px solid rgba(207,161,58,0.35)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-gold)', display: 'block', marginBottom: 2 }}>Seleccionado</span>
                      <strong>{selectedRecipientLabel}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => pickRecipient('')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      title="Cambiar destinatario"
                    >
                      <X size={14} /> Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative' }}>
                      <Search
                        size={15}
                        style={{
                          position: 'absolute',
                          left: 12,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          color: 'var(--text-muted)',
                          pointerEvents: 'none',
                        }}
                      />
                      <input
                        type="search"
                        className="form-input"
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        placeholder="Buscar socio por nombre, credencial o teléfono…"
                        autoComplete="off"
                        style={{
                          paddingLeft: '2.4rem',
                          background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-glass)',
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => pickRecipient(MAILBOX.ALL_MEMBERS)}
                      style={{
                        textAlign: 'left',
                        padding: '0.7rem 0.9rem',
                        borderRadius: 8,
                        border: '1px solid var(--border-glass)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: '0.9rem',
                      }}
                    >
                      <strong style={{ color: 'var(--text-gold)' }}>Todos los socios</strong>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        Comunicado general
                      </span>
                    </button>

                    <div
                      style={{
                        maxHeight: 240,
                        overflowY: 'auto',
                        borderRadius: 8,
                        border: '1px solid var(--border-glass)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      {filteredMembers.length === 0 ? (
                        <p style={{ padding: '0.9rem', margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          No se encontraron socios con ese criterio.
                        </p>
                      ) : (
                        filteredMembers.map((m) => (
                          <button
                            key={m.memberId}
                            type="button"
                            onClick={() => pickRecipient(m.memberId)}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '0.7rem 0.9rem',
                              border: 'none',
                              borderBottom: '1px solid var(--border-glass)',
                              background: 'transparent',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>{m.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              Cred. {m.memberId.slice(0, 8)}… · {m.tier}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
                {recipientError && (
                  <p style={{ color: '#ef4444', fontSize: '0.82rem', margin: 0 }}>{recipientError}</p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="form-label">Asunto</label>
            <input
              className="form-input"
              required
              value={compose.subject}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
              placeholder="Asunto del mensaje"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <label className="form-label">Mensaje</label>
            <textarea
              className="form-input"
              required
              rows={6}
              value={compose.content}
              onChange={(e) => setCompose({ ...compose, content: e.target.value })}
              placeholder="Escriba su mensaje…"
              style={{ resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Send size={16} /> Enviar mensaje
            </button>
          </div>
        </form>
      ) : (
        <div
          className="glass-card msg-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: selected ? 'minmax(240px, 1fr) 1.4fr' : '1fr',
            minHeight: 420,
            overflow: 'hidden',
          }}
        >
          <style>{`
            @media (max-width: 800px) {
              .msg-layout { grid-template-columns: 1fr !important; }
              .msg-list-pane { display: ${selected ? 'none' : 'block'}; }
              .msg-detail-pane { display: ${selected ? 'block' : 'none'}; }
            }
          `}</style>
          <div className="msg-list-pane" style={{ borderRight: selected ? '1px solid var(--border-glass)' : 'none' }}>
            {list.length === 0 ? (
              <p style={{ padding: '2rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center' }}>
                {tab === 'inbox' ? 'No hay mensajes en la bandeja.' : 'Aún no envió mensajes.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {list.map((msg) => (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => openMessage(msg)}
                    style={{
                      background: selectedId === msg.id ? 'rgba(207,161,58,0.08)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-glass)',
                      borderLeft: selectedId === msg.id ? '3px solid var(--primary-gold)' : '3px solid transparent',
                      padding: '0.85rem 1rem',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-gold)', fontWeight: 700 }}>
                        {tab === 'inbox' ? msg.sender : recipientLabel(msg.recipientId, members)}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{msg.date}</span>
                    </div>
                    <div style={{
                      fontSize: '0.9rem',
                      fontWeight: !msg.isRead && tab === 'inbox' ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      {!msg.isRead && tab === 'inbox' && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary-gold)', flexShrink: 0 }} />
                      )}
                      {msg.subject}
                    </div>
                    <div style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                      marginTop: 3,
                      display: '-webkit-box',
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {msg.content}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="msg-detail-pane" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="btn btn-secondary btn-sm"
                style={{ alignSelf: 'flex-start', display: 'none' }}
              >
                <ArrowLeft size={14} /> Volver
              </button>
              <style>{`@media (max-width: 800px) { .msg-back-btn { display: inline-flex !important; } }`}</style>
              <button
                type="button"
                className="btn btn-secondary btn-sm msg-back-btn"
                onClick={() => setSelectedId(null)}
                style={{ alignSelf: 'flex-start', display: 'none', alignItems: 'center', gap: 6 }}
              >
                <ArrowLeft size={14} /> Volver
              </button>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {tab === 'inbox' ? `De: ${selected.sender}` : `Para: ${recipientLabel(selected.recipientId, members)}`}
                  {' · '}{selected.date}
                </div>
                <h2 className="serif-font" style={{ fontSize: '1.35rem', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MailOpen size={18} style={{ color: 'var(--text-gold)' }} />
                  {selected.subject}
                </h2>
              </div>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.95rem' }}>
                {selected.content}
              </p>
              {tab === 'inbox' && (
                <div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleReply} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PenSquare size={14} /> Responder
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
