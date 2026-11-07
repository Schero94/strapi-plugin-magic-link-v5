import SettingsModern from './SettingsModern';
import { LanguageProvider } from '../../components/LanguageProvider';

const SettingsWithLanguage = () => (
  <LanguageProvider>
    <SettingsModern />
  </LanguageProvider>
);

export default SettingsWithLanguage;
