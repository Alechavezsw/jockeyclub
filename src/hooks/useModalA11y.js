import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape to close, focus trap, restore focus, lock body scroll.
 */
export function useModalA11y({ open, onClose, containerRef }) {
  useEffect(() => {
    if (!open) return undefined;

    const node = containerRef.current;
    const previouslyFocused = document.activeElement;

    const focusables = () =>
      [...(node?.querySelectorAll(FOCUSABLE) || [])].filter(
        (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden="true"]'),
      );

    const items = focusables();
    (items[0] || node)?.focus?.();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !node) return;

      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }

      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose, containerRef]);
}
