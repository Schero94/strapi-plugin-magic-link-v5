import React from 'react';

/**
 * LicenseGuard — formerly a full-screen activation modal that blocked
 * children until the admin had registered a license key.
 *
 * In the marketplace build the guard is intentionally a pass-through:
 * the plugin is fully usable without any activation, so blocking the
 * Settings/Tokens pages behind a key would be a paywall, which is not
 * what we ship. License-key activation lives entirely on the dedicated
 * "License" settings page now.
 *
 * The component is kept as a stable export so existing imports in
 * `pages/Settings/index.jsx` and `pages/Tokens/index.jsx` keep working
 * without each consumer having to be touched.
 */
const LicenseGuard = ({ children }) => <>{children}</>;

export default LicenseGuard;
