import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { IntlContext, IntlProvider } from 'react-intl';
import enTranslations from '../translations/en.json';
import deTranslations from '../translations/de.json';
import frTranslations from '../translations/fr.json';
import esTranslations from '../translations/es.json';
import ptTranslations from '../translations/pt.json';

const STORAGE_KEY = 'magic-link-language';

export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'es', 'pt']);

const translations = Object.freeze({
  en: enTranslations,
  de: deTranslations,
  fr: frTranslations,
  es: esTranslations,
  pt: ptTranslations,
});

/**
 * Maps an admin locale ("de", "pt-BR", "en-GB") to a supported plugin language.
 * @param {unknown} locale
 * @returns {string|null} supported language code, or null
 */
export const toSupportedLanguage = (locale) => {
  if (typeof locale !== 'string' || !locale) return null;
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(base) ? base : null;
};

/**
 * Reads the explicit language override. Storage can be blocked (private
 * mode, sandboxed iframes), so every access is guarded.
 * @param {Storage|undefined} [storage]
 * @returns {string|null}
 */
export const readStoredLanguage = (storage = safeLocalStorage()) => {
  try {
    return toSupportedLanguage(storage?.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

/**
 * Stores or clears the explicit language override.
 * @param {string|null} language - null clears it (follow the admin locale)
 * @param {Storage|undefined} [storage]
 */
export const writeStoredLanguage = (language, storage = safeLocalStorage()) => {
  try {
    if (language) storage?.setItem(STORAGE_KEY, language);
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage is optional; the choice then lasts for this page view.
  }
};

function safeLocalStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Builds the message table: admin messages first (so Strapi and DS components
 * inside plugin pages stay translated), then the English plugin messages as a
 * fallback, then the selected plugin language.
 *
 * @param {Record<string, string>|undefined} adminMessages
 * @param {string} language
 * @returns {Record<string, string>}
 */
export const buildMessages = (adminMessages, language) => ({
  ...(adminMessages ?? {}),
  ...translations.en,
  ...(translations[language] ?? {}),
});

/**
 * Silences only MISSING_TRANSLATION. Every message has an English
 * defaultMessage, so a missing entry is not an error worth a console line on
 * each render. Other errors go to the parent handler.
 *
 * @param {(error: unknown) => void} [parentOnError]
 * @returns {(error: {code?: string}) => void}
 */
export const createIntlErrorHandler = (parentOnError) => (error) => {
  if (error?.code === 'MISSING_TRANSLATION') return;
  if (typeof parentOnError === 'function') parentOnError(error);
};

const LanguageContext = createContext(null);

/**
 * @returns {{
 *   language: string,
 *   adminLanguage: string,
 *   isFollowingAdmin: boolean,
 *   languages: readonly string[],
 *   changeLanguage: (language: string|null) => void,
 *   t: (key: string) => string,
 * }}
 */
export const usePluginLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('usePluginLanguage must be used within LanguageProvider');
  }
  return context;
};

/**
 * Plugin language scope.
 *
 * - The language follows the Strapi admin interface locale by default.
 * - `changeLanguage('de')` sets an explicit override (kept in localStorage when
 *   available). `changeLanguage(null)` returns to the admin locale.
 * - Admin messages stay available inside the scope, and English plugin
 *   messages are the fallback for keys a locale lacks.
 *
 * @param {{children?: import('react').ReactNode}} props
 */
export const LanguageProvider = ({ children }) => {
  const parentIntl = useContext(IntlContext);
  const adminLanguage = toSupportedLanguage(parentIntl?.locale) ?? 'en';
  const [override, setOverride] = useState(() => readStoredLanguage());
  const language = override ?? adminLanguage;

  const changeLanguage = useCallback((next) => {
    const supported = toSupportedLanguage(next);
    setOverride(supported);
    writeStoredLanguage(supported);
  }, []);

  const messages = useMemo(
    () => buildMessages(parentIntl?.messages, language),
    [parentIntl?.messages, language]
  );

  const parentOnError = parentIntl?.onError;
  const onError = useMemo(() => createIntlErrorHandler(parentOnError), [parentOnError]);

  const value = useMemo(
    () => ({
      language,
      adminLanguage,
      isFollowingAdmin: override === null,
      languages: SUPPORTED_LANGUAGES,
      changeLanguage,
      /** @deprecated use `useMagicLinkIntl().t(key, defaultMessage)` */
      t: (key) => messages[key] ?? key,
    }),
    [language, adminLanguage, override, changeLanguage, messages]
  );

  // Keep the admin's full locale ("en-GB") for date formats when the plugin
  // language matches it; otherwise use the selected language.
  const locale =
    parentIntl?.locale && toSupportedLanguage(parentIntl.locale) === language
      ? parentIntl.locale
      : language;

  return (
    <LanguageContext.Provider value={value}>
      <IntlProvider
        locale={locale}
        messages={messages}
        defaultLocale="en"
        timeZone={parentIntl?.timeZone}
        onError={onError}
      >
        {children}
      </IntlProvider>
    </LanguageContext.Provider>
  );
};

export default LanguageProvider;
