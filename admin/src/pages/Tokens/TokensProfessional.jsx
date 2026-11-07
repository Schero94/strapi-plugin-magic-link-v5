import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Loader } from '@strapi/design-system';
import { ArrowClockwise, Cog, Earth, Key, Lock, Shield, Sparkle } from '@strapi/icons';
import { Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { PluginPageTitle } from '../../components/shared/Headings';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useMagicLinkRBAC } from '../../hooks/useMagicLinkRBAC';
import CreateTokenModal from './CreateTokenModal';
import IPBans from './IPBans';
import JWTSessions from './JWTSessions';
import { MagicLinksPanel } from './MagicLinksPanel';
import OTPCodes from './OTPCodes';
import { CreatedTokenModal } from './components/CreatedTokenModal';
import { TokenTabs } from './components/TokenTabs';
import {
  Container,
  Header,
  HeaderActions,
  HeaderButton,
  HeaderContent,
  Subtitle,
  Title,
} from './components/tokenStyles';
import { getTokenCreationNotice } from './tokenCreateNotice.mjs';
import { buildCreateTokenBody, buildLoginUrl } from './tokenModel';
import { useTokenList, useTokenSettings } from './useTokenData';

const TAB_IDS = Object.freeze(['magic-links', 'otp-codes', 'jwt-sessions', 'ip-bans']);

/**
 * Tokens page: gradient header, accessible tabs and the four tab panels.
 * Every control is gated by the 6.0 RBAC actions (read, manage,
 * settings.read); the server enforces the same actions on each route.
 */
const TokensProfessional = () => {
  const { t } = useMagicLinkIntl();
  const navigate = useNavigate();
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { canRead, canManage, canReadSettings, isLoading: permissionsLoading, error: permissionsError } =
    useMagicLinkRBAC();

  const [activeTab, setActiveTab] = useState(TAB_IDS[0]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState(null);

  const tokenList = useTokenList({ enabled: canRead });
  const { settings, defaultTtlHours } = useTokenSettings({ enabled: canReadSettings });

  /** Shows the one-time token dialog when the response contains the plaintext token. */
  const presentIssuedToken = useCallback(
    (data, email) => {
      if (!data?.token) return;
      setCreatedToken({
        token: data.token,
        email: data.email ?? email,
        expiresAt: data.expires_at ?? data.expiresAt ?? null,
        loginUrl: buildLoginUrl({
          loginUrl: data.loginUrl,
          token: data.token,
          settings,
          origin: window.location.origin,
        }),
      });
    },
    [settings]
  );

  const handleCreateToken = async ({ email, ttl, context, sendEmail }) => {
    if (!canManage) return;
    try {
      const body = buildCreateTokenBody({ email, ttl, context, sendEmail });
      const response = await post('/magic-link/tokens', body);
      setIsCreateOpen(false);
      const notice = getTokenCreationNotice({ sendEmail, email });
      toggleNotification({
        type: 'success',
        message:
          notice.messageId === 'tokens.notifications.created'
            ? t('tokens.notifications.created', 'Login link sent to {email}', notice.values)
            : t('tokens.notifications.createdWithoutEmail', 'Token created. No email was sent.'),
      });
      presentIssuedToken(response?.data, email);
      await tokenList.refetch();
    } catch {
      toggleNotification({
        type: 'warning',
        message: t('tokens.notifications.createError', 'The token could not be created.'),
      });
    }
  };

  const handleRefresh = async () => {
    if (activeTab !== 'magic-links') {
      setRefreshKey((key) => key + 1);
      return;
    }
    const ok = await tokenList.refetch();
    toggleNotification({
      type: ok ? 'success' : 'warning',
      message: ok
        ? t('tokens.notifications.refreshed', 'Data refreshed')
        : t('tokens.notifications.loadError', 'Tokens could not be loaded.'),
    });
  };

  const pageTitle = <PluginPageTitle>{t('tokens.pageTitle', 'Tokens')}</PluginPageTitle>;

  if (permissionsLoading) {
    return (
      <>
        {pageTitle}
        <Page.Loading />
      </>
    );
  }

  if (permissionsError) {
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

  if (!canRead) {
    return (
      <>
        {pageTitle}
        <Page.NoPermissions />
      </>
    );
  }

  const tabs = [
    {
      id: 'magic-links',
      icon: Key,
      label: t('tokens.tabs.magicLinks', 'Magic Link Tokens'),
      shortLabel: t('tokens.tabs.magicLinksShort', 'Links'),
    },
    {
      id: 'otp-codes',
      icon: Lock,
      label: t('tokens.tabs.otpCodes', 'OTP Codes'),
      shortLabel: t('tokens.tabs.otpCodesShort', 'OTP'),
    },
    {
      id: 'jwt-sessions',
      icon: Shield,
      label: t('tokens.tabs.jwtSessions', 'JWT Sessions'),
      shortLabel: t('tokens.tabs.jwtSessionsShort', 'JWT'),
    },
    {
      id: 'ip-bans',
      icon: Earth,
      label: t('tokens.tabs.ipBans', 'IP Bans'),
      shortLabel: t('tokens.tabs.ipBansShort', 'IP'),
    },
  ];

  const panelProps = (id) => ({
    role: 'tabpanel',
    id: `magic-link-panel-${id}`,
    'aria-labelledby': `magic-link-tab-${id}`,
    tabIndex: 0,
  });

  return (
    <Page.Main>
      {pageTitle}
      <Container>
        <Header>
          <HeaderContent justifyContent="space-between" alignItems="center">
            <Box minWidth={0}>
              <Title tag="h1">
                <Sparkle aria-hidden="true" focusable="false" />
                {t('tokens.page.title', 'Token Management')}
              </Title>
              <Subtitle tag="p">
                {t('tokens.page.subtitle', 'Manage Magic Link tokens, OTP codes, JWT sessions and IP bans')}
              </Subtitle>
            </Box>
            <HeaderActions alignItems="center">
              {canManage ? (
                <HeaderButton type="button" onClick={() => setIsCreateOpen(true)}>
                  <Sparkle aria-hidden="true" focusable="false" />
                  {t('tokens.actions.newToken', 'New Token')}
                </HeaderButton>
              ) : null}
              <HeaderButton
                type="button"
                onClick={handleRefresh}
                disabled={activeTab === 'magic-links' && tokenList.isLoading}
              >
                <ArrowClockwise aria-hidden="true" focusable="false" />
                {t('tokens.actions.refresh', 'Refresh')}
              </HeaderButton>
              {canReadSettings ? (
                <HeaderButton type="button" onClick={() => navigate('/settings/magic-link/config')}>
                  <Cog aria-hidden="true" focusable="false" />
                  {t('tokens.actions.settings', 'Settings')}
                </HeaderButton>
              ) : null}
            </HeaderActions>
          </HeaderContent>
        </Header>

        <TokenTabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
          label={t('tokens.tabs.label', 'Token views')}
        />

        <div {...panelProps(activeTab)} key={`${activeTab}-${refreshKey}`}>
          {activeTab === 'magic-links' ? (
            <MagicLinksPanel
              tokens={tokenList.tokens}
              isLoading={tokenList.isLoading}
              error={tokenList.error}
              refetch={tokenList.refetch}
              canManage={canManage}
              onCreate={() => setIsCreateOpen(true)}
              onTokenIssued={presentIssuedToken}
            />
          ) : null}
          {activeTab === 'otp-codes' ? <OTPCodes /> : null}
          {activeTab === 'jwt-sessions' ? <JWTSessions /> : null}
          {activeTab === 'ip-bans' ? <IPBans /> : null}
          {tokenList.isLoading && activeTab === 'magic-links' && tokenList.tokens.length > 0 ? (
            <Box paddingTop={4}>
              <Loader small>{t('tokens.loading', 'Loading tokens...')}</Loader>
            </Box>
          ) : null}
        </div>
      </Container>

      {canManage ? (
        <CreateTokenModal
          isOpen={isCreateOpen}
          defaultTtl={defaultTtlHours}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleCreateToken}
        />
      ) : null}
      <CreatedTokenModal data={createdToken} onClose={() => setCreatedToken(null)} />
    </Page.Main>
  );
};

export default TokensProfessional;
