import { useCallback, useState } from 'react';
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
  defaultOpen = true,
  storageKey,
  forceOpen = false,
  extra = null,
  className = '',
  children,
}) {
  const [open, toggle] = usePersistedFold(storageKey, defaultOpen);
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
          <div>
            <h3 id={id}>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <ChevronDown size={18} className={`foldable-block-chevron${open ? ' is-open' : ''}`} aria-hidden />
        </button>
        {visible ? extra : null}
      </header>
      {visible ? (
        <div id={bodyId} className="foldable-block-body">
          {children}
        </div>
      ) : null}
    </Tag>
  );
}
