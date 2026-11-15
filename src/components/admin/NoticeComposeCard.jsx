import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mail, MessageSquare, Search, Send, Sparkles, Users, UserRound, X } from 'lucide-react';
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
  const [showAdvancedPick, setShowAdvancedPick] = useState(false);

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
          throw new Error(
            bits.length ? `El mensaje interno salió. El mail no: ${detail}` : detail,
            { cause: err },
          );
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

  const channelTone = channel === 'mail' ? 'mail' : channel === 'dm' ? 'md' : 'both';
  const channelTitle = channel === 'mail' ? 'Nuevo mail' : channel === 'dm' ? 'Nuevo MD' : 'Comunicado';
  const channelLead = channel === 'mail'
    ? 'Sale por correo a un socio o a todo el padrón con mail real.'
    : channel === 'dm'
      ? 'Queda en la bandeja interna de la app del socio.'
      : 'Mensaje interno, mail, o los dos.';
  const destStep = channel === 'both' ? '2' : '1';
  const msgStep = channel === 'both' ? '3' : '2';

  return (
    <div id="ops-compose-form" className={`glass-card fade-in ops-notice ops-notice--${channelTone}`}>
      <div className="ops-notice-head">
        <span className={`ops-notice-mark ops-notice-mark--${channelTone}`} aria-hidden="true">
          {channel === 'dm' ? <MessageSquare size={20} /> : <Mail size={20} />}
        </span>
        <div>
          <p className="ops-notice-kicker">Redactar y enviar</p>
          <h3 className="serif-font ops-notice-title">{channelTitle}</h3>
          <p className="ops-notice-lead">{channelLead}</p>
        </div>
      </div>

      <form onSubmit={handleSend} className="ops-notice-form">
        {channel === 'both' ? (
          <section className="ops-notice-block">
            <header className="ops-notice-block-head">
              <span className="ops-notice-step">1</span>
              <div>
                <h4>Canal</h4>
                <p>Elegí por dónde sale el aviso.</p>
              </div>
            </header>
            <fieldset className="ops-notice-set">
              <legend className="sr-only">Canal</legend>
              <label className={`ops-notice-chip ops-notice-chip--md${sendDm ? ' is-on' : ''}`}>
                <input type="checkbox" checked={sendDm} onChange={(e) => { setSendDm(e.target.checked); setConfirmMass(false); }} />
                <MessageSquare size={14} aria-hidden /> Mensaje interno
              </label>
              <label className={`ops-notice-chip ops-notice-chip--mail${sendMail ? ' is-on' : ''}`}>
                <input type="checkbox" checked={sendMail} onChange={(e) => { setSendMail(e.target.checked); setConfirmMass(false); }} />
                <Mail size={14} aria-hidden /> Mail
              </label>
            </fieldset>
          </section>
        ) : null}

        <section className="ops-notice-block">
          <header className="ops-notice-block-head">
            <span className="ops-notice-step">{destStep}</span>
            <div>
              <h4>Destino</h4>
              <p>Un socio puntual o todo el padrón.</p>
            </div>
          </header>
          <fieldset className="ops-notice-set ops-notice-set--dest">
            <legend className="sr-only">Destino</legend>
            <button
              type="button"
              className={`ops-notice-dest${audience === 'one' ? ' is-on' : ''}`}
              onClick={() => { setAudience('one'); setConfirmMass(false); }}
            >
              <UserRound size={18} aria-hidden />
              <span>
                <strong>Un socio</strong>
                <em>Buscá por nombre, DNI o n°</em>
              </span>
            </button>
            <button
              type="button"
              className={`ops-notice-dest${audience === 'all' ? ' is-on' : ''}`}
              onClick={() => { setAudience('all'); setRecipientId(''); setConfirmMass(false); }}
            >
              <Users size={18} aria-hidden />
              <span>
                <strong>Todos los socios</strong>
                <em>{sendMail ? `${mailCounts.withMail} mails` : 'Bandeja interna'}</em>
              </span>
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
                  <button
                    type="button"
                    className={`ops-notice-advanced-toggle${showAdvancedPick ? ' is-open' : ''}`}
                    aria-expanded={showAdvancedPick}
                    onClick={() => setShowAdvancedPick((v) => !v)}
                  >
                    Búsqueda avanzada
                    <ChevronDown size={15} aria-hidden />
                  </button>
                  {showAdvancedPick ? (
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
                  ) : null}
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
        </section>

        <section className="ops-notice-block">
          <header className="ops-notice-block-head">
            <span className="ops-notice-step">{msgStep}</span>
            <div>
              <h4>Mensaje</h4>
              <p>Escribilo vos o pedile un borrador a la IA.</p>
            </div>
          </header>

          <div className="ops-notice-ai">
            <label className="form-label" htmlFor="ops-notice-ai">Ayuda de IA</label>
            <div className="ops-notice-ai-row">
              <textarea
                id="ops-notice-ai"
                className="form-input"
                rows={2}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Ej.: canchas cerradas el sábado por el zonda."
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={draftWithGemini}
                disabled={Boolean(busy)}
              >
                <Sparkles size={14} />
                {busy === 'ai' ? 'Redactando…' : (subject || content ? 'Mejorar' : 'Redactar')}
              </button>
            </div>
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

          <label className="form-label" htmlFor="ops-notice-body">Cuerpo</label>
          <textarea
            id="ops-notice-body"
            className="form-input"
            rows={8}
            value={content}
            onChange={(e) => { setContent(e.target.value); setConfirmMass(false); }}
            placeholder="Texto que recibe el socio"
            required
          />
        </section>

        {confirmMass ? (
          <div className="ops-notice-confirm" role="status">
            {confirmLine} Confirmá para despacharlo.
          </div>
        ) : null}

        <div className="ops-notice-sendbar">
          <p className="ops-notice-sendbar-hint">
            {audience === 'one' && selectedLabel
              ? `Para ${selectedLabel}`
              : audience === 'all'
                ? 'Envío masivo al padrón'
                : 'Elegí un destino para enviar'}
          </p>
          <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
            <Send size={16} />
            {busy === 'send'
              ? 'Enviando…'
              : confirmMass
                ? 'Confirmar envío'
                : (channels ? `Enviar ${channels}` : 'Enviar')}
          </button>
        </div>
      </form>
    </div>
  );
}
