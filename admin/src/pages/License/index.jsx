import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Badge,
  Flex,
  Alert,
  Button,
  Loader,
  Accordion,
  VisuallyHidden,
} from '@strapi/design-system';
import { Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  User,
  Shield,
  ChartBubble,
  Duplicate,
  Download,
  Eye,
  EyeStriked,
} from '@strapi/icons';
import styled, { css, keyframes } from 'styled-components';
import { LanguageProvider } from '../../components/LanguageProvider';
import LicenseGuard from '../../components/LicenseGuard';
import { PluginPageTitle } from '../../components/shared/Headings';
import { motionSafe, reducedMotion } from '../../components/shared/motion';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useFormatters } from '../../hooks/useFormatters';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useMagicLinkRBAC } from '../../hooks/useMagicLinkRBAC';
import { brand, breakpoints, color, fontSize, space, theme } from '../../utils/theme';

// ================ PURE HELPERS (exported for tests) ================

/** Character used to hide license key characters. */
export const MASK_CHAR = '•';

/**
 * @param {unknown} value
 * @returns {boolean} true when the value already is a masked key (server-side masking)
 */
export const isMaskedKey = (value) =>
  typeof value === 'string' && (value.includes(MASK_CHAR) || value.includes('*'));

/**
 * Masks a license key for display. Only the last four characters stay
 * visible, and only for keys long enough that four characters reveal little.
 *
 * @param {unknown} key
 * @returns {string} masked key, or '' when there is no key
 */
export const maskLicenseKey = (key) => {
  if (typeof key !== 'string' || !key.trim()) return '';
  const trimmed = key.trim();
  if (isMaskedKey(trimmed)) return trimmed;
  const hidden = MASK_CHAR.repeat(4);
  if (trimmed.length < 12) return `${hidden}${hidden}`;
  return `${hidden}-${hidden}-${trimmed.slice(-4)}`;
};

/**
 * Reduces the GET /magic-link/license/status payload to what the page shows.
 * Accepts both the full key (`data.licenseKey`) and a server-masked key
 * (`data.licenseKeyMasked`, or a `licenseKey` that is already masked).
 *
 * @param {any} payload - response body of GET /magic-link/license/status
 * @returns {{
 *   kind: 'active'|'unverified'|'none',
 *   hasKey: boolean,
 *   fullKey: string|null,
 *   maskedKey: string,
 *   isActive: boolean,
 *   details: Record<string, any>,
 * }}
 */
export const getLicenseView = (payload) => {
  const details = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const rawKey = typeof details.licenseKey === 'string' ? details.licenseKey.trim() : '';
  const fullKey = rawKey && !isMaskedKey(rawKey) ? rawKey : null;
  const maskedKey =
    (typeof details.licenseKeyMasked === 'string' && details.licenseKeyMasked.trim()) ||
    maskLicenseKey(rawKey);
  const hasKey = Boolean(payload?.hasKey);
  const isValid = payload?.valid !== false;
  let kind = 'none';
  if (hasKey) kind = isValid ? 'active' : 'unverified';
  return {
    kind,
    hasKey,
    fullKey,
    maskedKey,
    isActive: details.isActive !== false,
    details,
  };
};

/**
 * @param {{firstName?: string|null, lastName?: string|null}} details
 * @returns {string} "First Last", or '' when neither is set
 */
export const holderName = (details = {}) =>
  [details.firstName, details.lastName]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim())
    .join(' ');

/**
 * Builds the plain-text license file. Every label comes from `labels`, so the
 * file follows the admin language.
 *
 * @param {{key: string, name: string, email: string, status: string, expires: string, generated: string}} values
 * @param {{title: string, key: string, holder: string, name: string, email: string, statusSection: string, status: string, expires: string, generated: string}} labels
 * @returns {string}
 */
export const buildLicenseFileContent = (values, labels) => {
  const rule = '='.repeat(40);
  const line = '-'.repeat(40);
  return [
    labels.title,
    rule,
    '',
    `${labels.key}: ${values.key}`,
    '',
    labels.holder,
    line,
    `${labels.name}: ${values.name}`,
    `${labels.email}: ${values.email}`,
    '',
    labels.statusSection,
    line,
    `${labels.status}: ${values.status}`,
    `${labels.expires}: ${values.expires}`,
    '',
    rule,
    `${labels.generated}: ${values.generated}`,
    '',
  ].join('\n');
};

/** File name of the downloaded license file (no key characters in it). */
export const LICENSE_FILE_NAME = 'magic-link-license.txt';

/**
 * Maps a fetch error to a translated message. Server text is never shown.
 * @param {any} error
 * @param {(key: string, defaultMessage: string) => string} t
 * @returns {string}
 */
export const licenseErrorMessage = (error, t) => {
  const status = error?.status ?? error?.response?.status;
  if (status === 401 || status === 403) {
    return t(
      'license.error.forbidden',
      'You do not have permission to view the license. Ask an administrator for the Settings read permission.'
    );
  }
  return t('license.error.load', 'The license information could not be loaded. Try again.');
};

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  max-width: 1440px;
  margin: 0 auto;
  ${motionSafe(css`
    animation: ${fadeIn} 0.4s ease-out;
  `)}
`;

const StickyHeader = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: ${color('neutral0')};
  border-bottom: 1px solid ${color('neutral200')};
  box-shadow: ${theme.shadows.sm};
  padding: ${space(6)};

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)};
  }
`;

const HeaderRow = styled(Flex)`
  flex-wrap: wrap;
  gap: ${space(4)};
  justify-content: space-between;
  align-items: center;

  & > :first-child {
    min-width: 0;
    flex: 1 1 240px;
  }
`;

/* Brand gradient shared with the Tokens header; 14px bold text is large text. */
const GradientButton = styled(Button)`
  background: ${brand.gradient};
  border: none;
  color: ${brand.onFill};

  & > span,
  & svg {
    color: ${brand.onFill};
    fill: ${brand.onFill};
  }

  &:hover:not([aria-disabled='true']) {
    background: ${brand.gradientHover};
  }
`;

const Content = styled(Box)`
  padding: ${space(6)};

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)};
  }
`;

const Stack = styled(Flex)`
  flex-direction: column;
  align-items: stretch;
  gap: ${space(6)};
`;

/*
 * Violet license banner. A 25 % slate layer over brand.violetGradient keeps the
 * look and raises white text to >= 4.5:1 (5.4:1 at the light end).
 */
const LicenseKeyBanner = styled.section`
  background:
    linear-gradient(rgba(15, 23, 42, 0.25), rgba(15, 23, 42, 0.25)), ${brand.violetGradient};
  border-radius: ${theme.borderRadius.lg};
  padding: ${space(6)} ${space(7)};
  color: ${brand.onFill};
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.25);

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)};
  }

  &::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.08), transparent);
    background-size: 200% 100%;
    ${motionSafe(css`
      animation: ${shimmer} 3s infinite;
    `)}
    pointer-events: none;
    z-index: 0;
  }

  & > * {
    position: relative;
    z-index: 1;
  }

  ${reducedMotion}
`;

const BannerRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space(4)};
  justify-content: space-between;
  align-items: flex-start;
`;

const BannerBody = styled.div`
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${space(3)};
`;

const BannerLabel = styled.h2`
  margin: 0;
  color: ${brand.onFill};
  font-size: ${fontSize(0)};
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
`;

const KeyText = styled.p`
  margin: 0;
  color: ${brand.onFill};
  font-family: monospace;
  font-size: ${fontSize(6)};
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;

  @media (max-width: ${breakpoints.mobile}) {
    font-size: ${fontSize(4)};
  }
`;

/* Frosted buttons: 14px bold text (DS size M) is large text, so 3:1 suffices. */
const FrostedButton = styled(Button)`
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: ${brand.onFill};

  & > span,
  & svg {
    color: ${brand.onFill};
    fill: ${brand.onFill};
  }

  &:hover:not([aria-disabled='true']) {
    background: rgba(255, 255, 255, 0.3);
    border-color: ${brand.onFill};
  }

  &:focus-visible {
    outline: 2px solid ${brand.onFill};
    outline-offset: 2px;
  }
`;

const DetailGrid = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  align-items: stretch;
  gap: ${space(6)};
  margin: 0;
`;

const DetailItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space(2)};
  min-width: 0;

  & > dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;

const LoaderArea = styled(Flex)`
  min-height: 320px;
  align-items: center;
  justify-content: center;
`;

// ================ SMALL COMPONENTS ================
const Detail = ({ label, children }) => (
  <DetailItem>
    <Typography tag="dt" variant="sigma" textColor="neutral600">
      {label}
    </Typography>
    <Typography tag="dd" variant="omega" fontWeight="semiBold" textColor="neutral800">
      {children}
    </Typography>
  </DetailItem>
);

// ================ DERIVED LABELS ================

/**
 * Translated, formatted values shared by the overview and the license file.
 *
 * @param {ReturnType<typeof getLicenseView>} view
 * @param {(key: string, defaultMessage: string, values?: object) => string} t
 * @param {(value: unknown, options?: object, fallback?: string) => string} formatDate
 * @returns {{name: string, notProvided: string, expiresText: string, activeLabel: string}}
 */
export const describeLicense = (view, t, formatDate) => {
  const notProvided = t('license.value.notProvided', 'Not provided');
  return {
    name: holderName(view.details),
    notProvided,
    expiresText: view.details.expiresAt
      ? formatDate(view.details.expiresAt, { dateStyle: 'long' }, notProvided)
      : t('license.value.never', 'Never'),
    activeLabel: view.isActive
      ? t('license.status.active', 'Active')
      : t('license.status.inactive', 'Inactive'),
  };
};

// ================ OVERVIEW (ready state) ================

/**
 * License overview: status alert, key banner and detail accordions.
 *
 * @param {{
 *   view: ReturnType<typeof getLicenseView>,
 *   canUseFullKey: boolean,
 *   revealed: boolean,
 *   alertDismissed: boolean,
 *   onDismissAlert: () => void,
 *   onToggleReveal: () => void,
 *   onCopy: () => void,
 *   onDownload: () => void,
 * }} props
 */
export const LicenseOverview = ({
  view,
  canUseFullKey,
  revealed,
  alertDismissed,
  onDismissAlert,
  onToggleReveal,
  onCopy,
  onDownload,
}) => {
  const { t } = useMagicLinkIntl();
  const { formatDate } = useFormatters();
  const { details } = view;
  const { name, notProvided, expiresText, activeLabel } = describeLicense(view, t, formatDate);
  const closeLabel = t('license.alert.close', 'Dismiss message');
  const isRevealed = revealed && canUseFullKey;

  const alertProps = {
    active: {
      variant: 'success',
      title: t('license.alert.active.title', 'License active'),
      body: t(
        'license.alert.active.body',
        'License key registered. Thank you for supporting the plugin.'
      ),
    },
    unverified: {
      variant: 'warning',
      title: t('license.alert.unverified.title', 'License not verified'),
      body: t(
        'license.alert.unverified.body',
        'The license server could not be reached. The plugin keeps working. Refresh the status later.'
      ),
    },
    none: {
      variant: 'default',
      title: t('license.alert.none.title', 'No license key registered'),
      body: t(
        'license.alert.none.body',
        'All Magic Link features are available without activation.'
      ),
    },
  }[view.kind];

  return (
    <Stack>
      {!alertDismissed && (
        <Alert
          variant={alertProps.variant}
          title={alertProps.title}
          closeLabel={closeLabel}
          onClose={onDismissAlert}
        >
          {alertProps.body}
        </Alert>
      )}

      {view.maskedKey && (
        <LicenseKeyBanner aria-labelledby="magic-link-license-key-label">
          <BannerRow>
            <BannerBody>
              <BannerLabel id="magic-link-license-key-label">
                {t('license.key.label', 'License key')}
              </BannerLabel>
              {isRevealed ? (
                <KeyText>{view.fullKey}</KeyText>
              ) : (
                <KeyText>
                  <span aria-hidden="true">{view.maskedKey}</span>
                  <VisuallyHidden>{t('license.key.hidden', 'License key hidden')}</VisuallyHidden>
                </KeyText>
              )}
              {canUseFullKey && (
                <Flex gap={2} wrap="wrap">
                  <FrostedButton
                    size="M"
                    variant="secondary"
                    onClick={onToggleReveal}
                    aria-pressed={isRevealed}
                    startIcon={
                      isRevealed ? <EyeStriked aria-hidden="true" /> : <Eye aria-hidden="true" />
                    }
                  >
                    {isRevealed
                      ? t('license.key.hide', 'Hide key')
                      : t('license.key.show', 'Show key')}
                  </FrostedButton>
                  <FrostedButton
                    size="M"
                    variant="secondary"
                    onClick={onCopy}
                    startIcon={<Duplicate aria-hidden="true" />}
                  >
                    {t('license.key.copy', 'Copy key')}
                  </FrostedButton>
                  <FrostedButton
                    size="M"
                    variant="secondary"
                    onClick={onDownload}
                    startIcon={<Download aria-hidden="true" />}
                  >
                    {t('license.key.download', 'Download as TXT')}
                  </FrostedButton>
                </Flex>
              )}
            </BannerBody>
            <Badge
              size="M"
              backgroundColor={view.isActive ? 'success100' : 'danger100'}
              textColor={view.isActive ? 'success700' : 'danger700'}
            >
              {activeLabel}
            </Badge>
          </BannerRow>
        </LicenseKeyBanner>
      )}

      <Accordion.Root defaultValue="account">
        <Accordion.Item value="account">
          <Accordion.Header>
            <Accordion.Trigger icon={User}>
              {t('license.section.account', 'Account information')}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <Box padding={6}>
              <DetailGrid>
                <Detail label={t('license.field.email', 'Email address')}>
                  {details.email || notProvided}
                </Detail>
                <Detail label={t('license.field.holder', 'Name')}>{name || notProvided}</Detail>
              </DetailGrid>
            </Box>
          </Accordion.Content>
        </Accordion.Item>

        <Accordion.Item value="details">
          <Accordion.Header>
            <Accordion.Trigger icon={Shield}>
              {t('license.section.details', 'License details')}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <Box padding={6}>
              <DetailGrid>
                <Detail
                  label={
                    details.isExpired
                      ? t('license.field.expired', 'Expired on')
                      : t('license.field.expires', 'Expires on')
                  }
                >
                  {expiresText}
                </Detail>
                <Detail label={t('license.field.deviceName', 'Device name')}>
                  {details.deviceName || notProvided}
                </Detail>
                <Detail label={t('license.field.ipAddress', 'IP address')}>
                  {details.ipAddress || notProvided}
                </Detail>
              </DetailGrid>
            </Box>
          </Accordion.Content>
        </Accordion.Item>

        <Accordion.Item value="status">
          <Accordion.Header>
            <Accordion.Trigger icon={ChartBubble}>
              {t('license.section.status', 'System status')}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <Box padding={6}>
              <DetailGrid>
                <Detail label={t('license.field.status', 'Status')}>
                  {view.hasKey ? activeLabel : t('license.status.noKey', 'No key registered')}
                </Detail>
                <Detail label={t('license.field.mode', 'Plugin mode')}>
                  {t('license.mode.unlocked', 'All features available')}
                </Detail>
              </DetailGrid>
            </Box>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </Stack>
  );
};

// ================ MAIN VIEW ================
const LicenseView = () => {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { t } = useMagicLinkIntl();
  const { formatDate, formatDateTime } = useFormatters();
  const copy = useCopyToClipboard();
  const {
    canReadSettings,
    canUpdateSettings,
    isLoading: rbacLoading,
    error: rbacError,
  } = useMagicLinkRBAC();

  const [status, setStatus] = useState('loading');
  const [licenseData, setLicenseData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // The first load starts with the effect below, so the page mounts busy.
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const requestRef = useRef(null);

  // Only sets state after the request settles, so the mount effect does not
  // trigger cascading renders. UI resets for a manual refresh happen in the
  // click handler (refreshLicenseStatus).
  const loadLicenseStatus = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await get('/magic-link/license/status', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setLicenseData(response.data);
      setLoadError(null);
      setStatus('ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      // Keep only the status; the message is translated at render time.
      setLoadError({ status: err?.status ?? err?.response?.status });
      setStatus('error');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsRefreshing(false);
      }
    }
  }, [get]);

  const refreshLicenseStatus = useCallback(() => {
    setIsRefreshing(true);
    setRevealed(false);
    setAlertDismissed(false);
    return loadLicenseStatus();
  }, [loadLicenseStatus]);

  useEffect(() => {
    if (!canReadSettings) return undefined;
    // loadLicenseStatus sets state only after its request settles.
    const load = async () => {
      await loadLicenseStatus();
    };
    load();
    return () => requestRef.current?.abort();
  }, [canReadSettings, loadLicenseStatus]);

  const pageTitle = <PluginPageTitle>{t('license.pageTitle', 'License')}</PluginPageTitle>;

  if (rbacLoading) {
    return (
      <>
        {pageTitle}
        <Page.Loading>{t('common.loading', 'Loading...')}</Page.Loading>
      </>
    );
  }

  if (rbacError) {
    return (
      <>
        {pageTitle}
        <Page.Error
          content={t(
            'common.permissions.loadError',
            'Your permissions could not be loaded. Reload the page to try again.'
          )}
        />
      </>
    );
  }

  if (!canReadSettings) {
    return (
      <>
        {pageTitle}
        <Page.NoPermissions />
      </>
    );
  }

  const view = getLicenseView(licenseData);
  // Reveal, copy and download need the right to change the license.
  const canUseFullKey = canUpdateSettings && Boolean(view.fullKey);

  const handleCopyLicenseKey = async () => {
    if (!canUseFullKey) return;
    await copy(view.fullKey, { success: t('license.copy.success', 'License key copied') });
  };

  const handleDownloadLicenseKey = () => {
    if (!canUseFullKey) return;
    const { name, notProvided, expiresText, activeLabel } = describeLicense(view, t, formatDate);
    let url = null;
    try {
      const content = buildLicenseFileContent(
        {
          key: view.fullKey,
          name: name || notProvided,
          email: view.details.email || notProvided,
          status: activeLabel,
          expires: expiresText,
          generated: formatDateTime(new Date()),
        },
        {
          title: t('license.file.title', 'Magic Link plugin license key'),
          key: t('license.key.label', 'License key'),
          holder: t('license.file.holder', 'License holder'),
          name: t('license.field.holder', 'Name'),
          email: t('license.field.email', 'Email address'),
          statusSection: t('license.file.statusSection', 'License status'),
          status: t('license.field.status', 'Status'),
          expires: t('license.field.expires', 'Expires on'),
          generated: t('license.file.generated', 'Generated'),
        }
      );
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = LICENSE_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toggleNotification({
        type: 'success',
        message: t('license.download.success', 'License file downloaded'),
      });
    } catch {
      toggleNotification({
        type: 'danger',
        message: t('license.download.error', 'The license file could not be downloaded.'),
      });
    } finally {
      if (url) {
        const objectUrl = url;
        // Revoke after the click has been handled, so the download can start.
        window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
      }
    }
  };

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <LoaderArea aria-busy="true">
          <Loader>{t('license.loading', 'Loading license information...')}</Loader>
        </LoaderArea>
      );
    }

    if (status === 'error') {
      // The header keeps the Refresh button, so a dismissed error still leaves a way to retry.
      if (alertDismissed) return null;
      return (
        <Alert
          variant="danger"
          title={t('license.error.title', 'License unavailable')}
          closeLabel={t('license.alert.close', 'Dismiss message')}
          onClose={() => setAlertDismissed(true)}
          action={
            <Button
              variant="danger-light"
              size="S"
              startIcon={<ArrowClockwise aria-hidden="true" />}
              onClick={refreshLicenseStatus}
              loading={isRefreshing}
            >
              {t('license.retry', 'Try again')}
            </Button>
          }
        >
          {licenseErrorMessage(loadError, t)}
        </Alert>
      );
    }

    return (
      <LicenseOverview
        view={view}
        canUseFullKey={canUseFullKey}
        revealed={revealed}
        alertDismissed={alertDismissed}
        onDismissAlert={() => setAlertDismissed(true)}
        onToggleReveal={() => setRevealed((current) => !current)}
        onCopy={handleCopyLicenseKey}
        onDownload={handleDownloadLicenseKey}
      />
    );
  };

  return (
    <Page.Main>
      {pageTitle}
      <Container>
        <StickyHeader>
          <HeaderRow>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography tag="h1" variant="alpha" textColor="neutral800">
                {t('license.title', 'License management')}
              </Typography>
              <Typography variant="epsilon" textColor="neutral600">
                {t('license.subtitle', 'View the license of your Magic Link plugin')}
              </Typography>
            </Flex>
            <GradientButton
              size="L"
              startIcon={<ArrowClockwise aria-hidden="true" />}
              onClick={refreshLicenseStatus}
              loading={isRefreshing && status !== 'loading'}
              disabled={status === 'loading'}
            >
              {t('license.refresh', 'Refresh status')}
            </GradientButton>
          </HeaderRow>
        </StickyHeader>

        <Content aria-busy={isRefreshing ? 'true' : undefined}>{renderBody()}</Content>
      </Container>
    </Page.Main>
  );
};

const LicensePage = () => (
  <LicenseGuard>
    <LanguageProvider>
      <LicenseView />
    </LanguageProvider>
  </LicenseGuard>
);

export { LicenseView };
export default LicensePage;
