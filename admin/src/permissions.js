const pluginPermissions = {
  access: [{ action: 'plugin::magic-link.access', subject: null }],
  accessSettings: [{ action: 'plugin::magic-link.settings.read', subject: null }],
  readSettings: [{ action: 'plugin::magic-link.settings.read', subject: null }],
  updateSettings: [{ action: 'plugin::magic-link.settings.update', subject: null }],
};

export default pluginPermissions; 