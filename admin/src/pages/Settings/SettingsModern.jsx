import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Accordion, Alert, Badge, Box, Button, Flex, Typography } from '@strapi/design-system';
import {
  ArrowClockwise,
  Check,
  Clock,
  Code,
  Cog,
  Key,
  Lock,
  Mail,
  WarningCircle,
} from '@strapi/icons';
import { Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useMagicLinkRBAC } from '../../hooks/useMagicLinkRBAC';
import { useFormatters } from '../../hooks/useFormatters';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { usePluginLanguage } from '../../components/LanguageProvider';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { UnsavedChangesDialog } from '../../components/shared/UnsavedChangesDialog';
import { PluginPageTitle } from '../../components/shared/Headings';
import { reducedMotion } from '../../components/shared/motion';
import { toPlaceholderSyntax } from '../../utils/emailTemplates';
import { brand, color, space, theme, tint } from '../../utils/theme';
import { BulletList } from './components/SettingsUi';
import { GeneralSection } from './sections/GeneralSection';
import { AuthSection } from './sections/AuthSection';
import { MfaSection } from './sections/MfaSection';
import { EmailSection } from './sections/EmailSection';
import { RateLimitSection } from './sections/RateLimitSection';
import { AdvancedSection } from './sections/AdvancedSection';
import {
  FIELD_SECTIONS,
  buildSavePayload,
  fieldId,
  getServerErrorField,
  isSettingsDirty,
  orderedErrorKeys,
  parseEnrollmentSummary,
  resolveMfaMode,
  sanitizeLoadedSettings,
  validateSettings,
} from './utils/settingsForm';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const Container = styled.form`
  max-width: 1440px;
  margin: 0 auto;
`;

const StickySaveBar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space(4)};
  padding: ${space(6)};
  background: ${color('neutral0')};
  border-bottom: 1px solid ${color('neutral150')};
  box-shadow: ${theme.shadows.sm};

  @media (max-width: 768px) {
    position: static;
    padding: ${space(4)};
  }
`;

const HeaderActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: ${space(2)};
  min-width: 0;
`;

const Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space(6)};
  padding: ${space(6)} ${space(6)} ${space(7)};

  @media (max-width: 768px) {
    padding: ${space(4)};
  }
`;

const InfoBanner = styled.div`
  display: flex;
  gap: ${space(3)};
  align-items: flex-start;
  padding: ${space(6)};
  border-radius: ${theme.borderRadius.lg};
  background: ${tint.primary.bg};
  border: 1px solid ${tint.primary.border};

  @media (max-width: 480px) {
    padding: ${space(4)};
  }
`;

const BannerIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: ${brand.primary};

  svg {
    width: 20px;
    height: 20px;
  }

  svg path {
    fill: ${brand.onFill};
  }
`;

const FooterBox = styled.div`
  display: flex;
  gap: ${space(3)};
  align-items: center;
  justify-content: center;
  padding: ${space(6)};
  border-radius: ${theme.borderRadius.lg};
  background: ${tint.success.bg};
  border: 1px solid ${tint.success.border};
  text-align: left;

  > svg {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
  }

  > svg path {
    fill: ${tint.success.fg};
  }
`;

/** Save button in the brand gradient (one gradient for all Magic Link pages). */
const SaveButton = styled(Button)`
  && {
    background: ${brand.gradient};
    border: none;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
    transition:
      box-shadow ${theme.transitions.fast},
      transform ${theme.transitions.fast};
  }

  && span,
  && svg path {
    color: ${brand.onFill};
    fill: ${brand.onFill};
    font-weight: 700;
  }

  &&:hover:not([aria-disabled='true']) {
    background: ${brand.gradientHover};
    transform: translateY(-1px);
  }

  &&[aria-disabled='true'] {
    opacity: 0.5;
  }

  ${reducedMotion}
`;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Settings response -> form state (templates shown in the 6.0 placeholder syntax). */
const toFormState = (raw) => {
  const clean = sanitizeLoadedSettings(raw);
  for (const key of ['message_html', 'message_text', 'object']) {
    if (typeof clean[key] === 'string') clean[key] = toPlaceholderSyntax(clean[key]);
  }
  return clean;
};

const listFrom = (payload) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.templates)) return data.templates;
  return [];
};

const NO_INTEGRATIONS = Object.freeze({
  emailDesignerInstalled: false,
  magicMailInstalled: false,
  emailProviderConfigured: false,
  emailProviderName: null,
});

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const SettingsModern = () => {
  const { t } = useMagicLinkIntl();
  const { formatNumber } = useFormatters();
  const { toggleNotification } = useNotification();
  const { get, put, post } = useFetchClient();
  const {
    canReadSettings,
    canUpdateSettings,
    isLoading: isPermissionLoading,
    error: permissionError,
  } = useMagicLinkRBAC();
  const canWriteSettings = canUpdateSettings;
  const { language } = usePluginLanguage();

  const [loadState, setLoadState] = useState('loading');
  const [settings, setSettings] = useState(null);
  const [initialSettings, setInitialSettings] = useState(null);
  const [integrations, setIntegrations] = useState(NO_INTEGRATIONS);
  const [emailDesignerTemplates, setEmailDesignerTemplates] = useState([]);
  const [magicMailTemplates, setMagicMailTemplates] = useState([]);
  const [rateLimitStats, setRateLimitStats] = useState({ status: 'idle', data: null });
  const [enrollment, setEnrollment] = useState({ status: 'loading', summary: null });
  const [serverErrors, setServerErrors] = useState({});
  const [openSection, setOpenSection] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const focusRequest = useRef(null);

  const isReady = loadState === 'ready' && settings !== null;
  const isDirty = isReady && isSettingsDirty(initialSettings, settings);
  const guard = useUnsavedChangesGuard(isDirty);
  const formDisabled = !canWriteSettings || isSaving;

  const clientErrors = useMemo(() => (settings ? validateSettings(settings) : {}), [settings]);
  const errorKeys = useMemo(
    () => orderedErrorKeys({ ...clientErrors, ...serverErrors }),
    [clientErrors, serverErrors]
  );
  const settingsFormValid = Object.keys(clientErrors).length === 0;

  /** Translated message for an invalid field, or undefined. */
  const errorFor = useCallback(
    (key) => {
      const error = clientErrors[key];
      if (!error) {
        return serverErrors[key]
          ? t(
              'settings.validation.server',
              'The server rejected this value. Check it and save again.'
            )
          : undefined;
      }
      switch (error.code) {
        case 'url':
          return t(
            'settings.validation.url',
            'Enter an https URL. http is only allowed for localhost.'
          );
        case 'path':
          return t(
            'settings.validation.path',
            'Enter a path that starts with / and contains only URL characters.'
          );
        case 'jwtExpiry':
          return t(
            'settings.auth.jwtExpiration.invalid',
            'Enter a number followed by m, h or d, such as 15m, 1h or 30d.'
          );
        case 'email':
          return t(
            'settings.email.invalidEmail',
            'Enter a valid email address or leave this field blank.'
          );
        case 'range':
          return t('settings.validation.range', 'Enter a whole number from {min} to {max}.', {
            min: formatNumber(error.min),
            max: formatNumber(error.max),
          });
        case 'length':
          return t('settings.validation.length', 'Use at most {max} characters.', {
            max: formatNumber(error.max),
          });
        case 'list':
          return t(
            'settings.validation.list',
            'Use at most {max} fields with up to 128 characters each.',
            {
              max: error.max,
            }
          );
        case 'digits':
          return t('settings.validation.digits', 'Choose 6 or 8 digits.');
        default:
          return t(
            'settings.validation.server',
            'The server rejected this value. Check it and save again.'
          );
      }
    },
    [clientErrors, serverErrors, t, formatNumber]
  );

  /* ---------------- Data loading ---------------- */

  // The fetchers below set state only after the request settles, so the mount
  // effect does not cascade renders. The initial state is already "loading";
  // retries and refreshes set it in their handlers.
  const fetchSettings = useCallback(async () => {
    try {
      const res = await get('/magic-link/settings');
      const payload = res?.data ?? {};
      const formState = toFormState(payload.settings ?? payload.data ?? payload);
      setSettings(formState);
      setInitialSettings(formState);
      setServerErrors({});
      setIntegrations({
        emailDesignerInstalled: payload.emailDesignerInstalled === true,
        magicMailInstalled: payload.magicMailInstalled === true,
        emailProviderConfigured: payload.emailProviderConfigured === true,
        emailProviderName:
          typeof payload.emailProviderName === 'string' ? payload.emailProviderName : null,
      });
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [get]);

  /** Retry after a failed load: shows the loader, then fetches again. */
  const retrySettings = useCallback(() => {
    setLoadState('loading');
    return fetchSettings();
  }, [fetchSettings]);

  /** Fetches only the rate-limit statistics (never the form). */
  const fetchStats = useCallback(async () => {
    try {
      const res = await get('/magic-link/rate-limit/stats');
      setRateLimitStats({ status: 'ready', data: res?.data?.data ?? {} });
    } catch {
      setRateLimitStats({ status: 'error', data: null });
    }
  }, [get]);

  /** Refreshes the rate-limit statistics and shows their loader meanwhile. */
  const loadStats = useCallback(() => {
    setRateLimitStats((current) => ({ status: 'loading', data: current.data }));
    return fetchStats();
  }, [fetchStats]);

  /** Number of users with an authenticator app (optional server feature). */
  const fetchEnrollment = useCallback(async () => {
    try {
      const res = await get('/magic-link/totp/enrollment-summary');
      const summary = parseEnrollmentSummary(res?.data);
      setEnrollment(
        summary ? { status: 'ready', summary } : { status: 'unavailable', summary: null }
      );
    } catch {
      setEnrollment({ status: 'unavailable', summary: null });
    }
  }, [get]);

  useEffect(() => {
    if (!canReadSettings) return;
    // The fetchers set state only after their requests settle.
    const load = async () => {
      await Promise.all([fetchSettings(), fetchStats(), fetchEnrollment()]);
    };
    load();
  }, [canReadSettings, fetchSettings, fetchStats, fetchEnrollment]);

  useEffect(() => {
    if (!integrations.emailDesignerInstalled) return undefined;
    let active = true;
    get('/email-designer-5/templates')
      .then((res) => active && setEmailDesignerTemplates(listFrom(res?.data)))
      .catch(() => active && setEmailDesignerTemplates([]));
    return () => {
      active = false;
    };
  }, [integrations.emailDesignerInstalled, get]);

  useEffect(() => {
    if (!integrations.magicMailInstalled) return undefined;
    let active = true;
    get('/magic-mail/designer/templates')
      .then((res) => active && setMagicMailTemplates(listFrom(res?.data)))
      .catch(() => active && setMagicMailTemplates([]));
    return () => {
      active = false;
    };
  }, [integrations.magicMailInstalled, get]);

  /* ---------------- Form state ---------------- */

  /** Updates one field without dropping sibling changes from batched controls. */
  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  /** Updates several fields at once (mode switches, template loads). */
  const patchSettings = useCallback((values) => {
    setSettings((current) => ({ ...current, ...values }));
  }, []);

  /** Opens the section of a field and moves focus to it. */
  const focusField = useCallback((key) => {
    const section = FIELD_SECTIONS[key];
    if (section) setOpenSection(section);
    focusRequest.current = key;
  }, []);

  useEffect(() => {
    const key = focusRequest.current;
    if (!key) return undefined;
    // Wait for the accordion content to mount before focusing.
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(fieldId(key));
      if (element) {
        element.focus();
        element.scrollIntoView?.({ block: 'center' });
      }
      focusRequest.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  });

  const discardChanges = () => {
    setSettings(initialSettings);
    setServerErrors({});
  };

  /* ---------------- Save ---------------- */

  /** Validates, sends only the changed fields and adopts the server's response. */
  const handleSave = async (event) => {
    event.preventDefault();
    if (!canWriteSettings || isPermissionLoading) return;
    if (!isDirty || isSaving) return;
    if (!settingsFormValid) {
      focusField(errorKeys[0]);
      toggleNotification({
        type: 'warning',
        message: t(
          'settings.save.invalid',
          'Some fields need attention. Fix them before you save.'
        ),
      });
      return;
    }

    const payload = buildSavePayload(initialSettings, settings);
    if (language && language !== initialSettings.ui_language) payload.ui_language = language;

    setIsSaving(true);
    try {
      const response = await put('/magic-link/settings', payload);
      const saved = toFormState(response?.data?.settings ?? { ...initialSettings, ...payload });
      setSettings(saved);
      setInitialSettings(saved);
      setServerErrors({});
      toggleNotification({
        type: 'success',
        message: t('settings.save.success', 'Settings saved'),
      });
    } catch (error) {
      const field = getServerErrorField(error);
      const errorKey = error?.response?.data?.error?.details?.key;
      if (
        errorKey === 'settings.security.forbidden' ||
        errorKey === 'settings.linkOrigin.notAllowed'
      ) {
        toggleNotification({
          type: 'danger',
          message:
            errorKey === 'settings.security.forbidden'
              ? t(
                  'settings.save.securityForbidden',
                  'Changing link targets, templates, account, MFA, code or rate-limit rules needs the "Settings: Security" permission.'
                )
              : t(
                  'settings.save.linkOriginNotAllowed',
                  'Login link URLs must use an origin allowed in the server configuration.'
                ),
        });
      } else if (field) {
        setServerErrors({ [field]: true });
        focusField(field);
        toggleNotification({
          type: 'danger',
          message: t(
            'settings.save.rejected',
            'The server rejected a value. Check the highlighted field.'
          ),
        });
      } else {
        toggleNotification({
          type: 'danger',
          message: t('settings.save.error', 'Settings could not be saved. Please try again.'),
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  /* ---------------- Rate limit actions ---------------- */

  /** Cleans expired rate-limit entries; refreshes only the statistics. */
  const handleRateLimitCleanup = async () => {
    if (!canWriteSettings || isPermissionLoading) return;
    setIsCleaning(true);
    try {
      await post('/magic-link/rate-limit/cleanup');
      toggleNotification({
        type: 'success',
        message: t('settings.rateLimit.cleanupSuccess', 'Expired entries removed'),
      });
      await loadStats();
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('settings.rateLimit.cleanupError', 'Expired entries could not be removed'),
      });
    } finally {
      setIsCleaning(false);
    }
  };

  /** Clears every rate-limit entry after confirmation; refreshes only the statistics. */
  const handleRateLimitReset = async () => {
    if (!canWriteSettings || isPermissionLoading) return;
    try {
      await post('/magic-link/rate-limit/reset');
      toggleNotification({
        type: 'success',
        message: t('settings.rateLimit.resetSuccess', 'All rate limits reset'),
      });
      setConfirmReset(false);
      await loadStats();
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('settings.rateLimit.resetError', 'Rate limits could not be reset'),
      });
    }
  };

  /* ---------------- Render ---------------- */

  const pageTitle = <PluginPageTitle>{t('settings.pageTitle', 'Settings')}</PluginPageTitle>;

  if (isPermissionLoading) {
    return (
      <>
        {pageTitle}
        <Page.Loading />
      </>
    );
  }

  if (permissionError) {
    return (
      <Page.Main>
        {pageTitle}
        <Page.Error
          content={t(
            'common.permissions.loadError',
            'Your permissions could not be loaded. Reload the page to try again.'
          )}
        />
      </Page.Main>
    );
  }

  if (!canReadSettings) {
    return (
      <Page.Main>
        {pageTitle}
        <Page.NoPermissions />
      </Page.Main>
    );
  }

  if (loadState === 'error') {
    return (
      <Page.Main>
        {pageTitle}
        <Page.Error
          content={t('settings.load.error', 'Settings could not be loaded.')}
          action={
            <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={retrySettings}>
              {t('settings.retry', 'Try again')}
            </Button>
          }
        />
      </Page.Main>
    );
  }

  if (!isReady) {
    return (
      <>
        {pageTitle}
        <Page.Loading>{t('settings.load.loading', 'Loading settings...')}</Page.Loading>
      </>
    );
  }

  const statusOn = t('status.active', 'ACTIVE');
  const statusOff = t('status.inactive', 'INACTIVE');
  const sectionProps = {
    settings,
    update: updateSetting,
    patch: patchSettings,
    disabled: formDisabled,
    errorFor,
    statusOn,
    statusOff,
  };
  const sections = [
    {
      value: 'general',
      icon: Cog,
      title: t('settings.section.general', 'General'),
      description: t(
        'settings.section.general.description',
        'Language, main features, link lifetime and URLs'
      ),
      content: <GeneralSection {...sectionProps} />,
    },
    {
      value: 'auth',
      icon: Key,
      title: t('settings.section.auth', 'Authentication'),
      description: t('settings.section.auth.description', 'User creation, JWT and login data'),
      content: <AuthSection {...sectionProps} />,
    },
    {
      value: 'mfa',
      icon: Lock,
      title: t('settings.section.mfa', 'Sign-in modes and MFA'),
      description: t(
        'settings.section.mfa.description',
        'Magic link, email code or authenticator app'
      ),
      content: (
        <MfaSection
          {...sectionProps}
          enrollment={enrollment}
          savedMfaMode={resolveMfaMode(initialSettings)}
        />
      ),
    },
    {
      value: 'email',
      icon: Mail,
      title: t('settings.section.email', 'Email'),
      description: t(
        'settings.section.email.description',
        'Sender, templates and email integrations'
      ),
      content: (
        <EmailSection
          {...sectionProps}
          integrations={integrations}
          emailDesignerTemplates={emailDesignerTemplates}
          magicMailTemplates={magicMailTemplates}
        />
      ),
    },
    {
      value: 'ratelimit',
      icon: Clock,
      title: t('settings.section.rateLimit', 'Rate limiting'),
      description: t(
        'settings.section.rateLimit.description',
        'Protect against abuse and brute-force attacks'
      ),
      content: (
        <RateLimitSection
          {...sectionProps}
          canManage={canWriteSettings}
          stats={rateLimitStats}
          onRetryStats={loadStats}
          onCleanup={handleRateLimitCleanup}
          onRequestReset={() => setConfirmReset(true)}
          isCleaning={isCleaning}
        />
      ),
    },
    {
      value: 'advanced',
      icon: Code,
      title: t('settings.section.advanced', 'Advanced'),
      description: t(
        'settings.section.advanced.description',
        'Public registration and plugin compatibility'
      ),
      content: <AdvancedSection {...sectionProps} />,
    },
  ];
  const invalidSections = new Set(errorKeys.map((key) => FIELD_SECTIONS[key]).filter(Boolean));

  return (
    <Page.Main>
      {pageTitle}
      <Container onSubmit={handleSave} noValidate aria-busy={isSaving}>
        <StickySaveBar>
          <Flex direction="column" gap={1} alignItems="flex-start" style={{ minWidth: 0 }}>
            <Typography variant="alpha" tag="h1" textColor="neutral800">
              {t('settings.page.title', 'Magic Link Settings')}
            </Typography>
            <Typography variant="epsilon" textColor="neutral600" tag="p">
              {t('settings.page.subtitle', 'Configure passwordless authentication for your users')}
            </Typography>
          </Flex>
          <HeaderActions>
            {errorKeys.length > 0 ? (
              <Button
                variant="danger-light"
                size="M"
                startIcon={<WarningCircle />}
                onClick={() => focusField(errorKeys[0])}
              >
                {t(
                  'settings.errors.summary',
                  '{count, plural, one {# field needs attention} other {# fields need attention}}',
                  { count: errorKeys.length }
                )}
              </Button>
            ) : null}
            {isDirty ? (
              <>
                <Badge variant="warning" role="status">
                  {t('common.unsaved.badge', 'Unsaved changes')}
                </Badge>
                <Button
                  variant="tertiary"
                  size="M"
                  onClick={() => guard.runGuarded(discardChanges)}
                  disabled={isSaving}
                >
                  {t('settings.discard', 'Discard')}
                </Button>
              </>
            ) : null}
            {canWriteSettings ? (
              <SaveButton
                type="submit"
                size="M"
                loading={isSaving}
                startIcon={<Check />}
                disabled={isSaving || isPermissionLoading || !canWriteSettings || !isDirty}
              >
                {isSaving
                  ? t('settings.save.saving', 'Saving...')
                  : t('settings.save.button', 'Save Changes')}
              </SaveButton>
            ) : null}
          </HeaderActions>
        </StickySaveBar>

        <Content>
          {!canWriteSettings ? (
            <Alert
              variant="default"
              closeLabel={t('common.close', 'Close')}
              title={t('settings.permission.readOnlyTitle', 'Read-only')}
            >
              {t(
                'settings.permission.readOnly',
                'You have read-only access. Changes cannot be saved.'
              )}
            </Alert>
          ) : null}

          <InfoBanner>
            <BannerIcon aria-hidden="true">
              <Cog />
            </BannerIcon>
            <Flex direction="column" gap={1} alignItems="flex-start" style={{ minWidth: 0 }}>
              <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="p">
                {t('settings.info.header', 'Important Configuration Notes')}
              </Typography>
              <Typography variant="pi" textColor="neutral700" tag="div">
                <BulletList>
                  <li>{t('settings.info.line1', 'Changes take effect after you save.')}</li>
                  <li>{t('settings.info.line2', 'Make sure all URLs are correctly configured')}</li>
                  <li>
                    {t(
                      'settings.info.line3',
                      'Test the configuration after saving with a test token'
                    )}
                  </li>
                  <li>
                    {t(
                      'settings.info.line4',
                      'Green cards are active features, grey cards are inactive.'
                    )}
                  </li>
                </BulletList>
              </Typography>
            </Flex>
          </InfoBanner>

          <Box>
            <Accordion.Root value={openSection} onValueChange={setOpenSection}>
              {sections.map((section) => (
                <Accordion.Item key={section.value} value={section.value}>
                  <Accordion.Header>
                    <Accordion.Trigger
                      icon={section.icon}
                      description={
                        invalidSections.has(section.value)
                          ? t(
                              'settings.section.hasErrors',
                              '{description} (contains fields to fix)',
                              {
                                description: section.description,
                              }
                            )
                          : section.description
                      }
                    >
                      {section.title}
                    </Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content>{section.content}</Accordion.Content>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          </Box>

          <FooterBox>
            <Check aria-hidden="true" />
            <Flex direction="column" gap={1} alignItems="flex-start">
              <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                {t('settings.footer.quickhelp', 'Quick Help')}
              </Typography>
              <Typography variant="pi" textColor="neutral700">
                {t(
                  'settings.footer.reminder',
                  'After saving, create a test token and try the magic link.'
                )}
              </Typography>
            </Flex>
          </FooterBox>
        </Content>
      </Container>

      <ConfirmDialog
        isOpen={canWriteSettings && confirmReset}
        title={t('settings.rateLimit.resetTitle', 'Reset all rate limits?')}
        description={t(
          'settings.rateLimit.resetConfirm',
          'All blocked IP addresses and email addresses can send requests again immediately.'
        )}
        confirmLabel={t('settings.rateLimit.reset', 'Reset All Limits')}
        onConfirm={handleRateLimitReset}
        onClose={() => setConfirmReset(false)}
      />
      <UnsavedChangesDialog guard={guard} />
    </Page.Main>
  );
};

export default SettingsModern;
