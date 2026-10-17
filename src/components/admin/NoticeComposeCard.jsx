import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Search, Send, Sparkles, X } from 'lucide-react';
import { askJevCompose } from '../../data/jevChat';
import { repos } from '../../data/bootstrap';
import {
  createMessage,
  MAILBOX,
  recipientLabel,
} from '../../domain/messaging/messages';
import {
  deliverableEmail,
  mailAudienceCount,
  noticeConfirmLine,
} from '../../domain/messaging/clubNotice';

export default function NoticeComposeCard({
  members = [],
  onSendMessage,
  senderName = 'Administración Jockey Club',
  replyToId = '',
}) {
  const [audience, setAudience] = useState('all');
  const [sendDm, setSendDm] = useState(true);
  const [sendMail, setSendMail] = useState(true);
  const [recipientId, setRecipientId] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [confirmMass, setConfirmMass] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (!replyToId) return;
    setAudience('one');
    setRecipientId(replyToId);
    setConfirmMass(false);
  }, [replyToId]);

  const mailCounts = useMemo(() => mailAudienceCount(members), [members]);
  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) => (
        String(m.name || '').toLowerCase().includes(q)
        || String(m.memberId || '').includes(q)
        || String(m.phone || '').includes(q)
      ))
      .slice(0, 12);
  }, [members, memberQuery]);

  const selectedLabel = recipientId ? recipientLabel(recipientId, members) : '';
  const selectedMember = members.find((m) => m.memberId === recipientId) || null;
  const selectedHasMail = Boolean(deliverableEmail(selectedMember?.email));
  const channels = [sendDm ? 'mensaje interno' : '', sendMail ? 'mail' : ''].filter(Boolean).join(' y ');
  const confirmLine = noticeConfirmLine({
    audience,
    sendDm,
    sendMail,
    mailCount: mailCounts.withMail,
    memberName: selectedLabel,
  });

  const resetOk = (text) => {
    setOk(text);
    window.setTimeout(() => setOk(''), 4000);
  };

  const draftWithGemini = async () => {
    setError('');
    setOk('');
    const prompt = aiPrompt.trim();
    const draft = [subject.trim(), content.trim()].filter(Boolean).join('\n\n');
    if (!prompt && !draft) {
      setError('Decile a la IA de qué se trata, o escribí un borrador para que lo mejore.');
      return;
    }
    setBusy('ai');
    try {
      const drafted = await askJevCompose({
        prompt,
        audience,
        channels: channels || 'mensaje interno y mail',
        draft,
        memberName: selectedLabel,
      });
      setSubject(drafted.subject);
      setContent(drafted.body);
      setConfirmMass(false);
    } catch (err) {
      setError(err?.message || 'La IA no pudo redactar.');
    } finally {
      setBusy('');
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setError('');
    setOk('');
    setProgress('');
    if (!sendDm && !sendMail) {
      setError('Elegí mensaje interno, mail, o los dos.');
      return;
    }
    if (audience === 'one' && !recipientId) {
      setError('Elegí un socio.');
      return;
    }
    if (!subject.trim() || !content.trim()) {
      setError('Completá asunto y mensaje.');
      return;
    }
    if (sendMail && audience === 'one' && !selectedHasMail) {
      setError('Ese socio no tiene un mail real. Mandá solo el mensaje interno, o cargá el correo en la ficha.');
      return;
    }
    if (audience === 'all' && !confirmMass) {
      setConfirmMass(true);
      return;
    }

    setBusy('send');
    try {
      const bits = [];
      if (sendDm) {
        const msg = createMessage({
          sender: senderName,
          senderId: MAILBOX.OPERATIONS,
          recipientId: audience === 'one' ? recipientId : MAILBOX.ALL_MEMBERS,
          subject,
          content,
          meta: { kind: 'club_notice', mail: sendMail },
        });
        if (typeof onSendMessage === 'function') await onSendMessage(msg);
        bits.push(audience === 'one' ? 'mensaje interno' : 'mensaje interno a todos');
      }
      if (sendMail) {
        let mailed;
        try {
          mailed = await repos.sendClubMailCampaign({
            subject: subject.trim(),
            text: content.trim(),
            audience,
            memberNumber: audience === 'one' ? recipientId : '',
            onProgress: ({ sent, failed, more }) => {
              setProgress(more
                ? `Enviando mails… ${sent} enviados${failed ? `, ${failed} no salieron` : ''}`
                : '');
            },
          });
        } catch (err) {
          const detail = err?.message || 'el mail no salió';
          throw new Error(bits.length ? `El mensaje interno salió. El mail no: ${detail}` : detail);
        }
        bits.push(mailed.sent === 1 ? '1 mail' : `${mailed.sent} mails`);
        if (mailed.failed) bits.push(`${mailed.failed} mails no salieron`);
      }
      setSubject('');
      setContent('');
      setAiPrompt('');
      setConfirmMass(false);
      setProgress('');
      resetOk(`Enviado: ${bits.join(' · ')}.`);
    } catch (err) {
      setError(err?.message || 'No se pudo enviar.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div id="ops-compose-form" className="glass-card fade-in ops-notice">
      <div>
        <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>
          Comunicado
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          Mensaje interno, mail, o los dos. A un socio o a todos. La IA puede redactarlo.
        </p>
      </div>

      <form onSubmit={handleSend} className="ops-notice-form">
        <fieldset className="ops-notice-set">
          <legend>Canal</legend>
          <label className={`ops-notice-chip${sendDm ? ' is-on' : ''}`}>
            <input type="checkbox" checked={sendDm} onChange={(e) => { setSendDm(e.target.checked); setConfirmMass(false); }} />
            <MessageSquare size={14} aria-hidden /> Mensaje interno
          </label>
          <label className={`ops-notice-chip${sendMail ? ' is-on' : ''}`}>
            <input type="checkbox" checked={sendMail} onChange={(e) => { setSendMail(e.target.checked); setConfirmMass(false); }} />
            <Mail size={14} aria-hidden /> Mail
          </label>
        </fieldset>

        <fieldset className="ops-notice-set">
          <legend>Destino</legend>
          <button
            type="button"
            className={`ops-notice-chip${audience === 'one' ? ' is-on' : ''}`}
            onClick={() => { setAudience('one'); setConfirmMass(false); }}
          >
            Un socio
          </button>
          <button
            type="button"
            className={`ops-notice-chip${audience === 'all' ? ' is-on' : ''}`}
            onClick={() => { setAudience('all'); setRecipientId(''); setConfirmMass(false); }}
          >
            Todos los socios
          </button>
        </fieldset>

        {audience === 'one' ? (
          <div className="ops-notice-pick">
            {recipientId ? (
              <div className="ops-notice-picked">
                <span>
                  <small>Seleccionado</small>
                  <strong>{selectedLabel}</strong>
                  {sendMail ? (
                    <em>{selectedHasMail ? selectedMember.email : 'Sin mail real'}</em>
                  ) : null}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRecipientId('')}>
                  <X size={14} /> Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="ops-notice-search">
                  <Search size={15} aria-hidden />
                  <input
                    type="search"
                    className="form-input"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Buscar socio por nombre, credencial o teléfono…"
                    autoComplete="off"
                  />
                </div>
                <div className="ops-notice-hits">
                  {filteredMembers.length === 0 ? (
                    <p>No se encontraron socios con ese criterio.</p>
                  ) : filteredMembers.map((m) => (
                    <button
                      key={m.memberId}
                      type="button"
                      onClick={() => { setRecipientId(m.memberId); setMemberQuery(''); setConfirmMass(false); }}
                    >
                      <strong>{m.name}</strong>
                      <span>Cred. {String(m.memberId || '').slice(0, 8)}… · {m.tier}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="ops-notice-count">
            {sendDm ? 'El mensaje interno lo ven todos en la bandeja. ' : ''}
            {sendMail
              ? `El mail sale a ${mailCounts.withMail} direcciones${mailCounts.withoutMail ? ` · ${mailCounts.withoutMail} fichas sin mail real` : ''}.`
              : ''}
          </p>
        )}

        <div className="ops-notice-ai">
          <label className="form-label" htmlFor="ops-notice-ai">Redactar con IA</label>
          <textarea
            id="ops-notice-ai"
            className="form-input"
            rows={2}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Ej: canchas cerradas el sábado por el zonda, o convocar a asamblea el 20."
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={draftWithGemini}
            disabled={Boolean(busy)}
          >
            <Sparkles size={14} /> {busy === 'ai' ? 'Redactando…' : (subject || content ? 'Mejorar con IA' : 'Redactar con IA')}
          </button>
        </div>

        {ok ? (
          <div role="status" className="ops-notice-ok">{ok}</div>
        ) : null}
        {error ? (
          <div role="alert" className="ops-notice-err">{error}</div>
        ) : null}
        {progress ? (
          <p className="ops-notice-progress">{progress}</p>
        ) : null}

        <label className="form-label" htmlFor="ops-notice-subject">Asunto</label>
        <input
          id="ops-notice-subject"
          className="form-input"
          value={subject}
          onChange={(e) => { setSubject(e.target.value); setConfirmMass(false); }}
          placeholder="Asunto del comunicado"
          required
        />

        <label className="form-label" htmlFor="ops-notice-body">Mensaje</label>
        <textarea
          id="ops-notice-body"
          className="form-input"
          rows={8}
          value={content}
          onChange={(e) => { setContent(e.target.value); setConfirmMass(false); }}
          placeholder="Cuerpo del comunicado"
          required
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />

        {confirmMass ? (
          <div className="ops-notice-confirm" role="status">
            {confirmLine} Confirmá para despacharlo.
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
          <Send size={16} />
          {busy === 'send'
            ? 'Enviando…'
            : confirmMass
              ? 'Confirmar envío'
              : (channels ? `Enviar ${channels}` : 'Enviar')}
        </button>
      </form>
    </div>
  );
}
