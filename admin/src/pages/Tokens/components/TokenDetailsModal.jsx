import { Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { Check, Clock, Cross, Earth, Lock, Plus, Trash } from '@strapi/icons';
import { SubsectionHeading } from '../../../components/shared/Headings';
import { useFormatters } from '../../../hooks/useFormatters';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useReturnFocus } from '../../../hooks/useReturnFocus';
import { accent, brand } from '../../../utils/theme';
import { getTokenActions, getTokenReference, isPast, toUserContext } from '../tokenModel';
import { TokenStatusBadge } from './TokenStatus';
import {
  CodeBlock,
  HeroCloseButton,
  HeroSubtitle,
  InfoList,
  MetaIcon,
  ModalHero,
  Panel,
  ReferenceChip,
} from './tokenStyles';

/**
 * Token details (DS Modal: focus trap, Escape, title announcement). The
 * actions open confirmation dialogs in the parent; the modal closes only
 * after an action succeeded.
 *
 * @param {object} props
 * @param {object|null} props.token
 * @param {boolean} props.canManage
 * @param {() => void} props.onClose
 * @param {(token: object) => void} props.onReissue
 * @param {(token: object) => void} props.onExtend
 * @param {(token: object) => void} props.onBlock
 * @param {(token: object) => void} props.onActivate
 * @param {(token: object) => void} props.onDelete
 */
export const TokenDetailsModal = ({
  token,
  canManage,
  onClose,
  onReissue,
  onExtend,
  onBlock,
  onActivate,
  onDelete,
}) => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();
  const isOpen = Boolean(token);
  const returnFocus = useReturnFocus(isOpen);

  if (!token) return null;

  const { state, canExtend, canBlock, canActivate, canReissue } = getTokenActions(token);
  const context = token.context && typeof token.context === 'object' ? token.context : {};
  const hasContext = Object.keys(context).length > 0;
  const showLastUsed = token.last_used_at && token.last_used_at !== token.used_at;

  return (
    <Modal.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content style={{ maxWidth: '60rem' }} onCloseAutoFocus={returnFocus}>
        <ModalHero $background={brand.violetGradient}>
          <Box minWidth={0}>
            <Modal.Title>{t('tokens.details.title', 'Token Details')}</Modal.Title>
            <HeroSubtitle>{token.email}</HeroSubtitle>
          </Box>
          <Modal.Close>
            <HeroCloseButton type="button" aria-label={t('common.close', 'Close')}>
              <Cross aria-hidden="true" focusable="false" />
            </HeroCloseButton>
          </Modal.Close>
        </ModalHero>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            <Flex alignItems="center" gap={3} wrap="wrap">
              <Typography variant="sigma" textColor="neutral600">
                {t('tokens.details.reference', 'Reference')}
              </Typography>
              <ReferenceChip>#{getTokenReference(token)}</ReferenceChip>
            </Flex>

            <InfoList>
              <div>
                <dt>{t('tokens.details.status', 'Status')}</dt>
                <dd>
                  <TokenStatusBadge state={state} />
                </dd>
              </div>
              <div>
                <dt>{t('tokens.details.created', 'Created')}</dt>
                <dd>{formatDateTime(token.createdAt)}</dd>
              </div>
              <div>
                <dt>{t('tokens.details.expiresAt', 'Valid until')}</dt>
                <dd>
                  {token.expires_at ? (
                    <Typography
                      variant="omega"
                      fontWeight="semiBold"
                      textColor={isPast(token.expires_at) ? 'danger600' : 'neutral800'}
                    >
                      {formatDateTime(token.expires_at)}
                    </Typography>
                  ) : (
                    t('tokens.details.unlimited', 'Unlimited')
                  )}
                </dd>
              </div>
              {token.used_at ? (
                <div>
                  <dt>{t('tokens.details.usedAt', 'Used')}</dt>
                  <dd>
                    <Flex alignItems="center" gap={2} tag="span">
                      <MetaIcon $accent={accent.success} aria-hidden="true">
                        <Check focusable="false" />
                      </MetaIcon>
                      {formatDateTime(token.used_at)}
                    </Flex>
                  </dd>
                </div>
              ) : null}
              {showLastUsed ? (
                <div>
                  <dt>{t('tokens.details.lastUsedAt', 'Last used')}</dt>
                  <dd>{formatDateTime(token.last_used_at)}</dd>
                </div>
              ) : null}
            </InfoList>

            {token.ip_address || token.user_agent ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <SubsectionHeading>
                  {t('tokens.details.technicalInfo', 'Technical Information')}
                </SubsectionHeading>
                <Panel>
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    {token.ip_address ? (
                      <Flex alignItems="center" gap={2}>
                        <MetaIcon aria-hidden="true">
                          <Earth focusable="false" />
                        </MetaIcon>
                        <Typography variant="pi" textColor="neutral800" style={{ fontFamily: 'monospace' }}>
                          {token.ip_address}
                        </Typography>
                      </Flex>
                    ) : null}
                    {token.user_agent ? (
                      <Typography variant="pi" textColor="neutral600" style={{ wordBreak: 'break-all' }}>
                        {token.user_agent}
                      </Typography>
                    ) : null}
                  </Flex>
                </Panel>
              </Flex>
            ) : null}

            {hasContext ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <SubsectionHeading>{t('tokens.details.context', 'Context Data')}</SubsectionHeading>
                <CodeBlock>{JSON.stringify(context, null, 2)}</CodeBlock>
              </Flex>
            ) : null}

            {canManage ? (
              <Flex direction="column" alignItems="stretch" gap={3}>
                <SubsectionHeading>{t('tokens.details.actions', 'Actions')}</SubsectionHeading>
                <Flex gap={2} wrap="wrap">
                  {canReissue ? (
                    <Button
                      variant="success-light"
                      size="M"
                      startIcon={<Plus />}
                      onClick={() => onReissue({ ...token, context: toUserContext(context) })}
                    >
                      {t('tokens.actions.reactivate', 'New Token')}
                    </Button>
                  ) : null}
                  {canExtend ? (
                    <Button variant="secondary" size="M" startIcon={<Clock />} onClick={() => onExtend(token)}>
                      {t('tokens.actions.extend', 'Extend')}
                    </Button>
                  ) : null}
                  {canBlock ? (
                    <Button variant="danger-light" size="M" startIcon={<Lock />} onClick={() => onBlock(token)}>
                      {t('tokens.actions.block', 'Block')}
                    </Button>
                  ) : null}
                  {canActivate ? (
                    <Button variant="success-light" size="M" startIcon={<Check />} onClick={() => onActivate(token)}>
                      {t('tokens.actions.activate', 'Activate')}
                    </Button>
                  ) : null}
                  <Button variant="danger-light" size="M" startIcon={<Trash />} onClick={() => onDelete(token)}>
                    {t('tokens.actions.delete', 'Delete')}
                  </Button>
                </Flex>
              </Flex>
            ) : null}
          </Flex>
        </Modal.Body>

        <Modal.Footer justifyContent="flex-end">
          <Modal.Close>
            <Button variant="tertiary" size="M">
              {t('common.close', 'Close')}
            </Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default TokenDetailsModal;
