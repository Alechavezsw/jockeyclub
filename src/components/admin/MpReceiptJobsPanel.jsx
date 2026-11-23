import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

function rowLabel(row) {
  const intent = row.mp_intents || {};
  const number = intent.member_number ? `Nº ${intent.member_number}` : 'Socio';
  const concept = intent.concept || 'Mercado Pago';
  return `${number} · ${concept}`;
}

export default function MpReceiptJobsPanel() {
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase
      .from('mp_receipt_jobs')
      .select('intent_id, status, attempts, email_error, last_error, receipt_number, next_attempt_at, mp_intents(member_number, concept, amount)')
      .in('status', ['pending', 'retry'])
      .order('updated_at', { ascending: true })
      .limit(40);
    if (error) {
      setRows([]);
      setNotice('Los comprobantes pendientes aparecen cuando está creada la cola de recibos.');
      return;
    }
    setNotice('');
    setRows(data || []);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;
    supabase
      .from('mp_receipt_jobs')
      .select('intent_id, status, attempts, email_error, last_error, receipt_number, next_attempt_at, mp_intents(member_number, concept, amount)')
      .in('status', ['pending', 'retry'])
      .order('updated_at', { ascending: true })
      .limit(40)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setRows([]);
          setNotice('Los comprobantes pendientes aparecen cuando está creada la cola de recibos.');
          return;
        }
        setNotice('');
        setRows(data || []);
      })
      .catch(() => {
        if (!cancelled) setNotice('No se pudo leer la cola de comprobantes.');
      });
    return () => { cancelled = true; };
  }, []);

  async function retry(intentId) {
    setBusyId(intentId);
    setNotice('');
    const { data, error } = await supabase.functions.invoke('mp-receipt-retry', {
      body: { intentId },
    });
    setBusyId('');
    if (error || data?.error) {
      setNotice(data?.error || 'No se pudo reintentar el comprobante.');
    } else if (data?.receipt?.status === 'sent' || data?.receipt?.skip === 'already') {
      setNotice('Comprobante entregado.');
    } else {
      setNotice(data?.receipt?.emailError || 'Quedó para un nuevo intento. El pago no se duplicó.');
    }
    await load();
  }

  if (!isSupabaseConfigured || (rows.length === 0 && !notice)) return null;

  return (
    <section className="members-app-desk__incoming" aria-label="Comprobantes de Mercado Pago pendientes">
      <div className="members-app-desk__incoming-head">
        <Mail size={16} aria-hidden="true" />
        <div>
          <strong>Comprobantes pendientes</strong>
          <p>Un reintento vuelve a enviar el mail o el mensaje. No vuelve a acreditar el pago.</p>
        </div>
      </div>
      {notice ? <p className="members-app-desk__incoming-empty">{notice}</p> : null}
      {rows.length > 0 ? (
        <ul className="members-app-desk__incoming-list">
          {rows.map((row) => (
            <li key={row.intent_id}>
              <div className="members-app-desk__incoming-main">
                <strong>{rowLabel(row)}</strong>
                <p>
                  {row.receipt_number || 'Sin número'}
                  {' · '}
                  {row.attempts} intento{row.attempts === 1 ? '' : 's'}
                  {row.email_error || row.last_error ? ` · ${row.email_error || row.last_error}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="members-app-desk__action-btn"
                disabled={busyId === row.intent_id}
                onClick={() => retry(row.intent_id)}
              >
                {busyId === row.intent_id ? <Loader2 size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Reintentar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
