import { Code } from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import {
  CardGrid,
  GroupTitle,
  Mono,
  Note,
  SectionBody,
  ToggleCard,
} from '../components/SettingsUi';

/**
 * Additional options and the strapi-plugin-passwordless compatibility mode.
 *
 * @param {{settings: Record<string, any>, update: (key: string, value: unknown) => void,
 *   disabled: boolean, statusOn: string, statusOff: string}} props
 */
export const AdvancedSection = ({ settings, update, disabled, statusOn, statusOff }) => {
  const { t } = useMagicLinkIntl();
  return (
    <SectionBody>
      <GroupTitle
        title={t('settings.advanced.title', 'ADDITIONAL OPTIONS')}
        subtitle={t('settings.advanced.subtitle', 'Advanced features for special use cases')}
      />
      <CardGrid $min="260px">
        <ToggleCard
          title={t(
            'settings.advanced.publicRegistration.title',
            'Magic Links on Public Registration'
          )}
          description={t(
            'settings.advanced.publicRegistration.description',
            'Allows users to sign in with a magic link from public registration forms without a password.'
          )}
          checked={settings.allow_magic_links_on_public_registration}
          onCheckedChange={(checked) => update('allow_magic_links_on_public_registration', checked)}
          disabled={disabled}
          statusOn={statusOn}
          statusOff={statusOff}
        />
        <ToggleCard
          title={t(
            'settings.compatibility.passwordless.title',
            'Passwordless Plugin Compatibility'
          )}
          description={t(
            'settings.compatibility.passwordless.description',
            'Keeps the /api/passwordless routes of strapi-plugin-passwordless working while you migrate.'
          )}
          checked={settings.passwordlessCompatibility}
          onCheckedChange={(checked) => update('passwordlessCompatibility', checked)}
          disabled={disabled}
          statusOn={statusOn}
          statusOff={statusOff}
        >
          {settings.passwordlessCompatibility ? (
            <Note tone="success" compact>
              <Mono>POST /api/passwordless/send-link</Mono>
              <br />
              <Mono>GET /api/passwordless/login</Mono>
            </Note>
          ) : null}
        </ToggleCard>
      </CardGrid>
      <Note
        tone="warning"
        icon={Code}
        title={t('settings.compatibility.migration.title', 'Migration Note')}
      >
        {t(
          'settings.compatibility.migration.description',
          'After the migration, switch your clients to the Magic Link API (/api/magic-link/*) and turn compatibility mode off.'
        )}
      </Note>
    </SectionBody>
  );
};

export default AdvancedSection;
