import { PLUGIN_ID } from '../pluginId';

const PREFIX = `${PLUGIN_ID}.`;

/**
 * Builds the react-intl message id for a Magic Link translation key.
 * Translation files store the full id ("magic-link.tokens.title"); code passes
 * the key without the prefix ("tokens.title"). Already prefixed keys are
 * returned unchanged, so the helper is idempotent.
 *
 * @param {string} key - "<view>.<key>", e.g. "tokens.actions.delete"
 * @returns {string} "magic-link.<view>.<key>"
 */
export const getTranslation = (key) => {
  const value = String(key ?? '');
  return value.startsWith(PREFIX) ? value : `${PREFIX}${value}`;
};

export default getTranslation;
