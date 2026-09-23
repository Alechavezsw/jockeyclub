import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PoolTab from '../components/admin/PoolTab';
import { DEFAULT_POOL_SETTINGS } from '../domain/pool/poolAccess';

/**
 * Página de pileta — mismo criterio que /acceso: pantalla propia, sin chrome del panel.
 */
export default function PoolControlView({
  members = [],
  setMembers,
  updateMember = null,
  formatCurrency,
  addJournalEntry,
  poolAccesses = [],
  setPoolAccesses,
  setEntryLogs,
  poolSettings = DEFAULT_POOL_SETTINGS,
  setPoolSettings,
}) {
  const navigate = useNavigate();

  return (
    <div className="pool-gate">
      <header className="pool-gate-header">
        <div className="pool-gate-brand">
          <img className="club-mark" src="/logo-jockey-club.png?v=clavos-blancos" alt="Jockey Club" />
          <div>
            <div className="serif-font pool-gate-title">Pileta</div>
            <div className="pool-gate-sub">Sede Rivadavia · Canon, apto médico y socios</div>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/panel')}
        >
          <ArrowLeft size={14} /> Panel
        </button>
      </header>
      <PoolTab
        members={members}
        setMembers={setMembers}
        updateMember={updateMember}
        formatCurrency={formatCurrency}
        addJournalEntry={addJournalEntry}
        poolAccesses={poolAccesses}
        setPoolAccesses={setPoolAccesses}
        setEntryLogs={setEntryLogs}
        poolSettings={poolSettings}
        setPoolSettings={setPoolSettings}
      />
    </div>
  );
}
