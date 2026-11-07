/**
 * Locale-aware formatting helpers built on a react-intl `intl` object, so
 * every view formats dates and numbers in the admin's interface language.
 * Use them through `useFormatters()` (admin/src/hooks/useFormatters.js).
 */

export const EMPTY_VALUE = '-';

/** One shared date+time format for tables, cards and version lists. */
export const DATE_TIME_FORMAT = Object.freeze({ dateStyle: 'medium', timeStyle: 'short' });
export const DATE_FORMAT = Object.freeze({ dateStyle: 'medium' });

/**
 * @param {unknown} value - Date, ISO string or epoch milliseconds
 * @returns {Date|null} a valid Date, or null for empty and invalid input
 */
export const toValidDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Creates the formatter set for one intl instance.
 * @param {{formatDate: Function, formatTime?: Function, formatNumber: Function, formatRelativeTime?: Function}} intl
 */
export const createFormatters = (intl) => {
  const formatDateTime = (value, options = DATE_TIME_FORMAT, fallback = EMPTY_VALUE) => {
    const date = toValidDate(value);
    return date ? intl.formatDate(date, options) : fallback;
  };

  const formatDateOnly = (value, options = DATE_FORMAT, fallback = EMPTY_VALUE) => {
    const date = toValidDate(value);
    return date ? intl.formatDate(date, options) : fallback;
  };

  const formatCount = (value, options, fallback = EMPTY_VALUE) => {
    const number = typeof value === 'number' ? value : Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(number)
      ? fallback
      : intl.formatNumber(number, options);
  };

  /**
   * @param {unknown} value - percentage in 0-100 units (42.5 -> "42.5%")
   */
  const formatPercent = (value, fractionDigits = 1, fallback = EMPTY_VALUE) => {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number)
      ? intl.formatNumber(number / 100, { style: 'percent', maximumFractionDigits: fractionDigits })
      : fallback;
  };

  /**
   * Relative time ("3 minutes ago") with the admin locale.
   * @param {unknown} value
   * @param {Date} [now]
   */
  const formatRelative = (value, now = new Date(), fallback = EMPTY_VALUE) => {
    const date = toValidDate(value);
    if (!date || typeof intl.formatRelativeTime !== 'function') {
      return date ? formatDateTime(date) : fallback;
    }
    const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return intl.formatRelativeTime(seconds, 'second', { numeric: 'auto' });
    if (abs < 3600)
      return intl.formatRelativeTime(Math.round(seconds / 60), 'minute', { numeric: 'auto' });
    if (abs < 86400)
      return intl.formatRelativeTime(Math.round(seconds / 3600), 'hour', { numeric: 'auto' });
    if (abs < 86400 * 30)
      return intl.formatRelativeTime(Math.round(seconds / 86400), 'day', { numeric: 'auto' });
    return formatDateOnly(date);
  };

  return {
    formatDateTime,
    formatDate: formatDateOnly,
    formatNumber: formatCount,
    formatPercent,
    formatRelative,
  };
};
