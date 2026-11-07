/**
 * Shared layout pieces of the security tabs (OTP codes, JWT sessions,
 * IP bans). The look is unchanged from 5.x (stat cards, filter card, rounded
 * data table, dashed empty state); colours now come from DS tokens and the
 * brand helpers, so dark mode works, and spacing follows the 4/8/12/16/24/32
 * scale.
 */
import styled, { css, keyframes } from 'styled-components';
import {
  Box,
  Button,
  Dots,
  Flex,
  Loader,
  NextLink,
  PageLink,
  Pagination,
  PreviousLink,
  SingleSelect,
  SingleSelectOption,
  Table,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, WarningCircle } from '@strapi/icons';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';
import { useFormatters } from '../../hooks/useFormatters';
import {
  accent,
  breakpoints,
  byScheme,
  color,
  fontSize,
  space,
  theme,
  tint,
} from '../../utils/theme';
import { motionSafe, reducedMotion } from '../../components/shared/motion';
import { getPageItems, PAGE_SIZES } from './securityTabs.utils';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

/**
 * Stat colour sets: icon/border accent plus a tinted icon background.
 * `secondary` (purple) has no shared tint, so it is defined here per scheme.
 */
export const STAT_TONES = Object.freeze({
  primary: { fg: accent.primary, bg: tint.primary.bg },
  success: { fg: accent.success, bg: tint.success.bg },
  warning: { fg: accent.warning, bg: tint.warning.bg },
  danger: { fg: accent.danger, bg: tint.danger.bg },
  secondary: { fg: accent.secondary, bg: byScheme('#F3E8FF', 'rgba(147, 51, 234, 0.16)') },
});

const toneOf = (props) => STAT_TONES[props.$tone] || STAT_TONES.primary;

/* ------------------------------ stats ------------------------------ */

export const StatsGrid = styled.ul`
  list-style: none;
  margin: 0 0 ${space(7)};
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  align-items: stretch;
  gap: ${space(4)};

  @media (max-width: ${breakpoints.mobile}) {
    gap: ${space(2)};
    margin-bottom: ${space(6)};
  }
`;

const StatCard = styled.li`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.lg};
  box-shadow: ${theme.shadows.sm};
  padding: ${space(6)};
  transition:
    transform ${theme.transitions.normal},
    box-shadow ${theme.transitions.normal},
    border-color ${theme.transitions.normal};
  ${motionSafe(css`
    animation: ${fadeIn} ${theme.transitions.normal} backwards;
  `)}
  animation-delay: ${(props) => props.$delay || '0s'};

  &:hover {
    transform: translateY(-4px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${(props) => toneOf(props).fg(props)};
  }

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)};

    &:hover {
      transform: none;
    }
  }

  ${reducedMotion}
`;

const StatIcon = styled.span`
  width: 48px;
  height: 48px;
  border-radius: ${theme.borderRadius.md};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => toneOf(props).bg(props)};

  svg {
    width: 24px;
    height: 24px;
  }

  svg path {
    fill: ${(props) => toneOf(props).fg(props)};
  }
`;

const StatValue = styled.span`
  display: block;
  font-size: ${fontSize(6)};
  font-weight: 700;
  line-height: 1.2;
  color: ${color('neutral800')};
  margin: ${space(3)} 0 ${space(1)};
  font-variant-numeric: tabular-nums;
`;

const StatLabel = styled.span`
  display: block;
  font-size: ${fontSize(2)};
  font-weight: 500;
  color: ${color('neutral600')};
`;

/**
 * Row of stat cards.
 * @param {{label: string, items: Array<{key: string, label: string, value: number|null, icon: Function, tone: string}>}} props
 */
export const StatsRow = ({ label, items }) => {
  const { formatNumber } = useFormatters();
  return (
    <StatsGrid aria-label={label}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <StatCard key={item.key} $tone={item.tone} $delay={`${index * 0.1}s`}>
            <StatIcon $tone={item.tone} aria-hidden="true">
              <Icon />
            </StatIcon>
            <StatValue>{formatNumber(item.value)}</StatValue>
            <StatLabel>{item.label}</StatLabel>
          </StatCard>
        );
      })}
    </StatsGrid>
  );
};

/* ---------------------------- filter bar --------------------------- */

export const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${space(2)};
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.lg};
  box-shadow: ${theme.shadows.sm};
  padding: ${space(4)};
  margin-bottom: ${space(6)};

  > * {
    min-width: 0;
  }
`;

export const FilterSearch = styled.div`
  flex: 1 1 240px;

  @media (max-width: ${breakpoints.mobile}) {
    flex-basis: 100%;
  }
`;

export const FilterSelect = styled.div`
  flex: 0 1 180px;

  @media (max-width: ${breakpoints.mobile}) {
    flex: 1 1 140px;
  }
`;

export const FilterActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space(2)};
  margin-left: auto;

  @media (max-width: ${breakpoints.mobile}) {
    margin-left: 0;
    flex: 1 1 100%;

    > * {
      flex: 1 1 0;
      min-width: 0;
    }
  }
`;

/**
 * Entries-per-page select (40px, labelled).
 * @param {{value: number, onChange: (value: number) => void}} props
 */
export const PageSizeSelect = ({ value, onChange }) => {
  const { t } = useMagicLinkIntl();
  return (
    <SingleSelect
      aria-label={t('common.entriesPerPage', 'Entries per page')}
      value={String(value)}
      onChange={(next) => onChange(parseInt(next, 10) || PAGE_SIZES[0])}
    >
      {PAGE_SIZES.map((size) => (
        <SingleSelectOption key={size} value={String(size)}>
          {t('common.entries', '{count} entries', { count: size })}
        </SingleSelectOption>
      ))}
    </SingleSelect>
  );
};

/* ------------------------------ table ------------------------------ */

export const DataTable = styled.section`
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.xl};
  box-shadow: ${theme.shadows.sm};
  overflow: hidden;

  /* DS 2.2.4 Table renders its own bordered, shadowed wrapper and a scroll
     container with 24px side padding. Inside this card that drew a second
     frame and inset the header band, so both are flattened: the header band
     spans the card and the first column lines up with the filter bar. */
  > div:has(table) {
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  div:has(> table) {
    padding-left: 0;
    padding-right: 0;
  }

  /* Phones: the rows are cards of their own, so the frame around them goes
     away and the cards line up with the filter bar (as in the Tokens tab).
     Loading, error and empty states keep the frame. */
  @media (max-width: ${breakpoints.mobile}) {
    &:has(table) {
      overflow: visible;
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
  }
`;

export const StyledTable = styled(Table)`
  thead {
    background: ${color('neutral100')};
    border-bottom: 1px solid ${color('neutral200')};

    th {
      padding: ${space(4)};
      color: ${color('neutral800')};
      font-size: ${fontSize(0)};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }

  tbody tr {
    border-bottom: 1px solid ${color('neutral150')};
    transition: background ${theme.transitions.fast};

    &:last-child {
      border-bottom: none;
    }

    /* Only on devices that hover: on touch screens the tint stuck to the
       last tapped card and read as a selection. */
    @media (hover: hover) {
      &:hover {
        background: ${(props) =>
          props.$hover === 'danger' ? color('danger100')(props) : color('primary100')(props)};
      }
    }

    td {
      padding: ${space(4)};
      color: ${color('neutral800')};
    }

    ${reducedMotion}
  }

  /* DS checkboxes are 20px (flex: 0 0 20px); 24px keeps the row selectors
     at the desktop target size (32px on phones, below). */
  button[role='checkbox'] {
    flex-basis: 24px;
    width: 24px;
    height: 24px;
  }

  .agent-text {
    max-width: 200px;
  }

  /* 769-1199px: 8px side padding, wrapping dates and a narrower user agent,
     so every column, including the row actions, fits without horizontal
     scrolling (same step as the Tokens table). */
  @media (max-width: ${breakpoints.tableCompact}) {
    thead th,
    tbody tr td {
      padding-left: ${space(2)};
      padding-right: ${space(2)};
    }

    tbody tr td.cell-date {
      white-space: normal;
      text-wrap: balance;
    }

    .agent-text {
      max-width: 120px;
    }
  }

  /* DS gives a checkbox cell 4px side padding, which put the selector 4px
     from the card edge once the scroll padding was removed. */
  && thead th:first-child,
  && tbody td:first-child {
    padding-left: ${space(4)};
  }

  /* The outer columns keep 16px at every width, so the rows stay symmetric
     inside the card when the compact step narrows the inner padding. */
  && thead th:last-child,
  && tbody td:last-child {
    padding-right: ${space(4)};
  }

  @media (max-width: ${breakpoints.mobile}) {
    display: block;

    button[role='checkbox'] {
      flex-basis: 32px;
      width: 32px;
      height: 32px;
    }

    && tbody td:first-child,
    && tbody td:last-child {
      padding-left: 0;
      padding-right: 0;
    }

    .agent-text {
      max-width: 100%;
    }

    thead {
      display: none;
    }

    tbody {
      display: block;
    }

    tbody tr {
      display: block;
      margin: 0 0 ${space(4)};
      padding: ${space(4)};
      background: ${color('neutral0')};
      border: 1px solid ${color('neutral200')};
      border-radius: ${theme.borderRadius.lg};
      box-shadow: ${theme.shadows.sm};

      &:last-child {
        margin-bottom: 0;
        border-bottom: 1px solid ${color('neutral200')};
      }
    }

    tbody tr td {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: ${space(3)};
      padding: ${space(2)} 0;
      min-width: 0;
      text-align: right;

      &:not(:last-child) {
        border-bottom: 1px solid ${color('neutral150')};
      }

      &::before {
        content: attr(data-label);
        flex-shrink: 0;
        font-size: ${fontSize(1)};
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: ${color('neutral600')};
        text-align: left;
      }

      &[data-label='']::before {
        display: none;
      }

      /* Row actions sit at the end of the card, like a footer. */
      &[data-label='']:last-child {
        justify-content: flex-end;
      }
    }
  }
`;

/** Column header that holds a sort button (keeps the uppercase label and the button aligned). */
export const SortHeader = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space(1)};
`;

export const Avatar = styled.span`
  width: 36px;
  height: 36px;
  border-radius: ${theme.borderRadius.full};
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => props.$background};

  svg {
    width: 16px;
    height: 16px;
  }

  svg path {
    fill: #ffffff;
  }
`;

export const MonoText = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: ${fontSize(2)};
  font-weight: 600;
  color: ${color('neutral800')};
  /* DS table cells are nowrap; long IPv6 addresses may break on phones. */
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
`;

export const ActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: ${space(2)};
  padding: ${space(4)};
  margin-bottom: ${space(4)};
  background: ${tint.primary.bg};
  border: 1px solid ${tint.primary.border};
  border-radius: ${theme.borderRadius.lg};
  color: ${color('neutral800')};
`;

/* --------------------------- empty / states --------------------------- */

const EmptyBox = styled.div`
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: ${space(7)};
  text-align: center;
  background: ${color('neutral0')};

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.08) 0%, rgba(147, 51, 234, 0.08) 100%);
    pointer-events: none;
  }

  > * {
    position: relative;
    width: 100%;
    max-width: 560px;
  }

  @media (max-width: ${breakpoints.mobile}) {
    min-height: 0;
    padding: ${space(6)} ${space(4)};
  }
`;

const EmptyIcon = styled.span`
  width: 96px;
  height: 96px;
  border-radius: ${theme.borderRadius.full};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(props) => toneOf(props).bg(props)};
  box-shadow: ${theme.shadows.lg};

  svg {
    width: 48px;
    height: 48px;
  }

  svg path {
    fill: ${(props) => toneOf(props).fg(props)};
  }
`;

/**
 * Empty, no-match and error states inside the table card.
 * @param {{icon: Function, tone?: string, title: string, description?: string, actions?: import('react').ReactNode, role?: string}} props
 */
export const EmptyState = ({ icon: Icon, tone = 'primary', title, description, actions, role }) => (
  <EmptyBox role={role}>
    <Flex direction="column" alignItems="center" gap={4}>
      <EmptyIcon $tone={tone} aria-hidden="true">
        <Icon />
      </EmptyIcon>
      <Typography tag="h3" variant="beta" textColor="neutral800">
        {title}
      </Typography>
      {description ? (
        <Typography variant="omega" textColor="neutral600" style={{ maxWidth: '400px' }}>
          {description}
        </Typography>
      ) : null}
      {actions ? (
        <Flex gap={2} wrap="wrap" justifyContent="center" paddingTop={2}>
          {actions}
        </Flex>
      ) : null}
    </Flex>
  </EmptyBox>
);

/**
 * Load error with a retry button, rendered in place of the table.
 * @param {{message: string, onRetry: () => void, isRetrying?: boolean}} props
 */
export const LoadErrorState = ({ message, onRetry, isRetrying = false }) => {
  const { t } = useMagicLinkIntl();
  return (
    <EmptyState
      icon={WarningCircle}
      tone="danger"
      role="alert"
      title={message}
      description={t('common.error.generic', 'Something went wrong. Please try again.')}
      actions={
        <Button
          variant="secondary"
          size="L"
          startIcon={<ArrowClockwise aria-hidden="true" />}
          onClick={onRetry}
          loading={isRetrying}
        >
          {t('common.table.retry', 'Try again')}
        </Button>
      }
    />
  );
};

/** In-content loader (no full-screen overlay, no rotate wrapper). */
export const LoadingState = ({ label }) => (
  <Flex justifyContent="center" alignItems="center" padding={8} style={{ minHeight: '320px' }}>
    <Loader>{label}</Loader>
  </Flex>
);

/* ---------------------------- pagination ---------------------------- */

const PaginationWrap = styled(Box)`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: ${space(2)};
  padding: ${space(4)};
  border-top: 1px solid ${color('neutral150')};

  @media (max-width: ${breakpoints.mobile}) {
    justify-content: center;
    padding: ${space(4)} 0 0;
    border-top: none;

    nav a,
    nav button {
      min-width: 32px;
      min-height: 32px;
    }
  }
`;

/**
 * DS pagination with ellipses and keyboard-reachable buttons, plus a
 * "Showing x-y of z" summary.
 * @param {{page: number, pageCount: number, total: number, pageSize: number, onChange: (page: number) => void}} props
 */
export const TablePagination = ({ page, pageCount, total, pageSize, onChange }) => {
  const { t } = useMagicLinkIntl();
  const { formatNumber } = useFormatters();
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const go = (next) => (event) => {
    event.preventDefault();
    if (next >= 1 && next <= pageCount && next !== page) onChange(next);
  };

  return (
    <PaginationWrap>
      <Typography variant="pi" textColor="neutral600" aria-live="polite">
        {t('common.table.pagination.summary', 'Showing {from}-{to} of {total}', {
          from: formatNumber(from),
          to: formatNumber(to),
          total: formatNumber(total),
        })}
      </Typography>
      {pageCount > 1 ? (
        <Pagination
          activePage={page}
          pageCount={pageCount}
          label={t('common.table.pagination.label', 'Pagination')}
        >
          <PreviousLink tag="button" type="button" onClick={go(page - 1)}>
            {t('common.previous', 'Previous')}
          </PreviousLink>
          {getPageItems(page, pageCount).map((item) =>
            typeof item === 'number' ? (
              <PageLink key={item} tag="button" type="button" number={item} onClick={go(item)}>
                {t('common.table.pagination.goTo', 'Go to page {page}', { page: item })}
              </PageLink>
            ) : (
              <Dots key={item}>{t('common.table.pagination.more', 'More pages')}</Dots>
            )
          )}
          <NextLink tag="button" type="button" onClick={go(page + 1)}>
            {t('common.next', 'Next')}
          </NextLink>
        </Pagination>
      ) : null}
    </PaginationWrap>
  );
};
