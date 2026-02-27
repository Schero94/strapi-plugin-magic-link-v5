/**
 * License Guard Service
 * Handles license creation, verification, and ping tracking
 */

const crypto = require('crypto');
const os = require('os');

// FIXED LICENSE SERVER URL - DO NOT MODIFY!
// This URL is hardcoded and cannot be overridden for security reasons.
// Any attempt to modify this will break license validation.
const LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

module.exports = ({ strapi }) => ({
  /**
   * Get license server URL (hardcoded and immutable for security)
   * @returns {string} The fixed license server URL
   */
  getLicenseServerUrl() {
    // Always return the hardcoded URL - no environment variable override allowed
    return LICENSE_SERVER_URL;
  },

  /**
   * Generate a unique device ID based on machine identifiers
   */
  generateDeviceId() {
    try {
      const networkInterfaces = os.networkInterfaces();
      const macAddresses = [];
      
      // Collect MAC addresses
      Object.values(networkInterfaces).forEach(interfaces => {
        interfaces.forEach(iface => {
          if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macAddresses.push(iface.mac);
          }
        });
      });
      
      // Create hash from MAC addresses and hostname
      const identifier = `${macAddresses.join('-')}-${os.hostname()}`;
      return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 32);
    } catch (error) {
      strapi.log.error('Error generating device ID:', error);
      // Fallback to random ID
      return crypto.randomBytes(16).digest('hex');
    }
  },

  /**
   * Get device name
   */
  getDeviceName() {
    try {
      return os.hostname() || 'Unknown Device';
    } catch (error) {
      return 'Unknown Device';
    }
  },

  /**
   * Get server IP address
   */
  getIpAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();
      for (const name of Object.keys(networkInterfaces)) {
        for (const iface of networkInterfaces[name]) {
          // Skip internal and non-IPv4 addresses
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
      return '127.0.0.1';
    } catch (error) {
      return '127.0.0.1';
    }
  },

  /**
   * Get user agent (server context)
   */
  getUserAgent() {
    return `Strapi/${strapi.config.info.strapi} Node/${process.version} ${os.platform()}/${os.release()}`;
  },

  /**
   * Create a license
   */
  async createLicense({ email, firstName, lastName }) {
    try {
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          deviceName,
          deviceId,
          ipAddress,
          userAgent,
          pluginName: 'magic-link',
          productName: 'Magic Link - Passwordless Authentication',
        }),
      });

      const data = await response.json();

      if (data.success) {
        strapi.log.info('[SUCCESS] License created successfully:', data.data.licenseKey);
        return data.data;
      } else {
        strapi.log.error('[ERROR] License creation failed:', data);
        return null;
      }
    } catch (error) {
      strapi.log.error('[ERROR] Error creating license:', error);
      return null;
    }
  },

  /**
   * Verify a license (with grace period support)
   */
  async verifyLicense(licenseKey, allowGracePeriod = false) {
    try {
      // Create timeout for fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          licenseKey,
          pluginName: 'magic-link',
          productName: 'Magic Link - Passwordless Authentication',
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      const data = await response.json();

      if (data.success) {
        const isValid = data.data.isActive && !data.data.isExpired;
        
        // Store last validation timestamp
        if (isValid) {
          const pluginStore = strapi.store({ 
            type: 'plugin', 
            name: 'magic-link' 
          });
          await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
        }
        
        return {
          valid: isValid,
          data: data.data,
        };
      } else {
        strapi.log.warn(`[WARNING] License verification failed: ${data.message || 'Unknown error'} (Key: ${licenseKey?.substring(0, 8)}...)`);
        return { valid: false, data: null };
      }
    } catch (error) {
      // If grace period is allowed, accept the key anyway
      if (allowGracePeriod) {
        strapi.log.warn(`[WARNING] Cannot verify license online: ${error.message} (Key: ${licenseKey?.substring(0, 8)}...)`);
        strapi.log.info(`[INFO] Grace period active - accepting stored license key`);
        return { valid: true, data: null, gracePeriod: true };
      }
      
      strapi.log.error(`[ERROR] Error verifying license: ${error.message} (Key: ${licenseKey?.substring(0, 8)}...)`);
      return { valid: false, data: null };
    }
  },

  /**
   * Ping a license (lightweight check)
   */
  async pingLicense(licenseKey) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          licenseKey,
          pluginName: 'magic-link',
          productName: 'Magic Link - Passwordless Authentication',
        }),
      });

      const data = await response.json();

      if (data.success) {
        strapi.log.debug(`[PING] License ping successful: ${data.data?.isActive ? 'ACTIVE' : 'INACTIVE'} (Key: ${licenseKey?.substring(0, 8)}...)`);
        return data.data;
      } else {
        strapi.log.debug(`[WARNING] License ping failed: ${data.message || 'Unknown error'} (Key: ${licenseKey?.substring(0, 8)}...)`);
        return null;
      }
    } catch (error) {
      strapi.log.debug(`License ping error: ${error.message} (Key: ${licenseKey?.substring(0, 8)}...)`);
      return null;
    }
  },

  /**
   * Upgrade a license
   */
  async upgradeLicense(licenseId, features) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/${licenseId}/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(features),
      });

      const data = await response.json();

      if (data.success) {
        strapi.log.info('[SUCCESS] License upgraded:', licenseId);
        return data.data;
      } else {
        strapi.log.error('[ERROR] License upgrade failed:', licenseId);
        return null;
      }
    } catch (error) {
      strapi.log.error('[ERROR] Error upgrading license:', error);
      return null;
    }
  },

  /**
   * Get license by key
   */
  async getLicenseByKey(licenseKey) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/key/${licenseKey}`);
      const data = await response.json();

      if (data.success) {
        return data.data;
      }
      return null;
    } catch (error) {
      strapi.log.error('[ERROR] Error fetching license by key:', error);
      return null;
    }
  },

  /**
   * Get licenses by email
   */
  async getLicensesByEmail(email) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/email/${encodeURIComponent(email)}`);
      const data = await response.json();

      if (data.success) {
        return data.data;
      }
      return [];
    } catch (error) {
      strapi.log.error('[ERROR] Error fetching licenses by email:', error);
      return [];
    }
  },

  /**
   * Get online statistics
   */
  async getOnlineStats() {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/stats/online`);
      const data = await response.json();

      if (data.success) {
        return data.data;
      }
      return null;
    } catch (error) {
      strapi.log.error('[ERROR] Error fetching online stats:', error);
      return null;
    }
  },

  /**
   * Start periodic pinging for a license
   */
  startPinging(licenseKey, intervalMinutes = 15) {
    const intervalMs = intervalMinutes * 60 * 1000;
    
    // Immediate ping
    this.pingLicense(licenseKey);
    
    // Setup interval
    const pingInterval = setInterval(async () => {
      await this.pingLicense(licenseKey);
    }, intervalMs);
    
    return pingInterval;
  },

  /**
   * Initialize license guard
   * Checks for existing license or prompts for creation
   */
  async initialize() {
    try {
      // Check if license key exists in plugin store
      const pluginStore = strapi.store({ 
        type: 'plugin', 
        name: 'magic-link' 
      });
      let licenseKey = await pluginStore.get({ key: 'licenseKey' });

      // Check last validation timestamp
      const lastValidated = await pluginStore.get({ key: 'lastValidated' });
      const now = new Date();
      const gracePeriodHours = 24;
      let withinGracePeriod = false;
      
      if (lastValidated) {
        const lastValidatedDate = new Date(lastValidated);
        const hoursSinceValidation = (now - lastValidatedDate) / (1000 * 60 * 60);
        withinGracePeriod = hoursSinceValidation < gracePeriodHours;
      }

      if (licenseKey) {
        // Always allow grace period during initialization (server might not be ready yet)
        const verification = await this.verifyLicense(licenseKey, true);
        
        if (verification.valid) {
          // Start pinging
          const pingInterval = this.startPinging(licenseKey, 15);
          
          // Store interval for cleanup
          strapi.licenseGuard = {
            licenseKey,
            pingInterval,
            data: verification.data,
          };
          
          return { valid: true, data: verification.data };
        } else {
          strapi.log.warn('[WARNING] Stored license is invalid or expired');
          // Only clear if we got a definitive rejection (not a network error during grace period)
          if (!withinGracePeriod) {
            await pluginStore.delete({ key: 'licenseKey' });
            await pluginStore.delete({ key: 'lastValidated' });
          }
        }
      }

      strapi.log.warn('[WARNING] No valid license found. Plugin will run in demo mode.');
      
      return { valid: false, demo: true };
    } catch (error) {
      strapi.log.error('[ERROR] Error initializing license guard:', error);
      return { valid: false, error: error.message };
    }
  },

  /**
   * Store license key after creation
   */
  async storeLicenseKey(licenseKey) {
    try {
      strapi.log.info(`[LICENSE] Storing license key: ${licenseKey?.substring(0, 8)}...`);
      const pluginStore = strapi.store({ 
        type: 'plugin', 
        name: 'magic-link' 
      });
      
      await pluginStore.set({ key: 'licenseKey', value: licenseKey });
      // Store initial validation timestamp
      await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
      
      // Verify it was stored
      const stored = await pluginStore.get({ key: 'licenseKey' });
      if (stored === licenseKey) {
        strapi.log.info('[SUCCESS] License key stored and verified successfully');
        return true;
      } else {
        strapi.log.error('[ERROR] License key storage verification failed');
        return false;
      }
    } catch (error) {
      strapi.log.error('[ERROR] Error storing license key:', error);
      return false;
    }
  },


  /**
   * Cleanup on plugin destroy
   */
  cleanup() {
    if (strapi.licenseGuard && strapi.licenseGuard.pingInterval) {
      clearInterval(strapi.licenseGuard.pingInterval);
      strapi.log.info('[INFO] License pinging stopped');
    }
  },

  /**
   * Check if a feature is available
   * @param {string} featureName - Feature name to check
   * @returns {boolean}
   */
  async hasFeature(featureName) {
    try {
      const features = require('../config/features');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return features.hasFeature(null, featureName);
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      return features.hasFeature(licenseData, featureName);
    } catch (error) {
      strapi.log.error('Error checking feature:', error);
      return false;
    }
  },

  /**
   * Get max allowed tokens
   * @returns {number} Max tokens (-1 = unlimited)
   */
  async getMaxTokens() {
    try {
      const features = require('../config/features');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return features.getMaxTokens(null);
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      return features.getMaxTokens(licenseData);
    } catch (error) {
      strapi.log.error('Error getting max tokens:', error);
      return features.free.maxTokens;
    }
  },

  /**
   * Get max allowed sessions
   * @returns {number} Max sessions (-1 = unlimited)
   */
  async getMaxSessions() {
    try {
      const features = require('../config/features');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return features.getMaxSessions(null);
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      return features.getMaxSessions(licenseData);
    } catch (error) {
      strapi.log.error('Error getting max sessions:', error);
      return features.free.maxSessions;
    }
  },

  /**
   * Get max allowed IP bans
   * @returns {number} Max IP bans (-1 = unlimited)
   */
  async getMaxIPBans() {
    try {
      const features = require('../config/features');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return features.getMaxIPBans(null);
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      return features.getMaxIPBans(licenseData);
    } catch (error) {
      strapi.log.error('Error getting max IP bans:', error);
      return features.free.maxIPBans;
    }
  },

  /**
   * Get available OTP types
   * @returns {Array} Available OTP types
   */
  async getAvailableOTPTypes() {
    try {
      const features = require('../config/features');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return features.getAvailableOTPTypes(null);
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      return features.getAvailableOTPTypes(licenseData);
    } catch (error) {
      strapi.log.error('Error getting available OTP types:', error);
      return [];
    }
  },

  /**
   * Get license tier info
   * @returns {Object} License tier information
   */
  async getLicenseTierInfo() {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-link' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });
      
      if (!licenseKey) {
        return {
          tier: 'free',
          features: {
            premium: false,
            advanced: false,
            enterprise: false
          }
        };
      }

      const licenseData = await this.getLicenseByKey(licenseKey);
      
      return {
        tier: licenseData?.tier || 'free',
        features: {
          premium: licenseData?.featurePremium || licenseData?.features?.premium || false,
          advanced: licenseData?.featureAdvanced || licenseData?.features?.advanced || false,
          enterprise: licenseData?.featureEnterprise || licenseData?.features?.enterprise || false
        }
      };
    } catch (error) {
      strapi.log.error('Error getting license tier info:', error);
      return {
        tier: 'free',
        features: {
          premium: false,
          advanced: false,
          enterprise: false
        }
      };
    }
  }
});

