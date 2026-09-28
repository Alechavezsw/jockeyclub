import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FOLD_STORAGE_KEY = 'padronFold:v1';

function readFolds() {
  try {
    const raw = localStorage.getItem(FOLD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeFolds(next) {
  try {
    localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

function usePersistedFold(storageKey, defaultOpen) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    const stored = readFolds()[storageKey];
    return typeof stored === 'boolean' ? stored : defaultOpen;
  });

  const toggle = useCallback(() => {
    setOpen((cur) => {
      const next = !cur;
      if (storageKey) writeFolds({ ...readFolds(), [storageKey]: next });
      return next;
    });
  }, [storageKey]);

  return [open, toggle, setOpen];
}

export default function FoldableSection({
  as: Tag = 'section',
  id,
  title,
  subtitle,
  count,
  defaultOpen = true,
  storageKey,
  openToken = 0,
  forceOpen = false,
  extra = null,
  className = '',
  children,
}) {
  const [open, toggle, setOpen] = usePersistedFold(storageKey, defaultOpen);
  useEffect(() => {
    if (!openToken) return;
    setOpen(true);
  }, [openToken, setOpen]);
  const visible = forceOpen || open;

  const bodyId = id ? `${id}-body` : undefined;

  return (
    <Tag className={`foldable-block${visible ? ' is-open' : ' is-folded'}${className ? ` ${className}` : ''}`} aria-labelledby={id}>
      <header className="foldable-block-head">
        <button
          type="button"
          className="foldable-block-toggle"
          aria-expanded={visible}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <i className="due-fold-arrow" aria-hidden="true">
            <ChevronDown size={18} strokeWidth={2.5} />
          </i>
          <span className="foldable-block-copy">
            <h3 id={id}>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </span>
          {count != null && count !== '' ? <b className="tabular-nums">{count}</b> : null}
        </button>
      </header>
      {visible ? (
        <div id={bodyId} className="foldable-block-body">
          {extra ? <div className="foldable-block-extra">{extra}</div> : null}
          {children}
        </div>
      ) : null}
    </Tag>
  );
}
