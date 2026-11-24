import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, Search } from 'lucide-react';
import ModalDialog from '../ModalDialog';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  buildFamilyLinkPreview,
  currentFamilyPrincipal,
  familyLinkConfirmPhrase,
  familyLinkMatchesConfirm,
  normalizeClubNumber,
} from '../../domain/members/familyLinkCorrection';
import { familyPrincipalOf, memberNumberOf } from '../../domain/members/households';

/**
 * Asistente de corrección de vínculo familiar.
 * Solo aplica vía RPC; sin el migration publicado muestra error claro.
 */
export default function FamilyLinkCorrectionModal({
  open,
  member,
  members = [],
  onClose,
  onApplied,
}) {
  const memberId = memberNumberOf(member);
  const expectedPrincipal = currentFamilyPrincipal(member);
  const [proposedInput, setProposedInput] = useState('');
  const [proposedMember, setProposedMember] = useState(null);
  const [originHousehold, setOriginHousehold] = useState([]);
  const [destinationHousehold, setDestinationHousehold] = useState([]);
  const [reason, setReason] = useState('');
  const [ackInactive, setAckInactive] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [serverPreview, setServerPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open || !memberId) return undefined;
    let cancelled = false;
    setProposedInput('');
    setProposedMember(null);
    setDestinationHousehold([]);
    setReason('');
    setAckInactive(false);
    setConfirmText('');
    setServerPreview(null);
    setMsg('');
    (async () => {
      try {
        if (typeof repos.listHouseholdByPrincipal === 'function') {
          const rows = await repos.listHouseholdByPrincipal(expectedPrincipal || memberId);
          if (!cancelled) setOriginHousehold(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (!cancelled) setOriginHousehold([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, memberId, expectedPrincipal]);

  const localPreview = useMemo(() => buildFamilyLinkPreview({
    member,
    expectedPrincipal,
    proposedPrincipal: proposedInput,
    proposedMember,
    originHousehold,
    destinationHousehold,
    members,
    reason,
    ackInactiveTitular: ackInactive,
  }), [
    member,
    expectedPrincipal,
    proposedInput,
    proposedMember,
    originHousehold,
    destinationHousehold,
    members,
    reason,
    ackInactive,
  ]);

  const confirmPhrase = familyLinkConfirmPhrase(localPreview);
  const confirmOk = familyLinkMatchesConfirm(localPreview, confirmText);

  async function lookupProposed() {
    const key = normalizeClubNumber(proposedInput);
    setMsg('');
    setServerPreview(null);
    if (!key) {
      setProposedMember(null);
      setDestinationHousehold([]);
      setMsg('Indicá un Nº de socio válido.');
      return;
    }
    setBusy(true);
    try {
      let found = (members || []).find((row) => memberNumberOf(row) === key) || null;
      if (!found && typeof repos.getMemberByNumber === 'function') {
        found = await repos.getMemberByNumber(key);
      }
      setProposedMember(found || null);
      if (found && typeof repos.listHouseholdByPrincipal === 'function') {
        const destPrincipal = familyPrincipalOf(found) || memberNumberOf(found);
        const rows = await repos.listHouseholdByPrincipal(destPrincipal);
        setDestinationHousehold(Array.isArray(rows) ? rows : [found]);
      } else {
        setDestinationHousehold(found ? [found] : []);
      }
      if (isSupabaseConfigured && typeof repos.previewFamilyLinkChange === 'function') {
        try {
          const remote = await repos.previewFamilyLinkChange(memberId, key);
          setServerPreview(remote);
        } catch (err) {
          if (err?.code === 'FAMILY_LINK_RPC_MISSING') {
            setMsg('La RPC de corrección aún no está publicada en la base. El preview local sigue disponible.');
          } else {
            setMsg(err?.message || 'No se pudo consultar el preview en servidor.');
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyChange() {
    setMsg('');
    if (!localPreview.ok || !confirmOk) {
      setMsg('Completá motivo, validaciones y la frase de confirmación.');
      return;
    }
    if (!isSupabaseConfigured || typeof repos.applyFamilyLinkChange !== 'function') {
      setMsg('La corrección solo se aplica en cloud con la RPC publicada.');
      return;
    }
    setBusy(true);
    try {
      const result = await repos.applyFamilyLinkChange({
        memberNumber: memberId,
        expectedPrincipal,
        proposedPrincipal: localPreview.proposedPrincipal,
        reason,
        ackInactive,
      });
      if (typeof onApplied === 'function') onApplied(result);
      onClose?.();
    } catch (err) {
      setMsg(err?.message || 'No se pudo aplicar el vínculo.');
    } finally {
      setBusy(false);
    }
  }

  if (!open || !member) return null;

  return (
    <ModalDialog
      onClose={busy ? undefined : onClose}
      labelledBy="family-link-title"
      contentClassName="modal-content glass-panel family-link-modal"
      contentStyle={{ width: 'min(720px, 94vw)', maxHeight: '90vh', overflow: 'auto', padding: '1.25rem' }}
    >
      <header className="family-link-head">
        <p className="household-integrity-kicker">Corrección asistida · sin impacto financiero</p>
        <h3 id="family-link-title" className="serif-font">
          <Link2 size={18} aria-hidden /> Revisar vínculo familiar
        </h3>
        <p>
          Socio <strong>{member.name}</strong> · Nº {memberId}. Titular actual:{' '}
          <strong>{expectedPrincipal || '—'}</strong>.
        </p>
      </header>

      <label className="family-link-field">
        <span>Nuevo titular (Nº de socio)</span>
        <div className="family-link-lookup">
          <input
            value={proposedInput}
            onChange={(e) => setProposedInput(e.target.value)}
            placeholder="Ej. 10009"
            disabled={busy}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={lookupProposed} disabled={busy}>
            <Search size={14} /> Buscar
          </button>
        </div>
      </label>

      {proposedMember ? (
        <p className="family-link-found">
          Encontrado: <strong>{proposedMember.name || proposedMember.full_name}</strong>
          {' · '}estado {proposedMember.status || 'active'}
        </p>
      ) : null}

      <div className="family-link-columns">
        <section>
          <h4>Hogar actual</h4>
          <ul>
            {(localPreview.originHousehold || []).map((row) => (
              <li key={row.memberId}>{row.role}: {row.name} · Nº {row.memberId}</li>
            ))}
            {!localPreview.originHousehold?.length ? <li className="muted">Sin integrantes cargados</li> : null}
          </ul>
        </section>
        <section>
          <h4>Hogar destino</h4>
          <ul>
            {(localPreview.destinationHousehold || []).map((row) => (
              <li key={row.memberId}>{row.role}: {row.name} · Nº {row.memberId}</li>
            ))}
            {!localPreview.destinationHousehold?.length ? <li className="muted">Buscá un titular</li> : null}
          </ul>
        </section>
      </div>

      <section className="family-link-changes">
        <h4>Qué cambiaría</h4>
        <ul>
          {(localPreview.wouldChange || []).map((row) => (
            <li key={row.field}>
              <code>{row.field}</code>: {String(row.from || '—')} → {String(row.to || '—')}
            </li>
          ))}
        </ul>
        <p className="family-link-finance">{localPreview.financialNote}</p>
      </section>

      {(localPreview.errors || []).map((err) => (
        <p key={err.code} className="mp-ops-note is-error">
          <AlertTriangle size={14} aria-hidden /> {err.message}
        </p>
      ))}
      {(localPreview.warnings || []).map((warn) => (
        <p key={warn.code} className="mp-ops-note is-warn">{warn.message}</p>
      ))}
      {serverPreview?.ok === false ? (
        <p className="mp-ops-note is-warn">El servidor también marcó observaciones en el preview.</p>
      ) : null}

      <label className="family-link-field">
        <span>Motivo (obligatorio)</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Evidencia: ficha LILA, nota de secretaría, etc."
          disabled={busy}
        />
      </label>

      {localPreview.warnings?.some((w) => w.code === 'proposed_inactive') ? (
        <label className="family-link-check">
          <input
            type="checkbox"
            checked={ackInactive}
            onChange={(e) => setAckInactive(e.target.checked)}
            disabled={busy}
          />
          Acepto vincular bajo un titular no operativo (sin reactivarlo).
        </label>
      ) : null}

      <label className="family-link-field">
        <span>Escribí exactamente: «{confirmPhrase}»</span>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={busy || !localPreview.ok}
        />
      </label>

      {msg ? <p className="mp-ops-note is-warn" role="status">{msg}</p> : null}

      <footer className="family-link-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={applyChange}
          disabled={busy || !localPreview.ok || !confirmOk}
        >
          Confirmar corrección
        </button>
      </footer>
    </ModalDialog>
  );
}
