/**
 * Styled building blocks of the Tokens page. Colours come from the DS theme
 * (dark mode aware) or from the Magic Link brand helpers in utils/theme.
 */
import styled, { css, keyframes } from 'styled-components';
import { Box, Flex, Table, Typography } from '@strapi/design-system';
import {
  accent,
  brand,
  breakpoints,
  byScheme,
  color,
  fontSize,
  space,
  theme,
  tint,
} from '../../../utils/theme';
import { motionSafe, reducedMotion } from '../../../components/shared/motion';

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;

/** One content width for header, tabs, stats, filter bar and table. */
export const Container = styled(Box)`
  max-width: 1440px;
  margin: 0 auto;
  padding: ${space(7)} ${space(6)} ${space(7)};
  ${motionSafe(css`
    animation: ${fadeIn} 300ms ease-out;
  `)}

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)} ${space(4)} ${space(6)};
  }
`;

export const Header = styled.header`
  position: relative;
  overflow: hidden;
  background: ${brand.gradient};
  border-radius: ${theme.borderRadius.xl};
  padding: ${space(7)};
  margin-bottom: ${space(6)};
  box-shadow: ${theme.shadows.xl};

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    pointer-events: none;
    ${motionSafe(css`
      animation: ${shimmer} 3s infinite;
    `)}
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(
      circle at 20% 80%,
      transparent 50%,
      rgba(255, 255, 255, 0.1) 50%
    );
    background-size: 16px 16px;
    opacity: 0.3;
    pointer-events: none;
  }

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(6)} ${space(4)};
    border-radius: ${theme.borderRadius.md};
  }
`;

export const HeaderContent = styled(Flex)`
  position: relative;
  z-index: 1;
  gap: ${space(4)};

  @media (max-width: ${breakpoints.mobile}) {
    flex-direction: column;
    align-items: stretch;
  }
`;

/** White title on the gradient; both gradient stops keep it at >= 4.5:1 (see brand.gradient). */
export const Title = styled(Typography)`
  display: flex;
  align-items: center;
  gap: ${space(2)};
  color: ${brand.onFill};
  font-size: ${fontSize(5)};
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.025em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  svg {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    ${motionSafe(css`
      animation: ${float} 3s ease-in-out infinite;
    `)}
  }

  svg path {
    fill: ${brand.onFill};
  }
`;

export const Subtitle = styled(Typography)`
  display: block;
  margin-top: ${space(1)};
  color: ${brand.onFill};
  font-size: ${fontSize(2)};
  font-weight: 600;
`;

export const HeaderActions = styled(Flex)`
  gap: ${space(2)};
  flex-wrap: wrap;
  justify-content: flex-end;

  @media (max-width: ${breakpoints.mobile}) {
    justify-content: stretch;

    /* Grow from the label width and wrap to a new row instead of squeezing a
       label past its button (320px, or long German and French labels). */
    & > * {
      flex: 1 1 auto;
    }
  }
`;

/** Translucent button on the gradient header. 14px semi-bold white label. */
export const HeaderButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space(2)};
  min-height: ${theme.controlHeight.L};
  padding: 0 ${space(4)};
  border-radius: ${theme.borderRadius.sm};
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(12px);
  color: ${brand.onFill};
  font-size: ${fontSize(2)};
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background ${theme.transitions.normal},
    transform ${theme.transitions.normal};

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  svg path {
    fill: ${brand.onFill};
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
  }

  &:focus-visible {
    outline: 2px solid ${brand.onFill};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  @media (max-width: ${breakpoints.mobile}) {
    min-height: 44px;
    padding: 0 ${space(2)};
  }

  ${reducedMotion}
`;

/* ---------------------------------------------------------------- Tabs */

export const TabsWrapper = styled(Box)`
  position: relative;
  margin-bottom: ${space(6)};
  padding: ${space(1)};
  border-radius: ${theme.borderRadius.xl};
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.05) 0%, rgba(147, 51, 234, 0.03) 100%);
  border: 1px solid ${color('neutral150')};
  box-shadow: ${theme.shadows.sm};
`;

export const TabList = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${space(1)};
`;

export const TabButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${space(2)};
  min-width: 0;
  min-height: 48px;
  padding: ${space(3)} ${space(4)};
  border: none;
  border-radius: ${theme.borderRadius.lg};
  background: ${({ $active }) => ($active ? brand.gradient : 'transparent')};
  color: ${({ $active }) => ($active ? brand.onFill : color('neutral700'))};
  font-size: ${fontSize(2)};
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
  box-shadow: ${({ $active }) => ($active ? '0 4px 12px rgba(79, 70, 229, 0.3)' : 'none')};
  transition:
    background ${theme.transitions.normal},
    color ${theme.transitions.normal};

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  svg path {
    fill: currentColor;
  }

  &:hover {
    color: ${({ $active }) => ($active ? brand.onFill : color('neutral800'))};
    background: ${({ $active }) => ($active ? brand.gradient : color('neutral100'))};
  }

  &:focus-visible {
    outline: 2px solid ${accent.primary};
    outline-offset: 2px;
  }

  .tab-label-short {
    display: none;
  }

  @media (max-width: ${breakpoints.mobile}) {
    flex-direction: column;
    gap: ${space(1)};
    padding: ${space(2)} ${space(1)};
    min-height: 56px;

    .tab-label-full {
      display: none;
    }

    .tab-label-short {
      display: block;
    }
  }

  ${reducedMotion}
`;

/* --------------------------------------------------------------- Stats */

/**
 * Five stat cards without an orphan row: 5 columns, then 3 + 2 on a 6-column
 * grid, then on phones the total card spans the full row above 2 + 2.
 */
export const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: stretch;
  gap: ${space(4)};
  margin-bottom: ${space(6)};

  @media (max-width: ${breakpoints.statsThreeTwo}) {
    grid-template-columns: repeat(6, minmax(0, 1fr));

    & > :nth-child(-n + 3) {
      grid-column: span 2;
    }

    & > :nth-child(n + 4) {
      grid-column: span 3;
    }
  }

  @media (max-width: ${breakpoints.mobile}) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${space(2)};

    & > :nth-child(n) {
      grid-column: span 1;
    }

    & > :first-child {
      grid-column: 1 / -1;
    }
  }
`;

export const StatCard = styled.div`
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space(2)};
  padding: ${space(6)};
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.lg};
  box-shadow: ${theme.shadows.sm};
  transition:
    transform ${theme.transitions.normal},
    box-shadow ${theme.transitions.normal},
    border-color ${theme.transitions.normal};

  &:hover {
    transform: translateY(-4px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${(p) => p.$accent(p)};
  }

  &::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 120px;
    height: 120px;
    background: radial-gradient(circle at center, ${(p) => p.$accent(p)}26, transparent 70%);
    transform: translate(40%, -40%);
    pointer-events: none;
  }

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)};
  }

  ${reducedMotion}
`;

export const StatIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: ${theme.borderRadius.md};
  background: ${(p) => p.$tint(p)};

  svg {
    width: 24px;
    height: 24px;
  }

  svg path {
    fill: ${(p) => p.$accent(p)};
  }
`;

export const StatValue = styled.span`
  color: ${color('neutral800')};
  font-size: ${fontSize(7)};
  font-weight: 700;
  line-height: 1;
`;

export const StatLabel = styled.span`
  color: ${color('neutral600')};
  font-size: ${fontSize(2)};
  font-weight: 500;
  text-align: center;
`;

/* ---------------------------------------------------- Filter and table */

export const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${space(2)};
  margin-bottom: ${space(4)};
  padding: ${space(4)};
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.lg};
  box-shadow: ${theme.shadows.sm};

  & > .filter-search {
    flex: 1 1 240px;
    min-width: 0;
  }

  /* The DS 2.2.4 Searchbar clear button is 22px; give it the 24px desktop
     and 32px touch target. */
  & > .filter-search button {
    min-width: 24px;
    min-height: 24px;
  }

  & > .filter-select {
    flex: 0 1 200px;
    min-width: 0;
  }

  @media (max-width: ${breakpoints.mobile}) {
    & > .filter-search {
      flex-basis: 100%;
    }

    & > .filter-search button {
      min-width: 32px;
      min-height: 32px;
    }

    & > .filter-select {
      flex: 1 1 140px;
    }
  }
`;

export const ActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space(2)};
  margin-bottom: ${space(4)};
  padding: ${space(4)};
  background: ${tint.primary.bg};
  border: 1px solid ${tint.primary.border};
  border-radius: ${theme.borderRadius.lg};
`;

export const DataTable = styled.div`
  overflow: hidden;
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.xl};
  box-shadow: ${theme.shadows.sm};

  /* Phones: the rows are cards of their own, so the frame around them goes
     away and the cards line up with the filter bar. DS 2.2.4 Table renders
     a bordered wrapper and a scroll container with 24px side padding around
     the <table>. Loading, error and empty states keep the frame. */
  @media (max-width: ${breakpoints.mobile}) {
    &:has(table) {
      overflow: visible;
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }

    &:has(table) > div {
      background: transparent;
      border: none;
      box-shadow: none;
    }

    & div:has(> table) {
      padding: 0;
    }
  }
`;

/**
 * Pagination below the table. Below 520px only previous, the current page and
 * next stay visible, with a "Page x of y" line, so the row never overflows.
 */
export const PaginationBar = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space(2)};
  padding: ${space(4)};

  .pagination-status {
    display: none;
  }

  @media (max-width: ${breakpoints.mobile}) {
    padding: ${space(4)} 0 0;

    nav a,
    nav button {
      min-width: 32px;
      min-height: 32px;
    }
  }

  @media (max-width: ${breakpoints.compact}) {
    nav li:not(:first-child):not(:last-child):not(:has([aria-current='true'])) {
      display: none;
    }

    .pagination-status {
      display: block;
    }
  }
`;

export const StyledTable = styled(Table)`
  thead th {
    padding: ${space(4)};
  }

  tbody tr {
    border-bottom: 1px solid ${color('neutral150')};
    transition: background ${theme.transitions.fast};

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background: ${color('neutral100')};
    }

    ${reducedMotion}
  }

  tbody td {
    padding: ${space(4)};
    color: ${color('neutral800')};
  }

  /* 1024-1199px: 8px side padding, and the "Used ..." and IP lines of the
     reference cell may wrap, so all seven columns, including the row actions,
     fit inside the frame without horizontal scrolling. */
  @media (max-width: ${breakpoints.tableCompact}) {
    thead th,
    tbody td {
      padding-left: ${space(2)};
      padding-right: ${space(2)};
    }

    tbody td.cell-reference {
      white-space: normal;
      text-wrap: balance;
    }
  }

  .cell-label {
    display: none;
  }

  /* Card layout below 768px: every cell shows its column label. */
  @media (max-width: ${breakpoints.mobile}) {
    display: block;
    width: 100%;

    thead {
      display: none;
    }

    tbody {
      display: block;
      width: 100%;
    }

    tbody tr {
      display: block;
      width: 100%;
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

    tbody td {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: ${space(3)};
      width: 100%;
      padding: ${space(2)} 0;
      min-width: 0;
      overflow-wrap: anywhere;

      &:not(:last-child) {
        border-bottom: 1px solid ${color('neutral150')};
      }
    }

    .cell-label {
      display: block;
      flex-shrink: 0;
      color: ${color('neutral600')};
      font-size: ${fontSize(1)};
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }
`;

/** Token state badge: DS Badge metrics (11px semi-bold caps) in the Magic Link tints. */
export const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 3px ${space(2)};
  border: 1px solid ${(p) => tint[p.$tone].border(p)};
  border-radius: ${theme.borderRadius.sm};
  background: ${(p) => tint[p.$tone].bg(p)};
  color: ${(p) => tint[p.$tone].fg(p)};
  font-size: ${fontSize(0)};
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
`;

/**
 * Expiry date inside an InfoList value: same size and weight as the other
 * values (DS Typography variants grow to 16px on phones), red when expired.
 */
export const ExpiryValue = styled.span`
  color: ${(p) => (p.$expired ? color('danger600')(p) : 'inherit')};
`;

export const ReferenceChip = styled.span`
  display: inline-block;
  padding: 2px ${space(2)};
  border-radius: ${theme.borderRadius.sm};
  background: rgba(128, 128, 128, 0.12);
  color: ${color('neutral800')};
  font-family: monospace;
  font-size: ${fontSize(1)};
  font-weight: 600;
  letter-spacing: 0.05em;
`;

export const Avatar = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: ${theme.borderRadius.full};
  background: ${brand.gradient};

  svg {
    width: 18px;
    height: 18px;
  }

  svg path {
    fill: ${brand.onFill};
  }
`;

/**
 * Empty slot with the size of a DS IconButton (size S, 32px). It keeps the
 * view and delete buttons in the same columns when a row cannot be extended.
 */
export const ActionSlot = styled.span`
  display: block;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
`;

export const MetaIcon = styled.span`
  display: inline-flex;
  flex-shrink: 0;

  svg {
    width: 14px;
    height: 14px;
  }

  svg path {
    fill: ${(p) => (p.$accent ? p.$accent(p) : color('neutral500')(p))};
  }
`;

/** Centered state panel inside the table card (loading, error, empty). */
export const StatePanel = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space(4)};
  padding: ${space(7)} ${space(6)};
  min-height: 240px;
  text-align: center;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.06) 0%, rgba(147, 51, 234, 0.06) 100%);
    pointer-events: none;
  }

  & > * {
    position: relative;
    max-width: 560px;
  }
`;

export const StateIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: ${theme.borderRadius.full};
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%);

  svg {
    width: 40px;
    height: 40px;
  }

  svg path {
    fill: ${accent.primary};
  }
`;

/** Primary call to action in the brand gradient (14px bold white text). */
export const GradientButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space(2)};
  min-height: ${theme.controlHeight.L};
  padding: 0 ${space(6)};
  border: none;
  border-radius: ${theme.borderRadius.sm};
  background: ${brand.gradient};
  color: ${brand.onFill};
  font-size: ${fontSize(2)};
  font-weight: 700;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  svg path {
    fill: ${brand.onFill};
  }

  &:hover {
    background: ${brand.gradientHover};
  }

  &:focus-visible {
    outline: 2px solid ${accent.primary};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

/* --------------------------------------------------------------- Modals */

/** Coloured modal header (details: violet, created: green). */
export const ModalHero = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: ${space(4)};
  padding: ${space(6)};
  background: ${(p) => p.$background};
  color: ${brand.onFill};

  h2 {
    color: ${brand.onFill};
    font-size: ${fontSize(5)};
    font-weight: 700;
    line-height: 1.25;
  }
`;

export const HeroSubtitle = styled.p`
  margin-top: ${space(2)};
  color: ${brand.onFill};
  font-size: ${fontSize(4)};
  font-weight: 600;
  overflow-wrap: anywhere;
`;

export const HeroIcon = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: ${theme.borderRadius.full};
  background: rgba(255, 255, 255, 0.2);

  svg {
    width: 28px;
    height: 28px;
  }

  svg path {
    fill: ${brand.onFill};
  }
`;

export const HeroCloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: ${theme.controlHeight.L};
  height: ${theme.controlHeight.L};
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: ${theme.borderRadius.sm};
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  svg path {
    fill: ${brand.onFill};
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  &:focus-visible {
    outline: 2px solid ${brand.onFill};
    outline-offset: 2px;
  }
`;

export const InfoList = styled.dl`
  overflow: hidden;
  border: 1px solid ${color('neutral200')};
  border-radius: ${theme.borderRadius.lg};

  & > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: ${space(2)};
    padding: ${space(3)} ${space(4)};
    border-bottom: 1px solid ${color('neutral150')};
  }

  & > div:first-child {
    background: ${color('neutral100')};
  }

  & > div:last-child {
    border-bottom: none;
  }

  dt {
    color: ${color('neutral600')};
    font-size: ${fontSize(2)};
  }

  dd {
    margin: 0;
    color: ${color('neutral800')};
    font-size: ${fontSize(2)};
    font-weight: 600;
  }
`;

export const Panel = styled.div`
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  background: ${color('neutral100')};
  border: 1px solid ${color('neutral200')};
`;

/** Deliberately dark code block in both schemes (light text, 4.5:1 or more). */
export const CodeBlock = styled.pre`
  margin: 0;
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  background: ${byScheme('#1E1E2E', '#11111B')};
  border: 1px solid ${byScheme('#313244', '#45475A')};
  color: ${byScheme('#CDD6F4', '#CDD6F4')};
  font-family: Monaco, Consolas, monospace;
  font-size: ${fontSize(1)};
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
`;

const tintBox = (name) => css`
  background: ${tint[name].bg};
  border: 1px solid ${tint[name].border};
  color: ${tint[name].fg};
`;

export const Callout = styled.div`
  display: flex;
  align-items: flex-start;
  gap: ${space(3)};
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  font-size: ${fontSize(2)};
  line-height: 1.6;
  ${(p) => tintBox(p.$tone ?? 'warning')}

  svg {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  svg path {
    fill: currentColor;
  }
`;

/** Copyable value (token or link). A real button: keyboard and screen-reader friendly. */
export const CopyBox = styled.button`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: ${space(2)};
  width: 100%;
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  text-align: left;
  cursor: pointer;
  ${(p) => tintBox(p.$tone ?? 'success')}

  .copy-value {
    font-family: monospace;
    font-size: ${(p) => (p.$tone === 'primary' ? fontSize(2)(p) : fontSize(3)(p))};
    font-weight: 600;
    word-break: break-all;
    color: ${color('neutral800')};
  }

  .copy-hint {
    display: inline-flex;
    align-items: center;
    gap: ${space(1)};
    font-size: ${fontSize(1)};
  }

  .copy-hint svg {
    width: 12px;
    height: 12px;
  }

  .copy-hint svg path {
    fill: currentColor;
  }

  &:hover {
    filter: brightness(0.98);
  }

  &:focus-visible {
    outline: 2px solid ${accent.primary};
    outline-offset: 2px;
  }
`;
