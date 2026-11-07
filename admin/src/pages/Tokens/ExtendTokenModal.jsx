import { useState } from 'react';
import styled from 'styled-components';
import { Box, Button, Field, Flex, Modal, NumberInput, Typography } from '@strapi/design-system';
import { Check, Clock } from '@strapi/icons';
import { useFormatters } from '../../hooks/useFormatters';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useReturnFocus } from '../../hooks/useReturnFocus';
import { space } from '../../utils/theme';
import { InfoList } from './components/tokenStyles';
import {
  EXTEND_LIMITS,
  EXTEND_PRESETS,
  computeExtendedExpiry,
  isIntegerInRange,
} from './tokenModel';

/** 2 x 2 preset grid with equal button widths. */
const PresetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space(2)};

  & > button {
    width: 100%;
  }
`;

/**
 * Extend-token dialog: presets (+1/7/30/90 days) or a custom whole number of
 * days within EXTEND_LIMITS. The preview mirrors the server: an expired
 * token is extended from now.
 *
 * @param {object} props
 * @param {object|null} props.token - the token to extend; null closes the dialog
 * @param {() => void} props.onClose
 * @param {(token: object, days: number) => Promise<unknown>} props.onSubmit
 */
const ExtendTokenModal = ({ token, onClose, onSubmit }) => {
  const { t } = useMagicLinkIntl();
  const { formatDateTime } = useFormatters();
  const isOpen = Boolean(token);
  const returnFocus = useReturnFocus(isOpen);
  const [preset, setPreset] = useState(7);
  const [customDays, setCustomDays] = useState(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset the choice for every token the dialog opens with. Adjusting state
  // during render avoids an extra effect pass
  // (https://react.dev/learn/you-might-not-need-an-effect).
  const [shownToken, setShownToken] = useState(null);
  if (shownToken !== token) {
    setShownToken(token);
    if (token) {
      setPreset(7);
      setCustomDays(undefined);
      setIsSubmitting(false);
    }
  }

  if (!token) return null;

  const isCustom = customDays !== undefined;
  const days = isCustom ? customDays : preset;
  const daysValid = isIntegerInRange(days, EXTEND_LIMITS);
  const customError =
    isCustom && !daysValid
      ? t(
          'tokens.extend.customError',
          'Enter a whole number of days from {min} to {max}.',
          EXTEND_LIMITS
        )
      : undefined;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!daysValid || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(token, days);
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal.Root open={isOpen} onOpenChange={(open) => !open && requestClose()}>
      <Modal.Content style={{ maxWidth: '48rem' }} onCloseAutoFocus={returnFocus}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Modal.Title>{t('tokens.extend.title', 'Extend Token')}</Modal.Title>
            <Typography variant="pi" textColor="neutral600" ellipsis>
              {token.email}
            </Typography>
          </Flex>
        </Modal.Header>
        <form onSubmit={handleSubmit} noValidate>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={6}>
              <InfoList>
                <div>
                  <dt>{t('tokens.extend.currentExpiry', 'Currently valid until')}</dt>
                  <dd>
                    {token.expires_at
                      ? formatDateTime(token.expires_at)
                      : t('tokens.details.unlimited', 'Unlimited')}
                  </dd>
                </div>
              </InfoList>

              <Flex
                direction="column"
                alignItems="stretch"
                gap={2}
                role="group"
                aria-labelledby="extend-presets-label"
              >
                <Typography
                  id="extend-presets-label"
                  variant="pi"
                  fontWeight="bold"
                  textColor="neutral800"
                >
                  {t('tokens.extend.selectExtension', 'Select extension')}
                </Typography>
                <PresetGrid>
                  {EXTEND_PRESETS.map((value) => {
                    const selected = !isCustom && preset === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        size="L"
                        variant={selected ? 'default' : 'tertiary'}
                        aria-pressed={selected}
                        onClick={() => {
                          setPreset(value);
                          setCustomDays(undefined);
                        }}
                      >
                        {t('tokens.extend.preset', '+{count, plural, one {# day} other {# days}}', {
                          count: value,
                        })}
                      </Button>
                    );
                  })}
                </PresetGrid>
              </Flex>

              <Field.Root
                name="extend-custom-days"
                error={customError}
                hint={t('tokens.extend.customHint', 'Or enter {min} to {max} days.', EXTEND_LIMITS)}
              >
                <Field.Label>{t('tokens.extend.customDays', 'Custom number of days')}</Field.Label>
                <NumberInput
                  placeholder={t('tokens.extend.customPlaceholder', 'e.g. 14')}
                  value={customDays}
                  step={1}
                  min={EXTEND_LIMITS.min}
                  max={EXTEND_LIMITS.max}
                  onValueChange={(value) => setCustomDays(value)}
                />
                <Field.Hint />
                <Field.Error />
              </Field.Root>

              <Box>
                <InfoList aria-live="polite">
                  <div>
                    <dt>
                      <Flex alignItems="center" gap={1} tag="span">
                        <Check aria-hidden="true" focusable="false" width="14px" height="14px" />
                        {t('tokens.extend.newExpiry', 'New expiry date')}
                      </Flex>
                    </dt>
                    <dd>
                      <Typography
                        variant="omega"
                        fontWeight="semiBold"
                        textColor={daysValid ? 'success600' : 'neutral600'}
                      >
                        {daysValid
                          ? formatDateTime(computeExtendedExpiry(token.expires_at, days))
                          : t('common.emptyValue', '-')}
                      </Typography>
                    </dd>
                  </div>
                </InfoList>
              </Box>
            </Flex>
          </Modal.Body>
          <Modal.Footer justifyContent="flex-end" gap={2}>
            <Button
              type="button"
              variant="tertiary"
              size="M"
              onClick={requestClose}
              disabled={isSubmitting}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              size="M"
              startIcon={<Clock />}
              loading={isSubmitting}
              disabled={!daysValid}
            >
              {t('tokens.extend.submit', 'Extend Token')}
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ExtendTokenModal;
