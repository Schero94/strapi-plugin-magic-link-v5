import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns focus to the element that opened a dialog.
 *
 * Radix Dialog / AlertDialog (DS Modal and Dialog) only restore focus to a
 * `Dialog.Trigger`. Dialogs opened from state (row actions, wizard buttons)
 * have no trigger, so focus fell back to <body> on close.
 *
 * The opener is captured in a layout effect, which runs before the passive
 * mount effect in which Radix's FocusScope moves focus into the dialog.
 * Pass the returned handler as `onCloseAutoFocus` of `Modal.Content` or
 * `Dialog.Content`; it prevents Radix's default and focuses the opener, or
 * the fallback when the opener is gone (for example a deleted table row).
 *
 * @param {boolean} isOpen
 * @param {() => (HTMLElement|null|undefined)} [getFallback] - element to focus when the opener left the DOM
 * @returns {(event: Event) => void} onCloseAutoFocus handler
 */
export const useReturnFocus = (isOpen, getFallback) => {
  const openerRef = useRef(null);
  const fallbackRef = useRef(getFallback);

  useLayoutEffect(() => {
    fallbackRef.current = getFallback;
  }, [getFallback]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const active = document.activeElement;
    const opener = active && active !== document.body ? active : null;
    openerRef.current = opener;
    // A dialog that unmounts together with its owner (conditional rendering)
    // never calls onCloseAutoFocus. When focus is left on <body> after the
    // close, restore it here; otherwise onCloseAutoFocus already did.
    return () => {
      window.setTimeout(() => {
        const current = document.activeElement;
        if (current && current !== document.body) return;
        const target = opener?.isConnected ? opener : fallbackRef.current?.();
        target?.focus?.();
      }, 0);
    };
  }, [isOpen]);

  return useCallback((event) => {
    const opener = openerRef.current;
    openerRef.current = null;
    const target = opener?.isConnected ? opener : fallbackRef.current?.();
    if (!target || typeof target.focus !== 'function') return;
    event.preventDefault();
    target.focus();
  }, []);
};

export default useReturnFocus;
