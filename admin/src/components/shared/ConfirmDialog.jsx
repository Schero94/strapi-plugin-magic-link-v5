import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Flex, Typography } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import styled from 'styled-components';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useReturnFocus } from '../../hooks/useReturnFocus';
import { accent } from '../../utils/theme';

const WarningIcon = styled(WarningCircle)`
  width: 24px;
  height: 24px;

  path {
    fill: ${(p) => (p.$danger ? accent.danger(p) : accent.warning(p))};
  }
`;

/**
 * Accessible confirmation dialog (DS 2 alert dialog). Replaces
 * window.confirm(): it follows dark mode, is translated, traps focus, closes
 * on Escape and announces its title and description to screen readers.
 *
 *   <ConfirmDialog
 *     isOpen={pendingDelete !== null}
 *     title={t('tokens.delete.title', 'Delete token?')}
 *     description={t('tokens.delete.body', 'The login link for {email} stops working.', { email })}
 *     confirmLabel={t('common.delete', 'Delete')}
 *     onConfirm={async () => { await deleteToken(pendingDelete); setPendingDelete(null); }}
 *     onClose={() => setPendingDelete(null)}
 *   />
 *
 * While the promise returned by onConfirm is pending, both buttons are
 * disabled, the confirm button shows a spinner, and Escape and overlay clicks
 * do not close the dialog. Errors thrown by onConfirm are swallowed, so the
 * handler itself must show the error notification.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose - Cancel, Escape and overlay click
 * @param {() => (void|Promise<unknown>)} props.onConfirm
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description] - main sentence (dialog description)
 * @param {import('react').ReactNode} [props.children] - extra body content; a string renders as helper text
 * @param {string} [props.confirmLabel]
 * @param {string} [props.cancelLabel]
 * @param {'danger'|'default'} [props.variant='danger']
 * @param {boolean} [props.isLoading]
 * @param {import('react').ReactElement} [props.confirmIcon]
 * @param {() => (HTMLElement|null|undefined)} [props.getReturnFocusFallback] - focus target
 *   when the element that opened the dialog is gone (for example a deleted row)
 */
export const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  isLoading = false,
  confirmIcon,
  getReturnFocusFallback,
}) => {
  const { t } = useMagicLinkIntl();
  const [isPending, setIsPending] = useState(false);
  const mounted = useRef(true);
  const returnFocus = useReturnFocus(Boolean(isOpen), getReturnFocusFallback);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = isLoading || isPending;
  const danger = variant === 'danger';

  const handleConfirm = async () => {
    if (busy) return;
    const result = onConfirm?.();
    if (result && typeof result.then === 'function') {
      setIsPending(true);
      try {
        await result;
      } catch {
        // The caller reports errors; keep the dialog usable.
      } finally {
        if (mounted.current) setIsPending(false);
      }
    }
  };

  const handleOpenChange = (open) => {
    if (!open && !busy) onClose?.();
  };

  return (
    <Dialog.Root open={Boolean(isOpen)} onOpenChange={handleOpenChange}>
      <Dialog.Content onCloseAutoFocus={returnFocus}>
        <Dialog.Header textAlign="center">{title}</Dialog.Header>
        <Dialog.Body icon={<WarningIcon aria-hidden="true" $danger={danger} />}>
          <Flex direction="column" gap={2} width="100%" alignItems="stretch">
            {description ? (
              <Dialog.Description textAlign="center">{description}</Dialog.Description>
            ) : null}
            {typeof children === 'string' ? (
              <Typography variant="pi" textColor="neutral600" textAlign="center">
                {children}
              </Typography>
            ) : (
              children
            )}
          </Flex>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel>
            <Button variant="tertiary" fullWidth disabled={busy}>
              {cancelLabel ?? t('common.cancel', 'Cancel')}
            </Button>
          </Dialog.Cancel>
          <Button
            variant={danger ? 'danger' : 'default'}
            fullWidth
            onClick={handleConfirm}
            loading={busy}
            startIcon={busy ? undefined : confirmIcon}
          >
            {confirmLabel ??
              (danger ? t('common.delete', 'Delete') : t('common.confirm', 'Confirm'))}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default ConfirmDialog;
