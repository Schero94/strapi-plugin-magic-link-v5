import { useId, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  Badge,
  Flex,
  NumberInput,
  Radio,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import {
  CheckCircle,
  Information,
  Key,
  Lightning,
  Link as LinkIcon,
  Lock,
  Mail,
  WarningCircle,
} from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { ConfirmDialog } from '../../../components/shared/ConfirmDialog';
import { reducedMotion } from '../../../components/shared/motion';
import { accent, brand, byScheme, color, fontSize, space, theme } from '../../../utils/theme';
import {
  BulletList,
  CardGrid,
  FieldGrid,
  GroupTitle,
  IconBadge,
  Note,
  Panel,
  SectionBody,
  SettingField,
  StepList,
  ToggleCard,
} from '../components/SettingsUi';
import {
  AUTH_MODES,
  applyAuthMode,
  applyTotpPolicy,
  canRequireTotp,
  getAuthMode,
  resolveMfaMode,
} from '../utils/settingsForm';

const ModeCard = styled.button`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space(3)};
  height: 100%;
  min-width: 0;
  padding: ${space(6)} ${space(4)} ${space(4)};
  border-radius: ${theme.borderRadius.md};
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: ${(p) => (p.$active ? 'rgba(22, 163, 74, 0.08)' : 'rgba(128, 128, 128, 0.06)')};
  border: 2px solid ${(p) => (p.$active ? 'rgba(22, 163, 74, 0.5)' : color('neutral200')(p))};
  box-shadow: ${(p) => (p.$active ? '0 4px 12px rgba(34, 197, 94, 0.15)' : theme.shadows.sm)};
  transition:
    border-color ${theme.transitions.fast},
    box-shadow ${theme.transitions.fast},
    transform ${theme.transitions.fast};

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: ${(p) => (p.$active ? 'rgba(22, 163, 74, 0.7)' : color('neutral300')(p))};
  }

  &:focus-visible {
    outline: 2px solid ${byScheme(brand.primary, '#7DD3FC')};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
  }

  ${reducedMotion}
`;

const ModePill = styled.span`
  position: absolute;
  top: ${space(2)};
  right: ${space(2)};
  padding: 2px ${space(2)};
  border-radius: ${theme.borderRadius.sm};
  font-size: ${fontSize(0)};
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.6;
  background: ${(p) => (p.$active ? brand.success : color('neutral150')(p))};
  color: ${(p) => (p.$active ? brand.onFill : color('neutral700')(p))};
`;

const FeatureList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${space(1)};

  li {
    display: flex;
    gap: ${space(2)};
    align-items: center;
  }

  svg {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
  }

  svg path {
    fill: ${(p) => (typeof p.$accent === 'function' ? p.$accent(p) : p.$accent)};
  }
`;

const CardFooter = styled.div`
  margin-top: auto;
`;

/**
 * Login modes (magic link, + email code, + authenticator app), the
 * authenticator policy with lock-out protection, TOTP-only login and the
 * code settings.
 *
 * @param {object} props
 * @param {Record<string, any>} props.settings
 * @param {(key: string, value: unknown) => void} props.update
 * @param {(values: Record<string, unknown>) => void} props.patch
 * @param {boolean} props.disabled
 * @param {(key: string) => string|undefined} props.errorFor
 * @param {{status: 'loading'|'ready'|'unavailable', summary: {enrolled: number}|null}} props.enrollment
 * @param {'disabled'|'optional'|'required'} props.savedMfaMode - mode currently stored on the server
 * @param {string} props.statusOn
 * @param {string} props.statusOff
 */
export const MfaSection = ({
  settings,
  update,
  patch,
  disabled,
  errorFor,
  enrollment,
  savedMfaMode,
  statusOn,
  statusOff,
}) => {
  const { t } = useMagicLinkIntl();
  const id = useId();
  const cardRefs = useRef([]);
  const [confirmRequired, setConfirmRequired] = useState(false);
  const mode = getAuthMode(settings);
  const mfaMode = resolveMfaMode(settings);
  const requireCheck = canRequireTotp(enrollment.status === 'ready' ? enrollment.summary : null);
  const enrolled = enrollment.summary?.enrolled;

  const modes = {
    'magic-link': {
      icon: LinkIcon,
      accent: accent.primary,
      background: 'rgba(2, 132, 199, 0.12)',
      title: t('settings.mfa.mode.magicLink.title', 'Magic link only'),
      description: t(
        'settings.mfa.mode.magicLink.description',
        'One-click sign-in by email. Fast and easy to use.'
      ),
      features: [
        t('settings.mfa.mode.magicLink.feature1', 'No passwords'),
        t('settings.mfa.mode.magicLink.feature2', 'Fast sign-in'),
        t('settings.mfa.mode.magicLink.feature3', 'Works on every device'),
      ],
      badge: t('settings.mfa.mode.magicLink.badge', 'Fast'),
    },
    'email-otp': {
      icon: Mail,
      accent: accent.secondary,
      background: 'rgba(124, 58, 237, 0.1)',
      title: t('settings.mfa.mode.emailOtp.title', 'Magic link + email code'),
      description: t(
        'settings.mfa.mode.emailOtp.description',
        'After opening the link, users enter a one-time code sent by email.'
      ),
      features: [
        t('settings.mfa.mode.emailOtp.feature1', 'Code sent by email'),
        t('settings.mfa.mode.emailOtp.feature2', 'Configurable code length'),
        t('settings.mfa.mode.emailOtp.feature3', 'Configurable lifetime'),
      ],
      badge: t('settings.mfa.mode.emailOtp.badge', 'Stronger'),
    },
    totp: {
      icon: Lock,
      accent: accent.warning,
      background: 'rgba(217, 119, 6, 0.1)',
      title: t('settings.mfa.mode.totp.title', 'Magic link + authenticator app'),
      description: t(
        'settings.mfa.mode.totp.description',
        'After opening the link, users enter a code from an authenticator app such as Google Authenticator or Authy.'
      ),
      features: [
        t('settings.mfa.mode.totp.feature1', 'Authenticator app codes'),
        t('settings.mfa.mode.totp.feature2', 'Set up by QR code'),
        t('settings.mfa.mode.totp.feature3', 'Codes rotate every 30 seconds'),
      ],
      badge: t('settings.mfa.mode.totp.badge', 'Strongest'),
    },
  };

  const selectMode = (next) => {
    if (disabled || next === mode) return;
    patch(applyAuthMode(next, settings));
  };

  /** Arrow keys move the selection, as in a native radio group. */
  const handleKeyDown = (event, index) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let nextIndex = null;
    if (event.key in keys)
      nextIndex = (index + keys[event.key] + AUTH_MODES.length) % AUTH_MODES.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = AUTH_MODES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectMode(AUTH_MODES[nextIndex]);
    cardRefs.current[nextIndex]?.focus();
  };

  const handlePolicyChange = (value) => {
    if (disabled || value === mfaMode) return;
    if (value === 'required') {
      if (!requireCheck.allowed) return;
      setConfirmRequired(true);
      return;
    }
    patch(applyTotpPolicy('optional'));
  };

  const enrollmentText = (() => {
    if (enrollment.status === 'loading') {
      return t(
        'settings.mfa.enrollment.loading',
        'Checking how many users have set up an authenticator app...'
      );
    }
    if (enrollment.status !== 'ready') {
      return t(
        'settings.mfa.enrollment.unavailable',
        'The number of users with an authenticator app could not be determined.'
      );
    }
    if (enrolled === 0) {
      return t('settings.mfa.enrollment.none', 'No user has set up an authenticator app yet.');
    }
    return t(
      'settings.mfa.enrollment.count',
      '{count, plural, one {# user has} other {# users have}} set up an authenticator app.',
      { count: enrolled }
    );
  })();

  const savedLockout =
    savedMfaMode === 'required' && enrollment.status === 'ready' && enrolled === 0;
  const emailOtpSteps = [
    t('settings.mfa.otp.step1', 'The user opens the magic link from the email.'),
    t('settings.mfa.otp.step2', 'Your app shows the code entry page.'),
    t(
      'settings.mfa.otp.step3',
      'The user enters the {length}-digit code sent to their email address.',
      {
        length: settings.otp_length ?? 6,
      }
    ),
    t('settings.mfa.otp.step4', 'After a correct code, the user is signed in.'),
  ];

  const summary = [];
  if (mode === 'magic-link') {
    summary.push({
      icon: LinkIcon,
      text: t('settings.mfa.summary.magicLink', 'Users sign in with the magic link only.'),
    });
  }
  if (mode === 'email-otp') {
    summary.push({
      icon: Mail,
      text: t(
        'settings.mfa.summary.emailOtp',
        'Users open the magic link, then enter the code from the email.'
      ),
    });
  }
  if (mode === 'totp') {
    summary.push({
      icon: Lock,
      text:
        mfaMode === 'required'
          ? t(
              'settings.mfa.summary.totpRequired',
              'Users open the magic link, then enter a code from their authenticator app. Users without an app cannot sign in.'
            )
          : t(
              'settings.mfa.summary.totpOptional',
              'Users open the magic link. Users who set up an authenticator app must also enter its code.'
            ),
    });
  }
  if (settings.totp_as_primary_auth) {
    summary.push({
      icon: Lightning,
      text: t(
        'settings.mfa.summary.totpOnly',
        'Users with an authenticator app can also sign in with email and code, without waiting for an email.'
      ),
    });
  }

  return (
    <SectionBody>
      <Note tone="primary" icon={Information}>
        {t(
          'settings.mfa.intro',
          'Choose how users sign in. The selection takes effect when you save. Email codes and authenticator apps are separate modes.'
        )}
      </Note>

      {savedLockout ? (
        <Note
          tone="danger"
          icon={WarningCircle}
          role="alert"
          title={t('settings.mfa.lockout.title', 'Every sign-in currently fails')}
        >
          {t(
            'settings.mfa.lockout.body',
            'The saved policy requires an authenticator app, but no user has set one up. Choose "Users who set up an app" or another mode and save.'
          )}
        </Note>
      ) : null}

      <GroupTitle id={`${id}-modes`} title={t('settings.mfa.modes.title', 'Sign-in mode')} />
      <CardGrid $min="240px" role="radiogroup" aria-labelledby={`${id}-modes`}>
        {AUTH_MODES.map((key, index) => {
          const item = modes[key];
          const Icon = item.icon;
          const isActive = mode === key;
          return (
            <ModeCard
              key={key}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-labelledby={`${id}-${key}-title`}
              aria-describedby={`${id}-${key}-description`}
              tabIndex={isActive ? 0 : -1}
              $active={isActive}
              disabled={disabled}
              onClick={() => selectMode(key)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <ModePill $active={isActive} aria-hidden="true">
                {isActive ? statusOn : statusOff}
              </ModePill>
              <IconBadge $background={item.background} $color={item.accent} aria-hidden="true">
                <Icon />
              </IconBadge>
              <Flex direction="column" gap={1} alignItems="flex-start">
                <Typography
                  id={`${id}-${key}-title`}
                  variant="omega"
                  fontWeight="bold"
                  textColor="neutral800"
                >
                  {item.title}
                </Typography>
                <Typography id={`${id}-${key}-description`} variant="pi" textColor="neutral600">
                  {item.description}
                </Typography>
              </Flex>
              <FeatureList $accent={item.accent}>
                {item.features.map((feature) => (
                  <li key={feature}>
                    <CheckCircle aria-hidden="true" />
                    <Typography variant="pi" textColor="neutral700">
                      {feature}
                    </Typography>
                  </li>
                ))}
              </FeatureList>
              <CardFooter>
                <Badge>{item.badge}</Badge>
              </CardFooter>
            </ModeCard>
          );
        })}
      </CardGrid>

      {mode === 'email-otp' ? (
        <Panel>
          <GroupTitle
            title={t('settings.mfa.otp.title', 'Email code settings')}
            subtitle={t(
              'settings.mfa.otp.delivery',
              'Delivery: email. Codes are sent to the address of the account.'
            )}
          />
          <FieldGrid $columns={2}>
            <SettingField
              name="otp_length"
              label={t('settings.mfa.otp.length.label', 'Code length (digits)')}
              hint={t('settings.mfa.otp.length.hint', 'Default: 6 digits. Allowed: 4 to 16.')}
              error={errorFor('otp_length')}
              required
            >
              <NumberInput
                value={settings.otp_length}
                onValueChange={(value) => update('otp_length', value)}
                min={4}
                max={16}
                disabled={disabled}
              />
            </SettingField>
            <SettingField
              name="otp_expiry"
              label={t('settings.mfa.otp.expiry.label', 'Code lifetime (seconds)')}
              hint={t(
                'settings.mfa.otp.expiry.hint',
                'Default: 300 seconds (5 minutes). Allowed: 30 to 86,400.'
              )}
              error={errorFor('otp_expiry')}
              required
            >
              <NumberInput
                value={settings.otp_expiry}
                onValueChange={(value) => update('otp_expiry', value)}
                min={30}
                max={86400}
                step={30}
                disabled={disabled}
              />
            </SettingField>
            <SettingField
              name="otp_max_attempts"
              label={t('settings.mfa.otp.attempts.label', 'Maximum wrong attempts')}
              hint={t(
                'settings.mfa.otp.attempts.hint',
                'The code becomes invalid after this many wrong entries. Default: 3.'
              )}
              error={errorFor('otp_max_attempts')}
              required
            >
              <NumberInput
                value={settings.otp_max_attempts}
                onValueChange={(value) => update('otp_max_attempts', value)}
                min={1}
                max={20}
                disabled={disabled}
              />
            </SettingField>
            <SettingField
              name="otp_resend_cooldown"
              label={t('settings.mfa.otp.cooldown.label', 'Wait before a new code (seconds)')}
              hint={t(
                'settings.mfa.otp.cooldown.hint',
                'How long users wait before they can request a new code. Default: 60.'
              )}
              error={errorFor('otp_resend_cooldown')}
              required
            >
              <NumberInput
                value={settings.otp_resend_cooldown}
                onValueChange={(value) => update('otp_resend_cooldown', value)}
                min={0}
                max={86400}
                disabled={disabled}
              />
            </SettingField>
          </FieldGrid>
          <Note
            tone="success"
            icon={CheckCircle}
            title={t('settings.mfa.otp.howItWorks', 'How it works')}
          >
            <StepList>
              {emailOtpSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </StepList>
          </Note>
        </Panel>
      ) : null}

      {mode === 'totp' ? (
        <Panel>
          <GroupTitle
            id={`${id}-policy`}
            title={t('settings.mfa.policy.title', 'Who must use an authenticator app?')}
          />
          <Note
            tone={enrollment.status === 'ready' && enrolled === 0 ? 'warning' : 'primary'}
            icon={Key}
            title={t('settings.mfa.enrollment.title', 'Enrollment')}
          >
            <BulletList>
              <li aria-live="polite">{enrollmentText}</li>
              <li>
                {t(
                  'settings.mfa.enrollment.howTo',
                  'Users set up their app while signed in, from your frontend. They cannot set it up during a sign-in that already requires a code.'
                )}
              </li>
            </BulletList>
          </Note>
          <Radio.Group
            value={mfaMode === 'required' ? 'required' : 'optional'}
            onValueChange={handlePolicyChange}
            aria-labelledby={`${id}-policy`}
            disabled={disabled}
          >
            <Radio.Item value="optional">
              <Flex direction="column" gap={1} alignItems="flex-start" tag="span">
                <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                  {t('settings.mfa.policy.optional', 'Users who set up an app (recommended)')}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'settings.mfa.policy.optionalHint',
                    'Users with an authenticator app must enter its code. Everyone else signs in with the magic link.'
                  )}
                </Typography>
              </Flex>
            </Radio.Item>
            <Radio.Item value="required" disabled={disabled || !requireCheck.allowed}>
              <Flex direction="column" gap={1} alignItems="flex-start" tag="span">
                <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                  {t('settings.mfa.policy.required', 'Every user')}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {requireCheck.allowed
                    ? t(
                        'settings.mfa.policy.requiredHint',
                        'Users without an authenticator app can no longer sign in.'
                      )
                    : t(
                        'settings.mfa.policy.requiredBlocked',
                        'Unavailable: no user has set up an authenticator app, so every sign-in would fail.'
                      )}
                </Typography>
              </Flex>
            </Radio.Item>
          </Radio.Group>
        </Panel>
      ) : null}

      <CardGrid $min="260px">
        <ToggleCard
          title={t('settings.mfa.totpOnly.title', 'Sign-in with authenticator code only')}
          description={t(
            'settings.mfa.totpOnly.description',
            'Users who set up an authenticator app can sign in with their email address and a current code, without waiting for an email.'
          )}
          checked={settings.totp_as_primary_auth}
          onCheckedChange={(checked) => update('totp_as_primary_auth', checked)}
          disabled={disabled}
          statusOn={statusOn}
          statusOff={statusOff}
        />
      </CardGrid>

      {mode === 'totp' || settings.totp_as_primary_auth ? (
        <Panel>
          <GroupTitle
            title={t('settings.mfa.totp.title', 'Authenticator app settings')}
            subtitle={t(
              'settings.mfa.totp.subtitle',
              'Changes apply to new setups. Apps that are already set up keep working.'
            )}
          />
          <FieldGrid $columns={3}>
            <SettingField
              name="totp_issuer"
              label={t('settings.mfa.totp.issuer.label', 'Issuer name')}
              hint={t(
                'settings.mfa.totp.issuer.hint',
                'Shown in the authenticator app, for example your app name.'
              )}
              error={errorFor('totp_issuer')}
            >
              <TextInput
                value={settings.totp_issuer ?? ''}
                onChange={(event) => update('totp_issuer', event.target.value)}
                placeholder="Magic Link"
                disabled={disabled}
                maxLength={128}
              />
            </SettingField>
            <SettingField
              name="totp_digits"
              label={t('settings.mfa.totp.digits.label', 'Code digits')}
              error={errorFor('totp_digits')}
            >
              <SingleSelect
                value={String(settings.totp_digits ?? 6)}
                onChange={(value) => update('totp_digits', Number.parseInt(value, 10))}
                disabled={disabled}
              >
                <SingleSelectOption value="6">
                  {t('settings.mfa.totp.digits.option', '{count} digits', { count: 6 })}
                </SingleSelectOption>
                <SingleSelectOption value="8">
                  {t('settings.mfa.totp.digits.option', '{count} digits', { count: 8 })}
                </SingleSelectOption>
              </SingleSelect>
            </SettingField>
            <SettingField
              name="totp_period"
              label={t('settings.mfa.totp.period.label', 'Code period (seconds)')}
              hint={t(
                'settings.mfa.totp.period.hint',
                'Default: 30 seconds. Most apps only support 30.'
              )}
              error={errorFor('totp_period')}
              required
            >
              <NumberInput
                value={settings.totp_period}
                onValueChange={(value) => update('totp_period', value)}
                min={15}
                max={300}
                disabled={disabled}
              />
            </SettingField>
          </FieldGrid>
        </Panel>
      ) : null}

      <Note
        tone="primary"
        icon={CheckCircle}
        title={t('settings.mfa.summary.title', 'Current selection')}
      >
        <Flex direction="column" gap={2} alignItems="flex-start">
          {summary.map(({ icon: Icon, text }) => (
            <Flex key={text} gap={2} alignItems="flex-start">
              <Icon
                aria-hidden="true"
                width="14px"
                height="14px"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <span>{text}</span>
            </Flex>
          ))}
        </Flex>
      </Note>

      <ConfirmDialog
        isOpen={!disabled && confirmRequired}
        variant="danger"
        title={t(
          'settings.mfa.confirmRequired.title',
          'Require an authenticator app for every user?'
        )}
        description={
          enrollment.status === 'ready'
            ? t(
                'settings.mfa.confirmRequired.bodyCount',
                'Only {count, plural, one {# user has} other {# users have}} set up an authenticator app. Everyone else can no longer sign in after you save.',
                { count: enrolled }
              )
            : t(
                'settings.mfa.confirmRequired.bodyUnknown',
                'Users without an authenticator app can no longer sign in after you save. The number of enrolled users is unknown.'
              )
        }
        confirmLabel={t('settings.mfa.confirmRequired.confirm', 'Require for everyone')}
        onConfirm={() => {
          patch(applyTotpPolicy('required'));
          setConfirmRequired(false);
        }}
        onClose={() => setConfirmRequired(false)}
      >
        {t(
          'settings.mfa.confirmRequired.recovery',
          'To undo it, choose "Users who set up an app" or another sign-in mode and save again.'
        )}
      </ConfirmDialog>
    </SectionBody>
  );
};

export default MfaSection;
