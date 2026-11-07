import { getTranslation } from './getTranslation';

/**
 * @deprecated Use `getTranslation` from './getTranslation', or the `t` helper
 * from `useMagicLinkIntl()`, which also passes the English defaultMessage.
 *
 * @param {string} id - translation key with or without the plugin prefix
 * @returns {string} prefixed message id
 */
const getTrad = (id) => getTranslation(id);

export default getTrad;
