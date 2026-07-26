import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ConcessionsTab from '../components/admin/ConcessionsTab';

/**
 * Sección independiente de Concesiones (fuera del panel de pestañas).
 */
export default function ConcessionsView({
  concessions,
  canonPayments,
  upsertConcession,
  renewConcessionContract,
  setConcessionStatus,
  toggleConcessionChecklist,
  addDocToConcession,
  removeDocFromConcession,
  recordCanonPayment,
  renewedBy,
}) {
  const navigate = useNavigate();

  return (
    <div className="fade-in concessions-view">
      <button
        type="button"
        className="btn btn-secondary btn-sm concessions-view-back"
        onClick={() => navigate('/panel')}
      >
        <ArrowLeft size={14} /> Volver al panel
      </button>
      <ConcessionsTab
        concessions={concessions}
        canonPayments={canonPayments}
        upsertConcession={upsertConcession}
        renewConcessionContract={renewConcessionContract}
        setConcessionStatus={setConcessionStatus}
        toggleConcessionChecklist={toggleConcessionChecklist}
        addDocToConcession={addDocToConcession}
        removeDocFromConcession={removeDocFromConcession}
        recordCanonPayment={recordCanonPayment}
        renewedBy={renewedBy}
      />
    </div>
  );
}
