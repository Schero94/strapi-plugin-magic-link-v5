import { useCallback } from 'react';
import { useNotification } from '@strapi/strapi/admin';
import { copyToClipboard } from '../components/shared/clipboard';
import { useMagicLinkIntl } from './useMagicLinkIntl';

/**
 * Copy helper that shows a success or failure toast based on the real result.
 * The copied text is never logged or shown in the toast.
 *
 *   const copy = useCopyToClipboard();
 *   await copy(loginUrl, { success: t('tokens.created.linkCopied', 'Login link copied') });
 *
 * @returns {(text: string, messages?: {success?: string, failure?: string}) => Promise<boolean>}
 */
export const useCopyToClipboard = () => {
  const { toggleNotification } = useNotification();
  const { t } = useMagicLinkIntl();

  return useCallback(
    async (text, messages = {}) => {
      const copied = await copyToClipboard(text);
      toggleNotification({
        type: copied ? 'success' : 'warning',
        message: copied
          ? (messages.success ?? t('common.clipboard.copied', 'Copied to clipboard'))
          : (messages.failure ??
            t('common.clipboard.failed', 'Copy failed. Select the text and copy it manually.')),
      });
      return copied;
    },
    [t, toggleNotification]
  );
};

export default useCopyToClipboard;
