import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { getTranslation } from '../utils/getTranslation';

/**
 * Translation helper for Magic Link views.
 *
 *   const { t } = useMagicLinkIntl();
 *   t('tokens.actions.delete', 'Delete token');
 *   t('tokens.delete.body', 'Delete the token for {email}?', { email });
 *   t('otp.count', '{count, plural, one {# code} other {# codes}}', { count });
 *
 * The key is written without the plugin prefix; the message id becomes
 * "magic-link.<view>.<key>". The defaultMessage is the exact English text and
 * is shown when the active locale has no entry.
 *
 * @returns {{
 *   t: (key: string, defaultMessage: string, values?: Record<string, unknown>) => string,
 *   formatMessage: import('react-intl').IntlShape['formatMessage'],
 *   locale: string,
 * }}
 */
export const useMagicLinkIntl = () => {
  const intl = useIntl();
  const t = useCallback(
    (key, defaultMessage, values) =>
      intl.formatMessage({ id: getTranslation(key), defaultMessage }, values),
    [intl]
  );
  return { t, formatMessage: intl.formatMessage, locale: intl.locale };
};

export default useMagicLinkIntl;
