import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, User, Users, LayoutDashboard, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  ROLE_LABELS,
  allowedAccountingSubtabs,
  allowedAdminTabs,
  canAccessAdmin,
} from '../domain/auth/roles';
import { searchSession } from '../domain/nav/sessionSearch';

const MEMBER_NAV = [
  { id: 'home', label: 'Inicio', path: '/' },
  { id: 'reservas', label: 'Reservar canchas', path: '/reservas' },
  { id: 'cuenta', label: 'Mi cuenta', path: '/cuenta' },
  { id: 'revista', label: 'Novedades', path: '/revista' },
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

    if (isOperative) {
      return searchSession({
        query,
        tabs,
        accountingTabs: allowedAccountingSubtabs(role),
        members,
        staffMembers,
      });
    }

    const words = q.split(/\s+/).filter((token) => token.length >= 2);
    return MEMBER_NAV.filter((item) => words.some((token) => normalize(item.label).includes(token))).map((item) => ({
      id: `nav-${item.id}`,
      kind: 'section',
      title: item.label,
      subtitle: 'Ir a',
      path: item.path,
    }));
  }, [query, isOperative, tabs, role, members, staffMembers]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const focusSearch = () => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
    setOpen(true);
  };

  const isEditableTarget = (target) => {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.('input, textarea, select, [contenteditable="true"]'));
  };

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      // Chrome/Edge se quedan con Ctrl+K (omnibox). Usamos Ctrl+/ y ⌘K; `/` si no estás escribiendo.
      const modK = (e.metaKey || e.ctrlKey) && e.code === 'KeyK';
      const ctrlSlash = e.ctrlKey && (e.key === '/' || e.code === 'Slash');
      const plainSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target);
      if (!modK && !ctrlSlash && !plainSlash) return;
      e.preventDefault();
      e.stopPropagation();
      focusSearch();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const shortcutHint = useMemo(() => {
    if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')) {
      return '⌘K';
    }
    return 'Ctrl /';
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
          placeholder={isOperative ? 'Buscar sección, herramienta o socio…' : 'Buscar en el portal…'}
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
          <button
            type="button"
            className="session-status-bar__kbd"
            title={`Atajo: ${shortcutHint} (también /)`}
            aria-label={`Enfocar buscador (${shortcutHint})`}
            onClick={focusSearch}
          >
            {shortcutHint}
          </button>
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
