/**
 * Shared Magic Link admin building blocks. Usage is documented in the admin
 * foundation guide and in each module's JSDoc.
 */
export { ConfirmDialog } from './ConfirmDialog';
export { UnsavedChangesDialog } from './UnsavedChangesDialog';
export { PluginPageTitle, SectionHeading, SubsectionHeading } from './Headings';
export { SearchField } from './SearchField';
export { copyToClipboard } from './clipboard';
export { createFormatters, toValidDate, DATE_FORMAT, DATE_TIME_FORMAT, EMPTY_VALUE } from './format';
export {
  reducedMotion,
  motionSafe,
  prefersReducedMotion,
  usePrefersReducedMotion,
  REDUCED_MOTION_QUERY,
} from './motion';
