import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Pure decision used by the router blocker.
 * @param {boolean} isDirty
 * @param {{currentLocation?: {pathname?: string, search?: string}, nextLocation?: {pathname?: string, search?: string}}} transition
 * @returns {boolean} true when leaving would discard unsaved changes
 */
export const shouldBlockNavigation = (isDirty, transition = {}) => {
  if (!isDirty) return false;
  const { currentLocation, nextLocation } = transition;
  if (!nextLocation) return false;
  return (
    currentLocation?.pathname !== nextLocation.pathname ||
    (currentLocation?.search ?? '') !== (nextLocation.search ?? '')
  );
};

/**
 * Adds/removes the browser "Leave site?" prompt for tab close and reload.
 * @param {boolean} active
 * @param {Window|undefined} [win]
 * @returns {() => void} cleanup
 */
export const attachBeforeUnload = (
  active,
  win = typeof window === 'undefined' ? undefined : window
) => {
  if (!active || typeof win?.addEventListener !== 'function') return () => {};
  const handler = (event) => {
    event.preventDefault();
    // Required by Chrome/Edge to show the native prompt.
    event.returnValue = '';
    return '';
  };
  win.addEventListener('beforeunload', handler);
  return () => win.removeEventListener('beforeunload', handler);
};

/**
 * Shared state machine for "discard unsaved changes?" confirmations.
 * @param {boolean} isDirty
 */
const useDiscardState = (isDirty) => {
  const dirtyRef = useRef(Boolean(isDirty));
  // Event handlers and the router blocker read the committed value; refs are
  // written after render, not during it.
  useLayoutEffect(() => {
    dirtyRef.current = Boolean(isDirty);
  }, [isDirty]);
  const [pendingAction, setPendingAction] = useState(null);

  /** Runs `action` now when clean, otherwise after the user confirms. */
  const runGuarded = useCallback((action) => {
    if (typeof action !== 'function') return;
    if (dirtyRef.current) {
      setPendingAction(() => action);
    } else {
      action();
    }
  }, []);

  return { dirtyRef, pendingAction, setPendingAction, runGuarded };
};

/**
 * Guard for in-page discards only (modals, wizards, "Refresh" buttons).
 * Does not register a router blocker, so it can be used inside a page that
 * already has `useUnsavedChangesGuard`.
 *
 *   const discard = useDiscardGuard(formChanged);
 *   <Modal.Root open onOpenChange={(open) => !open && discard.runGuarded(onClose)}>
 *   <UnsavedChangesDialog guard={discard} />
 *
 * @param {boolean} isDirty
 */
export const useDiscardGuard = (isDirty) => {
  const { pendingAction, setPendingAction, runGuarded } = useDiscardState(isDirty);

  const confirm = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    if (action) action();
  }, [pendingAction, setPendingAction]);

  const cancel = useCallback(() => setPendingAction(null), [setPendingAction]);

  return { isDirty: Boolean(isDirty), isOpen: pendingAction !== null, confirm, cancel, runGuarded };
};

/**
 * Page-level guard: blocks in-app navigation (tabs, links, back button) and
 * tab close/reload while `isDirty` is true, and offers `runGuarded` for
 * in-page discards. Use at most ONE per mounted page (react-router supports a
 * single active blocker); use `useDiscardGuard` for nested modals.
 *
 *   const guard = useUnsavedChangesGuard(hasChanges);
 *   ...
 *   <TertiaryButton onClick={() => guard.runGuarded(fetchSettings)}>Refresh</TertiaryButton>
 *   <UnsavedChangesDialog guard={guard} />
 *
 * After a successful save, navigate with `guard.bypass(() => navigate(path))`
 * so the still-dirty render does not block the redirect.
 *
 * @param {boolean} isDirty
 */
export const useUnsavedChangesGuard = (isDirty) => {
  const { dirtyRef, pendingAction, setPendingAction, runGuarded } = useDiscardState(isDirty);
  const bypassRef = useRef(false);

  const blocker = useBlocker(
    useCallback(
      (transition) => !bypassRef.current && shouldBlockNavigation(dirtyRef.current, transition),
      [dirtyRef]
    )
  );

  useEffect(() => attachBeforeUnload(Boolean(isDirty)), [isDirty]);

  // If the page became clean while a navigation was blocked, let it through.
  useEffect(() => {
    if (blocker.state === 'blocked' && !isDirty) blocker.proceed();
  }, [blocker, isDirty]);

  const confirm = useCallback(() => {
    if (blocker.state === 'blocked') blocker.proceed();
    const action = pendingAction;
    setPendingAction(null);
    if (action) action();
  }, [blocker, pendingAction, setPendingAction]);

  const cancel = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset();
    setPendingAction(null);
  }, [blocker, setPendingAction]);

  /** Runs `action` (e.g. navigate after save) without the guard. */
  const bypass = useCallback((action) => {
    bypassRef.current = true;
    try {
      return action();
    } finally {
      bypassRef.current = false;
    }
  }, []);

  return {
    isDirty: Boolean(isDirty),
    isOpen: blocker.state === 'blocked' || pendingAction !== null,
    confirm,
    cancel,
    runGuarded,
    bypass,
  };
};

export default useUnsavedChangesGuard;
