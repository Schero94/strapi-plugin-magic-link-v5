import {
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Link as LinkIcon } from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { usePluginLanguage } from '../../../components/LanguageProvider';
import {
  CardGrid,
  FieldGrid,
  GroupTitle,
  Mono,
  Note,
  Panel,
  SectionBody,
  SettingField,
  ToggleCard,
} from '../components/SettingsUi';
import { buildLoginUrlPreview, formatList, parseList } from '../utils/settingsForm';

const FOLLOW_ADMIN = 'admin';
const LANGUAGE_LABELS = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  pt: 'Português',
};

/**
 * General settings: interface language, main features, link lifetime and
 * length, token context policy and the login link URLs.
 *
 * @param {{settings: Record<string, any>, update: (key: string, value: unknown) => void,
 *   disabled: boolean, errorFor: (key: string) => string|undefined, statusOn: string,
 *   statusOff: string}} props
 */
export const GeneralSection = ({ settings, update, disabled, errorFor, statusOn, statusOff }) => {
  const { t } = useMagicLinkIntl();
  const { language, isFollowingAdmin, changeLanguage, languages } = usePluginLanguage();
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  const preview = buildLoginUrlPreview(settings, origin);
  const previewSource = {
    frontend: t(
      'settings.links.preview.source.frontend',
      'Built from the frontend URL and login path.'
    ),
    confirmation: t(
      'settings.links.preview.source.confirmation',
      'Built from the confirmation URL.'
    ),
    api: t(
      'settings.links.preview.source.api',
      'No valid frontend or confirmation URL is set, so the link opens the Strapi API login route.'
    ),
  }[preview.source];

  return (
    <SectionBody>
      <Panel>
        <FieldGrid $columns={2}>
          <SettingField
            name="ui_language"
            label={t('settings.language.label', 'Interface Language')}
            hint={t(
              'settings.language.hint',
              'Language of the Magic Link admin pages in this browser. It applies immediately.'
            )}
          >
            <SingleSelect
              value={isFollowingAdmin ? FOLLOW_ADMIN : language}
              onChange={(value) => changeLanguage(value === FOLLOW_ADMIN ? null : value)}
            >
              <SingleSelectOption value={FOLLOW_ADMIN}>
                {t('common.language.followAdmin', 'Same as admin interface')}
              </SingleSelectOption>
              {languages.map((code) => (
                <SingleSelectOption key={code} value={code}>
                  {LANGUAGE_LABELS[code] ?? code}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </SettingField>
        </FieldGrid>
      </Panel>

      <Panel>
        <GroupTitle
          align="center"
          title={t('settings.features.title', 'MAIN FEATURES')}
          subtitle={t(
            'settings.features.subtitle',
            'Enable or disable the main features of the Magic Link plugin'
          )}
        />
        <CardGrid $min="240px">
          <ToggleCard
            title={t('settings.feature.createUser.title', 'Automatically Create Users')}
            description={t(
              'settings.feature.createUser.description',
              'Creates an account when the email address is unknown. Follows the Users & Permissions registration and email confirmation settings.'
            )}
            checked={settings.createUserIfNotExists}
            onCheckedChange={(checked) => update('createUserIfNotExists', checked)}
            disabled={disabled}
            statusOn={statusOn}
            statusOff={statusOff}
          />
          <ToggleCard
            title={t('settings.feature.staysValid.title', 'Reusable links')}
            description={t(
              'settings.feature.staysValid.description',
              'A link can be used more than once until it expires. Less secure; keep it off unless users need to open the link on several devices.'
            )}
            checked={settings.stays_valid}
            onCheckedChange={(checked) => update('stays_valid', checked)}
            disabled={disabled}
            statusOn={statusOn}
            statusOff={statusOff}
          />
        </CardGrid>
      </Panel>

      <GroupTitle title={t('settings.time.title', 'Link lifetime and length')} />
      <FieldGrid $columns={2}>
        <SettingField
          name="expire_period"
          label={t('settings.expire.label', 'Link lifetime (seconds)')}
          hint={t(
            'settings.expire.hint',
            'Recommended: 3600 seconds (1 hour). Allowed: 10 to 31,536,000.'
          )}
          error={errorFor('expire_period')}
          required
        >
          <NumberInput
            value={settings.expire_period}
            onValueChange={(value) => update('expire_period', value)}
            placeholder="3600"
            disabled={disabled}
            min={10}
            step={60}
          />
        </SettingField>
        <SettingField
          name="token_length"
          label={t('settings.tokenLength.label', 'Token length (characters)')}
          hint={t(
            'settings.tokenLength.hint',
            'Longer tokens are harder to guess. Allowed: 22 to 128. Current: {length} characters.',
            { length: settings.token_length ?? '-' }
          )}
          error={errorFor('token_length')}
          required
        >
          <NumberInput
            value={settings.token_length}
            onValueChange={(value) => update('token_length', value)}
            placeholder="32"
            disabled={disabled}
            min={22}
            max={128}
          />
        </SettingField>
      </FieldGrid>

      <GroupTitle
        title={t('settings.context.title', 'Context field policy')}
        subtitle={t(
          'settings.context.subtitle',
          'Applies to every login link, whether your frontend or an administrator creates it. Reserved fields such as userId or otpVerified are always removed.'
        )}
      />
      <FieldGrid $columns={2}>
        <SettingField
          name="context_whitelist"
          label={t('settings.context.whitelist.label', 'Allowed fields')}
          hint={t(
            'settings.context.whitelist.hint',
            'Comma-separated. When set, only these fields are kept. Leave empty to allow all fields that are not blocked.'
          )}
          error={errorFor('context_whitelist')}
        >
          <TextInput
            value={formatList(settings.context_whitelist)}
            onChange={(event) => update('context_whitelist', event.target.value)}
            onBlur={() => update('context_whitelist', parseList(settings.context_whitelist))}
            placeholder="redirectTo, role, source"
            disabled={disabled}
          />
        </SettingField>
        <SettingField
          name="context_blacklist"
          label={t('settings.context.blacklist.label', 'Blocked fields')}
          hint={t(
            'settings.context.blacklist.hint',
            'Comma-separated. These fields are always removed, even when they are also allowed.'
          )}
          error={errorFor('context_blacklist')}
        >
          <TextInput
            value={formatList(settings.context_blacklist)}
            onChange={(event) => update('context_blacklist', event.target.value)}
            onBlur={() => update('context_blacklist', parseList(settings.context_blacklist))}
            placeholder="password, secret, apiKey, token"
            disabled={disabled}
          />
        </SettingField>
      </FieldGrid>

      <GroupTitle
        title={t('settings.links.title', 'Login link URLs')}
        subtitle={t(
          'settings.links.subtitle',
          'Use https. http is only accepted for localhost. The frontend URL wins over the confirmation URL.'
        )}
      />
      <FieldGrid $columns={2}>
        <SettingField
          name="frontend_url"
          label={t('settings.links.frontendUrl.label', 'Frontend base URL')}
          hint={t(
            'settings.links.frontendUrl.hint',
            'Base URL of your frontend app (React, Vue, mobile deep link page). Leave empty to use the confirmation URL.'
          )}
          error={errorFor('frontend_url')}
        >
          <TextInput
            type="url"
            inputMode="url"
            value={settings.frontend_url ?? ''}
            onChange={(event) => update('frontend_url', event.target.value)}
            placeholder="https://app.example.com"
            disabled={disabled}
          />
        </SettingField>
        <SettingField
          name="frontend_login_path"
          label={t('settings.links.frontendPath.label', 'Frontend login path')}
          hint={t(
            'settings.links.frontendPath.hint',
            'Path of the page that receives the link, appended to the frontend URL. Starts with /.'
          )}
          error={errorFor('frontend_login_path')}
        >
          <TextInput
            value={settings.frontend_login_path ?? ''}
            onChange={(event) => update('frontend_login_path', event.target.value)}
            placeholder="/auth/magic-link"
            disabled={disabled}
          />
        </SettingField>
      </FieldGrid>
      <SettingField
        name="confirmationUrl"
        label={t('settings.confirmationUrl.label', 'Confirmation URL')}
        hint={t(
          'settings.confirmationUrl.hint',
          'Full URL of the page that receives the link when no frontend URL is set.'
        )}
        error={errorFor('confirmationUrl')}
      >
        <TextInput
          type="url"
          inputMode="url"
          value={settings.confirmationUrl ?? ''}
          onChange={(event) => update('confirmationUrl', event.target.value)}
          placeholder="https://app.example.com/auth/magic-link"
          disabled={disabled}
        />
      </SettingField>

      <Note
        tone="primary"
        icon={LinkIcon}
        title={t('settings.links.preview.title', 'Resulting login link')}
      >
        <Typography variant="pi" tag="p" style={{ color: 'inherit', margin: 0 }}>
          <Mono>{preview.url}</Mono>
        </Typography>
        <Typography variant="pi" tag="p" style={{ color: 'inherit', margin: 0 }}>
          {previewSource}
        </Typography>
      </Note>
    </SectionBody>
  );
};

export default GeneralSection;
