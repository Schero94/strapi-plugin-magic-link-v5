import TokensProfessional from './TokensProfessional';
import { LanguageProvider } from '../../components/LanguageProvider';
import LicenseGuard from '../../components/LicenseGuard';

const TokensWithLanguage = () => (
  <LicenseGuard>
    <LanguageProvider>
      <TokensProfessional />
    </LanguageProvider>
  </LicenseGuard>
);

export default TokensWithLanguage;
