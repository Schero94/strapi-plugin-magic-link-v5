import { Button, Flex, Loader, NumberInput, Typography } from '@strapi/design-system';
import { ArrowClockwise, Trash } from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useFormatters } from '../../../hooks/useFormatters';
import {
  CardGrid,
  FieldGrid,
  GroupTitle,
  Note,
  Panel,
  SectionBody,
  SettingField,
  Stat,
  ToggleCard,
} from '../components/SettingsUi';

/**
 * Rate limiting: switch, limits and live statistics with cleanup and reset.
 *
 * @param {object} props
 * @param {Record<string, any>} props.settings
 * @param {(key: string, value: unknown) => void} props.update
 * @param {boolean} props.disabled - form is read-only
 * @param {boolean} props.canManage - may run cleanup and reset
 * @param {(key: string) => string|undefined} props.errorFor
 * @param {{status: 'idle'|'loading'|'ready'|'error', data: Record<string, number>|null}} props.stats
 * @param {() => void} props.onRetryStats
 * @param {() => void} props.onCleanup
 * @param {() => void} props.onRequestReset
 * @param {boolean} props.isCleaning
 * @param {string} props.statusOn
 * @param {string} props.statusOff
 */
export const RateLimitSection = ({
  settings,
  update,
  disabled,
  canManage,
  errorFor,
  stats,
  onRetryStats,
  onCleanup,
  onRequestReset,
  isCleaning,
  statusOn,
  statusOff,
}) => {
  const { t } = useMagicLinkIntl();
  const { formatNumber } = useFormatters();
  const value = (key) => formatNumber(Number(stats.data?.[key] ?? 0));

  return (
    <SectionBody>
      <Panel>
        <GroupTitle
          align="center"
          title={t('settings.rateLimit.title', 'RATE LIMITING')}
          subtitle={t(
            'settings.rateLimit.subtitle',
            'Prevent abuse by limiting the number of requests per IP address and email'
          )}
        />
        <CardGrid $min="260px">
          <ToggleCard
            title={t('settings.rateLimit.enable.title', 'Enable Rate Limiting')}
            description={t(
              'settings.rateLimit.enable.description',
              'Protects against brute-force attacks and spam by limiting login link requests.'
            )}
            checked={settings.rate_limit_enabled}
            onCheckedChange={(checked) => update('rate_limit_enabled', checked)}
            disabled={disabled}
            statusOn={statusOn}
            statusOff={statusOff}
          />
        </CardGrid>
      </Panel>

      <GroupTitle title={t('settings.rateLimit.config.title', 'Limits')} />
      <FieldGrid $columns={2}>
        <SettingField
          name="rate_limit_max_attempts"
          label={t('settings.rateLimit.maxAttempts.label', 'Maximum requests')}
          hint={t(
            'settings.rateLimit.maxAttempts.hint',
            'Requests allowed per time window before blocking (1 to 1,000).'
          )}
          error={errorFor('rate_limit_max_attempts')}
          required
        >
          <NumberInput
            value={settings.rate_limit_max_attempts}
            onValueChange={(next) => update('rate_limit_max_attempts', next)}
            min={1}
            max={1000}
            disabled={disabled}
          />
        </SettingField>
        <SettingField
          name="rate_limit_window_minutes"
          label={t('settings.rateLimit.windowMinutes.label', 'Time Window (Minutes)')}
          hint={t(
            'settings.rateLimit.windowMinutes.hint',
            'Period in which requests are counted (1 to 10,080 minutes).'
          )}
          error={errorFor('rate_limit_window_minutes')}
          required
        >
          <NumberInput
            value={settings.rate_limit_window_minutes}
            onValueChange={(next) => update('rate_limit_window_minutes', next)}
            min={1}
            max={10080}
            disabled={disabled}
          />
        </SettingField>
      </FieldGrid>

      <GroupTitle title={t('settings.rateLimit.stats.title', 'CURRENT STATISTICS')} />
      {stats.status === 'loading' || stats.status === 'idle' ? (
        <Flex justifyContent="center" padding={4}>
          <Loader small>{t('settings.rateLimit.stats.loading', 'Loading statistics...')}</Loader>
        </Flex>
      ) : null}
      {stats.status === 'error' ? (
        <Note tone="danger" role="alert">
          <Flex gap={3} alignItems="center" wrap="wrap">
            <span>{t('settings.rateLimit.stats.error', 'Statistics could not be loaded.')}</span>
            <Button
              variant="tertiary"
              size="S"
              startIcon={<ArrowClockwise />}
              onClick={onRetryStats}
            >
              {t('settings.retry', 'Try again')}
            </Button>
          </Flex>
        </Note>
      ) : null}
      {stats.status === 'ready' ? (
        <>
          <CardGrid $min="160px">
            <Stat
              tone="neutral"
              value={value('totalEntries')}
              label={t('settings.rateLimit.stats.total', 'Total Entries')}
            />
            <Stat
              tone="danger"
              value={value('blocked')}
              label={t('settings.rateLimit.stats.blocked', 'Currently Blocked')}
            />
            <Stat
              tone="primary"
              value={value('ipLimits')}
              label={t('settings.rateLimit.stats.ipLimits', 'IP address limits')}
            />
            <Stat
              tone="success"
              value={value('emailLimits')}
              label={t('settings.rateLimit.stats.emailLimits', 'Email Limits')}
            />
          </CardGrid>
          <Typography variant="pi" textColor="neutral600">
            {t(
              'settings.rateLimit.stats.note',
              'Statistics cover this server process only. Cleanup and reset do not change your unsaved settings.'
            )}
          </Typography>
          {canManage ? (
            <Flex gap={2} justifyContent="center" wrap="wrap">
              <Button
                variant="secondary"
                size="M"
                onClick={onCleanup}
                loading={isCleaning}
                startIcon={<ArrowClockwise />}
              >
                {t('settings.rateLimit.cleanup', 'Clean up expired entries')}
              </Button>
              <Button
                variant="danger-light"
                size="M"
                onClick={onRequestReset}
                startIcon={<Trash />}
              >
                {t('settings.rateLimit.reset', 'Reset All Limits')}
              </Button>
            </Flex>
          ) : null}
        </>
      ) : null}
    </SectionBody>
  );
};

export default RateLimitSection;
