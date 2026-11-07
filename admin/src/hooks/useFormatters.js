import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { createFormatters } from '../components/shared/format';

/**
 * Date and number formatters bound to the admin interface locale.
 *
 *   const { formatDateTime, formatNumber } = useFormatters();
 *   formatDateTime(account.lastUsed)   // "6 Nov 2026, 14:05" for en-GB, "06.11.2026, 14:05" for de
 *
 * @returns {ReturnType<typeof createFormatters>}
 */
export const useFormatters = () => {
  const intl = useIntl();
  return useMemo(() => createFormatters(intl), [intl]);
};

export default useFormatters;
