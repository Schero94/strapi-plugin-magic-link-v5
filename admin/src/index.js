import pluginPkg from '../../package.json';
import pluginId from './pluginId';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';
import pluginPermissions from './permissions';
import { getTranslation } from './utils/getTranslation';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: pluginId,
      initializer: Initializer,
      isReady: false,
      name,
    });

    // Tokens, OTP codes, JWT sessions and IP bans. Needs the read action.
    app.addMenuLink({
      to: `plugins/${pluginId}/tokens`,
      icon: PluginIcon,
      intlLabel: {
        id: getTranslation('tokens.title'),
        defaultMessage: 'Magic Link Tokens',
      },
      Component: () => import('./pages/Tokens'),
      permissions: pluginPermissions.main,
    });

    app.createSettingSection(
      {
        id: pluginId,
        intlLabel: {
          id: getTranslation('Header.Settings'),
          defaultMessage: 'Magic Link',
        },
      },
      [
        {
          intlLabel: {
            id: getTranslation('Form.title.Settings'),
            defaultMessage: 'Settings',
          },
          id: 'magic-link-settings',
          to: `${pluginId}/config`,
          Component: () => import('./pages/Settings'),
          permissions: pluginPermissions.settingsRead,
        },
        {
          intlLabel: {
            id: getTranslation('Form.title.License'),
            defaultMessage: 'License',
          },
          id: 'magic-link-license',
          to: `${pluginId}/license`,
          Component: () => import('./pages/License'),
          // The license key is plugin configuration, so it shares the settings actions.
          permissions: pluginPermissions.settingsRead,
        },
      ]
    );
  },

  bootstrap() {},

  /**
   * Loads the plugin messages for the admin locales. The JSON files already
   * use the full "magic-link.*" ids. Locales without a file get an empty set
   * and fall back to each message's English defaultMessage.
   */
  async registerTrads({ locales }) {
    return Promise.all(
      locales.map((locale) =>
        // Wrapped so a bundler that throws synchronously for an unknown
        // locale file still resolves to the empty fallback.
        Promise.resolve()
          .then(() => import(`./translations/${locale}.json`))
          .then(({ default: data }) => ({ data, locale }))
          .catch(() => ({ data: {}, locale }))
      )
    );
  },
};
