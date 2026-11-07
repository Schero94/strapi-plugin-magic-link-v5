import { Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Check, Duplicate, Link, WarningCircle } from '@strapi/icons';
import { SubsectionHeading } from '../../../components/shared/Headings';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { useFormatters } from '../../../hooks/useFormatters';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useReturnFocus } from '../../../hooks/useReturnFocus';
import { brand } from '../../../utils/theme';
import { Callout, CopyBox, HeroIcon, HeroSubtitle, InfoList, ModalHero } from './tokenStyles';

const preventClose = (event) => event.preventDefault();

/**
 * Shows the one-time plaintext token and its login link. Overlay clicks and
 * Escape are ignored so the only copy cannot be lost by accident; the dialog
 * closes only with the explicit "Done" button.
 *
 * @param {object} props
 * @param {{token: string, email: string, expiresAt?: string, loginUrl: string}|null} props.data
 * @param {() => void} props.onClose
 * @param {() => (HTMLElement|null|undefined)} [props.getReturnFocusFallback] - focus target
 *   when the element that opened the dialog is gone (the
 *   submit button of the closed create dialog)
 */
export const CreatedTokenModal = ({ data, onClose, getReturnFocusFallback }) => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();
  const copy = useCopyToClipboard();
  const isOpen = Boolean(data);
  const returnFocus = useReturnFocus(isOpen, getReturnFocusFallback);

  if (!data) return null;

  const copyToken = () =>
    copy(data.token, { success: t('tokens.notifications.tokenCopied', 'Token copied') });
  const copyLink = () =>
    copy(data.loginUrl, { success: t('tokens.notifications.linkCopied', 'Login link copied') });

  return (
    <Modal.Root open={isOpen}>
      <Modal.Content
        style={{ maxWidth: '60rem' }}
        onInteractOutside={preventClose}
        onEscapeKeyDown={preventClose}
        onCloseAutoFocus={returnFocus}
      >
        <ModalHero $background={brand.successGradient}>
          <Flex alignItems="center" gap={3} minWidth={0}>
            <HeroIcon aria-hidden="true">
              <Check focusable="false" />
            </HeroIcon>
            <Box minWidth={0}>
              <Modal.Title>{t('tokens.created.title', 'Token created')}</Modal.Title>
              <HeroSubtitle>{data.email}</HeroSubtitle>
            </Box>
          </Flex>
        </ModalHero>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            <Callout $tone="warning" role="note">
              <WarningCircle aria-hidden="true" focusable="false" />
              <span>
                {t(
                  'tokens.created.warning',
                  'This is the only time the full token is shown. Copy it now if you want to send it to the user yourself. After you close this dialog, only a masked reference is shown.'
                )}
              </span>
            </Callout>

            <Flex direction="column" alignItems="stretch" gap={2}>
              <SubsectionHeading id="created-token-label">
                {t('tokens.created.plaintextToken', 'Full token')}
              </SubsectionHeading>
              <CopyBox
                type="button"
                $tone="success"
                aria-labelledby="created-token-label created-token-hint"
                onClick={copyToken}
              >
                <span className="copy-value">{data.token}</span>
                <span className="copy-hint" id="created-token-hint">
                  <Duplicate aria-hidden="true" focusable="false" />
                  {t('tokens.details.clickToCopy', 'Click to copy')}
                </span>
              </CopyBox>
            </Flex>

            {data.loginUrl ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <SubsectionHeading id="created-link-label">
                  {t('tokens.details.magicLink', 'Magic Link URL')}
                </SubsectionHeading>
                <CopyBox
                  type="button"
                  $tone="primary"
                  aria-labelledby="created-link-label created-link-hint"
                  onClick={copyLink}
                >
                  <span className="copy-value">{data.loginUrl}</span>
                  <span className="copy-hint" id="created-link-hint">
                    <Duplicate aria-hidden="true" focusable="false" />
                    {t('tokens.details.clickToCopy', 'Click to copy')}
                  </span>
                </CopyBox>
              </Flex>
            ) : null}

            <InfoList>
              <div>
                <dt>{t('tokens.details.expiresAt', 'Valid until')}</dt>
                <dd>
                  {data.expiresAt
                    ? formatDateTime(data.expiresAt)
                    : t('tokens.details.unlimited', 'Unlimited')}
                </dd>
              </div>
            </InfoList>
            <Typography variant="pi" textColor="neutral600">
              {t(
                'tokens.created.closeHint',
                'Close this dialog with Done when you have copied what you need.'
              )}
            </Typography>
          </Flex>
        </Modal.Body>

        <Modal.Footer justifyContent="flex-end" gap={2}>
          {data.loginUrl ? (
            <Button variant="secondary" size="M" startIcon={<Link />} onClick={copyLink}>
              {t('tokens.created.copyLink', 'Copy Link')}
            </Button>
          ) : null}
          <Button variant="success" size="M" onClick={onClose}>
            {t('tokens.created.done', 'Done')}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default CreatedTokenModal;
