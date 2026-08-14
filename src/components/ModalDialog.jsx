import { useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

/**
 * Accessible modal shell: role=dialog, Escape, focus trap, overlay click to close.
 */
export default function ModalDialog({
  open = true,
  onClose,
  labelledBy,
  describedBy,
  overlayClassName = 'modal-overlay',
  contentClassName = 'modal-content glass-panel',
  contentStyle,
  children,
}) {
  const contentRef = useRef(null);
  useModalA11y({ open, onClose, containerRef: contentRef });

  if (!open) return null;

  return (
    <div
      className={overlayClassName}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={contentClassName}
        style={contentStyle}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
