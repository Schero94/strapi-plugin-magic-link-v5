/**
 * LicenseGuard used to be a full-screen activation modal that blocked its
 * children until a license key was registered.
 *
 * The plugin is fully usable without activation, so the guard is a
 * pass-through. License-key handling lives on the License settings page.
 * The export stays so the page wrappers keep their import.
 *
 * @param {{children?: import('react').ReactNode}} props
 */
const LicenseGuard = ({ children }) => <>{children}</>;

export default LicenseGuard;
