import { Badge } from '@strapi/design-system';
import { Check, Clock, Lock, Server, Sparkle } from '@strapi/icons';
import { useMagicLinkIntl } from '../../../hooks/useMagicLinkIntl';
import { useFormatters } from '../../../hooks/useFormatters';
import { accent, byScheme, tint } from '../../../utils/theme';
import { StatCard, StatIcon, StatLabel, StatValue, StatsGrid } from './tokenStyles';

const BADGE_VARIANT = Object.freeze({
  active: 'success',
  expired: 'warning',
  used: 'secondary',
  blocked: 'danger',
});

/**
 * Translated label for a derived token state.
 * @param {(key: string, message: string) => string} t
 * @param {'active'|'expired'|'used'|'blocked'} state
 */
export const getStatusLabel = (t, state) => {
  switch (state) {
    case 'expired':
      return t('tokens.status.expired', 'Expired');
    case 'used':
      return t('tokens.status.used', 'Used');
    case 'blocked':
      return t('tokens.status.blocked', 'Blocked');
    default:
      return t('tokens.status.active', 'Active');
  }
};

/** @param {{state: 'active'|'expired'|'used'|'blocked'}} props */
export const TokenStatusBadge = ({ state }) => {
  const { t } = useMagicLinkIntl();
  return <Badge variant={BADGE_VARIANT[state] ?? 'neutral'}>{getStatusLabel(t, state)}</Badge>;
};

const usedTint = byScheme('#F3E8FF', 'rgba(147, 51, 234, 0.16)');

/** @param {{stats: {total: number, active: number, expired: number, used: number, blocked: number}}} props */
export const TokenStats = ({ stats }) => {
  const { t } = useMagicLinkIntl();
  const { formatNumber } = useFormatters();

  const cards = [
    { key: 'total', label: t('tokens.stats.total', 'Total'), icon: Server, accent: accent.primary, tint: tint.primary.bg },
    { key: 'active', label: t('tokens.stats.active', 'Active'), icon: Sparkle, accent: accent.success, tint: tint.success.bg },
    { key: 'expired', label: t('tokens.stats.expired', 'Expired'), icon: Clock, accent: accent.warning, tint: tint.warning.bg },
    { key: 'used', label: t('tokens.stats.used', 'Used'), icon: Check, accent: accent.secondary, tint: usedTint },
    { key: 'blocked', label: t('tokens.stats.blocked', 'Blocked'), icon: Lock, accent: accent.danger, tint: tint.danger.bg },
  ];

  return (
    <StatsGrid role="list" aria-label={t('tokens.stats.label', 'Token statistics')}>
      {cards.map(({ key, label, icon: Icon, accent: cardAccent, tint: cardTint }) => (
        <StatCard key={key} role="listitem" $accent={cardAccent}>
          <StatIcon $accent={cardAccent} $tint={cardTint} aria-hidden="true">
            <Icon focusable="false" />
          </StatIcon>
          <StatValue>{formatNumber(stats[key] ?? 0)}</StatValue>
          <StatLabel>{label}</StatLabel>
        </StatCard>
      ))}
    </StatsGrid>
  );
};
