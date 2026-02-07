import { useState, useEffect, useCallback, useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { useIntl } from 'react-intl';
import {
  Box,
  Button,
  Flex,
  TextInput,
  Textarea,
  Typography,
  Grid,
  Switch,
  NumberInput,
  Divider,
  SingleSelect,
  SingleSelectOption,
  Accordion,
  Badge,
} from '@strapi/design-system';
import { Check, Cog, Mail, Shield, Code, Link, Key, Lock, Lightning, CheckCircle } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import getTrad from '../../utils/getTrad';
import { usePluginLanguage } from '../../components/LanguageProvider';
import { getTemplateList, getTemplate } from '../../utils/emailTemplates';

// ================ THEME ================
const theme = {
  colors: {
    primary: { 600: '#0284C7', 700: '#075985', 100: '#E0F2FE', 50: '#F0F9FF' },
    success: { 600: '#16A34A', 700: '#15803D', 100: '#DCFCE7', 50: '#F0FDF4' },
    danger: { 600: '#DC2626', 700: '#B91C1C', 100: '#FEE2E2', 50: '#FEF2F2' },
    warning: { 600: '#D97706', 700: '#A16207', 100: '#FEF3C7', 50: '#FFFBEB' },
    neutral: { 0: '#FFFFFF', 50: '#F9FAFB', 100: '#F3F4F6', 200: '#E5E7EB', 400: '#9CA3AF', 600: '#4B5563', 700: '#374151', 800: '#1F2937' }
  },
  shadows: { sm: '0 1px 3px rgba(0,0,0,0.1)', md: '0 4px 6px rgba(0,0,0,0.1)', xl: '0 20px 25px rgba(0,0,0,0.1)' },
  borderRadius: { md: '8px', lg: '12px', xl: '16px' }
};

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const PlaceholderGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
`;

const PlaceholderTile = styled(Box)`
  border-radius: 8px;
  border: 1px solid rgba(14, 165, 233, 0.3);
  background: rgba(14, 165, 233, 0.04);
  padding: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  min-height: 120px;
  transition: all 0.15s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(2, 132, 199, 0.15);
    border-color: #0ea5e9;
  }

  &:active {
    transform: translateY(0);
  }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  animation: ${fadeIn} 0.5s;
  max-width: 1400px;
  margin: 0 auto;
`;

const ToggleCard = styled(Box)`
  background: ${props => props.$active ? 'rgba(22, 163, 74, 0.08)' : 'rgba(128, 128, 128, 0.06)'};
  border-radius: ${theme.borderRadius.md};
  padding: 20px;
  transition: all 0.2s ease;
  border: 2px solid ${props => props.$active ? 'rgba(22, 163, 74, 0.4)' : 'rgba(128, 128, 128, 0.2)'};
  box-shadow: ${props => props.$active ? '0 4px 12px rgba(34, 197, 94, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.1)'};
  position: relative;
  user-select: none;
  cursor: pointer;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: ${props => props.$active ? '0 6px 16px rgba(34, 197, 94, 0.25)' : '0 3px 8px rgba(128, 128, 128, 0.2)'};
    border-color: ${props => props.$active ? 'rgba(22, 163, 74, 0.6)' : 'rgba(128, 128, 128, 0.4)'};
  }
  
  &:active {
    transform: translateY(0px);
    box-shadow: ${props => props.$active ? '0 2px 6px rgba(34, 197, 94, 0.15)' : '0 1px 2px rgba(0, 0, 0, 0.1)'};
  }
  
  ${props => props.$active && `
    &::before {
      content: '${props.$statusLabel || ''}';
      position: absolute;
      top: 8px;
      right: 8px;
      background: ${theme.colors.success[600]};
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
    }
  `}
  
  ${props => !props.$active && `
    &::before {
      content: '${props.$statusLabel || ''}';
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(128, 128, 128, 0.5);
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
    }
  `}
`;

const GreenToggle = styled.div`
  ${props => props.$isActive && `
    button[role="switch"] {
      background-color: #16A34A !important;
      border-color: #16A34A !important;
      
      &:hover {
        background-color: #15803D !important;
        border-color: #15803D !important;
      }
      
      &:focus {
        background-color: #16A34A !important;
        border-color: #16A34A !important;
        box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2) !important;
      }
    }
    
    /* Toggle handle */
    button[role="switch"] > span {
      background-color: white !important;
    }
  `}
  
  ${props => !props.$isActive && `
    button[role="switch"] {
      background-color: rgba(128, 128, 128, 0.3);
      
      &:hover {
        background-color: rgba(128, 128, 128, 0.4);
      }
    }
  `}
`;

const StickySaveBar = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--colors-neutral0, white);
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  box-shadow: ${theme.shadows.sm};
`;

const IconWrapper = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  background: ${props => props.$bgColor || 'rgba(2, 132, 199, 0.12)'};
  
  svg {
    width: 24px;
    height: 24px;
    color: ${props => props.$iconColor || theme.colors.primary[600]};
  }
`;

// ================ COMPONENT ================
const SettingsModern = () => {
  const { formatMessage } = useIntl();
  const { toggleNotification } = useNotification();
  const { get, put } = useFetchClient();
  const { language, changeLanguage } = usePluginLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [settings, setSettings] = useState({
    enabled: true,
    createUserIfNotExists: true,
    expire_period: 3600,
    confirmationUrl: '',
    from_name: '',
    from_email: '',
    response_email: '',
    token_length: 32,
    stays_valid: false,
    object: '',
    message_html: '',
    message_text: '',
    max_login_attempts: 5,
    context_whitelist: [],
    context_blacklist: ['password', 'secret', 'apiKey', 'token'],
    login_path: '/magic-link/login',
    user_creation_strategy: 'email',
    verify_email: false,
    welcome_email: false,
    use_jwt_token: true,
    jwt_token_expires_in: '30d',
    callback_url: '',
    allow_magic_links_on_public_registration: false,
    store_login_info: true,
    ui_language: 'en',
    rate_limit_enabled: true,
    rate_limit_max_attempts: 5,
    rate_limit_window_minutes: 15,
    use_email_designer: false,
    email_designer_template_id: '',
    use_magic_mail: false,
    // OTP Settings
    otp_enabled: false,
    otp_type: 'email',
    otp_length: 6,
    otp_expiry: 300,
    otp_max_attempts: 3,
    otp_resend_cooldown: 60,
    // MFA Settings
    mfa_mode: 'disabled',
    mfa_require_totp: false,
    totp_as_primary_auth: false,
    // TOTP Settings
    totp_issuer: 'Magic Link',
    totp_algorithm: 'SHA1',
    totp_digits: 6,
    totp_period: 30,
    // WhatsApp Settings
    whatsapp_enabled: false,
    whatsapp_debug: false,
    whatsapp_app_name: 'Magic Link',
    whatsapp_message_template: `*{{appName}} Login*

Klicke auf den Link um dich einzuloggen:

{{link}}

Dieser Link ist {{expiry}} gültig.

_Falls du diesen Link nicht angefordert hast, ignoriere diese Nachricht._`,
    // Frontend URL Settings
    frontend_url: '',
    frontend_login_path: '/auth/magic-link',
  });
  
  const [rateLimitStats, setRateLimitStats] = useState(null);
  const [emailDesignerInstalled, setEmailDesignerInstalled] = useState(false);
  const [magicMailInstalled, setMagicMailInstalled] = useState(false);
  const [emailProviderConfigured, setEmailProviderConfigured] = useState(false);
  const [emailProviderName, setEmailProviderName] = useState(null);
  const [otpCodes, setOtpCodes] = useState([]);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState(null);
  const [textEditorHeight, setTextEditorHeight] = useState(300);
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [magicMailTemplates, setMagicMailTemplates] = useState([]);

  const placeholderList = useMemo(() => ([
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.url') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.url.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.url.example') })
    },
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.code') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.code.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.code.example') })
    },
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.expiry') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.expiry.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.expiry.example') })
    },
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.link') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.link.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.link.example') })
    },
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.username') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.username.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.username.example') })
    },
    {
      code: formatMessage({ id: getTrad('settings.email.placeholders.email') }),
      desc: formatMessage({ id: getTrad('settings.email.placeholders.email.description') }),
      example: formatMessage({ id: getTrad('settings.email.placeholders.email.example') })
    }
  ]), [formatMessage]);

  const [selectedTemplateKey, setSelectedTemplateKey] = useState(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await get('/magic-link/settings');
      console.log('🔍 Settings Response:', res.data);
      const settingsData = res.data.settings || res.data.data || res.data;
      setSettings(prev => ({ ...prev, ...settingsData }));
      
      // Check if Email Designer is installed
      if (res.data.emailDesignerInstalled !== undefined) {
        setEmailDesignerInstalled(res.data.emailDesignerInstalled);
        console.log('📧 Email Designer:', res.data.emailDesignerInstalled);
      }
      
      // Check if MagicMail is installed
      if (res.data.magicMailInstalled !== undefined) {
        setMagicMailInstalled(res.data.magicMailInstalled);
        console.log('📬 MagicMail:', res.data.magicMailInstalled);
      }
      
      // Check if email provider is configured
      if (res.data.emailProviderConfigured !== undefined) {
        setEmailProviderConfigured(res.data.emailProviderConfigured);
        console.log('✉️ Email Provider Configured:', res.data.emailProviderConfigured);
      }
      if (res.data.emailProviderName !== undefined) {
        setEmailProviderName(res.data.emailProviderName);
        console.log('📮 Email Provider Name:', res.data.emailProviderName);
      }
      
      // Load rate limit stats
      try {
        const statsRes = await get('/magic-link/rate-limit/stats');
        if (statsRes?.data?.data) {
          setRateLimitStats(statsRes.data.data);
        }
      } catch (error) {
        console.error('Error loading rate limit stats:', error);
      }
      
      // Load license info
      try {
        const licenseRes = await get('/magic-link/license/status');
        if (licenseRes?.data) {
          // Convert features to tier for UI compatibility
          let tier = 'free';
          const licenseData = licenseRes.data.data || licenseRes.data;
          
          if (licenseData.features) {
            if (licenseData.features.enterprise) {
              tier = 'enterprise';
            } else if (licenseData.features.advanced) {
              tier = 'advanced';
            } else if (licenseData.features.premium) {
              tier = 'premium';
            }
          }
          
          const enrichedLicenseInfo = {
            ...licenseData,
            tier,
            valid: licenseRes.data.valid !== false,
            demo: licenseRes.data.demo === true
          };
          
          setLicenseInfo(enrichedLicenseInfo);
          console.log('💎 License Info:', enrichedLicenseInfo);
        }
      } catch (error) {
        console.error('Error loading license info:', error);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error loading settings:', error);
        toggleNotification({
          type: 'warning',
          message: formatMessage({ id: getTrad('settings.load.error') })
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [get, toggleNotification, formatMessage]);
  
  // Load email templates when Email Designer is installed
  useEffect(() => {
    const fetchEmailTemplates = async () => {
      if (emailDesignerInstalled) {
        try {
          const response = await get('/email-designer-5/templates');
          if (response && response.data) {
            setEmailTemplates(response.data);
          }
        } catch (error) {
          console.error('Error fetching email templates:', error);
        }
      }
    };
    
    fetchEmailTemplates();
  }, [emailDesignerInstalled, get]);

  // Load MagicMail templates when MagicMail is installed
  useEffect(() => {
    const fetchMagicMailTemplates = async () => {
      if (magicMailInstalled) {
        try {
          const response = await get('/magic-mail/designer/templates');
          const payload = response?.data;
          const templates = Array.isArray(payload)
            ? payload
            : payload?.data || payload?.templates || [];

          setMagicMailTemplates(templates);
          console.log(`✅ MagicMail templates loaded: ${templates.length}`);
        } catch (error) {
          console.error('❌ Error fetching MagicMail templates:', error);
          setMagicMailTemplates([]);
        }
      }
    };
    
    fetchMagicMailTemplates();
  }, [magicMailInstalled, get]);

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect if current HTML/Text matches one of the built-in templates
  useEffect(() => {
    const templateEntry = getTemplateList().find(({ value }) => {
      const tpl = getTemplate(value);
      return tpl.html === settings.message_html && tpl.text === settings.message_text;
    });

    if (templateEntry && templateEntry.value !== selectedTemplateKey) {
      setSelectedTemplateKey(templateEntry.value);
    }
  }, [settings.message_html, settings.message_text, selectedTemplateKey]);

  // Auto-disable premium features if license doesn't support them
  useEffect(() => {
    if (!licenseInfo) return;
    
    const currentTier = licenseInfo.tier || 'free';
    let needsUpdate = false;
    let newSettings = { ...settings };
    
    // Disable Email OTP if not premium/advanced/enterprise
    if (settings.otp_enabled && !['premium', 'advanced', 'enterprise'].includes(currentTier)) {
      newSettings.otp_enabled = false;
      needsUpdate = true;
    }
    
    // Disable TOTP MFA if not advanced/enterprise
    if (settings.mfa_require_totp && !['advanced', 'enterprise'].includes(currentTier)) {
      newSettings.mfa_require_totp = false;
      needsUpdate = true;
    }
    
    // Disable TOTP-only login if not advanced/enterprise
    if (settings.totp_as_primary_auth && !['advanced', 'enterprise'].includes(currentTier)) {
      newSettings.totp_as_primary_auth = false;
      needsUpdate = true;
    }
    
    if (needsUpdate) {
      setSettings(newSettings);
    }
  }, [licenseInfo, settings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // Convert comma-separated strings to arrays before saving
      const toSave = { ...settings, ui_language: language };
      if (typeof toSave.context_whitelist === 'string') {
        toSave.context_whitelist = toSave.context_whitelist.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (typeof toSave.context_blacklist === 'string') {
        toSave.context_blacklist = toSave.context_blacklist.split(',').map(s => s.trim()).filter(Boolean);
      }
      await put('/magic-link/settings', toSave);
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('settings.save.success') })
      });
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error saving settings:', error);
        toggleNotification({
          type: 'danger',
          message: formatMessage({ id: getTrad('settings.save.error') })
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: value });
  };
  
  // Check license before enabling premium/advanced features
  const checkLicenseAndSetMode = (mode) => {
    const currentTier = licenseInfo?.tier || 'free';
    
    // Check license requirements
    if (mode === 'otp-email' && !['premium', 'advanced', 'enterprise'].includes(currentTier)) {
      toggleNotification({
        type: 'warning',
        message: '💎 Premium License Required: Email OTP requires at least Premium license. Please upgrade your license.'
      });
      return false;
    }
    
    if (mode === 'mfa-totp' && !['advanced', 'enterprise'].includes(currentTier)) {
      toggleNotification({
        type: 'warning',
        message: '⚡ Advanced License Required: MFA with TOTP requires at least Advanced license. Please upgrade your license.'
      });
      return false;
    }
    
    if (mode === 'totp-primary' && !['advanced', 'enterprise'].includes(currentTier)) {
      toggleNotification({
        type: 'warning',
        message: '⚡ Advanced License Required: TOTP-only login requires at least Advanced license. Please upgrade your license.'
      });
      return false;
    }
    
    // License check passed
    return true;
  };

  const handleLanguageChange = (newLang) => {
    changeLanguage(newLang);
  };
  
  const handleRateLimitCleanup = async () => {
    try {
      await get('/magic-link/rate-limit/cleanup');
      toggleNotification({
        type: 'success',
        message: formatMessage({ id: getTrad('settings.rateLimit.cleanupSuccess') })
      });
      loadSettings();
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: formatMessage({ id: getTrad('settings.rateLimit.cleanupError') })
      });
    }
  };
  
  const handleRateLimitReset = async () => {
    if (window.confirm(formatMessage({ id: getTrad('settings.rateLimit.resetConfirm') }))) {
      try {
        await get('/magic-link/rate-limit/reset');
        toggleNotification({
          type: 'success',
          message: formatMessage({ id: getTrad('settings.rateLimit.resetSuccess') })
        });
        loadSettings();
      } catch (error) {
        toggleNotification({
          type: 'danger',
          message: formatMessage({ id: getTrad('settings.rateLimit.resetError') })
        });
      }
    }
  };

  if (isLoading) {
    return (
      <Box padding={8}>
        <Typography>{formatMessage({ id: getTrad('settings.load.loading') })}</Typography>
      </Box>
    );
  }

  const statusActive = formatMessage({ id: getTrad('status.active') });
  const statusInactive = formatMessage({ id: getTrad('status.inactive') });

  return (
    <Container as="form" onSubmit={handleSave}>
      {/* Sticky Save Bar */}
      <StickySaveBar paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Flex direction="column" gap={1} alignItems="flex-start">
            <Typography variant="alpha" fontWeight="bold" style={{ fontSize: '24px' }}>
              {formatMessage({ id: getTrad('settings.page.title') })}
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              {formatMessage({ id: getTrad('settings.page.subtitle') })}
            </Typography>
          </Flex>
          <Button
            type="submit"
            loading={isSaving}
            startIcon={<Check />}
            disabled={isSaving}
            size="L"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              fontWeight: '600',
              padding: '12px 24px',
              border: 'none',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            onMouseEnter={(e) => {
              if (!isSaving) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(102, 126, 234, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
            }}
          >
            {isSaving ? formatMessage({ id: getTrad('settings.save.saving') }) : formatMessage({ id: getTrad('settings.save.button') })}
          </Button>
        </Flex>
      </StickySaveBar>

      {/* Content */}
      <Box paddingTop={6} paddingLeft={6} paddingRight={6} paddingBottom={10}>
        {/* Info Banner */}
        <Box
          background="primary50"
          padding={5}
          style={{ borderRadius: theme.borderRadius.lg, border: '2px solid #BAE6FD', marginBottom: '24px' }}
        >
          <Flex gap={3} alignItems="flex-start">
            <Box
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: theme.colors.primary[600],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Cog style={{ width: '20px', height: '20px', color: 'white' }} />
            </Box>
            <Box>
              <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '4px', display: 'block' }}>
                {formatMessage({ id: getTrad('settings.info.header') })}
              </Typography>
              <Typography variant="pi" style={{ lineHeight: '1.6', fontSize: '13px' }}>
                • {formatMessage({ id: getTrad('settings.info.line1') })}<br/>
                • {formatMessage({ id: getTrad('settings.info.line2') })}<br/>
                • {formatMessage({ id: getTrad('settings.info.line3') })}<br/>
                • {formatMessage({ id: getTrad('settings.info.line4') })}
              </Typography>
            </Box>
          </Flex>
        </Box>

        <Accordion.Root type="multiple" defaultValue={['general', 'auth', 'email', 'mfa']}>
          {/* General Settings */}
          <Accordion.Item value="general">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Cog}
                description={formatMessage({ id: getTrad('settings.section.general.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.general') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                {/* Language Selector - Compact */}
                <Box background="neutral50" padding={4} style={{ borderRadius: theme.borderRadius.md, border: '2px solid rgba(128, 128, 128, 0.2)', marginBottom: '24px' }}>
                  <Flex gap={4} alignItems="center">
                    <Typography variant="pi" fontWeight="bold" style={{ minWidth: '150px' }}>
                      {formatMessage({ id: getTrad('settings.language.label') })}
                    </Typography>
                    <Box style={{ width: '200px' }}>
                      <SingleSelect
                        value={language}
                        onChange={handleLanguageChange}
                        size="S"
                      >
                        <SingleSelectOption value="en">{formatMessage({ id: getTrad('settings.language.en') })}</SingleSelectOption>
                        <SingleSelectOption value="de">{formatMessage({ id: getTrad('settings.language.de') })}</SingleSelectOption>
                        <SingleSelectOption value="fr">{formatMessage({ id: getTrad('settings.language.fr') })}</SingleSelectOption>
                        <SingleSelectOption value="es">{formatMessage({ id: getTrad('settings.language.es') })}</SingleSelectOption>
                        <SingleSelectOption value="pt">{formatMessage({ id: getTrad('settings.language.pt') })}</SingleSelectOption>
                      </SingleSelect>
                    </Box>
                    <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', flex: 1 }}>
                      {formatMessage({ id: getTrad('settings.language.hint') })}
                    </Typography>
                  </Flex>
                </Box>

                {/* Feature Toggles */}
                <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px' }}>
                  <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', textAlign: 'center', color: theme.colors.neutral[700] }}>
                    {formatMessage({ id: getTrad('settings.features.title') })}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', textAlign: 'center', fontSize: '12px' }}>
                    {formatMessage({ id: getTrad('settings.features.subtitle') })}
                  </Typography>
                  <Grid.Root gap={4}>
                    <Grid.Item col={4} s={6} xs={12}>
                      <ToggleCard $active={settings.enabled} $statusLabel={settings.enabled ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.enabled}
                              onCheckedChange={(checked) => updateSetting('enabled', checked)}
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.enabled.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.enabled.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    <Grid.Item col={4} s={6} xs={12}>
                      <ToggleCard $active={settings.createUserIfNotExists} $statusLabel={settings.createUserIfNotExists ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.createUserIfNotExists}
                              onCheckedChange={(checked) => updateSetting('createUserIfNotExists', checked)}
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.createUser.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.createUser.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    <Grid.Item col={4} s={6} xs={12}>
                      <ToggleCard $active={settings.stays_valid} $statusLabel={settings.stays_valid ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.stays_valid}
                              onCheckedChange={(checked) => updateSetting('stays_valid', checked)}
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.staysValid.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.feature.staysValid.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                  </Grid.Root>
                </Box>

                {/* Basic Settings */}
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.time.title') })}
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.expire.label') })}
                      </Typography>
                      <NumberInput
                        hint={formatMessage({ id: getTrad('settings.expire.hint') })}
                        value={settings.expire_period}
                        onValueChange={val => updateSetting('expire_period', val)}
                        placeholder={formatMessage({ id: getTrad('settings.expire.placeholder') })}
                      />
                      <Box padding={2} background="primary50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="primary700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.expire.recommendation') })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.tokenLength.label') })}
                      </Typography>
                      <NumberInput
                        hint={formatMessage({ id: getTrad('settings.tokenLength.hint') })}
                        value={settings.token_length}
                        onValueChange={val => updateSetting('token_length', val)}
                        placeholder={formatMessage({ id: getTrad('settings.tokenLength.placeholder') })}
                      />
                      <Box padding={2} background="success50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="success700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.tokenLength.recommendation') }, { length: settings.token_length })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.security.title') })}
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.maxAttempts.label') })}
                      </Typography>
                      <NumberInput
                        hint={formatMessage({ id: getTrad('settings.maxAttempts.hint') })}
                        value={settings.max_login_attempts}
                        onValueChange={val => updateSetting('max_login_attempts', val)}
                        placeholder={formatMessage({ id: getTrad('settings.maxAttempts.placeholder') })}
                      />
                      <Box padding={2} background="warning50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="warning700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.maxAttempts.warning') })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.context.title') })}
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.context.whitelist.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.context.whitelist.hint') })}
                        value={typeof settings.context_whitelist === 'string' ? settings.context_whitelist : (settings.context_whitelist || []).join(', ')}
                        onChange={(e) => {
                          updateSetting('context_whitelist', e.target.value);
                        }}
                        onBlur={(e) => {
                          const value = typeof settings.context_whitelist === 'string' ? settings.context_whitelist : '';
                          const list = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
                          updateSetting('context_whitelist', list);
                        }}
                        placeholder={formatMessage({ id: getTrad('settings.context.whitelist.placeholder') })}
                      />
                      <Box padding={2} background="primary50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="primary700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.context.whitelist.info') })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.context.blacklist.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.context.blacklist.hint') })}
                        value={typeof settings.context_blacklist === 'string' ? settings.context_blacklist : (settings.context_blacklist || []).join(', ')}
                        onChange={(e) => {
                          updateSetting('context_blacklist', e.target.value);
                        }}
                        onBlur={(e) => {
                          const value = typeof settings.context_blacklist === 'string' ? settings.context_blacklist : '';
                          const list = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
                          updateSetting('context_blacklist', list);
                        }}
                        placeholder={formatMessage({ id: getTrad('settings.context.blacklist.placeholder') })}
                      />
                      <Box padding={2} background="danger50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="danger700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.context.blacklist.info') })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.api.title') })}
                </Typography>
                <Grid.Root gap={6}>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.loginPath.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.loginPath.hint') })}
                        value={settings.login_path}
                        onChange={(e) => updateSetting('login_path', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.loginPath.placeholder') })}
                      />
                      <Box padding={2} background="neutral100" style={{ borderRadius: '4px', marginTop: '8px', border: '1px solid rgba(128, 128, 128, 0.2)' }}>
                        <Typography variant="pi" textColor="neutral700" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                          {formatMessage({ id: getTrad('settings.loginPath.fullPath') }, { path: settings.login_path })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.confirmationUrl.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.confirmationUrl.hint') })}
                        value={settings.confirmationUrl}
                        onChange={(e) => updateSetting('confirmationUrl', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.confirmationUrl.placeholder') })}
                      />
                      <Box padding={2} background="primary50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="primary700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.confirmationUrl.example') }, { url: settings.confirmationUrl || 'https://yourapp.com' })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.callbackUrl.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.callbackUrl.hint') })}
                        value={settings.callback_url}
                        onChange={(e) => updateSetting('callback_url', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.callbackUrl.placeholder') })}
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        {formatMessage({ id: getTrad('settings.callbackUrl.note') })}
                      </Typography>
                    </Box>
                  </Grid.Item>
                  
                  {/* Frontend URL Settings */}
                  <Grid.Item col={12}>
                    <Divider style={{ margin: '16px 0' }} />
                    <Typography variant="delta" fontWeight="bold" style={{ marginBottom: '16px', display: 'block' }}>
                      Frontend URL (for SPA/Mobile Apps)
                    </Typography>
                  </Grid.Item>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Frontend Base URL
                      </Typography>
                      <TextInput
                        value={settings.frontend_url || ''}
                        onChange={(e) => updateSetting('frontend_url', e.target.value)}
                        placeholder="https://myapp.com"
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Base URL deiner Frontend-App (React, Vue, etc.). Wenn leer, wird confirmationUrl verwendet.
                      </Typography>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        Login Path
                      </Typography>
                      <TextInput
                        value={settings.frontend_login_path || '/auth/magic-link'}
                        onChange={(e) => updateSetting('frontend_login_path', e.target.value)}
                        placeholder="/auth/magic-link"
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Pfad der an die Frontend URL angehaengt wird.
                      </Typography>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={12}>
                    <Box padding={3} background="primary50" style={{ borderRadius: '8px', marginTop: '8px' }}>
                      <Typography variant="pi" fontWeight="bold" style={{ display: 'block', marginBottom: '4px' }}>
                        Resultierende Magic Link URL:
                      </Typography>
                      <Typography variant="pi" textColor="primary700" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        {settings.frontend_url 
                          ? `${settings.frontend_url.replace(/\/$/, '')}${settings.frontend_login_path || '/auth/magic-link'}?loginToken=ABC123`
                          : `${settings.confirmationUrl || 'http://localhost:1337/api/magic-link/login'}?loginToken=ABC123`
                        }
                      </Typography>
                    </Box>
                  </Grid.Item>
                </Grid.Root>
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* WhatsApp Settings */}
          <Accordion.Item value="whatsapp">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Lightning}
                description="WhatsApp-Nachricht anpassen und Delivery konfigurieren"
              >
                WhatsApp Einstellungen
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                <Grid.Root gap={4}>
                  <Grid.Item col={12}>
                    <Box background="success50" padding={4} style={{ borderRadius: '8px', border: '2px solid #22C55E', marginBottom: '16px' }}>
                      <Flex gap={3} alignItems="flex-start">
                        <Lightning style={{ color: '#22C55E', width: '24px', height: '24px', flexShrink: 0, marginTop: '2px' }} />
                        <Box>
                          <Typography variant="delta" fontWeight="bold" style={{ display: 'block', marginBottom: '4px' }}>
                            WhatsApp Magic Link Delivery
                          </Typography>
                          <Typography variant="pi" textColor="neutral600">
                            Sende Magic Links kostenlos via WhatsApp anstatt per Email. Die Nachricht kann hier angepasst werden.
                          </Typography>
                        </Box>
                      </Flex>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        App Name (in WhatsApp Nachricht)
                      </Typography>
                      <TextInput
                        value={settings.whatsapp_app_name || 'Magic Link'}
                        onChange={(e) => updateSetting('whatsapp_app_name', e.target.value)}
                        placeholder="Magic Link"
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
                        Wird in der WhatsApp-Nachricht als App-Name angezeigt.
                      </Typography>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={6} s={12}>
                    <Flex direction="column" gap={3}>
                      <ToggleCard $active={settings.whatsapp_debug} $statusLabel={settings.whatsapp_debug ? 'DEBUG' : 'OFF'} onClick={() => updateSetting('whatsapp_debug', !settings.whatsapp_debug)}>
                        <Flex gap={3} alignItems="center">
                          <GreenToggle $isActive={settings.whatsapp_debug}>
                            <Switch checked={settings.whatsapp_debug} onCheckedChange={(checked) => updateSetting('whatsapp_debug', checked)} />
                          </GreenToggle>
                          <Box>
                            <Typography variant="omega" fontWeight="bold">Debug Mode</Typography>
                            <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px' }}>
                              Aktiviert ausfuehrliche WhatsApp-Logs
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Flex>
                  </Grid.Item>
                  
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        WhatsApp Nachricht Template
                      </Typography>
                      <Textarea
                        value={settings.whatsapp_message_template || ''}
                        onChange={(e) => updateSetting('whatsapp_message_template', e.target.value)}
                        style={{ minHeight: '200px', fontFamily: 'monospace', fontSize: '13px' }}
                      />
                      <Box padding={3} background="neutral100" style={{ borderRadius: '8px', marginTop: '12px' }}>
                        <Typography variant="pi" fontWeight="bold" style={{ display: 'block', marginBottom: '8px' }}>
                          Verfuegbare Platzhalter:
                        </Typography>
                        <Flex gap={2} wrap="wrap">
                          <Badge backgroundColor="primary100" textColor="primary700">{'{{appName}}'}</Badge>
                          <Badge backgroundColor="primary100" textColor="primary700">{'{{link}}'}</Badge>
                          <Badge backgroundColor="primary100" textColor="primary700">{'{{expiry}}'}</Badge>
                        </Flex>
                        <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
                          *text* = Fett, _text_ = Kursiv (WhatsApp Formatierung)
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={12}>
                    <Box padding={4} background="neutral50" style={{ borderRadius: '8px', border: '1px solid rgba(128, 128, 128, 0.2)' }}>
                      <Typography variant="pi" fontWeight="bold" style={{ display: 'block', marginBottom: '8px' }}>
                        Vorschau:
                      </Typography>
                      <Box padding={3} background="neutral0" style={{ borderRadius: '8px', whiteSpace: 'pre-wrap', fontFamily: 'system-ui', fontSize: '14px', lineHeight: '1.5', border: '1px solid rgba(128, 128, 128, 0.2)' }}>
                        {(settings.whatsapp_message_template || '')
                          .replace(/\{\{appName\}\}/g, settings.whatsapp_app_name || 'Magic Link')
                          .replace(/\{\{link\}\}/g, settings.frontend_url 
                            ? `${settings.frontend_url.replace(/\/$/, '')}${settings.frontend_login_path || '/auth/magic-link'}?loginToken=ABC123`
                            : `${settings.confirmationUrl || 'http://localhost:1337'}?loginToken=ABC123`)
                          .replace(/\{\{expiry\}\}/g, '1 Stunde')
                        }
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Authentication Settings */}
          <Accordion.Item value="auth">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description={formatMessage({ id: getTrad('settings.section.auth.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.auth') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                {/* Auth Toggles */}
                <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px' }}>
                  <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', textAlign: 'center', color: theme.colors.neutral[700] }}>
                    {formatMessage({ id: getTrad('settings.auth.options.title') })}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', textAlign: 'center', fontSize: '12px' }}>
                    {formatMessage({ id: getTrad('settings.auth.options.subtitle') })}
                  </Typography>
                  <Grid.Root gap={4}>
                    <Grid.Item col={3} s={6} xs={12}>
                      <ToggleCard $active={settings.verify_email} $statusLabel={settings.verify_email ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.verify_email}
                              onCheckedChange={(checked) => updateSetting('verify_email', checked)}
                              size="L"
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.verifyEmail.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.verifyEmail.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    <Grid.Item col={3} s={6} xs={12}>
                      <ToggleCard $active={settings.welcome_email} $statusLabel={settings.welcome_email ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.welcome_email}
                              onCheckedChange={(checked) => updateSetting('welcome_email', checked)}
                              size="L"
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.welcomeEmail.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.welcomeEmail.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    <Grid.Item col={3} s={6} xs={12}>
                      <ToggleCard $active={settings.use_jwt_token} $statusLabel={settings.use_jwt_token ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.use_jwt_token}
                              onCheckedChange={(checked) => updateSetting('use_jwt_token', checked)}
                              size="L"
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.useJwt.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.useJwt.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                    <Grid.Item col={3} s={6} xs={12}>
                      <ToggleCard $active={settings.store_login_info} $statusLabel={settings.store_login_info ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.store_login_info}
                              onCheckedChange={(checked) => updateSetting('store_login_info', checked)}
                              size="L"
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.storeLoginInfo.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.auth.storeLoginInfo.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                  </Grid.Root>
                </Box>

                {/* Auth Settings */}
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.auth.management.title') })}
                </Typography>
                <Grid.Root gap={6}>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.auth.strategy.label') })}
                      </Typography>
                      <SingleSelect
                        value={settings.user_creation_strategy}
                        onChange={(val) => updateSetting('user_creation_strategy', val)}
                      >
                        <SingleSelectOption value="email">{formatMessage({ id: getTrad('settings.auth.strategy.email') })}</SingleSelectOption>
                        <SingleSelectOption value="emailUsername">{formatMessage({ id: getTrad('settings.auth.strategy.emailUsername') })}</SingleSelectOption>
                        <SingleSelectOption value="manual">{formatMessage({ id: getTrad('settings.auth.strategy.manual') })}</SingleSelectOption>
                      </SingleSelect>
                      <Box padding={2} background="neutral100" style={{ borderRadius: '4px', marginTop: '8px', border: '1px solid rgba(128, 128, 128, 0.2)' }}>
                        <Typography variant="pi" textColor="neutral700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.auth.strategy.current') }, { 
                            strategy: settings.user_creation_strategy === 'email' ? formatMessage({ id: getTrad('settings.auth.strategy.email') }) :
                                     settings.user_creation_strategy === 'emailUsername' ? formatMessage({ id: getTrad('settings.auth.strategy.emailUsername') }) :
                                     formatMessage({ id: getTrad('settings.auth.strategy.manual') })
                          })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.auth.jwtExpiration.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.auth.jwtExpiration.hint') })}
                        value={settings.jwt_token_expires_in}
                        onChange={(e) => updateSetting('jwt_token_expires_in', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.auth.jwtExpiration.placeholder') })}
                      />
                      <Box padding={2} background="success50" style={{ borderRadius: '4px', marginTop: '8px' }}>
                        <Typography variant="pi" textColor="success700" style={{ fontSize: '11px' }}>
                          {formatMessage({ id: getTrad('settings.auth.jwtExpiration.examples') })}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid.Item>
                </Grid.Root>
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Email Settings */}
          <Accordion.Item value="email">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Mail}
                description={formatMessage({ id: getTrad('settings.section.email.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.email') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                {/* Email Provider Warning */}
                {!emailProviderConfigured && !magicMailInstalled && (
                  <Box 
                    background="danger100" 
                    padding={5} 
                    style={{ 
                      borderRadius: theme.borderRadius.md, 
                      marginBottom: '32px', 
                      border: '2px solid #fca5a5',
                      boxShadow: '0 4px 12px rgba(220, 38, 38, 0.15)'
                    }}
                  >
                    <Flex direction="column" gap={3}>
                      <Flex alignItems="center" gap={2}>
                        <Mail style={{ color: theme.colors.danger[600], width: '24px', height: '24px' }} />
                        <Typography variant="delta" fontWeight="bold" style={{ color: theme.colors.danger[700] }}>
                          ⚠️ No Email Provider Configured
                        </Typography>
                      </Flex>
                      <Typography variant="pi" style={{ fontSize: '13px', color: theme.colors.danger[700], lineHeight: '1.6' }}>
                        <strong>Magic Link cannot send emails!</strong> You need to configure an email provider for the plugin to work.
                      </Typography>
                      <Divider style={{ backgroundColor: theme.colors.danger[300] }} />
                      <Typography variant="pi" fontWeight="semiBold" style={{ fontSize: '13px', color: theme.colors.danger[800], marginBottom: '8px' }}>
                        📋 Choose one of these options:
                      </Typography>
                      <Box paddingLeft={3}>
                        <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.danger[700], lineHeight: '1.8' }}>
                          <strong>1. Install Nodemailer (Recommended)</strong><br/>
                          <code style={{ 
                            backgroundColor: 'rgba(255,255,255,0.8)', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                            fontSize: '11px'
                          }}>npm install @strapi/provider-email-nodemailer</code>
                          <br/>Then configure in <code>config/plugins.js</code>
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.danger[700], lineHeight: '1.8', marginTop: '12px', display: 'block' }}>
                          <strong>2. Install MagicMail Plugin</strong><br/>
                          Advanced email routing with OAuth2, multi-account support, and analytics
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.danger[700], lineHeight: '1.8', marginTop: '12px', display: 'block' }}>
                          <strong>3. Use other providers</strong><br/>
                          SendGrid, Mailgun, Amazon SES, or any Strapi email provider
                        </Typography>
                      </Box>
                    </Flex>
                  </Box>
                )}
                
                {/* Email Provider Success */}
                {(emailProviderConfigured || magicMailInstalled) && (
                  <Box 
                    background="success100" 
                    padding={4} 
                    style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px', border: '2px solid #86efac' }}
                  >
                    <Flex alignItems="center" gap={2}>
                      <Check style={{ color: theme.colors.success[600] }} />
                      <Typography variant="pi" fontWeight="semiBold" style={{ color: theme.colors.success[700] }}>
                        {magicMailInstalled 
                          ? '✅ Email Provider: MagicMail (Advanced Routing)' 
                          : `✅ Email Provider: ${emailProviderName || 'Configured'}`}
                      </Typography>
                    </Flex>
                  </Box>
                )}
                
                {/* Email From Settings */}
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.email.sender.title') })}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', fontSize: '12px' }}>
                  {formatMessage({ id: getTrad('settings.email.sender.subtitle') })}
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={4} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.email.fromName.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.email.fromName.hint') })}
                        value={settings.from_name}
                        onChange={(e) => updateSetting('from_name', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.email.fromName.placeholder') })}
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                        {formatMessage({ id: getTrad('settings.email.fromName.example') })}
                      </Typography>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={4} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.email.fromEmail.label') })}
                      </Typography>
                      <TextInput
                        type="email"
                        hint={formatMessage({ id: getTrad('settings.email.fromEmail.hint') })}
                        value={settings.from_email}
                        onChange={(e) => updateSetting('from_email', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.email.fromEmail.placeholder') })}
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                        {formatMessage({ id: getTrad('settings.email.fromEmail.note') })}
                      </Typography>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={4} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.email.responseEmail.label') })}
                      </Typography>
                      <TextInput
                        type="email"
                        hint={formatMessage({ id: getTrad('settings.email.responseEmail.hint') })}
                        value={settings.response_email}
                        onChange={(e) => updateSetting('response_email', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.email.responseEmail.placeholder') })}
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                        {formatMessage({ id: getTrad('settings.email.responseEmail.note') })}
                      </Typography>
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.email.subject.label') })}
                      </Typography>
                      <TextInput
                        hint={formatMessage({ id: getTrad('settings.email.subject.hint') })}
                        value={settings.object}
                        onChange={(e) => updateSetting('object', e.target.value)}
                        placeholder={formatMessage({ id: getTrad('settings.email.subject.placeholder') })}
                      />
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                        {formatMessage({ id: getTrad('settings.email.subject.note') })}
                      </Typography>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                {/* Email Designer Integration (Optional) */}
                {emailDesignerInstalled && (
                  <>
                    <Divider style={{ marginBottom: '24px' }} />
                    
                    {/* Header Section */}
                    <Box 
                      background="neutral0" 
                      padding={5} 
                      style={{ 
                        borderRadius: theme.borderRadius.lg, 
                        border: '2px solid #10b981', 
                        marginBottom: '24px',
                        background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)'
                      }}
                    >
                      <Flex alignItems="center" gap={3} style={{ marginBottom: '12px' }}>
                        <Check width="24px" height="24px" style={{ color: '#059669' }} />
                        <Typography variant="delta" fontWeight="bold" style={{ color: '#065F46' }}>
                          📧 Email Designer Integration
                        </Typography>
                        <Badge style={{ backgroundColor: '#10b981', color: 'white' }}>Active</Badge>
                      </Flex>
                      <Typography variant="pi" style={{ color: '#047857', fontSize: '13px' }}>
                        Use your beautiful Email Designer 5 templates for Magic Link emails!
                      </Typography>
                    </Box>

                    {/* Toggle & Template Selection */}
                    <Box 
                      background="white" 
                      padding={5} 
                      style={{ 
                        borderRadius: theme.borderRadius.lg, 
                        border: '2px solid rgba(128, 128, 128, 0.2)',
                        marginBottom: '24px'
                      }}
                    >
                      <Grid.Root gap={6}>
                        <Grid.Item col={12}>
                          <Flex alignItems="center" gap={3} style={{ marginBottom: '8px' }}>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '15px' }}>
                              Use Email Designer Template
                            </Typography>
                            <GreenToggle $isActive={settings.use_email_designer || false}>
                              <Switch
                                checked={settings.use_email_designer || false}
                                onCheckedChange={(checked) => updateSetting('use_email_designer', checked)}
                              />
                            </GreenToggle>
                          </Flex>
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                            Enable to use a professionally designed template from Email Designer 5
                          </Typography>
                        </Grid.Item>
                        
                        {settings.use_email_designer && (
                          <Grid.Item col={12}>
                            <Divider style={{ marginBottom: '16px', marginTop: '8px' }} />
                            <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '12px', display: 'block', fontSize: '14px' }}>
                              📋 Select Your Template
                            </Typography>
                            <Box 
                              padding={4} 
                              background="primary50" 
                              style={{ 
                                borderRadius: '8px', 
                                border: '2px solid #BAE6FD',
                                marginBottom: '16px'
                              }}
                            >
                              <SingleSelect
                                value={settings.email_designer_template_id}
                                onChange={(value) => {
                                  updateSetting('email_designer_template_id', value);
                                  toggleNotification({ 
                                    type: 'success', 
                                    message: '✅ Email Designer template selected!' 
                                  });
                                }}
                                placeholder="Choose a template from Email Designer..."
                                size="L"
                              >
                                {emailTemplates.map((template) => (
                                  <SingleSelectOption key={template.id} value={template.id.toString()}>
                                    📄 {template.name || template.subject || `Template #${template.id}`}
                                  </SingleSelectOption>
                                ))}
                              </SingleSelect>
                            </Box>
                            {emailTemplates.length > 0 ? (
                              <Box 
                                background="success100" 
                                padding={3} 
                                style={{ borderRadius: '6px', border: '1px solid #86efac' }}
                              >
                                <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.success[700] }}>
                                  ✨ {emailTemplates.length} template{emailTemplates.length !== 1 ? 's' : ''} available
                                </Typography>
                              </Box>
                            ) : (
                              <Box 
                                background="warning100" 
                                padding={3} 
                                style={{ borderRadius: '6px', border: '1px solid #fcd34d' }}
                              >
                                <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.warning[700] }}>
                                  ⚠️ No templates found. Create one in Email Designer 5 first!
                                </Typography>
                              </Box>
                            )}
                          </Grid.Item>
                        )}
                      </Grid.Root>
                    </Box>
                    
                    <Box 
                      background="warning100" 
                      padding={3} 
                      style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px', border: '1px solid #fcd34d' }}
                    >
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.warning[700] }}>
                        {formatMessage({ id: getTrad('settings.email.designer.variables') })}
                      </Typography>
                    </Box>
                  </>
                )}

                {/* MagicMail Integration (Optional) */}
                {magicMailInstalled && (
                  <>
                    <Divider style={{ marginBottom: '24px' }} />
                    
                    {/* Header Section */}
                    <Box 
                      padding={6} 
                      style={{ 
                        borderRadius: '16px', 
                        border: 'none',
                        marginBottom: '24px',
                        background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
                        boxShadow: '0 10px 25px rgba(124, 58, 237, 0.3)'
                      }}
                    >
                      <Flex alignItems="center" gap={3} style={{ marginBottom: '12px' }}>
                        <div style={{ 
                          background: 'rgba(255, 255, 255, 0.2)', 
                          padding: '10px', 
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Mail width="24px" height="24px" style={{ color: 'white' }} />
                        </div>
                        <Typography variant="delta" fontWeight="bold" style={{ color: 'white', fontSize: '20px' }}>
                          MagicMail Integration
                        </Typography>
                        <Box
                          style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.2)',
                            color: '#FFFFFF',
                            border: '1px solid rgba(255, 255, 255, 0.5)',
                            borderRadius: '999px',
                            padding: '4px 14px',
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.8px'
                          }}
                        >
                          Active
                        </Box>
                      </Flex>
                      <Typography variant="pi" style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '14px', lineHeight: '1.6' }}>
                        Advanced email routing with OAuth2 accounts, automatic failover, and comprehensive analytics
                      </Typography>
                    </Box>

                    {/* Toggle & Template Selection */}
                    <Box 
                      background="white" 
                      padding={5} 
                      style={{ 
                        borderRadius: theme.borderRadius.lg, 
                        border: '2px solid rgba(128, 128, 128, 0.2)',
                        marginBottom: '24px'
                      }}
                    >
                      <Grid.Root gap={6}>
                        <Grid.Item col={12}>
                          <Flex alignItems="center" gap={3} style={{ marginBottom: '8px' }}>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '15px' }}>
                              Use MagicMail for Sending
                            </Typography>
                            <GreenToggle $isActive={settings.use_magic_mail || false}>
                              <Switch
                                checked={settings.use_magic_mail || false}
                                onCheckedChange={(checked) => updateSetting('use_magic_mail', checked)}
                              />
                            </GreenToggle>
                          </Flex>
                        </Grid.Item>
                        
                        {settings.use_magic_mail && (
                          <Grid.Item col={12}>
                            <Divider style={{ marginBottom: '20px', marginTop: '16px' }} />
                            
                            <Box 
                              padding={5} 
                              style={{ 
                                borderRadius: '12px', 
                                border: '2px solid rgba(139, 92, 246, 0.3)',
                                background: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)',
                                marginBottom: '16px'
                              }}
                            >
                              <Flex alignItems="center" gap={2} style={{ marginBottom: '16px' }}>
                                <div style={{
                                  background: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
                                  padding: '8px',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  <Mail width="16px" height="16px" style={{ color: 'white' }} />
                                </div>
                                <Typography variant="pi" fontWeight="bold" style={{ fontSize: '15px', color: '#5B21B6' }}>
                                  Select Email Template
                                </Typography>
                              </Flex>
                              
                              <SingleSelect
                                value={settings.magic_mail_template_id}
                                onChange={(value) => {
                                  updateSetting('magic_mail_template_id', value);
                                  const selectedTemplate = magicMailTemplates.find(t => t.id.toString() === value);
                                  toggleNotification({ 
                                    type: 'success', 
                                    message: `✅ Template "${selectedTemplate?.name || 'Selected'}" is now active!` 
                                  });
                                }}
                                placeholder="🔍 Choose a template from MagicMail..."
                                size="L"
                              >
                                {magicMailTemplates.map((template) => (
                                  <SingleSelectOption key={template.id} value={template.id.toString()}>
                                    📧 {template.name || template.subject || `Template #${template.id}`}
                                  </SingleSelectOption>
                                ))}
                              </SingleSelect>
                              
                              <Typography variant="omega" style={{ fontSize: '12px', color: '#7C3AED', marginTop: '12px', display: 'block' }}>
                                💡 Templates are managed in your MagicMail settings
                              </Typography>
                            </Box>
                          </Grid.Item>
                        )}
                      </Grid.Root>
                    </Box>
                    
                    <Box 
                      background="warning100" 
                      padding={3} 
                      style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px', border: '1px solid #fcd34d' }}
                    >
                      <Flex gap={2} alignItems="flex-start">
                        <CheckCircle width="14px" height="14px" style={{ color: theme.colors.warning[700], flexShrink: 0, marginTop: '2px' }} />
                        <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.warning[700] }}>
                          <strong>Tip:</strong> MagicMail will use your configured email accounts and routing rules. Make sure you have at least one active account configured in MagicMail settings.
                        </Typography>
                      </Flex>
                    </Box>
                  </>
                )}

                {/* Email Templates */}
                <Divider style={{ marginBottom: '24px' }} />
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.email.templates.title') })}
                  {emailDesignerInstalled && settings.use_email_designer && (
                    <Badge style={{ marginLeft: '8px', backgroundColor: theme.colors.neutral[400] }}>
                      {formatMessage({ id: getTrad('settings.email.designer.fallbackBadge') })}
                    </Badge>
                  )}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', fontSize: '12px' }}>
                  {emailDesignerInstalled && settings.use_email_designer 
                    ? formatMessage({ id: getTrad('settings.email.designer.fallbackDescription') })
                    : formatMessage({ id: getTrad('settings.email.templates.subtitle') })}
                </Typography>
                
                {/* Platzhalter Info Box - Kompakt */}
                <Box 
                  background="primary100" 
                  padding={3} 
                  style={{ borderRadius: theme.borderRadius.md, marginBottom: '16px', border: '2px solid #BAE6FD' }}
                >
                  <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '12px' }}>
                    <Typography variant="pi" fontWeight="bold" style={{ color: theme.colors.primary[700], fontSize: '13px' }}>
                      📋 {formatMessage({ id: getTrad('settings.email.placeholders.title') })}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px' }}>
                      {formatMessage({ id: getTrad('settings.email.placeholders.clickToCopy') })}
                    </Typography>
                  </Flex>
                  <PlaceholderGrid>
                    {placeholderList.map((placeholder) => (
                      <PlaceholderTile
                        key={placeholder.code}
                        onClick={() => {
                          navigator.clipboard.writeText(placeholder.code);
                          toggleNotification({ 
                            type: 'success', 
                            message: formatMessage({ id: getTrad('settings.email.placeholders.copied') }, { placeholder: placeholder.code })
                          });
                        }}
                      >
                        <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: '6px' }}>
                          <Typography variant="pi" style={{ 
                            fontFamily: 'monospace', 
                            fontSize: '13px', 
                            color: theme.colors.primary[700], 
                            fontWeight: 'bold',
                            wordBreak: 'break-all'
                          }}>
                            {placeholder.code}
                          </Typography>
                          <Badge size="S" style={{ backgroundColor: '#0EA5E9', color: 'white' }}>
                            {formatMessage({ id: getTrad('settings.email.placeholders.copyLabel') })}
                          </Badge>
                        </Flex>
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '11px', lineHeight: '1.4', flexGrow: 1 }}>
                          {placeholder.desc}
                        </Typography>
                        <Typography variant="omega" style={{ fontSize: '9px', color: '#999', fontFamily: 'monospace', marginTop: '6px' }}>
                          {placeholder.example}
                        </Typography>
                      </PlaceholderTile>
                    ))}
                  </PlaceholderGrid>
                </Box>

                {/* Show template gallery + editors whenever MagicMail sending is disabled */}
                {!settings.use_magic_mail && (
                  <>
                    {/* Beautiful Template Selector */}
                    <Box 
                      background="neutral0" 
                      padding={5} 
                      style={{ borderRadius: theme.borderRadius.lg, border: '2px solid #0EA5E9', marginBottom: '24px', background: 'rgba(14, 165, 233, 0.06)' }}
                    >
                      <Flex alignItems="center" gap={2} style={{ marginBottom: '12px' }}>
                        <Mail width="20px" height="20px" style={{ color: '#0EA5E9' }} />
                        <Typography variant="delta" fontWeight="bold" style={{ color: '#0369A1' }}>
                          🎨 Email Template Gallery
                        </Typography>
                        <Badge style={{ backgroundColor: '#0EA5E9', color: 'white' }}>New</Badge>
                      </Flex>
                      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '16px', fontSize: '13px' }}>
                        Choose from our professionally designed templates. Click to instantly load a beautiful template!
                      </Typography>

                      <Box
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                          gap: '12px'
                        }}
                      >
                        {getTemplateList().map((template) => {
                          const isActive = selectedTemplateKey === template.value;
                          return (
                            <Box
                              key={template.value}
                              role="button"
                              tabIndex={0}
                              background="white"
                              style={{
                                borderRadius: '10px',
                                border: `2px solid ${isActive ? 'rgba(2, 132, 199, 0.6)' : 'rgba(128, 128, 128, 0.2)'}`,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                padding: '16px',
                                minHeight: '110px',
                                boxShadow: isActive ? '0 8px 20px rgba(2, 132, 199, 0.25)' : '0 2px 6px rgba(15, 23, 42, 0.08)',
                                background: isActive ? 'rgba(14, 165, 233, 0.08)' : 'rgba(128, 128, 128, 0.04)',
                                outline: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between'
                              }}
                              onClick={() => {
                                const selectedTemplate = getTemplate(template.value);
                                setSelectedTemplateKey(template.value);
                                setSettings(prev => ({
                                  ...prev,
                                  message_html: selectedTemplate.html,
                                  message_text: selectedTemplate.text
                                }));
                                toggleNotification({ 
                                  type: 'success', 
                                  message: `✨ Template "${template.label}" loaded!` 
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  const selectedTemplate = getTemplate(template.value);
                                  setSelectedTemplateKey(template.value);
                                  setSettings(prev => ({
                                    ...prev,
                                    message_html: selectedTemplate.html,
                                    message_text: selectedTemplate.text
                                  }));
                                  toggleNotification({ 
                                    type: 'success', 
                                    message: `✨ Template "${template.label}" loaded!` 
                                  });
                                }
                              }}
                            >
                              <Typography
                                variant="pi"
                                fontWeight="bold"
                                style={{
                                  marginBottom: '6px',
                                  display: 'block',
                                  fontSize: '14px',
                                  color: isActive ? '#0F172A' : '#111827'
                                }}
                              >
                                {template.label}
                              </Typography>
                              <Typography
                                variant="omega"
                                textColor="neutral600"
                                style={{ fontSize: '12px', lineHeight: '1.4' }}
                              >
                                {template.preview}
                              </Typography>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>

                    <Grid.Root gap={8}>
                  <Grid.Item col={12}>
                    <Box 
                      background="neutral0" 
                      padding={6} 
                      style={{ borderRadius: theme.borderRadius.lg, border: '2px solid rgba(128, 128, 128, 0.2)', width: '100%' }}
                    >
                      <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '16px' }}>
                        <Flex alignItems="center" gap={2}>
                          <Typography variant="delta" fontWeight="bold" style={{ fontSize: '18px' }}>
                            {formatMessage({ id: getTrad('settings.email.html.title') })}
                          </Typography>
                          <Badge variant="success">{formatMessage({ id: getTrad('settings.email.html.badge') })}</Badge>
                        </Flex>
                        <Button
                          variant="tertiary"
                          size="S"
                          onClick={() => {
                            const defaultTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <h2>Magic Link Login</h2>
  <p>${formatMessage({ id: getTrad('settings.email.placeholders.url.description') })}</p>
  <p><a href="<%= URL %>?loginToken=<%= CODE %>">${language === 'de' ? 'Jetzt anmelden' : 'Sign in now'}</a></p>
  <p style="color: #666; font-size: 14px;">${language === 'de' ? 'Der Link läuft in 1 Stunde ab.' : 'The link expires in 1 hour.'}</p>
</body>
</html>`;
                            updateSetting('message_html', defaultTemplate);
                            toggleNotification({ type: 'success', message: formatMessage({ id: getTrad('settings.email.html.defaultLoaded') }) });
                          }}
                        >
                          {formatMessage({ id: getTrad('settings.email.html.loadDefault') })}
                        </Button>
                      </Flex>
                      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '16px', display: 'block', fontSize: '14px' }}>
                        {formatMessage({ id: getTrad('settings.email.html.description') })}
                      </Typography>
                      <Box 
                        style={{ 
                          border: '2px solid rgba(128, 128, 128, 0.2)', 
                          borderRadius: '6px', 
                          overflow: 'hidden',
                          background: '#1e1e1e',
                          height: '700px',
                          display: 'flex',
                          flexDirection: 'column'
                        }}
                      >
                        <Box 
                          padding={2} 
                          background="neutral700" 
                          style={{ borderBottom: '1px solid #333', flexShrink: 0 }}
                        >
                          <Typography variant="omega" style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace' }}>
                            {formatMessage({ id: getTrad('settings.email.html.filename') })}
                          </Typography>
                        </Box>
                        <textarea
                          value={settings.message_html}
                          onChange={(e) => updateSetting('message_html', e.target.value)}
                          style={{ 
                            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                            height: '100%',
                            fontSize: '14px',
                            lineHeight: '1.8',
                            background: '#1e1e1e',
                            color: '#d4d4d4',
                            border: 'none',
                            padding: '20px',
                            resize: 'none',
                            width: '100%',
                            boxSizing: 'border-box',
                            outline: 'none',
                            margin: 0,
                            display: 'block',
                            overflow: 'auto'
                          }}
                          placeholder={formatMessage({ id: getTrad('settings.email.html.placeholder') })}
                        />
                      </Box>
                      <Flex gap={2} style={{ marginTop: '12px' }} wrap="wrap">
                        <Button
                          variant="secondary"
                          size="S"
                          onClick={() => {
                            navigator.clipboard.writeText(settings.message_html);
                            toggleNotification({ type: 'success', message: formatMessage({ id: getTrad('settings.email.html.copy') }) + '!' });
                          }}
                        >
                          {formatMessage({ id: getTrad('settings.email.html.copy') })}
                        </Button>
                        <Button
                          variant="tertiary"
                          size="S"
                          onClick={() => {
                            const lines = settings.message_html.split('\n').length;
                            const chars = settings.message_html.length;
                            toggleNotification({ 
                              type: 'info', 
                              message: formatMessage({ id: getTrad('settings.email.html.stats') }, { lines, chars })
                            });
                          }}
                        >
                          {formatMessage({ id: getTrad('settings.email.html.info') })}
                        </Button>
                      </Flex>
                    </Box>
                  </Grid.Item>
                  
                  <Grid.Item col={12}>
                    <Box 
                      background="neutral0" 
                      padding={6} 
                      style={{ borderRadius: theme.borderRadius.lg, border: '2px solid rgba(128, 128, 128, 0.2)', width: '100%' }}
                    >
                      <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '16px' }}>
                        <Flex alignItems="center" gap={2}>
                          <Typography variant="delta" fontWeight="bold" style={{ fontSize: '18px' }}>
                            {formatMessage({ id: getTrad('settings.email.text.title') })}
                          </Typography>
                          <Badge variant="secondary">{formatMessage({ id: getTrad('settings.email.text.badge') })}</Badge>
                        </Flex>
                        <Button
                          variant="tertiary"
                          size="S"
                          onClick={() => {
                            const defaultTemplate = `${language === 'de' ? 'Hallo' : 'Hello'},

${language === 'de' ? 'Klicke auf den folgenden Link, um dich anzumelden' : 'Click the following link to sign in'}:

<%= URL %>?loginToken=<%= CODE %>

${language === 'de' ? 'Der Link läuft in 1 Stunde ab.' : 'The link expires in 1 hour.'}`;
                            updateSetting('message_text', defaultTemplate);
                            toggleNotification({ type: 'success', message: formatMessage({ id: getTrad('settings.email.text.defaultLoaded') }) });
                          }}
                        >
                          {formatMessage({ id: getTrad('settings.email.text.loadDefault') })}
                        </Button>
                      </Flex>
                      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '16px', display: 'block', fontSize: '14px' }}>
                        {formatMessage({ id: getTrad('settings.email.text.description') })}
                      </Typography>
                      <Box 
                        style={{ 
                          border: '2px solid rgba(128, 128, 128, 0.2)', 
                          borderRadius: '6px', 
                          overflow: 'hidden',
                          background: '#f5f5f5',
                          height: '500px',
                          display: 'flex',
                          flexDirection: 'column'
                        }}
                      >
                        <Box 
                          padding={2} 
                          background="neutral200" 
                          style={{ borderBottom: '1px solid rgba(128, 128, 128, 0.2)', flexShrink: 0 }}
                        >
                          <Typography variant="omega" style={{ color: '#666', fontSize: '11px', fontFamily: 'monospace' }}>
                            {formatMessage({ id: getTrad('settings.email.text.filename') })}
                          </Typography>
                        </Box>
                        <textarea
                          value={settings.message_text}
                          onChange={(e) => updateSetting('message_text', e.target.value)}
                          style={{ 
                            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                            height: '100%',
                            fontSize: '14px',
                            lineHeight: '1.8',
                            background: '#f5f5f5',
                            color: '#1f2937',
                            border: 'none',
                            padding: '20px',
                            resize: 'none',
                            width: '100%',
                            boxSizing: 'border-box',
                            outline: 'none',
                            margin: 0,
                            display: 'block',
                            overflow: 'auto'
                          }}
                          placeholder={formatMessage({ id: getTrad('settings.email.text.placeholder') })}
                        />
                      </Box>
                      <Flex gap={2} style={{ marginTop: '12px' }} wrap="wrap">
                        <Button
                          variant="secondary"
                          size="S"
                          onClick={() => {
                            navigator.clipboard.writeText(settings.message_text);
                            toggleNotification({ type: 'success', message: formatMessage({ id: getTrad('settings.email.text.copy') }) + '!' });
                          }}
                        >
                          {formatMessage({ id: getTrad('settings.email.text.copy') })}
                        </Button>
                      </Flex>
                    </Box>
                  </Grid.Item>
                </Grid.Root>
                  </>
                )}
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Advanced Settings */}
          <Accordion.Item value="advanced">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Code}
                description={formatMessage({ id: getTrad('settings.section.advanced.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.advanced') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.advanced.title') })}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', fontSize: '12px' }}>
                  {formatMessage({ id: getTrad('settings.advanced.subtitle') })}
                </Typography>
                <Grid.Root gap={6}>
                  <Grid.Item col={12}>
                    <ToggleCard $active={settings.allow_magic_links_on_public_registration} $statusLabel={settings.allow_magic_links_on_public_registration ? statusActive : statusInactive}>
                      <Flex direction="column" gap={3}>
                        <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                          <Switch
                            checked={settings.allow_magic_links_on_public_registration}
                            onCheckedChange={(checked) => updateSetting('allow_magic_links_on_public_registration', checked)}
                            size="L"
                          />
                        </Flex>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.advanced.publicRegistration.title') })}
                          </Typography>
                          <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.advanced.publicRegistration.description') })}
                          </Typography>
                        </Box>
                      </Flex>
                    </ToggleCard>
                  </Grid.Item>
                </Grid.Root>
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* MFA / Multi-Factor Authentication Settings */}
          <Accordion.Item value="mfa">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description="Multi-Factor Authentication & Login Modes (Advanced)"
              >
                MFA & Login Modes
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                {/* License Status & Feature Info */}
                <Box 
                  background="neutral100" 
                  padding={4} 
                  style={{ 
                    borderRadius: theme.borderRadius.md, 
                    marginBottom: '24px', 
                    border: '2px solid rgba(128, 128, 128, 0.2)'
                  }}
                >
                  <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '12px' }}>
                    <Flex alignItems="center" gap={2}>
                      <Shield width="20px" height="20px" style={{ color: licenseInfo?.tier === 'advanced' || licenseInfo?.tier === 'enterprise' ? '#16A34A' : '#9CA3AF' }} />
                      <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px' }}>
                        Current License: {licenseInfo?.tier ? licenseInfo.tier.charAt(0).toUpperCase() + licenseInfo.tier.slice(1) : 'Free'}
                      </Typography>
                    </Flex>
                    <Badge style={{ 
                      backgroundColor: licenseInfo?.tier === 'advanced' || licenseInfo?.tier === 'enterprise' ? '#16A34A' : licenseInfo?.tier === 'premium' ? '#7C3AED' : '#9CA3AF',
                      color: 'white',
                      fontWeight: '600',
                      fontSize: '11px',
                      padding: '4px 12px'
                    }}>
                      {licenseInfo?.tier === 'advanced' || licenseInfo?.tier === 'enterprise' ? '✓ All Features Unlocked' : licenseInfo?.tier === 'premium' ? 'Email OTP Available' : 'Basic Features Only'}
                    </Badge>
                  </Flex>
                  <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                    💡 <strong>Wähle deinen Login-Modus:</strong> Magic Link (schnell), Email OTP (sicherer) oder TOTP Authenticator (höchste Sicherheit)
                  </Typography>
                </Box>

                {/* Authentication Modes */}
                <Typography variant="delta" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[800] }}>
                  Choose Authentication Mode
                </Typography>

                <Grid.Root gap={4} style={{ marginBottom: '24px' }}>
                  {/* Mode 1: Magic Link Only */}
                  <Grid.Item col={4} s={12} style={{ display: 'flex' }}>
                    <ToggleCard 
                      $active={
                        (!settings.otp_enabled && !settings.mfa_require_totp && !settings.totp_as_primary_auth) ||
                        (settings.otp_enabled && !['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier)) ||
                        (settings.mfa_require_totp && !['advanced', 'enterprise'].includes(licenseInfo?.tier))
                      }
                      $statusLabel={
                        (!settings.otp_enabled && !settings.mfa_require_totp && !settings.totp_as_primary_auth) ||
                        (settings.otp_enabled && !['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier)) ||
                        (settings.mfa_require_totp && !['advanced', 'enterprise'].includes(licenseInfo?.tier))
                          ? 'ACTIVE' : 'OFF'
                      }
                      onClick={() => {
                        updateSetting('otp_enabled', false);
                        updateSetting('mfa_require_totp', false);
                        updateSetting('totp_as_primary_auth', false);
                      }}
                      style={{ cursor: 'pointer', minHeight: '160px', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                    >
                      <IconWrapper $bgColor={theme.colors.primary[100]} $iconColor={theme.colors.primary[600]}>
                        <Link />
                      </IconWrapper>
                      <Box>
                        <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                          Magic Link Only
                        </Typography>
                        <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginBottom: '12px' }}>
                          Ein-Klick-Login per E-Mail. Schnell und benutzerfreundlich.
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '10px', color: theme.colors.primary[600], display: 'block', marginBottom: '8px' }}>
                          ✓ Keine Passwörter<br/>
                          ✓ Schneller Login<br/>
                          ✓ Immer verfügbar
                        </Typography>
                      </Box>
                      <Badge style={{ 
                        marginTop: '8px', 
                        backgroundColor: theme.colors.primary[600], 
                        color: 'white',
                        fontWeight: '600',
                        fontSize: '11px',
                        padding: '4px 10px'
                      }}>
                        Free
                      </Badge>
                      {!(!settings.otp_enabled && !settings.mfa_require_totp && !settings.totp_as_primary_auth) && (
                        <Button
                          variant="secondary"
                          startIcon={<Check />}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const newSettings = {
                                ...settings,
                                otp_enabled: false,
                                mfa_require_totp: false,
                                totp_as_primary_auth: false
                              };
                              await put('/magic-link/settings', newSettings);
                              setSettings(newSettings);
                              toggleNotification({
                                type: 'success',
                                message: '✅ Modus geändert: Magic Link Only'
                              });
                            } catch (error) {
                              console.error('Error saving mode:', error);
                              toggleNotification({
                                type: 'danger',
                                message: '❌ Fehler beim Speichern'
                              });
                            }
                          }}
                          style={{ marginTop: '12px', width: '100%' }}
                        >
                          Aktivieren
                        </Button>
                      )}
                    </ToggleCard>
                  </Grid.Item>

                  {/* Mode 2: Magic Link + Email OTP */}
                  <Grid.Item col={4} s={12} style={{ display: 'flex', position: 'relative' }}>
                    <ToggleCard 
                      $active={settings.otp_enabled && !settings.mfa_require_totp && ['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier)}
                      $statusLabel={settings.otp_enabled && !settings.mfa_require_totp && ['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) ? 'ACTIVE' : !['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) ? '🔒 LOCKED' : 'OFF'}
                      onClick={() => {
                        if (!checkLicenseAndSetMode('otp-email')) return;
                        updateSetting('otp_enabled', true);
                        updateSetting('mfa_require_totp', false);
                        updateSetting('totp_as_primary_auth', false);
                      }}
                      style={{ 
                        cursor: !['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) ? 'not-allowed' : 'pointer', 
                        minHeight: '160px', 
                        width: '100%', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        justifyContent: 'space-between',
                        opacity: !['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) ? 0.6 : 1,
                        position: 'relative'
                      }}
                    >
                      {!['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          <Lock width="40px" height="40px" style={{ color: '#7C3AED' }} />
                          <Typography variant="pi" fontWeight="bold" style={{ color: '#7C3AED', fontSize: '13px' }}>
                            Premium Required
                          </Typography>
                        </div>
                      )}
                      <IconWrapper $bgColor="rgba(124, 58, 237, 0.1)" $iconColor="#7C3AED">
                        <Mail />
                      </IconWrapper>
                      <Box>
                        <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                          Magic Link + Email OTP
                        </Typography>
                        <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginBottom: '12px' }}>
                          Extra Sicherheit: 6-stelliger Code nach dem Klicken des Magic Links.
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '10px', color: '#7C3AED', display: 'block', marginBottom: '8px' }}>
                          ✓ Email-Code Verifikation<br/>
                          ✓ Konfigurierbare Code-Länge<br/>
                          ✓ Ablaufzeit einstellbar
                        </Typography>
                      </Box>
                      <Badge style={{ 
                        marginTop: '8px', 
                        backgroundColor: '#5B21B6', 
                        color: '#FAF5FF',
                        fontWeight: '600',
                        fontSize: '11px',
                        padding: '4px 10px',
                        border: '1px solid #4C1D95'
                      }}>
                        Premium
                      </Badge>
                      {['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) && !(settings.otp_enabled && !settings.mfa_require_totp) && (
                        <Button
                          variant="secondary"
                          startIcon={<Check />}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!checkLicenseAndSetMode('otp-email')) return;
                            try {
                              const newSettings = {
                                ...settings,
                                otp_enabled: true,
                                mfa_require_totp: false,
                                totp_as_primary_auth: false
                              };
                              await put('/magic-link/settings', newSettings);
                              setSettings(newSettings);
                              toggleNotification({
                                type: 'success',
                                message: '✅ Modus geändert: Magic Link + Email OTP'
                              });
                            } catch (error) {
                              console.error('Error saving mode:', error);
                              toggleNotification({
                                type: 'danger',
                                message: '❌ Fehler beim Speichern'
                              });
                            }
                          }}
                          style={{ marginTop: '12px', width: '100%' }}
                        >
                          Aktivieren
                        </Button>
                      )}
                    </ToggleCard>
                  </Grid.Item>

                  {/* Mode 3: Magic Link + TOTP (MFA) */}
                  <Grid.Item col={4} s={12} style={{ display: 'flex', position: 'relative' }}>
                    <ToggleCard 
                      $active={settings.mfa_require_totp && ['advanced', 'enterprise'].includes(licenseInfo?.tier)}
                      $statusLabel={settings.mfa_require_totp && ['advanced', 'enterprise'].includes(licenseInfo?.tier) ? 'ACTIVE' : !['advanced', 'enterprise'].includes(licenseInfo?.tier) ? '🔒 LOCKED' : 'OFF'}
                      onClick={() => {
                        if (!checkLicenseAndSetMode('mfa-totp')) return;
                        updateSetting('otp_enabled', false);
                        updateSetting('mfa_require_totp', true);
                        updateSetting('totp_as_primary_auth', false);
                      }}
                      style={{ 
                        cursor: !['advanced', 'enterprise'].includes(licenseInfo?.tier) ? 'not-allowed' : 'pointer', 
                        minHeight: '160px', 
                        width: '100%', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        justifyContent: 'space-between',
                        opacity: !['advanced', 'enterprise'].includes(licenseInfo?.tier) ? 0.6 : 1,
                        position: 'relative'
                      }}
                    >
                      {!['advanced', 'enterprise'].includes(licenseInfo?.tier) && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10,
                            flexDirection: 'column',
                            gap: '8px'
                          }}
                        >
                          <Lightning width="40px" height="40px" style={{ color: '#D97706' }} />
                          <Typography variant="pi" fontWeight="bold" style={{ color: '#D97706', fontSize: '13px' }}>
                            Advanced Required
                          </Typography>
                        </div>
                      )}
                      <IconWrapper $bgColor="rgba(217, 119, 6, 0.1)" $iconColor="#D97706">
                        <Lock />
                      </IconWrapper>
                      <Box>
                        <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                          Magic Link + TOTP (MFA)
                        </Typography>
                        <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginBottom: '12px' }}>
                          Höchste Sicherheit: Magic Link + Authenticator App (Google Authenticator, Authy).
                        </Typography>
                        <Typography variant="pi" style={{ fontSize: '10px', color: '#D97706', display: 'block', marginBottom: '8px' }}>
                          ✓ TOTP Authenticator App<br/>
                          ✓ QR-Code Setup<br/>
                          ✓ 30s Code-Rotation
                        </Typography>
                      </Box>
                      <Badge style={{ 
                        marginTop: '8px', 
                        backgroundColor: '#92400E', 
                        color: '#FEFCE8',
                        fontWeight: '600',
                        fontSize: '11px',
                        padding: '4px 10px',
                        border: '1px solid #78350F'
                      }}>
                        Advanced
                      </Badge>
                      {['advanced', 'enterprise'].includes(licenseInfo?.tier) && !settings.mfa_require_totp && (
                        <Button
                          variant="secondary"
                          startIcon={<Check />}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!checkLicenseAndSetMode('mfa-totp')) return;
                            try {
                              const newSettings = {
                                ...settings,
                                otp_enabled: false,
                                mfa_require_totp: true,
                                totp_as_primary_auth: false
                              };
                              await put('/magic-link/settings', newSettings);
                              setSettings(newSettings);
                              toggleNotification({
                                type: 'success',
                                message: '✅ Modus geändert: Magic Link + TOTP (MFA)'
                              });
                            } catch (error) {
                              console.error('Error saving mode:', error);
                              toggleNotification({
                                type: 'danger',
                                message: '❌ Fehler beim Speichern'
                              });
                            }
                          }}
                          style={{ marginTop: '12px', width: '100%' }}
                        >
                          Aktivieren
                        </Button>
                      )}
                    </ToggleCard>
                  </Grid.Item>
                </Grid.Root>

                <Divider style={{ marginBottom: '24px' }} />

                {/* Email OTP Configuration */}
                {settings.otp_enabled && !settings.mfa_require_totp && ['premium', 'advanced', 'enterprise'].includes(licenseInfo?.tier) && (
                  <>
                    <Box 
                      background="primary100" 
                      padding={4} 
                      style={{ 
                        borderRadius: theme.borderRadius.md, 
                        marginBottom: '24px',
                        border: '1px solid #BFDBFE'
                      }}
                    >
                      <Flex alignItems="center" gap={2} style={{ marginBottom: '8px' }}>
                        <Mail width="18px" height="18px" style={{ color: theme.colors.primary[700] }} />
                        <Typography variant="pi" fontWeight="bold" style={{ color: theme.colors.primary[700] }}>
                          Email OTP Einstellungen
                        </Typography>
                      </Flex>
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.primary[700], lineHeight: '1.6' }}>
                        Konfiguriere hier, wie der OTP-Code per E-Mail verschickt wird. Benutzer erhalten nach dem Klick auf den Magic Link einen zusätzlichen Verifikationscode per E-Mail.
                      </Typography>
                    </Box>
                    
                    <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                      Code-Einstellungen
                    </Typography>

                    <Grid.Root gap={6} style={{ marginBottom: '24px' }}>
                      <Grid.Item col={6} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            📧 Versandmethode
                          </Typography>
                          <SingleSelect
                            value={settings.otp_type || 'email'}
                            onChange={(value) => updateSetting('otp_type', value)}
                            placeholder="Wähle Versandmethode"
                          >
                            <SingleSelectOption value="email">E-Mail OTP (Premium)</SingleSelectOption>
                            <SingleSelectOption value="sms">SMS OTP (Advanced)</SingleSelectOption>
                            <SingleSelectOption value="totp">Authenticator App (Advanced)</SingleSelectOption>
                          </SingleSelect>
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Wie sollen Benutzer den Verifikationscode erhalten?
                          </Typography>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={3} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            🔢 Code-Länge
                          </Typography>
                          <NumberInput
                            value={settings.otp_length || 6}
                            onValueChange={(value) => updateSetting('otp_length', value)}
                            placeholder="6"
                            min={4}
                            max={8}
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Anzahl der Ziffern (4-8). Standard: 6 Ziffern
                          </Typography>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={3} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            ⏱️ Gültigkeit (Sekunden)
                          </Typography>
                          <NumberInput
                            value={settings.otp_expiry || 300}
                            onValueChange={(value) => updateSetting('otp_expiry', value)}
                            placeholder="300"
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Wie lange ist der Code gültig? Standard: 300s (5 Min)
                          </Typography>
                        </Box>
                      </Grid.Item>
                    </Grid.Root>

                    {/* Security Settings */}
                    <Grid.Root gap={6} style={{ marginBottom: '24px' }}>
                      <Grid.Item col={6} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            ⚠️ Max. Fehlversuche
                          </Typography>
                          <NumberInput
                            value={settings.otp_max_attempts || 3}
                            onValueChange={(value) => updateSetting('otp_max_attempts', value)}
                            placeholder="3"
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Nach wie vielen Fehlversuchen wird der Code ungültig? Standard: 3
                          </Typography>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={6} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            🔄 Wartezeit für neuen Code
                          </Typography>
                          <NumberInput
                            value={settings.otp_resend_cooldown || 60}
                            onValueChange={(value) => updateSetting('otp_resend_cooldown', value)}
                            placeholder="60"
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Wie lange muss der Benutzer warten, bevor ein neuer Code angefordert werden kann? Standard: 60s
                          </Typography>
                        </Box>
                      </Grid.Item>
                    </Grid.Root>

                    {/* Info Box */}
                    <Box 
                      background="success100" 
                      padding={4} 
                      style={{ borderRadius: theme.borderRadius.md, border: '1px solid #BBF7D0', marginBottom: '24px' }}
                    >
                      <Flex gap={2} alignItems="flex-start" style={{ marginBottom: '12px' }}>
                        <CheckCircle width="16px" height="16px" style={{ color: theme.colors.success[700], flexShrink: 0, marginTop: '2px' }} />
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ fontSize: '13px', color: theme.colors.success[700], marginBottom: '6px', display: 'block' }}>
                            So funktioniert's:
                          </Typography>
                          <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.success[700], lineHeight: '1.6' }}>
                            1. Benutzer klickt auf Magic Link in der E-Mail<br/>
                            2. Wird zu OTP-Verifikationsseite weitergeleitet<br/>
                            3. Gibt den {settings.otp_length || 6}-stelligen Code ein, der an {settings.otp_type === 'sms' ? 'sein Telefon' : 'seine E-Mail'} gesendet wurde<br/>
                            4. Nach erfolgreicher Verifikation ist der Benutzer eingeloggt
                          </Typography>
                        </Box>
                      </Flex>
                    </Box>

                    <Divider style={{ marginBottom: '24px' }} />
                  </>
                )}

                {/* Alternative Login Method */}
                <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px' }}>
                  <Flex alignItems="flex-start" gap={4}>
                    <Box flex="1">
                      <Flex alignItems="center" gap={2} style={{ marginBottom: '8px' }}>
                        <Lightning width="16px" height="16px" style={{ color: '#D97706' }} />
                        <Typography variant="pi" fontWeight="bold">
                          Enable TOTP-Only Login
                        </Typography>
                        <Badge style={{ 
                          backgroundColor: '#92400E', 
                          color: '#FEFCE8',
                          fontWeight: '600',
                          fontSize: '11px',
                          padding: '3px 8px',
                          border: '1px solid #78350F'
                        }}>
                          Advanced
                        </Badge>
                      </Flex>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginBottom: '12px' }}>
                        Allow users to login with Email + TOTP code directly, without waiting for magic link email.
                      </Typography>
                      <Flex gap={2} alignItems="flex-start">
                        <Lightning width="14px" height="14px" style={{ color: theme.colors.warning[700], flexShrink: 0, marginTop: '2px' }} />
                        <Typography variant="pi" style={{ fontSize: '11px', color: theme.colors.warning[700] }}>
                          <strong>Fast login:</strong> Users open authenticator app, enter code → instant login (no email needed)
                        </Typography>
                      </Flex>
                    </Box>
                    <GreenToggle $isActive={settings.totp_as_primary_auth}>
                      <Switch
                        checked={settings.totp_as_primary_auth || false}
                        onCheckedChange={(checked) => {
                          if (checked && !checkLicenseAndSetMode('totp-primary')) {
                            return;
                          }
                          updateSetting('totp_as_primary_auth', checked);
                        }}
                      />
                    </GreenToggle>
                  </Flex>
                </Box>

                {/* TOTP Configuration */}
                {(settings.mfa_require_totp || settings.totp_as_primary_auth) && (
                  <>
                    <Divider style={{ marginBottom: '24px' }} />
                    
                    <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                      TOTP Configuration
                    </Typography>

                    <Grid.Root gap={6}>
                      <Grid.Item col={6} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            Issuer Name
                          </Typography>
                          <TextInput
                            value={settings.totp_issuer || 'Magic Link'}
                            onChange={(e) => updateSetting('totp_issuer', e.target.value)}
                            placeholder="Magic Link"
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Displayed in authenticator apps (e.g., "MyApp")
                          </Typography>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={3} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            Code Digits
                          </Typography>
                          <SingleSelect
                            value={settings.totp_digits?.toString() || '6'}
                            onChange={(value) => updateSetting('totp_digits', parseInt(value))}
                          >
                            <SingleSelectOption value="6">6 digits</SingleSelectOption>
                            <SingleSelectOption value="8">8 digits</SingleSelectOption>
                          </SingleSelect>
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={3} s={12}>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                            Time Period (s)
                          </Typography>
                          <NumberInput
                            value={settings.totp_period || 30}
                            onValueChange={(value) => updateSetting('totp_period', value)}
                            placeholder="30"
                          />
                          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '6px' }}>
                            Default: 30 seconds
                          </Typography>
                        </Box>
                      </Grid.Item>
                    </Grid.Root>

                    {/* Info Box */}
                    <Box 
                      background="success100" 
                      padding={4} 
                      style={{ borderRadius: theme.borderRadius.md, border: '1px solid #BBF7D0', marginTop: '16px' }}
                    >
                      <Flex gap={2} alignItems="flex-start">
                        <Key width="14px" height="14px" style={{ color: theme.colors.success[700], flexShrink: 0, marginTop: '2px' }} />
                        <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.success[700] }}>
                          <strong>How it works:</strong> Users scan QR code with Google Authenticator, Authy, or any TOTP app. They'll get a new 6-digit code every 30 seconds.
                        </Typography>
                      </Flex>
                    </Box>
                  </>
                )}

                {/* Current Mode Summary */}
                <Divider style={{ marginTop: '24px', marginBottom: '24px' }} />
                
                <Box 
                  background="primary100" 
                  padding={4} 
                  style={{ borderRadius: theme.borderRadius.md, border: '2px solid #BFDBFE' }}
                >
                  <Flex gap={2} alignItems="center" style={{ marginBottom: '8px' }}>
                    <CheckCircle width="16px" height="16px" style={{ color: theme.colors.primary[700] }} />
                    <Typography variant="pi" fontWeight="bold" style={{ color: theme.colors.primary[700] }}>
                      Current Configuration:
                    </Typography>
                  </Flex>
                  {!settings.otp_enabled && !settings.mfa_require_totp && !settings.totp_as_primary_auth && (
                    <Flex gap={2} alignItems="flex-start">
                      <Link width="14px" height="14px" style={{ color: theme.colors.neutral[700], flexShrink: 0, marginTop: '2px' }} />
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.neutral[700] }}>
                        Users login with Magic Link only (one-click email login)
                      </Typography>
                    </Flex>
                  )}
                  {settings.otp_enabled && !settings.mfa_require_totp && (
                    <Flex gap={2} alignItems="flex-start">
                      <Mail width="14px" height="14px" style={{ color: theme.colors.neutral[700], flexShrink: 0, marginTop: '2px' }} />
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.neutral[700] }}>
                        Users click Magic Link → Enter 6-digit code from email
                      </Typography>
                    </Flex>
                  )}
                  {settings.mfa_require_totp && (
                    <Flex gap={2} alignItems="flex-start">
                      <Lock width="14px" height="14px" style={{ color: theme.colors.neutral[700], flexShrink: 0, marginTop: '2px' }} />
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.neutral[700] }}>
                        Users click Magic Link → Enter code from authenticator app (MFA)
                      </Typography>
                    </Flex>
                  )}
                  {settings.totp_as_primary_auth && (
                    <Flex gap={2} alignItems="flex-start" style={{ marginTop: settings.mfa_require_totp ? '8px' : '0' }}>
                      <Lightning width="14px" height="14px" style={{ color: theme.colors.neutral[700], flexShrink: 0, marginTop: '2px' }} />
                      <Typography variant="pi" style={{ fontSize: '12px', color: theme.colors.neutral[700] }}>
                        + TOTP-only login enabled (users can skip email and login with code directly)
                      </Typography>
                    </Flex>
                  )}
                </Box>
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Rate Limiting */}
          <Accordion.Item value="ratelimit">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description={formatMessage({ id: getTrad('settings.section.rateLimit.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.rateLimit') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                {/* Rate Limit Toggle */}
                <Box background="neutral100" padding={5} style={{ borderRadius: theme.borderRadius.md, marginBottom: '24px' }}>
                  <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', textAlign: 'center', color: theme.colors.neutral[700] }}>
                    {formatMessage({ id: getTrad('settings.rateLimit.title') })}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', textAlign: 'center', fontSize: '12px' }}>
                    {formatMessage({ id: getTrad('settings.rateLimit.subtitle') })}
                  </Typography>
                  <Grid.Root gap={4}>
                    <Grid.Item col={12}>
                      <ToggleCard $active={settings.rate_limit_enabled} $statusLabel={settings.rate_limit_enabled ? statusActive : statusInactive}>
                        <Flex direction="column" gap={3}>
                          <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                            <Switch
                              checked={settings.rate_limit_enabled}
                              onCheckedChange={(checked) => updateSetting('rate_limit_enabled', checked)}
                              size="L"
                            />
                          </Flex>
                          <Box>
                            <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.rateLimit.enable.title') })}
                            </Typography>
                            <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                              {formatMessage({ id: getTrad('settings.rateLimit.enable.description') })}
                            </Typography>
                          </Box>
                        </Flex>
                      </ToggleCard>
                    </Grid.Item>
                  </Grid.Root>
                </Box>

                {/* Rate Limit Configuration */}
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.rateLimit.config.title') })}
                </Typography>
                <Grid.Root gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.rateLimit.maxAttempts.label') })}
                      </Typography>
                      <NumberInput
                        name="rate_limit_max_attempts"
                        hint={formatMessage({ id: getTrad('settings.rateLimit.maxAttempts.hint') })}
                        value={settings.rate_limit_max_attempts}
                        onValueChange={val => updateSetting('rate_limit_max_attempts', val)}
                        min={1}
                        max={100}
                      />
                    </Box>
                  </Grid.Item>
                  <Grid.Item col={6} s={12}>
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.rateLimit.windowMinutes.label') })}
                      </Typography>
                      <NumberInput
                        name="rate_limit_window_minutes"
                        hint={formatMessage({ id: getTrad('settings.rateLimit.windowMinutes.hint') })}
                        value={settings.rate_limit_window_minutes}
                        onValueChange={val => updateSetting('rate_limit_window_minutes', val)}
                        min={1}
                        max={1440}
                      />
                    </Box>
                  </Grid.Item>
                </Grid.Root>

                {/* Rate Limit Stats */}
                {rateLimitStats && (
                  <>
                    <Divider style={{ marginBottom: '24px' }} />
                    <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '16px', display: 'block', color: theme.colors.neutral[700] }}>
                      {formatMessage({ id: getTrad('settings.rateLimit.stats.title') })}
                    </Typography>
                    <Flex gap={4} wrap="wrap" justifyContent="center" style={{ marginBottom: '24px' }}>
                      <Box padding={4} background="neutral100" style={{ borderRadius: '8px', textAlign: 'center', minWidth: '140px', flex: '1' }}>
                        <Typography variant="beta" style={{ color: theme.colors.primary[600], fontWeight: '700' }}>
                          {rateLimitStats.totalEntries || 0}
                        </Typography>
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
                          {formatMessage({ id: getTrad('settings.rateLimit.stats.total') })}
                        </Typography>
                      </Box>
                      <Box padding={4} background="danger100" style={{ borderRadius: '8px', textAlign: 'center', minWidth: '140px', flex: '1' }}>
                        <Typography variant="beta" style={{ color: theme.colors.danger[600], fontWeight: '700' }}>
                          {rateLimitStats.blocked || 0}
                        </Typography>
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
                          {formatMessage({ id: getTrad('settings.rateLimit.stats.blocked') })}
                        </Typography>
                      </Box>
                      <Box padding={4} background="primary100" style={{ borderRadius: '8px', textAlign: 'center', minWidth: '140px', flex: '1' }}>
                        <Typography variant="beta" style={{ color: theme.colors.primary[600], fontWeight: '700' }}>
                          {rateLimitStats.ipLimits || 0}
                        </Typography>
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
                          {formatMessage({ id: getTrad('settings.rateLimit.stats.ipLimits') })}
                        </Typography>
                      </Box>
                      <Box padding={4} background="success100" style={{ borderRadius: '8px', textAlign: 'center', minWidth: '140px', flex: '1' }}>
                        <Typography variant="beta" style={{ color: theme.colors.success[600], fontWeight: '700' }}>
                          {rateLimitStats.emailLimits || 0}
                        </Typography>
                        <Typography variant="omega" textColor="neutral600" style={{ fontSize: '11px', marginTop: '4px', display: 'block' }}>
                          {formatMessage({ id: getTrad('settings.rateLimit.stats.emailLimits') })}
                        </Typography>
                      </Box>
                    </Flex>
                    
                    {/* Management Buttons */}
                    <Flex gap={3} justifyContent="center">
                      <Button
                        onClick={handleRateLimitCleanup}
                        variant="secondary"
                        size="M"
                      >
                        {formatMessage({ id: getTrad('settings.rateLimit.cleanup') })}
                      </Button>
                      <Button
                        onClick={handleRateLimitReset}
                        variant="danger"
                        size="M"
                      >
                        {formatMessage({ id: getTrad('settings.rateLimit.reset') })}
                      </Button>
                    </Flex>
                  </>
                )}
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Compatibility Settings */}
          <Accordion.Item value="compatibility">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Link}
                description={formatMessage({ id: getTrad('settings.section.compatibility.description') })}
              >
                {formatMessage({ id: getTrad('settings.section.compatibility') })}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={6}>
                <Typography variant="sigma" fontWeight="bold" style={{ marginBottom: '8px', display: 'block', color: theme.colors.neutral[700] }}>
                  {formatMessage({ id: getTrad('settings.compatibility.title') })}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', fontSize: '12px' }}>
                  {formatMessage({ id: getTrad('settings.compatibility.subtitle') })}
                </Typography>
                
                {/* Info Box */}
                <Box 
                  background="primary100" 
                  padding={4} 
                  style={{ 
                    borderRadius: theme.borderRadius.md, 
                    marginBottom: '24px', 
                    border: '2px solid #BAE6FD'
                  }}
                >
                  <Flex alignItems="flex-start" gap={3}>
                    <Link width="20px" height="20px" style={{ color: theme.colors.primary[600], flexShrink: 0, marginTop: '2px' }} />
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '6px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.compatibility.info.title') })}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                        {formatMessage({ id: getTrad('settings.compatibility.info.description') })}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>

                <Grid.Root gap={6}>
                  {/* Passwordless Compatibility */}
                  <Grid.Item col={6} s={12}>
                    <ToggleCard $active={settings.passwordlessCompatibility} $statusLabel={settings.passwordlessCompatibility ? statusActive : statusInactive}>
                      <Flex direction="column" gap={3}>
                        <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                          <Switch
                            checked={settings.passwordlessCompatibility}
                            onCheckedChange={(checked) => updateSetting('passwordlessCompatibility', checked)}
                            size="L"
                          />
                        </Flex>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.compatibility.passwordless.title') })}
                          </Typography>
                          <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.compatibility.passwordless.description') })}
                          </Typography>
                        </Box>
                        {settings.passwordlessCompatibility && (
                          <Box 
                            background="success100" 
                            padding={3} 
                            style={{ 
                              borderRadius: theme.borderRadius.md, 
                              marginTop: '8px',
                              border: '1px solid #BBF7D0'
                            }}
                          >
                            <Typography variant="pi" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                              POST /api/passwordless/send-link<br/>
                              GET /api/passwordless/login
                            </Typography>
                          </Box>
                        )}
                      </Flex>
                    </ToggleCard>
                  </Grid.Item>

                  {/* Email Designer Compatibility */}
                  <Grid.Item col={6} s={12}>
                    <ToggleCard $active={settings.emailDesignerCompatibility} $statusLabel={settings.emailDesignerCompatibility ? statusActive : statusInactive}>
                      <Flex direction="column" gap={3}>
                        <Flex justifyContent="center" alignItems="center" style={{ marginBottom: '8px' }}>
                          <Switch
                            checked={settings.emailDesignerCompatibility}
                            onCheckedChange={(checked) => updateSetting('emailDesignerCompatibility', checked)}
                            size="L"
                          />
                        </Flex>
                        <Box>
                          <Typography variant="pi" fontWeight="bold" style={{ fontSize: '14px', marginBottom: '6px', display: 'block', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.compatibility.emailDesigner.title') })}
                          </Typography>
                          <Typography variant="omega" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.4', textAlign: 'center' }}>
                            {formatMessage({ id: getTrad('settings.compatibility.emailDesigner.description') })}
                          </Typography>
                        </Box>
                        {settings.emailDesignerCompatibility && (
                          <Box 
                            background="success100" 
                            padding={3} 
                            style={{ 
                              borderRadius: theme.borderRadius.md, 
                              marginTop: '8px',
                              border: '1px solid #BBF7D0'
                            }}
                          >
                            <Typography variant="pi" style={{ fontSize: '11px' }}>
                              ✓ Email Designer 5 Integration<br/>
                              ✓ sendTemplatedEmail() Support
                            </Typography>
                          </Box>
                        )}
                      </Flex>
                    </ToggleCard>
                  </Grid.Item>
                </Grid.Root>

                {/* Migration Note */}
                <Box 
                  background="warning100" 
                  padding={4} 
                  style={{ 
                    borderRadius: theme.borderRadius.md, 
                    marginTop: '24px',
                    border: '2px solid #FDE68A'
                  }}
                >
                  <Flex alignItems="flex-start" gap={3}>
                    <Code width="20px" height="20px" style={{ color: theme.colors.warning[600], flexShrink: 0, marginTop: '2px' }} />
                    <Box>
                      <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '6px', display: 'block' }}>
                        {formatMessage({ id: getTrad('settings.compatibility.migration.title') })}
                      </Typography>
                      <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                        {formatMessage({ id: getTrad('settings.compatibility.migration.description') })}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Box>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>

        {/* Info Footer */}
        <Box
          background="success50"
          padding={5}
          style={{ borderRadius: theme.borderRadius.lg, marginTop: '32px', border: '2px solid #BBF7D0' }}
        >
          <Flex gap={3} alignItems="center" justifyContent="center">
            <Check style={{ width: '24px', height: '24px', color: theme.colors.success[600] }} />
            <Box>
              <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '4px', display: 'block' }}>
                {formatMessage({ id: getTrad('settings.footer.quickhelp') })}
              </Typography>
              <Typography variant="pi" textColor="neutral700" style={{ fontSize: '13px' }}>
                <strong>{formatMessage({ id: getTrad('settings.footer.reminder') })}</strong>
              </Typography>
            </Box>
          </Flex>
        </Box>
      </Box>
    </Container>
  );
};

export default SettingsModern;
