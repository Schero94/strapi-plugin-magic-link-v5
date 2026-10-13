'use strict';

const unavailableError = (reason) => {
  const error = new Error(reason);
  error.code = 'MAGIC_WHATSAPP_UNAVAILABLE';
  return error;
};

/**
 * Thin contract adapter to the standalone Magic WhatsApp plugin.
 * Magic Link never creates a connection or reads WhatsApp auth state.
 */
module.exports = ({ strapi }) => ({
  async sendMagicLink({ phoneNumber, loginUrl, expiresInSeconds }) {
    if (!phoneNumber || !loginUrl) {
      throw new TypeError('A phone number and login URL are required');
    }

    let plugin;
    try {
      plugin = strapi.plugin('magic-whatsapp');
    } catch {
      throw unavailableError('Magic WhatsApp is not enabled');
    }

    let service;
    try {
      service = plugin?.service?.('whatsapp');
    } catch {
      throw unavailableError('Magic WhatsApp delivery service is not available');
    }
    if (!service || typeof service.getStatus !== 'function' || typeof service.sendMagicLink !== 'function') {
      throw unavailableError('Magic WhatsApp delivery service is not available');
    }

    let status;
    try {
      status = await service.getStatus();
    } catch {
      throw unavailableError('Magic WhatsApp connection status is not available');
    }

    if (status?.isConnected !== true) {
      throw unavailableError('Magic WhatsApp is disconnected');
    }

    let result;
    try {
      result = await service.sendMagicLink({ phoneNumber, loginUrl, expiresInSeconds });
    } catch {
      const error = new Error('Magic WhatsApp could not send the login link');
      error.code = 'MAGIC_WHATSAPP_SEND_FAILED';
      throw error;
    }
    if (result?.success !== true) {
      const error = new Error('Magic WhatsApp could not send the login link');
      error.code = 'MAGIC_WHATSAPP_SEND_FAILED';
      throw error;
    }

    return result;
  },
});
