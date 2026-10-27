import { useMemo, useState } from 'react';
import { CreditCard, Download } from 'lucide-react';
import { formatCurrency } from '../../domain/accounting/journal';
import {
  LILA_PRISMA_FILE_707,
  PRISMA_FILE_TYPES,
  buildPrismaPresentation,
  maskCard,
  presentationDebits,
  summarizeResponseFile,
} from '../../domain/accounting/prismaPresentation';

const STORAGE_KEY = 'jockey-prisma-presentations:v1';

const BANKS = [
  'Banco Macro',
  'Mercado Pago',
  'Banco de San Juan',
  'Banco Itaú — Servicios y prestaciones',
];

const EMPTY_CONFIG = { establishment: '', bank: '' };

function loadState() {
  const base = {
    configs: {
      DEBLIQC: { ...EMPTY_CONFIG },
      DEBLIQD: { ...EMPTY_CONFIG },
      DEBLIMC: { ...EMPTY_CONFIG },
    },
    files: [LILA_PRISMA_FILE_707],
    responses: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      configs: { ...base.configs, ...(parsed.configs || {}) },
      files: Array.isArray(parsed.files) && parsed.files.length ? parsed.files : base.files,
      responses: Array.isArray(parsed.responses) ? parsed.responses : [],
    };
  } catch {
    return base;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      configs: state.configs,
      files: state.files,
      responses: state.responses,
    }));
  } catch {
    /* cuota llena o navegación privada */
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export default function PrismaDebitsPanel({ members = [] }) {
  const [state, setState] = useState(loadState);
  const [fileType, setFileType] = useState('DEBLIQC');
  const [error, setError] = useState('');
  const [responseNote, setResponseNote] = useState('');

  const config = state.configs[fileType] || EMPTY_CONFIG;
  const preview = useMemo(
    () => presentationDebits(members, fileType),
    [members, fileType],
  );
  const previewAmount = preview.reduce((sum, row) => sum + row.amount, 0);

  const patch = (next) => {
    setState(next);
    saveState(next);
  };

  const updateConfig = (key, value) => {
    patch({
      ...state,
      configs: {
        ...state.configs,
        [fileType]: { ...config, [key]: value },
      },
    });
  };

  const generate = () => {
    setError('');
    try {
      const when = new Date();
      const file = buildPrismaPresentation({
        fileType,
        establishment: config.establishment,
        when,
        debits: preview,
      });
      downloadText(file.filename, file.text);
      patch({
        ...state,
        files: [
          {
            id: String(when.getTime()),
            fileType,
            createdAt: when.toISOString(),
            debitCount: file.debitCount,
            totalCents: file.totalCents,
            status: 'Listo para procesar pagos',
            establishment: String(config.establishment || '').trim(),
          },
          ...state.files,
        ],
      });
    } catch (err) {
      setError(err.message || 'No se pudo armar el archivo.');
    }
  };

  const downloadExisting = (item) => {
    setError('');
    try {
      const file = buildPrismaPresentation({
        fileType: item.fileType,
        establishment: item.establishment || '',
        when: new Date(item.createdAt),
        debits: item.id === LILA_PRISMA_FILE_707.id
          ? []
          : presentationDebits(members, item.fileType),
      });
      downloadText(file.filename, file.text);
    } catch (err) {
      setError(err.message || 'No se pudo descargar.');
    }
  };

  const onResponse = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setError('');
    setResponseNote('');
    try {
      const text = await chosen.text();
      const summary = summarizeResponseFile(chosen.name, text);
      setResponseNote(`${summary.filename}: ${summary.records} registro${summary.records === 1 ? '' : 's'} de detalle.`);
      patch({
        ...state,
        responses: [
          {
            filename: summary.filename,
            records: summary.records,
            kind: summary.kind,
            loadedAt: new Date().toISOString(),
          },
          ...state.responses,
        ].slice(0, 20),
      });
    } catch (err) {
      setError(err.message || 'No se pudo leer el archivo de respuesta.');
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <div>
        <h4 className="serif-font" style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CreditCard size={18} /> Prisma
        </h4>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          El mismo circuito que Lila: identificador, archivo de presentación y archivo de respuesta.
          El importe es el saldo de cuenta corriente. Vitalicio, fundador y comisión no entran.
        </p>
      </div>

      <section style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {Object.values(PRISMA_FILE_TYPES).map((type) => {
          const row = state.configs[type.code] || EMPTY_CONFIG;
          const active = fileType === type.code;
          return (
            <button
              key={type.code}
              type="button"
              className="glass-card"
              onClick={() => setFileType(type.code)}
              style={{
                textAlign: 'left',
                padding: '0.85rem 1rem',
                cursor: 'pointer',
                borderColor: active ? 'var(--primary-gold)' : undefined,
              }}
            >
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{type.filename.replace('.txt', '')}</div>
              <strong>{type.label}</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                {row.establishment ? `Establecimiento ${row.establishment}` : 'Sin identificador'}
                {row.bank ? ` · ${row.bank}` : ''}
              </div>
            </button>
          );
        })}
      </section>

      <form
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.65rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem' }}
      >
        <div>
          <label className="form-label">Identificador de Prisma</label>
          <input
            className="form-input"
            inputMode="numeric"
            maxLength={10}
            value={config.establishment}
            onChange={(event) => updateConfig('establishment', event.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="Hasta 10 dígitos"
          />
        </div>
        <div>
          <label className="form-label">Cuenta bancaria</label>
          <select className="form-input" value={config.bank} onChange={(event) => updateConfig('bank', event.target.value)}>
            <option value="">Elegí una cuenta</option>
            {BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={generate}>Generar archivo</button>
        </div>
      </form>

      {!config.establishment && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Sin identificador, el archivo sale como el de Lila del 29/08/2026: encabezado y cierre, sin socios.
        </p>
      )}
      {error && <p style={{ color: '#ef4444', margin: 0 }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        <div className="glass-card" style={{ padding: '0.8rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Débitos de esta marca</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{preview.length}</div>
        </div>
        <div className="glass-card" style={{ padding: '0.8rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Monto</div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{formatCurrency(previewAmount)}</div>
        </div>
      </div>

      <div className="table-responsive">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tipo de tarjeta</th>
              <th>Débitos</th>
              <th>Fecha de generación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {state.files.map((item) => (
              <tr key={item.id}>
                <td>{item.id === LILA_PRISMA_FILE_707.id ? '707' : item.id.slice(-6)}</td>
                <td>{PRISMA_FILE_TYPES[item.fileType]?.label || item.fileType}</td>
                <td>{item.debitCount}</td>
                <td>{formatStamp(item.createdAt)}</td>
                <td>{item.status}</td>
                <td>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadExisting(item)}>
                    <Download size={13} /> Descargar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ border: '1px solid var(--border-glass)', borderRadius: 12, padding: '0.9rem', display: 'grid', gap: '0.55rem' }}>
        <strong>Archivo de respuesta</strong>
        <label className="form-label">Archivo de respuesta</label>
        <input className="form-input" type="file" accept=".txt,text/plain" onChange={onResponse} />
        {responseNote && <p style={{ margin: 0 }}>{responseNote}</p>}
        {state.responses.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No hay archivos de respuesta cargados.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {state.responses.map((item) => (
              <li key={`${item.filename}-${item.loadedAt}`}>
                {item.filename} · {item.records} registros · {formatStamp(item.loadedAt)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="table-responsive">
        <h5 style={{ margin: '0 0 0.4rem' }}>Vista previa de débitos</h5>
        <table className="admin-table">
          <thead>
            <tr><th>Socio</th><th>Tarjeta</th><th>Monto</th><th>Nuevo</th></tr>
          </thead>
          <tbody>
            {preview.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                  No hay adheridos con saldo para {PRISMA_FILE_TYPES[fileType].label}.
                </td>
              </tr>
            )}
            {preview.slice(0, 40).map((row) => (
              <tr key={row.memberId}>
                <td><strong>{row.memberName || row.memberId}</strong><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{row.memberId}</div></td>
                <td>{maskCard(row.card)}</td>
                <td style={{ fontWeight: 700 }}>{formatCurrency(row.amount)}</td>
                <td>No</td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.length > 40 && (
          <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            Se muestran 40 de {preview.length}. El archivo lleva todos.
          </p>
        )}
      </div>
    </div>
  );
}
