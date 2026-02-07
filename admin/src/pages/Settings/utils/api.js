/**
 * Legacy API utilities - no longer used.
 * Settings are loaded directly via useFetchClient() in SettingsModern.jsx.
 * Kept for backward compatibility with any external imports.
 */

export const fetchData = async () => {
  console.warn('[magic-link] fetchData() from utils/api.js is deprecated. Use useFetchClient() directly.');
  return {};
};

export const saveSettings = async () => {
  console.warn('[magic-link] saveSettings() from utils/api.js is deprecated. Use useFetchClient() directly.');
  return {};
};
