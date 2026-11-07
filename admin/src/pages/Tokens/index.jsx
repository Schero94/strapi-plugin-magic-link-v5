import TokensProfessional from './TokensProfessional';
import { LanguageProvider } from '../../components/LanguageProvider';

const TokensWithLanguage = () => (
  <LanguageProvider>
    <TokensProfessional />
  </LanguageProvider>
);

export default TokensWithLanguage;
