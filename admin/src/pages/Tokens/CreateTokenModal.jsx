import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  Flex,
  Modal,
  NumberInput,
  TextInput,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { Sparkle } from '@strapi/icons';
import { UnsavedChangesDialog } from '../../components/shared/UnsavedChangesDialog';
import { useDiscardGuard } from '../../hooks/useUnsavedChangesGuard';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useReturnFocus } from '../../hooks/useReturnFocus';
import { GradientButton, Panel } from './components/tokenStyles';
import { TTL_LIMITS, validateCreateForm } from './tokenModel';

const initialForm = (ttl) => ({ email: '', ttl, contextText: '', sendEmail: true });

/**
 * Create-token dialog. It hands the complete payload to the parent, which
 * posts it and closes the dialog only after the request succeeded.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {number} props.defaultTtl - hours
 * @param {() => void} props.onClose
 * @param {(payload: {email: string, ttl: number, context: object, sendEmail: boolean}) => Promise<unknown>} props.onSubmit
 */
const CreateTokenModal = ({ isOpen, defaultTtl, onClose, onSubmit }) => {
  const { t } = useMagicLinkIntl();
  const [form, setForm] = useState(() => initialForm(defaultTtl));
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const returnFocus = useReturnFocus(isOpen);

  // Reset the form whenever the dialog opens or the default TTL changes while
  // it is open. Adjusting state during render avoids an extra effect pass
  // (https://react.dev/learn/you-might-not-need-an-effect).
  const [resetKey, setResetKey] = useState(null);
  const nextResetKey = isOpen ? `open:${defaultTtl}` : null;
  if (resetKey !== nextResetKey) {
    setResetKey(nextResetKey);
    if (isOpen) {
      setForm(initialForm(defaultTtl));
      setSubmitted(false);
      setIsSubmitting(false);
    }
  }

  const isDirty =
    isOpen &&
    (form.email.trim() !== '' ||
      form.contextText.trim() !== '' ||
      form.ttl !== defaultTtl ||
      form.sendEmail !== true);
  const discard = useDiscardGuard(isDirty && !isSubmitting);

  const validation = useMemo(() => validateCreateForm(form), [form]);
  const { errors } = validation;
  const hasErrors = Object.keys(errors).length > 0;

  const update = (field) => (value) => setForm((previous) => ({ ...previous, [field]: value }));

  let emailError;
  if (submitted && errors.email === 'required') {
    emailError = t('tokens.create.email.required', 'Enter an email address.');
  } else if (submitted && errors.email === 'format') {
    emailError = t('tokens.create.email.invalid', 'Enter a valid email address.');
  }

  const ttlError = errors.ttl
    ? t('tokens.create.ttl.error', 'Enter a whole number of hours from {min} to {max}.', TTL_LIMITS)
    : undefined;

  let contextError;
  if (errors.context === 'reserved') {
    contextError = t(
      'tokens.create.context.reserved',
      'These keys are reserved for the server: {keys}',
      {
        keys: validation.reservedKeys.join(', '),
      }
    );
  } else if (errors.context === 'object') {
    contextError = t('tokens.create.context.object', 'The context must be a JSON object.');
  } else if (errors.context === 'json') {
    contextError = t('tokens.create.context.error', 'Invalid JSON format');
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        email: form.email.trim(),
        ttl: form.ttl,
        context: validation.context,
        sendEmail: form.sendEmail,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestClose = () => {
    if (isSubmitting) return;
    discard.runGuarded(onClose);
  };

  return (
    <>
      <Modal.Root open={isOpen} onOpenChange={(open) => !open && requestClose()}>
        <Modal.Content style={{ maxWidth: '60rem' }} onCloseAutoFocus={returnFocus}>
          <Modal.Header closeLabel={t('common.close', 'Close')}>
            <Modal.Title>{t('tokens.create.title', 'Create Magic Link Token')}</Modal.Title>
          </Modal.Header>
          <form onSubmit={handleSubmit} autoComplete="off" noValidate>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={6}>
                <Field.Root
                  name="create-token-email"
                  required
                  error={emailError}
                  hint={t(
                    'tokens.create.email.hint',
                    'The login link is created for this email address.'
                  )}
                >
                  <Field.Label>{t('tokens.create.email.label', 'Email address')}</Field.Label>
                  <TextInput
                    type="email"
                    autoComplete="off"
                    placeholder={t('tokens.create.email.placeholder', 'user@example.com')}
                    value={form.email}
                    onChange={(event) => update('email')(event.target.value)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>

                <Field.Root
                  name="create-token-ttl"
                  required
                  error={ttlError}
                  hint={t(
                    'tokens.create.ttl.hint',
                    'How long the link stays valid ({min} to {max} hours).',
                    TTL_LIMITS
                  )}
                >
                  <Field.Label>
                    {t('tokens.create.ttl.label', 'Validity Period (Hours)')}
                  </Field.Label>
                  <NumberInput
                    value={form.ttl}
                    onValueChange={(value) => update('ttl')(value)}
                    step={1}
                    min={TTL_LIMITS.min}
                    max={TTL_LIMITS.max}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>

                <Field.Root
                  name="create-token-context"
                  error={contextError}
                  hint={t(
                    'tokens.create.context.hint',
                    'Optional JSON object passed with the token, for example a redirect path.'
                  )}
                >
                  <Field.Label>
                    {t('tokens.create.context.label', 'JSON Context (Optional)')}
                  </Field.Label>
                  <Textarea
                    placeholder={t('tokens.create.context.placeholder', '\'{ "key": "value" }\'')}
                    value={form.contextText}
                    onChange={(event) => update('contextText')(event.target.value)}
                    style={{ fontFamily: 'monospace', minHeight: '100px' }}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>

                <Panel>
                  <Flex direction="column" alignItems="stretch" gap={1}>
                    <Checkbox
                      name="create-token-send-email"
                      checked={form.sendEmail}
                      onCheckedChange={(checked) => update('sendEmail')(checked === true)}
                      aria-describedby="create-token-send-email-hint"
                    >
                      {t('tokens.create.sendEmail.label', 'Send the login link by email')}
                    </Checkbox>
                    <Typography
                      variant="pi"
                      textColor="neutral600"
                      id="create-token-send-email-hint"
                    >
                      {form.sendEmail
                        ? t(
                            'tokens.create.sendEmail.hint',
                            'The user receives an email with the login link right away.'
                          )
                        : t(
                            'tokens.create.sendEmail.off',
                            'No email is sent. The token is shown once after creation so you can share it yourself.'
                          )}
                    </Typography>
                  </Flex>
                </Panel>
              </Flex>
            </Modal.Body>
            <Modal.Footer justifyContent="flex-end" gap={2}>
              <Button
                type="button"
                variant="tertiary"
                size="L"
                onClick={requestClose}
                disabled={isSubmitting}
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <GradientButton
                type="submit"
                disabled={isSubmitting || (submitted && hasErrors)}
                aria-busy={isSubmitting ? 'true' : undefined}
              >
                <Sparkle aria-hidden="true" focusable="false" />
                {isSubmitting
                  ? t('tokens.create.submitting', 'Creating...')
                  : t('tokens.create.submit', 'Create Token')}
              </GradientButton>
            </Modal.Footer>
          </form>
        </Modal.Content>
      </Modal.Root>
      <UnsavedChangesDialog guard={discard} />
    </>
  );
};

export default CreateTokenModal;
