import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Search, Send, Sparkles, X } from 'lucide-react';
import { askJevCompose } from '../../data/jevChat';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
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
import {
  filterMembersForBalances,
  lilaClubNumber,
} from '../../domain/accounting/memberBalances';
import {
  mergeMembersById,
  rankMemberSearchHit,
} from '../../domain/members/households';

const EMPTY_PICK = {
  firstName: '',
  lastName: '',
  dni: '',
  memberNumber: '',
  familyId: '',
};

function memberHitLine(member) {
  const nro = lilaClubNumber(member);
  const dni = String(member?.documentNumber || member?.dni || '').replace(/\D/g, '');
  const bits = [
    nro ? `N° ${nro}` : '',
    dni ? `DNI ${dni}` : '',
    member?.email || '',
    member?.phone || member?.phoneAlt || '',
    member?.familyGroupName || '',
  ].filter(Boolean);
  return bits.join(' · ') || member?.tier || '';
}

function remoteNeedle(query, pick) {
  const q = String(query || '').trim();
  if (q) return q;
  const nro = String(pick.memberNumber || '').replace(/\D/g, '');
  if (nro) return nro;
  const dni = String(pick.dni || '').replace(/\D/g, '');
  if (dni) return dni;
  const name = [pick.lastName, pick.firstName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  if (name) return name;
  return String(pick.familyId || '').trim();
}

export default function NoticeComposeCard({
  members = [],
  onSendMessage,
  senderName = 'Administración Jockey Club',
  replyToId = '',
  channel = 'both',
  onSent,
}) {
  const [audience, setAudience] = useState('all');
  const [sendDm, setSendDm] = useState(channel !== 'mail');
  const [sendMail, setSendMail] = useState(channel !== 'dm');
  const [recipientId, setRecipientId] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberPick, setMemberPick] = useState(EMPTY_PICK);
  const [remoteHits, setRemoteHits] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [confirmMass, setConfirmMass] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [progress, setProgress] = useState('');

  useEffect(() => {
    if (channel === 'mail') {
      setSendDm(false);
      setSendMail(true);
    } else if (channel === 'dm') {
      setSendDm(true);
      setSendMail(false);
    }
  }, [channel]);

  useEffect(() => {
    if (!replyToId) return;
    setAudience('one');
    setRecipientId(replyToId);
    setConfirmMass(false);
  }, [replyToId]);

  const mailCounts = useMemo(() => mailAudienceCount(members), [members]);
  const directory = useMemo(
    () => mergeMembersById(members, remoteHits),
    [members, remoteHits],
  );

  useEffect(() => {
    const needle = remoteNeedle(memberQuery, memberPick);
    const digits = needle.replace(/\D/g, '');
    const enough = needle.length >= 2 || digits.length >= 3;
    if (!enough || !isSupabaseConfigured) {
      setRemoteHits([]);
      setRemoteBusy(false);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      repos.searchMembersDirectory(needle, { limit: 40 })
        .then((rows) => {
          if (!cancelled) setRemoteHits(rows || []);
        })
        .catch(() => {
          if (!cancelled) setRemoteHits([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteBusy(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberQuery, memberPick]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim();
    const structured = Boolean(
      memberPick.firstName
      || memberPick.lastName
      || memberPick.dni
      || memberPick.memberNumber
      || memberPick.familyId,
    );
    if (!q && !structured) return directory.slice(0, 8);
    const fields = {
      firstName: memberPick.firstName,
      lastName: memberPick.lastName,
      dni: memberPick.dni,
      memberNumber: memberPick.memberNumber,
      familyId: memberPick.familyId,
      status: 'all',
    };
    const local = filterMembersForBalances(directory, { ...fields, query: q });
    const seen = new Set(local.map((row) => String(row.memberId || '')));
    const extra = q
      ? filterMembersForBalances(remoteHits, fields).filter((row) => {
        const id = String(row.memberId || '');
        return id && !seen.has(id);
      })
      : [];
    return [...local, ...extra]
      .toSorted((a, b) => rankMemberSearchHit(a, q) - rankMemberSearchHit(b, q))
      .slice(0, 16);
  }, [directory, memberPick, memberQuery, remoteHits]);

  const selectedLabel = recipientId ? recipientLabel(recipientId, directory) : '';
  const selectedMember = directory.find((m) => m.memberId === recipientId) || null;
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
      setError(sendDm
        ? 'Ese socio no tiene un mail real. Mandá solo el mensaje interno, o cargá el correo en la ficha.'
        : 'Ese socio no tiene un mail real. Cargá el correo en la ficha.');
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
      if (typeof onSent === 'function') onSent({ mail: sendMail, dm: sendDm });
    } catch (err) {
      setError(err?.message || 'No se pudo enviar.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div id="ops-compose-form" className="glass-card fade-in ops-notice">
      <div className="ops-notice-head">
        <img
          className="club-mark ops-notice-logo"
          src="/logo-jockey-club.png?v=clavos-blancos"
          alt=""
          width={48}
          height={48}
        />
        <div>
          <h3 className="serif-font" style={{ fontSize: '1.3rem', color: 'var(--text-gold)', margin: 0 }}>
            Comunicado
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
            {channel === 'mail'
              ? 'Mail a un socio o a todos. La IA puede redactarlo.'
              : channel === 'dm'
                ? 'Mensaje interno a un socio o a todos. La IA puede redactarlo.'
                : 'Mensaje interno, mail, o los dos. A un socio o a todos. La IA puede redactarlo.'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSend} className="ops-notice-form">
        {channel === 'both' ? (
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
        ) : null}

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
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setRecipientId('');
                    setMemberQuery('');
                    setMemberPick(EMPTY_PICK);
                  }}
                >
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
                    placeholder="Nombre, apellido, DNI, n° de socio, mail o teléfono…"
                    autoComplete="off"
                    aria-label="Buscar socio"
                  />
                </div>
                <div className="ops-notice-filters">
                  <label>
                    <span className="form-label">Nombre</span>
                    <input
                      className="form-input"
                      value={memberPick.firstName}
                      onChange={(e) => setMemberPick((prev) => ({ ...prev, firstName: e.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span className="form-label">Apellido</span>
                    <input
                      className="form-input"
                      value={memberPick.lastName}
                      onChange={(e) => setMemberPick((prev) => ({ ...prev, lastName: e.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span className="form-label">DNI</span>
                    <input
                      className="form-input"
                      inputMode="numeric"
                      value={memberPick.dni}
                      onChange={(e) => setMemberPick((prev) => ({ ...prev, dni: e.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span className="form-label">N° de socio</span>
                    <input
                      className="form-input"
                      inputMode="numeric"
                      value={memberPick.memberNumber}
                      onChange={(e) => setMemberPick((prev) => ({ ...prev, memberNumber: e.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    <span className="form-label">Grupo familiar</span>
                    <input
                      className="form-input"
                      value={memberPick.familyId}
                      onChange={(e) => setMemberPick((prev) => ({ ...prev, familyId: e.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="ops-notice-hits">
                  {filteredMembers.length === 0 ? (
                    <p>{remoteBusy ? 'Buscando en el padrón…' : 'No se encontraron socios con ese criterio.'}</p>
                  ) : filteredMembers.map((m) => (
                    <button
                      key={m.memberId}
                      type="button"
                      onClick={() => {
                        setRecipientId(m.memberId);
                        setMemberQuery('');
                        setMemberPick(EMPTY_PICK);
                        setConfirmMass(false);
                      }}
                    >
                      <strong>{m.name}</strong>
                      <span>{memberHitLine(m)}</span>
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
          rows={14}
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
