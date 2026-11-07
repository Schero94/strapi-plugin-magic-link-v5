import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Flex,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Check, Duplicate, Mail, WarningCircle } from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { ConfirmDialog } from '../../../components/shared/ConfirmDialog';
import { SubsectionHeading } from '../../../components/shared/Headings';
import { getTemplate, getTemplateList, toPlaceholderSyntax } from '../../../utils/emailTemplates';
import {
  BulletList,
  Card,
  CardGrid,
  CodeEditor,
  FieldGrid,
  GroupTitle,
  Mono,
  Note,
  SectionBody,
  SettingField,
  SwitchRow,
  Tile,
} from '../components/SettingsUi';
import {
  buildDefaultTemplates,
  fieldId,
  isCustomTemplate,
  templateStats,
} from '../utils/settingsForm';

/** Placeholders the server provides for every login e-mail. */
const PLACEHOLDERS = ['LOGIN_URL', 'EXPIRY_TEXT', 'EMAIL', 'USER', 'URL', 'CODE', 'EXPIRES_AT'];

/** Option value for a third-party template: its reference id when it has one. */
const templateValue = (template) => String(template?.templateReferenceId ?? template?.id ?? '');
const templateName = (template, fallback) =>
  template?.name || template?.subject || fallback.replace('{id}', String(template?.id ?? ''));

/**
 * E-mail provider status, sender, subject, optional Email Designer 5 and
 * Magic Mail integration, placeholders, template gallery and editors.
 *
 * @param {object} props
 * @param {Record<string, any>} props.settings
 * @param {(key: string, value: unknown) => void} props.update
 * @param {(values: Record<string, unknown>) => void} props.patch
 * @param {boolean} props.disabled
 * @param {(key: string) => string|undefined} props.errorFor
 * @param {{emailDesignerInstalled: boolean, magicMailInstalled: boolean,
 *   emailProviderConfigured: boolean, emailProviderName: string|null}} props.integrations
 * @param {Array<object>} props.emailDesignerTemplates
 * @param {Array<object>} props.magicMailTemplates
 */
export const EmailSection = ({
  settings,
  update,
  patch,
  disabled,
  errorFor,
  integrations,
  emailDesignerTemplates,
  magicMailTemplates,
}) => {
  const { t } = useMagicLinkIntl();
  const copy = useCopyToClipboard();
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const { emailDesignerInstalled, magicMailInstalled, emailProviderConfigured, emailProviderName } =
    integrations;

  const gallery = useMemo(() => getTemplateList(), []);
  const defaults = buildDefaultTemplates({
    heading: t('settings.email.default.heading', 'Sign in'),
    intro: t(
      'settings.email.default.intro',
      'Use the button below to sign in. No password needed.'
    ),
    button: t('settings.email.default.button', 'Sign in now'),
    expiry: t('settings.email.default.expiry', 'The link expires in {expiry}.', {
      expiry: '{{EXPIRY_TEXT}}',
    }),
    ignore: t(
      'settings.email.default.ignore',
      'If you did not request this email, you can ignore it.'
    ),
  });

  const currentHtml = toPlaceholderSyntax(settings.message_html);
  const currentText = toPlaceholderSyntax(settings.message_text);
  const activeGalleryKey =
    gallery.find(({ value }) => {
      const template = getTemplate(value);
      return template.html === currentHtml && template.text === currentText;
    })?.value ?? null;

  const knownHtml = [...gallery.map(({ value }) => getTemplate(value).html), defaults.html];
  const knownText = [...gallery.map(({ value }) => getTemplate(value).text), defaults.text];
  const htmlIsCustom = isCustomTemplate(settings.message_html, knownHtml, toPlaceholderSyntax);
  const textIsCustom = isCustomTemplate(settings.message_text, knownText, toPlaceholderSyntax);

  /** Applies a template change, asking first when custom content would be lost. */
  const requestTemplate = (request) => {
    if (disabled) return;
    const overwrites =
      ('message_html' in request.values &&
        htmlIsCustom &&
        request.values.message_html !== settings.message_html) ||
      ('message_text' in request.values &&
        textIsCustom &&
        request.values.message_text !== settings.message_text);
    if (overwrites) {
      setPendingTemplate(request);
    } else {
      patch(request.values);
    }
  };

  const designerSelected = emailDesignerTemplates.some(
    (template) => templateValue(template) === String(settings.email_designer_template_id ?? '')
  );
  const magicMailSelected = magicMailTemplates.some(
    (template) => String(template.id) === String(settings.magic_mail_template_id ?? '')
  );
  const htmlStats = templateStats(settings.message_html);
  const usingThirdParty =
    (emailDesignerInstalled && settings.use_email_designer) || settings.use_magic_mail;

  return (
    <SectionBody>
      {emailProviderConfigured || magicMailInstalled ? (
        <Note tone="success" icon={Check} compact>
          {magicMailInstalled
            ? t(
                'settings.email.provider.magicMail',
                'Email provider: Magic Mail (advanced routing)'
              )
            : t('settings.email.provider.configured', 'Email provider: {name}', {
                name: emailProviderName || t('settings.email.provider.defaultName', 'configured'),
              })}
        </Note>
      ) : (
        <Note
          tone="danger"
          icon={WarningCircle}
          role="alert"
          title={t('settings.email.provider.missing.title', 'No email provider configured')}
        >
          <Flex direction="column" gap={2} alignItems="flex-start">
            <span>
              {t(
                'settings.email.provider.missing.body',
                'Magic Link cannot send emails until an email provider is configured. Choose one of these options:'
              )}
            </span>
            <BulletList>
              <li>
                {t(
                  'settings.email.provider.missing.nodemailer',
                  'Install Nodemailer (recommended):'
                )}{' '}
                <Mono>npm install @strapi/provider-email-nodemailer</Mono>{' '}
                {t('settings.email.provider.missing.configure', 'and configure it in {file}.', {
                  file: 'config/plugins.js',
                })}
              </li>
              <li>
                {t(
                  'settings.email.provider.missing.magicMail',
                  'Install the Magic Mail plugin for routing, OAuth2 accounts and analytics.'
                )}
              </li>
              <li>
                {t(
                  'settings.email.provider.missing.other',
                  'Use any other Strapi email provider, such as SendGrid, Mailgun or Amazon SES.'
                )}
              </li>
            </BulletList>
          </Flex>
        </Note>
      )}

      <GroupTitle
        title={t('settings.email.sender.title', 'SENDER INFORMATION')}
        subtitle={t(
          'settings.email.sender.subtitle',
          'This information appears in emails sent to users'
        )}
      />
      <FieldGrid $columns={3}>
        <SettingField
          name="from_name"
          label={t('settings.email.fromName.label', 'Sender Name')}
          hint={t(
            'settings.email.fromName.hint',
            'The name users see as the sender, such as your app name.'
          )}
          error={errorFor('from_name')}
        >
          <TextInput
            value={settings.from_name ?? ''}
            onChange={(event) => update('from_name', event.target.value)}
            placeholder="My App"
            disabled={disabled}
            maxLength={200}
          />
        </SettingField>
        <SettingField
          name="from_email"
          label={t('settings.email.fromEmail.label', 'Sender Email')}
          hint={t(
            'settings.email.fromEmail.hint',
            'Must be an address your email provider may send from. Leave empty to use the provider default.'
          )}
          error={errorFor('from_email')}
        >
          <TextInput
            type="email"
            value={settings.from_email ?? ''}
            onChange={(event) => update('from_email', event.target.value)}
            placeholder="noreply@example.com"
            disabled={disabled}
          />
        </SettingField>
        <SettingField
          name="response_email"
          label={t('settings.email.responseEmail.label', 'Reply-to email')}
          hint={t(
            'settings.email.responseEmail.hint',
            'Optional. Replies from users go to this address.'
          )}
          error={errorFor('response_email')}
        >
          <TextInput
            type="email"
            value={settings.response_email ?? ''}
            onChange={(event) => update('response_email', event.target.value)}
            placeholder="support@example.com"
            disabled={disabled}
          />
        </SettingField>
      </FieldGrid>
      <SettingField
        name="object"
        label={t('settings.email.subject.label', 'Subject line')}
        hint={t(
          'settings.email.subject.hint',
          'Keep it clear so the email is not marked as spam. Placeholders such as {placeholder} work here too.',
          { placeholder: '{{EMAIL}}' }
        )}
        error={errorFor('object')}
      >
        <TextInput
          value={settings.object ?? ''}
          onChange={(event) => update('object', event.target.value)}
          placeholder={t('settings.email.subject.placeholder', 'Your sign-in link')}
          disabled={disabled}
          maxLength={500}
        />
      </SettingField>

      {emailDesignerInstalled ? (
        <Card>
          <SwitchRow
            icon={<Mail aria-hidden="true" width="16px" height="16px" />}
            title={t('settings.email.designer.useTemplate', 'Use an Email Designer 5 template')}
            description={t(
              'settings.email.designer.useTemplateHint',
              'Login emails use the selected Email Designer template. The templates below stay as the fallback.'
            )}
            checked={settings.use_email_designer}
            onCheckedChange={(checked) => update('use_email_designer', checked)}
            disabled={disabled}
          />
          {settings.use_email_designer ? (
            <>
              <SettingField
                name="email_designer_template_id"
                label={t('settings.email.designer.selectTemplate', 'Email Designer template')}
                hint={
                  emailDesignerTemplates.length > 0
                    ? t(
                        'settings.email.designer.templatesAvailable',
                        '{count, plural, one {# template available} other {# templates available}}. The choice applies after you save.',
                        { count: emailDesignerTemplates.length }
                      )
                    : undefined
                }
                error={
                  settings.email_designer_template_id &&
                  !designerSelected &&
                  emailDesignerTemplates.length > 0
                    ? t(
                        'settings.email.template.missing',
                        'The saved template no longer exists. Select another one.'
                      )
                    : undefined
                }
              >
                <SingleSelect
                  value={designerSelected ? String(settings.email_designer_template_id) : null}
                  onChange={(value) => update('email_designer_template_id', String(value))}
                  placeholder={t('settings.email.designer.placeholder', 'Choose a template...')}
                  disabled={disabled || emailDesignerTemplates.length === 0}
                >
                  {emailDesignerTemplates.map((template) => (
                    <SingleSelectOption
                      key={templateValue(template)}
                      value={templateValue(template)}
                    >
                      {templateName(
                        template,
                        t('settings.email.template.fallbackName', 'Template {id}')
                      )}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </SettingField>
              {emailDesignerTemplates.length === 0 ? (
                <Note tone="warning" icon={WarningCircle} compact>
                  {t(
                    'settings.email.designer.noTemplates',
                    'No templates found. Create one in Email Designer 5 first.'
                  )}
                </Note>
              ) : null}
              <Note tone="primary" compact>
                {t(
                  'settings.email.designer.variables',
                  "Template variables: '{{magicLink}}' (login link), '{{expiryText}}', '{{user.email}}' and '{{user.username}}'."
                )}
              </Note>
            </>
          ) : null}
        </Card>
      ) : null}

      {magicMailInstalled ? (
        <Card>
          <SwitchRow
            icon={<Mail aria-hidden="true" width="16px" height="16px" />}
            title={t('settings.email.magicMail.use', 'Send with Magic Mail')}
            description={t(
              'settings.email.magicMail.description',
              'Uses your Magic Mail accounts, routing rules and failover. Make sure at least one account is active.'
            )}
            checked={settings.use_magic_mail}
            onCheckedChange={(checked) => update('use_magic_mail', checked)}
            disabled={disabled}
          />
          {settings.use_magic_mail ? (
            <SettingField
              name="magic_mail_template_id"
              label={t('settings.email.magicMail.template', 'Magic Mail template')}
              hint={t(
                'settings.email.magicMail.templateHint',
                'Optional. Templates are managed in Magic Mail. The choice applies after you save.'
              )}
              error={
                settings.magic_mail_template_id &&
                !magicMailSelected &&
                magicMailTemplates.length > 0
                  ? t(
                      'settings.email.template.missing',
                      'The saved template no longer exists. Select another one.'
                    )
                  : undefined
              }
            >
              <SingleSelect
                value={magicMailSelected ? String(settings.magic_mail_template_id) : null}
                onChange={(value) => {
                  const template = magicMailTemplates.find(
                    (item) => String(item.id) === String(value)
                  );
                  patch({
                    magic_mail_template_id: String(value),
                    magic_mail_template_reference_id: template?.templateReferenceId ?? '',
                  });
                }}
                placeholder={t('settings.email.magicMail.placeholder', 'Choose a template')}
                disabled={disabled || magicMailTemplates.length === 0}
              >
                {magicMailTemplates.map((template) => (
                  <SingleSelectOption key={template.id} value={String(template.id)}>
                    {templateName(
                      template,
                      t('settings.email.template.fallbackName', 'Template {id}')
                    )}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </SettingField>
          ) : null}
        </Card>
      ) : null}

      <Flex direction="column" gap={4} alignItems="stretch">
        <Flex gap={2} alignItems="center" wrap="wrap">
          <GroupTitle
            title={t('settings.email.templates.title', 'EMAIL TEMPLATES')}
            subtitle={
              usingThirdParty
                ? t(
                    'settings.email.designer.fallbackDescription',
                    'These templates are used when the selected integration cannot send.'
                  )
                : t(
                    'settings.email.templates.subtitle',
                    'Design the emails sent to users. Use placeholders for dynamic content.'
                  )
            }
          />
          {usingThirdParty ? (
            <Badge>{t('settings.email.designer.fallbackBadge', 'Fallback only')}</Badge>
          ) : null}
        </Flex>

        <Card>
          <SubsectionHeading tag="h4">
            {t('settings.email.placeholders.title', 'Available placeholders')}
          </SubsectionHeading>
          <Typography variant="pi" textColor="neutral600">
            {t(
              'settings.email.placeholders.intro',
              'Values are inserted as plain text and escaped in HTML. Select a placeholder to copy it.'
            )}
          </Typography>
          <CardGrid $min="200px">
            {PLACEHOLDERS.map((name) => {
              const code = `{{${name}}}`;
              return (
                <Tile
                  key={name}
                  type="button"
                  onClick={() =>
                    copy(code, {
                      success: t('settings.email.placeholders.copied', '{placeholder} copied', {
                        placeholder: code,
                      }),
                    })
                  }
                  aria-label={t('settings.email.placeholders.copyLabel', 'Copy {placeholder}', {
                    placeholder: code,
                  })}
                >
                  <Flex gap={2} alignItems="center" justifyContent="space-between" width="100%">
                    <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                      <Mono>{code}</Mono>
                    </Typography>
                    <Duplicate aria-hidden="true" width="14px" height="14px" />
                  </Flex>
                  <Typography variant="pi" textColor="neutral600">
                    {
                      {
                        LOGIN_URL: t(
                          'settings.email.placeholders.loginUrl.description',
                          'Complete login link with the token. Use it for buttons and links.'
                        ),
                        EXPIRY_TEXT: t(
                          'settings.email.placeholders.expiry.description',
                          'How long the link stays valid, such as 1 hour.'
                        ),
                        EMAIL: t(
                          'settings.email.placeholders.email.description',
                          'Email address of the recipient.'
                        ),
                        USER: t(
                          'settings.email.placeholders.username.description',
                          'Username of the recipient, or the email address when there is none.'
                        ),
                        URL: t(
                          'settings.email.placeholders.url.description',
                          'Login URL without the token.'
                        ),
                        CODE: t(
                          'settings.email.placeholders.code.description',
                          'The token alone, for custom link formats only.'
                        ),
                        EXPIRES_AT: t(
                          'settings.email.placeholders.expiresAt.description',
                          'Expiry date and time in ISO 8601 format.'
                        ),
                      }[name]
                    }
                  </Typography>
                </Tile>
              );
            })}
          </CardGrid>
        </Card>

        {!settings.use_magic_mail ? (
          <>
            <Card>
              <Flex gap={2} alignItems="center" wrap="wrap">
                <Mail aria-hidden="true" width="20px" height="20px" />
                <SubsectionHeading tag="h4" variant="delta">
                  {t('settings.email.gallery.title', 'Template gallery')}
                </SubsectionHeading>
              </Flex>
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'settings.email.gallery.description',
                  'Load a ready-made design into the editors below. Save to apply it.'
                )}
              </Typography>
              <CardGrid $min="180px" role="list">
                {gallery.map((template) => {
                  const isActive = activeGalleryKey === template.value;
                  return (
                    <div role="listitem" key={template.value} style={{ minWidth: 0 }}>
                      <Tile
                        type="button"
                        $active={isActive}
                        aria-pressed={isActive}
                        disabled={disabled}
                        onClick={() => {
                          const selected = getTemplate(template.value);
                          requestTemplate({
                            label: template.label,
                            values: { message_html: selected.html, message_text: selected.text },
                          });
                        }}
                      >
                        <Flex
                          gap={2}
                          alignItems="center"
                          justifyContent="space-between"
                          width="100%"
                        >
                          <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                            {template.label}
                          </Typography>
                          {isActive ? (
                            <Badge variant="success" size="S">
                              {t('settings.email.gallery.active', 'In use')}
                            </Badge>
                          ) : null}
                        </Flex>
                        <Typography variant="pi" textColor="neutral600">
                          {template.preview}
                        </Typography>
                      </Tile>
                    </div>
                  );
                })}
              </CardGrid>
            </Card>

            <Card>
              <Flex gap={2} justifyContent="space-between" alignItems="center" wrap="wrap">
                <Flex gap={2} alignItems="center" wrap="wrap">
                  <SubsectionHeading
                    tag="h4"
                    variant="delta"
                    id={`${fieldId('message_html')}-label`}
                  >
                    {t('settings.email.html.title', 'HTML template')}
                  </SubsectionHeading>
                  <Badge variant="success">{t('settings.email.html.badge', 'Main Template')}</Badge>
                </Flex>
                <Button
                  variant="tertiary"
                  size="S"
                  disabled={disabled}
                  onClick={() =>
                    requestTemplate({
                      label: t('settings.email.default.name', 'Default template'),
                      values: { message_html: defaults.html },
                    })
                  }
                >
                  {t('settings.email.html.loadDefault', 'Load Default Template')}
                </Button>
              </Flex>
              <Typography
                variant="pi"
                textColor="neutral600"
                id={`${fieldId('message_html')}-hint`}
              >
                {t(
                  'settings.email.html.description',
                  'HTML version of the login email. Use the placeholders above, at least {placeholder}.',
                  { placeholder: '{{LOGIN_URL}}' }
                )}
              </Typography>
              <CodeEditor
                id={fieldId('message_html')}
                labelledBy={`${fieldId('message_html')}-label`}
                describedBy={`${fieldId('message_html')}-hint`}
                filename="email.html"
                value={settings.message_html}
                onChange={(value) => update('message_html', value)}
                placeholder={'<p><a href="{{LOGIN_URL}}">...</a></p>'}
                disabled={disabled}
                dark
                height="560px"
              />
              {errorFor('message_html') ? (
                <Typography variant="pi" textColor="danger600" role="alert">
                  {errorFor('message_html')}
                </Typography>
              ) : null}
              <Flex gap={2} justifyContent="space-between" alignItems="center" wrap="wrap">
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'settings.email.html.stats',
                    '{lines, plural, one {# line} other {# lines}}, {chars, plural, one {# character} other {# characters}}',
                    htmlStats
                  )}
                </Typography>
                <Button
                  variant="secondary"
                  size="S"
                  startIcon={<Duplicate />}
                  onClick={() =>
                    copy(settings.message_html ?? '', {
                      success: t('settings.email.html.copied', 'HTML template copied'),
                    })
                  }
                >
                  {t('settings.email.html.copy', 'Copy Template')}
                </Button>
              </Flex>
            </Card>

            <Card>
              <Flex gap={2} justifyContent="space-between" alignItems="center" wrap="wrap">
                <Flex gap={2} alignItems="center" wrap="wrap">
                  <SubsectionHeading
                    tag="h4"
                    variant="delta"
                    id={`${fieldId('message_text')}-label`}
                  >
                    {t('settings.email.text.title', 'Plain text template')}
                  </SubsectionHeading>
                  <Badge>{t('settings.email.text.badge', 'Fallback')}</Badge>
                </Flex>
                <Button
                  variant="tertiary"
                  size="S"
                  disabled={disabled}
                  onClick={() =>
                    requestTemplate({
                      label: t('settings.email.default.name', 'Default template'),
                      values: { message_text: defaults.text },
                    })
                  }
                >
                  {t('settings.email.text.loadDefault', 'Load Default Template')}
                </Button>
              </Flex>
              <Typography
                variant="pi"
                textColor="neutral600"
                id={`${fieldId('message_text')}-hint`}
              >
                {t(
                  'settings.email.text.description',
                  'Text version for email clients without HTML. Placeholders are inserted as they are.'
                )}
              </Typography>
              <CodeEditor
                id={fieldId('message_text')}
                labelledBy={`${fieldId('message_text')}-label`}
                describedBy={`${fieldId('message_text')}-hint`}
                filename="email.txt"
                value={settings.message_text}
                onChange={(value) => update('message_text', value)}
                placeholder="{{LOGIN_URL}}"
                disabled={disabled}
                height="320px"
                mobileHeight="240px"
              />
              {errorFor('message_text') ? (
                <Typography variant="pi" textColor="danger600" role="alert">
                  {errorFor('message_text')}
                </Typography>
              ) : null}
              <Flex justifyContent="flex-end">
                <Button
                  variant="secondary"
                  size="S"
                  startIcon={<Duplicate />}
                  onClick={() =>
                    copy(settings.message_text ?? '', {
                      success: t('settings.email.text.copied', 'Text template copied'),
                    })
                  }
                >
                  {t('settings.email.text.copy', 'Copy Template')}
                </Button>
              </Flex>
            </Card>
          </>
        ) : null}
      </Flex>

      <ConfirmDialog
        isOpen={!disabled && pendingTemplate !== null}
        variant="danger"
        title={t('settings.email.overwrite.title', 'Replace your template?')}
        description={t(
          'settings.email.overwrite.body',
          'Loading "{name}" replaces your custom template in the editor. Your saved settings stay unchanged until you save.',
          { name: pendingTemplate?.label ?? '' }
        )}
        confirmLabel={t('settings.email.overwrite.confirm', 'Replace template')}
        onConfirm={() => {
          if (pendingTemplate) patch(pendingTemplate.values);
          setPendingTemplate(null);
        }}
        onClose={() => setPendingTemplate(null)}
      />
    </SectionBody>
  );
};

export default EmailSection;
