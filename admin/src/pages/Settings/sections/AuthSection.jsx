import { SingleSelect, SingleSelectOption, TextInput } from '@strapi/design-system';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { CardGrid, FieldGrid, GroupTitle, Panel, SectionBody, SettingField, ToggleCard } from '../components/SettingsUi';

/**
 * Authentication options, user creation strategy and session lifetime.
 *
 * @param {{settings: Record<string, any>, update: (key: string, value: unknown) => void,
 *   disabled: boolean, errorFor: (key: string) => string|undefined, statusOn: string,
 *   statusOff: string}} props
 */
export const AuthSection = ({ settings, update, disabled, errorFor, statusOn, statusOff }) => {
  const { t } = useMagicLinkIntl();
  const toggles = [
    {
      key: 'verify_email',
      title: t('settings.auth.verifyEmail.title', 'Email Verification'),
      description: t(
        'settings.auth.verifyEmail.description',
        'Users must confirm their email address before they can sign in.'
      ),
    },
    {
      key: 'welcome_email',
      title: t('settings.auth.welcomeEmail.title', 'Welcome Email'),
      description: t('settings.auth.welcomeEmail.description', 'Sends a welcome email to newly created users.'),
    },
    {
      key: 'use_jwt_token',
      title: t('settings.auth.useJwt.title', 'Issue a JWT'),
      description: t(
        'settings.auth.useJwt.description',
        'Returns a Users & Permissions JWT after login, like the native login. Recommended for SPAs and mobile apps.'
      ),
    },
    {
      key: 'store_login_info',
      title: t('settings.auth.storeLoginInfo.title', 'Store Login Data'),
      description: t(
        'settings.auth.storeLoginInfo.description',
        'Stores the IP address and browser of each login for security monitoring.'
      ),
    },
  ];

  return (
    <SectionBody>
      <Panel>
        <GroupTitle
          align="center"
          title={t('settings.auth.options.title', 'AUTHENTICATION OPTIONS')}
          subtitle={t('settings.auth.options.subtitle', 'Configure how users are authenticated and managed')}
        />
        <CardGrid $min="200px">
          {toggles.map((toggle) => (
            <ToggleCard
              key={toggle.key}
              title={toggle.title}
              description={toggle.description}
              checked={settings[toggle.key]}
              onCheckedChange={(checked) => update(toggle.key, checked)}
              disabled={disabled}
              statusOn={statusOn}
              statusOff={statusOff}
            />
          ))}
        </CardGrid>
      </Panel>

      <GroupTitle title={t('settings.auth.management.title', 'User management and sessions')} />
      <FieldGrid $columns={2}>
        <SettingField
          name="user_creation_strategy"
          label={t('settings.auth.strategy.label', 'User Creation Strategy')}
          hint={t(
            'settings.auth.strategy.hint',
            'Used when an administrator creates a link for an unknown email address.'
          )}
        >
          <SingleSelect
            value={settings.user_creation_strategy}
            onChange={(value) => update('user_creation_strategy', value)}
            disabled={disabled}
          >
            <SingleSelectOption value="email">
              {t('settings.auth.strategy.email', 'Email only: the account is created with the email address')}
            </SingleSelectOption>
            <SingleSelectOption value="emailUsername">
              {t(
                'settings.auth.strategy.emailUsername',
                'Email and username: the username is generated from the email address'
              )}
            </SingleSelectOption>
            <SingleSelectOption value="manual">
              {t('settings.auth.strategy.manual', 'Manual: no automatic creation, users must exist')}
            </SingleSelectOption>
          </SingleSelect>
        </SettingField>
        <SettingField
          name="jwt_token_expires_in"
          label={t('settings.auth.jwtExpiration.label', 'JWT lifetime')}
          hint={t(
            'settings.auth.jwtExpiration.hint',
            'A number followed by m, h or d, such as 15m, 1h, 7d or 30d. Revoked tokens stay blocked until they expire.'
          )}
          error={errorFor('jwt_token_expires_in')}
          required
        >
          <TextInput
            value={settings.jwt_token_expires_in ?? ''}
            onChange={(event) => update('jwt_token_expires_in', event.target.value.trim())}
            placeholder="30d"
            disabled={disabled}
            maxLength={16}
          />
        </SettingField>
      </FieldGrid>
    </SectionBody>
  );
};

export default AuthSection;
