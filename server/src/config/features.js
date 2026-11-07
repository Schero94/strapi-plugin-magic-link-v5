/**
 * Magic Link Feature Definitions
 * Defines which features are available for each license tier
 */

module.exports = {
  // FREE/DEMO Features
  free: {
    maxTokens: 100,           // 100 aktive Tokens gleichzeitig
    maxSessions: 50,          // 50 aktive JWT Sessions
    maxIPBans: 10,            // 10 gebannte IPs
    features: [
      'basic-magic-link',     // Basis Magic Link Auth
      'email-templates',      // Basis Email Templates
      'jwt-sessions',         // JWT Session Management
      'ip-tracking',          // IP Tracking für Security
      'rate-limiting',        // Basis Rate Limiting
      'auto-user-creation',   // Auto User Creation
      'token-management',     // Token Dashboard
      'ip-bans',             // IP Ban Management
    ],
  },

  // PREMIUM Features
  premium: {
    maxTokens: 1000,          // 1000 aktive Tokens
    maxSessions: 500,         // 500 aktive Sessions
    maxIPBans: 100,           // 100 gebannte IPs
    features: [
      'basic-magic-link',
      'email-templates',
      'jwt-sessions',
      'ip-tracking',
      'rate-limiting',
      'auto-user-creation',
      'token-management',
      'ip-bans',
      'otp-email',            // Email OTP (6-digit code)
      'mfa-totp',             // MFA: Magic Link + TOTP (Szenario 1)
      'custom-email-templates', // Custom HTML/Text Templates
      'email-designer-integration', // Email Designer 5 Support
      'magic-mail-integration', // MagicMail Integration
      'advanced-rate-limiting', // Custom Rate Limits
      'session-management',   // Erweiterte Session Verwaltung
      'bulk-operations',      // Bulk Token/Session Operations
      'extended-logging',     // Erweiterte Login-Info Logs
      'custom-redirect-urls', // Custom Redirect URLs per Token
    ],
  },

  // ADVANCED Features
  advanced: {
    maxTokens: -1,            // Unlimited
    maxSessions: -1,          // Unlimited
    maxIPBans: -1,            // Unlimited
    features: [
      'basic-magic-link',
      'email-templates',
      'jwt-sessions',
      'ip-tracking',
      'rate-limiting',
      'auto-user-creation',
      'token-management',
      'ip-bans',
      'otp-email',
      'mfa-totp',             // MFA: Magic Link + TOTP (Szenario 1)
      'otp-totp',             // TOTP (Authenticator Apps)
      'totp-primary-login',   // Login with Email + TOTP only (Szenario 2)
      'custom-email-templates',
      'email-designer-integration',
      'magic-mail-integration',
      'advanced-rate-limiting',
      'session-management',
      'bulk-operations',
      'extended-logging',
      'custom-redirect-urls',
      'webhook-notifications', // Webhooks für Events
      'api-access-tokens',    // API Tokens für Programmatic Access
      'advanced-analytics',   // Analytics Dashboard
      'custom-token-context', // Custom Context Data in Tokens
      'geolocation-tracking', // GeoIP Tracking
      'device-fingerprinting', // Device Fingerprinting
      'suspicious-login-alerts', // Alerts für verdächtige Logins
    ],
  },

  // ENTERPRISE Features
  enterprise: {
    maxTokens: -1,
    maxSessions: -1,
    maxIPBans: -1,
    features: [
      'basic-magic-link',
      'email-templates',
      'jwt-sessions',
      'ip-tracking',
      'rate-limiting',
      'auto-user-creation',
      'token-management',
      'ip-bans',
      'otp-email',
      'mfa-totp',             // MFA: Magic Link + TOTP (Szenario 1)
      'otp-totp',
      'totp-primary-login',   // Login with Email + TOTP only (Szenario 2)
      'otp-backup-codes',     // Backup Recovery Codes
      'biometric-support',    // WebAuthn/FIDO2
      'custom-email-templates',
      'email-designer-integration',
      'magic-mail-integration',
      'advanced-rate-limiting',
      'session-management',
      'bulk-operations',
      'extended-logging',
      'custom-redirect-urls',
      'webhook-notifications',
      'api-access-tokens',
      'advanced-analytics',
      'custom-token-context',
      'geolocation-tracking',
      'device-fingerprinting',
      'suspicious-login-alerts',
      'sso-integration',      // SSO/SAML Integration
      'ldap-sync',           // LDAP/AD Sync
      'audit-logs',          // Vollständige Audit Logs
      'compliance-reports',  // GDPR/SOC2 Reports
      'priority-support',    // 24/7 Priority Support
      'custom-security-rules', // Custom Security Rules
      'multi-tenant',        // Multi-Tenant Support
      'white-label',         // White-Label Branding
    ],
  },

  /**
   * Check if a feature is available for given license tier
   */
  hasFeature(licenseData, featureName) {
    if (!licenseData) {
      // Demo mode - only free features
      return this.free.features.includes(featureName);
    }

    // Determine tier: check multiple possible formats
    let isEnterprise = false;
    let isAdvanced = false;
    let isPremium = false;

    // Check tier field directly
    if (licenseData.tier) {
      isEnterprise = licenseData.tier === 'enterprise';
      isAdvanced = licenseData.tier === 'advanced';
      isPremium = licenseData.tier === 'premium';
    }

    // Check features object (for backward compatibility)
    if (licenseData.features) {
      isEnterprise = isEnterprise || licenseData.features.enterprise === true;
      isAdvanced = isAdvanced || licenseData.features.advanced === true;
      isPremium = isPremium || licenseData.features.premium === true;
    }

    // Check feature flags directly on licenseData (magicapi format)
    if (licenseData.featureEnterprise === true) {
      isEnterprise = true;
    }
    if (licenseData.featureAdvanced === true) {
      isAdvanced = true;
    }
    if (licenseData.featurePremium === true) {
      isPremium = true;
    }

    // Check tiers in order: enterprise > advanced > premium > free
    if (isEnterprise && this.enterprise.features.includes(featureName)) {
      return true;
    }
    if (isAdvanced && this.advanced.features.includes(featureName)) {
      return true;
    }
    if (isPremium && this.premium.features.includes(featureName)) {
      return true;
    }
    
    return this.free.features.includes(featureName);
  },

  /**
   * Get max allowed tokens for license tier
   */
  getMaxTokens(licenseData) {
    if (!licenseData) return this.free.maxTokens;
    
    if (licenseData.featureEnterprise === true || licenseData.features?.enterprise === true) return this.enterprise.maxTokens;
    if (licenseData.featureAdvanced === true || licenseData.features?.advanced === true) return this.advanced.maxTokens;
    if (licenseData.featurePremium === true || licenseData.features?.premium === true) return this.premium.maxTokens;
    
    return this.free.maxTokens;
  },

  /**
   * Get max allowed sessions for license tier
   */
  getMaxSessions(licenseData) {
    if (!licenseData) return this.free.maxSessions;
    
    if (licenseData.featureEnterprise === true || licenseData.features?.enterprise === true) return this.enterprise.maxSessions;
    if (licenseData.featureAdvanced === true || licenseData.features?.advanced === true) return this.advanced.maxSessions;
    if (licenseData.featurePremium === true || licenseData.features?.premium === true) return this.premium.maxSessions;
    
    return this.free.maxSessions;
  },

  /**
   * Get max allowed IP bans for license tier
   */
  getMaxIPBans(licenseData) {
    if (!licenseData) return this.free.maxIPBans;
    
    if (licenseData.featureEnterprise === true || licenseData.features?.enterprise === true) return this.enterprise.maxIPBans;
    if (licenseData.featureAdvanced === true || licenseData.features?.advanced === true) return this.advanced.maxIPBans;
    if (licenseData.featurePremium === true || licenseData.features?.premium === true) return this.premium.maxIPBans;
    
    return this.free.maxIPBans;
  },

  /**
   * Get tier name from license data
   */
  getTierName(licenseData) {
    if (!licenseData) return 'free';
    
    if (licenseData.featureEnterprise === true || licenseData.features?.enterprise === true) return 'enterprise';
    if (licenseData.featureAdvanced === true || licenseData.features?.advanced === true) return 'advanced';
    if (licenseData.featurePremium === true || licenseData.features?.premium === true) return 'premium';
    
    return 'free';
  }
};
