import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, User, Users, LayoutDashboard, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  ROLE_LABELS,
  allowedAdminTabs,
  canAccessAdmin,
} from '../domain/auth/roles';

const SECTION_LABELS = {
  dashboard: 'Inicio',
  members: 'Socios',
  dues: 'Cuotas',
  bookings: 'Reservas',
  disciplines: 'Disciplinas',
  access: 'Ingresos',
  accounting: 'Contabilidad',
  staff: 'Personal',
  events: 'Fiestas',
  alerts: 'Alertas',
  claims: 'Reclamos',
  messaging: 'Mensajería',
  news: 'Revista',
  reports: 'Reportes',
  surveys: 'Encuestas',
  migration: 'Migración',
};

const MEMBER_NAV = [
  { id: 'home', label: 'Inicio', path: '/' },
  { id: 'reservas', label: 'Reservar canchas', path: '/reservas' },
  { id: 'cuenta', label: 'Mi cuenta', path: '/cuenta' },
  { id: 'revista', label: 'Revista digital', path: '/revista' },
  { id: 'mensajes', label: 'Mensajes', path: '/mensajes' },
  { id: 'perfil', label: 'Mi perfil', path: '/perfil' },
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function SessionStatusBar({ members = [], staffMembers = [] }) {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const now = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const isOperative = canAccessAdmin(role);
  const tabs = allowedAdminTabs(role);

  const results = useMemo(() => {
    const q = normalize(query);
    if (q.length < 2) return [];

    const items = [];

    if (isOperative) {
      tabs.forEach((key) => {
        const label = SECTION_LABELS[key];
        if (!label) return;
        if (normalize(label).includes(q) || normalize(key).includes(q)) {
          items.push({
            id: `section-${key}`,
            kind: 'section',
            title: label,
            subtitle: 'Ir al panel',
            path: `/panel/${key}`,
          });
        }
      });

      if (tabs.includes('members')) {
        members.slice(0, 400).forEach((m) => {
          const hay = normalize([
            m.name,
            m.memberId,
            m.documentNumber,
            m.email,
            m.phone,
          ].join(' '));
          if (!hay.includes(q)) return;
          items.push({
            id: `member-${m.memberId}`,
            kind: 'member',
            title: m.name,
            subtitle: `Socio · ${m.memberId || '—'}`,
            path: `/panel/members/${m.memberId}`,
          });
        });
      }

      if (tabs.includes('staff')) {
        staffMembers.slice(0, 200).forEach((s) => {
          const hay = normalize([s.name, s.role, s.area, s.email, s.phone, s.id].join(' '));
          if (!hay.includes(q)) return;
          items.push({
            id: `staff-${s.id}`,
            kind: 'staff',
            title: s.name || 'Personal',
            subtitle: `Personal · ${s.role || s.area || s.id}`,
            path: `/panel/staff/${s.id}`,
          });
        });
      }
    } else {
      MEMBER_NAV.forEach((item) => {
        if (normalize(item.label).includes(q)) {
          items.push({
            id: `nav-${item.id}`,
            kind: 'section',
            title: item.label,
            subtitle: 'Ir a',
            path: item.path,
          });
        }
      });
    }

    return items.slice(0, 8);
  }, [query, isOperative, tabs, members, staffMembers]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const go = (item) => {
    if (!item) return;
    setQuery('');
    setOpen(false);
    navigate(item.path);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter') && results.length) {
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[activeIndex]);
    }
  };

  const iconFor = (kind) => {
    if (kind === 'member') return <User size={14} aria-hidden="true" />;
    if (kind === 'staff') return <Users size={14} aria-hidden="true" />;
    return <LayoutDashboard size={14} aria-hidden="true" />;
  };

  return (
    <div className="session-status-bar" ref={rootRef}>
      <span className="session-status-bar__meta">
        <ShieldCheck size={13} className="session-status-bar__shield" aria-hidden="true" />
        Sesión:{' '}
        <strong>{user?.fullName}</strong>
        <span> · {ROLE_LABELS[role] || role}</span>
      </span>

      <div className="session-status-bar__search" role="search">
        <Search size={14} className="session-status-bar__search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          name="global-search"
          autoComplete="off"
          spellCheck={false}
          placeholder={isOperative ? 'Buscar socio, personal o sección…' : 'Buscar en el portal…'}
          aria-label="Buscador global"
          aria-expanded={open && results.length > 0}
          aria-controls="session-search-results"
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="session-status-bar__clear"
            aria-label="Limpiar búsqueda"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="session-status-bar__kbd" aria-hidden="true">Ctrl K</kbd>
        )}

        {open && query.trim().length >= 2 && (
          <ul
            id="session-search-results"
            className="session-status-bar__results"
            role="listbox"
          >
            {results.length === 0 ? (
              <li className="session-status-bar__empty" role="option" aria-disabled="true">
                Sin resultados para “{query.trim()}”
              </li>
            ) : (
              results.map((item, idx) => (
                <li key={item.id} role="option" aria-selected={idx === activeIndex}>
                  <button
                    type="button"
                    className={`session-status-bar__result${idx === activeIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => go(item)}
                  >
                    <span className="session-status-bar__result-icon">{iconFor(item.kind)}</span>
                    <span className="session-status-bar__result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <span className="session-status-bar__seat">Sede Rivadavia · {now}</span>
    </div>
  );
}
