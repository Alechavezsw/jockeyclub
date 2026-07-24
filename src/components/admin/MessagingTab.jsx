import { useState } from 'react';
import { Send, Phone } from 'lucide-react';

/** Mensajería interna al portal del socio y cobranza vía WhatsApp. */
export default function MessagingTab({ members, messages, setMessages, formatCurrency }) {
  const [msgRecipient, setMsgRecipient] = useState('all');
  const [msgSubject, setMsgSubject] = useState('');
  const [msgContent, setMsgContent] = useState('');
  const [msgSuccess, setMsgSuccess] = useState(false);
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    'Estimado/a *{nombre}*, le saludamos cordialmente de la Comisión Directiva del Jockey Club San Juan (Sede Rivadavia). Le recordamos amablemente que posee un saldo pendiente de cuota social de *{saldo}*. Puede regularizar su situación en la administración central o mediante transferencia al Banco Nación. ¡Muchas gracias!'
  );
  const [virtualSentLogs, setVirtualSentLogs] = useState([]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!msgSubject.trim() || !msgContent.trim()) return;

    const newMsg = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      sender: 'Tesorería Jockey Club',
      senderId: 'ops',
      recipientId: msgRecipient,
      subject: msgSubject.trim(),
      content: msgContent.trim(),
      isRead: false,
      parentId: null,
    };

    setMessages([newMsg, ...messages]);
    setMsgSubject('');
    setMsgContent('');
    setMsgSuccess(true);
    setTimeout(() => setMsgSuccess(false), 3000);
  };

  const handleSendWhatsAppRedirect = (memberItem) => {
    let rawMsg = whatsappTemplate
      .replace('{nombre}', memberItem.name)
      .replace('{saldo}', formatCurrency(memberItem.outstandingBalance));

    const encodedText = encodeURIComponent(rawMsg);
    const cleanPhone = memberItem.phone.replace(/[+\s-]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    window.open(waUrl, '_blank');

    const logItem = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      memberName: memberItem.name,
      phone: memberItem.phone,
      messagePreview: rawMsg.slice(0, 80) + '...',
      status: 'Redirected'
    };
    setVirtualSentLogs([logItem, ...virtualSentLogs]);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }} className="responsive-form-grid">
      {/* Enviar Comunicados */}
      <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div>
          <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Mailing & Mensajería Exclusiva</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            Envíe avisos institucionales directamente al portal privado del socio.
          </p>
        </div>

        {msgSuccess && (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--emerald-accent)', color: 'var(--emerald-accent)', padding: '0.6rem', borderRadius: '6px', fontSize: '0.8rem', textAlign: 'center' }}>
            ¡Mensaje inyectado en el portal del socio con éxito!
          </div>
        )}

        <form onSubmit={handleSendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>Destinatario del Mensaje</label>
            <select
              className="form-input"
              value={msgRecipient}
              onChange={(e) => setMsgRecipient(e.target.value)}
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
            >
              <option value="all" style={{ background: 'var(--bg-secondary)' }}>Todos los Socios (Broadcast Global)</option>
              {members.map(m => (
                <option key={m.memberId} value={m.memberId} style={{ background: 'var(--bg-secondary)' }}>
                  {m.name} (Cred: {m.memberId.slice(0, 6)}...)
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>Asunto del Comunicado</label>
            <input
              type="text"
              placeholder="Ej: Modificación Horario de Canchas de Polo"
              className="form-input"
              value={msgSubject}
              onChange={(e) => setMsgSubject(e.target.value)}
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem' }}>Cuerpo del Mensaje</label>
            <textarea
              placeholder="Escriba las directivas del comunicado..."
              className="form-input"
              value={msgContent}
              onChange={(e) => setMsgContent(e.target.value)}
              style={{ padding: '0.55rem', fontSize: '0.85rem', minHeight: '80px', fontFamily: 'inherit', resize: 'vertical' }}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold' }}
          >
            <Send size={14} /> Enviar Mensaje Interno
          </button>
        </form>
      </div>

      {/* Módulo WhatsApp Direct Debtors */}
      <div className="glass-card fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
        <div>
          <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>Cobranza vía WhatsApp</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            Envíe recordatorios elegantes y pre-armados directamente a sus celulares.
          </p>
        </div>

        {/* Template editor */}
        <div className="form-group" style={{ marginBottom: 0, background: 'rgba(0,0,0,0.1)', padding: '0.75rem', borderRadius: '6px' }}>
          <label className="form-label" style={{ fontSize: '0.72rem', color: 'var(--text-gold)' }}>Configurar Plantilla de WhatsApp</label>
          <textarea
            className="form-input"
            style={{ padding: '0.4rem', fontSize: '0.78rem', minHeight: '65px', fontFamily: 'inherit', background: 'rgba(0,0,0,0.2)' }}
            value={whatsappTemplate}
            onChange={(e) => setWhatsappTemplate(e.target.value)}
          />
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            Variables admitidas: <code>{'{nombre}'}</code> y <code>{'{saldo}'}</code>.
          </span>
        </div>

        {/* Listado de Socios Deudores */}
        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
          <h5 className="serif-font" style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--warning-accent)' }}>Socios con Cuotas Pendientes</h5>

          {members.filter(m => m.outstandingBalance > 0).length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
              No existen socios con deuda social de momento. ¡Excelente gestión!
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {members.filter(m => m.outstandingBalance > 0).map(debtor => (
                <div
                  key={debtor.memberId}
                  style={{
                    background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-glass)',
                    padding: '0.6rem 0.8rem', borderRadius: '6px', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-strong)' }}>{debtor.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--warning-accent)' }}>Deuda: {formatCurrency(debtor.outstandingBalance)}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Cel: {debtor.phone || 'No registrado'}</div>
                  </div>

                  <button
                    onClick={() => handleSendWhatsAppRedirect(debtor)}
                    disabled={!debtor.phone}
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', borderColor: 'var(--emerald-accent)', color: 'var(--emerald-accent)' }}
                  >
                    <Phone size={12} /> WhatsApp
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historial de envíos virtuales */}
        {virtualSentLogs.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
            <h5 className="serif-font" style={{ fontSize: '0.9rem', color: 'var(--text-gold)', marginBottom: '0.4rem' }}>Log de Avisos Enviados (Sesión)</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '110px', overflowY: 'auto' }}>
              {virtualSentLogs.map(log => (
                <div key={log.id} style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.01)', padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>A: <strong>{log.memberName}</strong> ({log.phone})</span>
                  <span style={{ color: 'var(--emerald-accent)' }}>{log.time} - {log.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
