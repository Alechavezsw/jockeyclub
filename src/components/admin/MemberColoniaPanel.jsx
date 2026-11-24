import { useEffect, useMemo, useState } from 'react';
import { Baby, ExternalLink, Loader2 } from 'lucide-react';
import { repos } from '../../data/bootstrap';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  coloniaEnrollmentBalance,
  coloniaSourceLabel,
  coloniaStatusLabel,
} from '../../domain/colonia/coloniaPortal';
import { ageYearsOn } from '../../domain/colonia/coloniaAge';
import { COLONIA_SEASON_2026_2027 } from '../../domain/colonia/coloniaConstants';

function money(n) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

/**
 * Ficha del socio → pestaña Colonia.
 * Lee únicamente colonia_* vía RPC; no toca outstanding_balance.
 */
export default function MemberColoniaPanel({
  member,
  onOpenColoniaAdmin,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enrollments, setEnrollments] = useState([]);

  const memberUuid = member?.id || null;

  useEffect(() => {
    if (!memberUuid || !isSupabaseConfigured) {
      setLoading(false);
      setEnrollments([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await repos.coloniaListForMember(memberUuid);
        if (cancelled) return;
        setEnrollments(res?.enrollments || []);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'No se pudo cargar Colonia.');
        setEnrollments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberUuid]);

  const rows = useMemo(() => (enrollments || []).map((row) => {
    const bal = coloniaEnrollmentBalance(row);
    const age = ageYearsOn(
      row.birth_date,
      COLONIA_SEASON_2026_2027.activitiesStartOn,
    );
    return { ...row, bal, age };
  }), [enrollments]);

  if (!isSupabaseConfigured) {
    return (
      <div className="mp-colonia-empty">
        <p>Colonia requiere conexión cloud.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="mp-family-loading" role="status">
        <Loader2 size={16} className="mp-family-loading-spin" />
        Cargando Colonia…
      </p>
    );
  }

  if (error) {
    return <p className="mp-section-lead" role="alert">{error}</p>;
  }

  if (!rows.length) {
    return (
      <div className="mp-colonia-empty">
        <Baby size={28} aria-hidden />
        <p className="mp-section-lead">
          Nadie del grupo familiar figura inscripto en Colonia de Verano en esta consulta.
        </p>
        <p className="muted">
          La cuota social y Colonia son cuentas independientes. Podés inscribir desde
          Mi cuenta → Colonia o desde Operación → Colonia.
        </p>
      </div>
    );
  }

  return (
    <div className="mp-colonia">
      <p className="mp-section-lead">
        Temporada {COLONIA_SEASON_2026_2027.code} · cuenta corriente de Colonia (no es cuota social)
      </p>
      <ul className="mp-colonia-list">
        {rows.map((row) => (
          <li key={row.id} className="mp-colonia-card">
            <div>
              <strong>{row.student_name || 'Alumno'}</strong>
              <div className="mp-family-meta">
                {row.age != null ? `${row.age} años · ` : ''}
                {coloniaStatusLabel(row.status)}
                {' · '}
                Plan {row.plan_key || '—'}
                {row.group_id ? ` · Grupo asignado` : ''}
                {' · '}
                {coloniaSourceLabel(row.source)}
              </div>
              <div className="mp-family-meta">
                Pago: {row.bal.paymentLabel}
                {' · '}
                Saldo Colonia {money(row.bal.balance)}
                {row.created_at
                  ? ` · Inscripto ${new Date(row.created_at).toLocaleDateString('es-AR')}`
                  : ''}
              </div>
            </div>
            {onOpenColoniaAdmin ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onOpenColoniaAdmin(row.id)}
              >
                <ExternalLink size={14} /> Ficha Colonia
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
