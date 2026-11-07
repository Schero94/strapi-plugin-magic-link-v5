import { useId } from 'react';
import styled, { css } from 'styled-components';
import { Box, Field, Flex, Switch, Typography } from '@strapi/design-system';
import { reducedMotion } from '../../../components/shared/motion';
import { SubsectionHeading } from '../../../components/shared/Headings';
import { brand, byScheme, color, fontSize, space, theme, tint } from '../../../utils/theme';
import { fieldId } from '../utils/settingsForm';

/**
 * Shared building blocks of the Settings sections. They keep the existing
 * Magic Link look (tinted panels, green active cards, status pills) and use
 * DS tokens so dark mode and contrast work.
 */

/** Inner padding of an accordion section (24px on every side). */
export const SectionBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space(6)};
  padding: ${space(6)};

  @media (max-width: 480px) {
    padding: ${space(4)};
  }
`;

/** Grey group panel (feature toggles, rate limiting). */
export const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space(4)};
  padding: ${space(6)};
  border-radius: ${theme.borderRadius.md};
  background: ${color('neutral100')};
  border: 1px solid ${color('neutral150')};

  @media (max-width: 480px) {
    padding: ${space(4)};
  }
`;

/** Bordered white card (integrations, editors). */
export const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space(4)};
  min-width: 0;
  padding: ${space(6)};
  border-radius: ${theme.borderRadius.lg};
  background: ${color('neutral0')};
  border: 1px solid ${color('neutral200')};

  @media (max-width: 480px) {
    padding: ${space(4)};
  }
`;

/** Equal-height responsive grid; `$min` is the smallest column width. */
export const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, ${(p) => p.$min ?? '220px'}), 1fr));
  gap: ${(p) => (p.$gap === 6 ? space(6) : space(4))};
  align-items: stretch;
`;

/** Fixed column grid that collapses to one column on small screens. */
export const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(${(p) => p.$columns ?? 2}, minmax(0, 1fr));
  gap: ${space(6)};
  align-items: start;

  @media (max-width: 1024px) {
    grid-template-columns: repeat(${(p) => Math.min(p.$columns ?? 2, 2)}, minmax(0, 1fr));
  }

  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

/**
 * Group title (uppercase sigma, h4: the accordion header is the h3).
 * @param {{title: string, subtitle?: string, align?: 'left'|'center', id?: string}} props
 */
export const GroupTitle = ({ title, subtitle, align = 'left', id }) => (
  <Flex direction="column" gap={1} alignItems={align === 'center' ? 'center' : 'flex-start'}>
    <SubsectionHeading
      tag="h4"
      id={id}
      variant="sigma"
      textColor="neutral700"
      style={align === 'center' ? { textAlign: 'center' } : undefined}
    >
      {title}
    </SubsectionHeading>
    {subtitle ? (
      <Typography
        variant="pi"
        textColor="neutral600"
        style={align === 'center' ? { textAlign: 'center' } : undefined}
      >
        {subtitle}
      </Typography>
    ) : null}
  </Flex>
);

const NoteBox = styled.div`
  display: flex;
  gap: ${space(2)};
  align-items: flex-start;
  padding: ${(p) => (p.$compact ? `${space(2)(p)} ${space(3)(p)}` : space(4)(p))};
  border-radius: ${theme.borderRadius.md};
  background: ${(p) => tint[p.$tone].bg(p)};
  border: 1px solid ${(p) => tint[p.$tone].border(p)};
  color: ${(p) => tint[p.$tone].fg(p)};
  font-size: ${fontSize(1)};
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;

  > svg {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
  }

  > svg path {
    fill: currentColor;
  }

  strong {
    font-weight: 600;
  }
`;

/**
 * Tinted info/success/warning/danger box with optional icon and title.
 * @param {{tone?: 'primary'|'success'|'warning'|'danger', icon?: import('react').ElementType,
 *   title?: import('react').ReactNode, children?: import('react').ReactNode, compact?: boolean,
 *   role?: string}} props
 */
export const Note = ({ tone = 'primary', icon: Icon, title, children, compact = false, role }) => (
  <NoteBox $tone={tone} $compact={compact} role={role}>
    {Icon ? <Icon aria-hidden="true" focusable="false" /> : null}
    <Flex direction="column" gap={1} alignItems="flex-start" style={{ minWidth: 0 }}>
      {title ? (
        <Typography variant="pi" fontWeight="bold" style={{ color: 'inherit' }}>
          {title}
        </Typography>
      ) : null}
      {children ? (
        <Typography variant="pi" style={{ color: 'inherit' }} tag="div">
          {children}
        </Typography>
      ) : null}
    </Flex>
  </NoteBox>
);

/** Bullet list for notes and help texts. */
export const BulletList = styled.ul`
  margin: 0;
  padding-left: ${space(4)};
  list-style: disc;

  li + li {
    margin-top: ${space(1)};
  }
`;

/** Ordered steps list. */
export const StepList = styled.ol`
  margin: 0;
  padding-left: ${space(4)};
  list-style: decimal;

  li + li {
    margin-top: ${space(1)};
  }
`;

/** Monospace inline value (paths, URLs). */
export const Mono = styled.code`
  font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: ${fontSize(1)};
  overflow-wrap: anywhere;
  word-break: break-all;
`;

/**
 * Labelled DS field: Field.Root + Label + control + Hint + Error.
 * The control receives the label, hint and error through the Field context.
 *
 * @param {{name: string, label: string, hint?: import('react').ReactNode, error?: string,
 *   required?: boolean, children: import('react').ReactNode}} props
 */
export const SettingField = ({ name, label, hint, error, required = false, children }) => (
  <Field.Root name={name} id={fieldId(name)} hint={hint} error={error} required={required}>
    <Field.Label>{label}</Field.Label>
    {children}
    <Field.Hint />
    <Field.Error />
  </Field.Root>
);

/* ------------------------------------------------------------------ */
/* Toggle cards                                                        */
/* ------------------------------------------------------------------ */

const ToggleCardLabel = styled.label`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space(3)};
  height: 100%;
  min-width: 0;
  padding: ${space(6)} ${space(4)} ${space(4)};
  border-radius: ${theme.borderRadius.md};
  text-align: center;
  user-select: none;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  background: ${(p) => (p.$active ? 'rgba(22, 163, 74, 0.08)' : 'rgba(128, 128, 128, 0.06)')};
  border: 2px solid ${(p) => (p.$active ? 'rgba(22, 163, 74, 0.4)' : color('neutral200')(p))};
  box-shadow: ${(p) => (p.$active ? '0 4px 12px rgba(34, 197, 94, 0.15)' : theme.shadows.sm)};
  transition:
    border-color ${theme.transitions.fast},
    box-shadow ${theme.transitions.fast},
    transform ${theme.transitions.fast};

  ${(p) =>
    !p.$disabled &&
    css`
      &:hover {
        transform: translateY(-2px);
        border-color: ${p.$active ? 'rgba(22, 163, 74, 0.6)' : color('neutral300')(p)};
      }
    `}

  &:focus-within {
    border-color: ${byScheme(brand.primary, '#7DD3FC')};
  }

  ${reducedMotion}
`;

const StatusPill = styled.span`
  position: absolute;
  top: ${space(2)};
  right: ${space(2)};
  padding: 2px ${space(2)};
  border-radius: ${theme.borderRadius.sm};
  font-size: ${fontSize(0)};
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.6;
  background: ${(p) => (p.$active ? brand.success : color('neutral150')(p))};
  color: ${(p) => (p.$active ? brand.onFill : color('neutral700')(p))};
`;

/**
 * Feature card with a centred switch. The whole card is the switch's label,
 * so clicking anywhere toggles it; the switch is named by the title and
 * described by the description. The status pill is real text.
 *
 * @param {{title: string, description?: string, checked: boolean,
 *   onCheckedChange: (checked: boolean) => void, disabled?: boolean,
 *   statusOn: string, statusOff: string, children?: import('react').ReactNode}} props
 */
export const ToggleCard = ({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  statusOn,
  statusOff,
  children,
}) => {
  const id = useId();
  const switchId = `${id}-switch`;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const isOn = Boolean(checked);

  return (
    <ToggleCardLabel htmlFor={switchId} $active={isOn} $disabled={disabled}>
      <StatusPill $active={isOn} aria-hidden="true">
        {isOn ? statusOn : statusOff}
      </StatusPill>
      <Switch
        id={switchId}
        checked={isOn}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      />
      <Flex direction="column" gap={1} alignItems="center">
        <Typography id={titleId} variant="omega" fontWeight="bold" textColor="neutral800">
          {title}
        </Typography>
        {description ? (
          <Typography id={descriptionId} variant="pi" textColor="neutral600">
            {description}
          </Typography>
        ) : null}
      </Flex>
      {children}
    </ToggleCardLabel>
  );
};

/* ------------------------------------------------------------------ */
/* Inline switch row (integrations)                                    */
/* ------------------------------------------------------------------ */

/**
 * Title + description on the left, switch on the right.
 * @param {{title: string, description?: string, checked: boolean,
 *   onCheckedChange: (checked: boolean) => void, disabled?: boolean,
 *   icon?: import('react').ReactNode}} props
 */
export const SwitchRow = ({ title, description, checked, onCheckedChange, disabled = false, icon }) => {
  const id = useId();
  return (
    <Flex gap={4} alignItems="flex-start" justifyContent="space-between">
      <Flex direction="column" gap={1} alignItems="flex-start" style={{ minWidth: 0, flex: 1 }}>
        <Flex gap={2} alignItems="center">
          {icon}
          <Typography tag="label" htmlFor={`${id}-switch`} id={`${id}-title`} variant="omega" fontWeight="bold" textColor="neutral800">
            {title}
          </Typography>
        </Flex>
        {description ? (
          <Typography id={`${id}-description`} variant="pi" textColor="neutral600">
            {description}
          </Typography>
        ) : null}
      </Flex>
      <Switch
        id={`${id}-switch`}
        checked={Boolean(checked)}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
      />
    </Flex>
  );
};

/* ------------------------------------------------------------------ */
/* Code editor                                                         */
/* ------------------------------------------------------------------ */

const EditorFrame = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: ${theme.borderRadius.md};
  border: 1px solid ${color('neutral200')};
  overflow: hidden;
`;

const EditorBar = styled.div`
  padding: ${space(2)} ${space(3)};
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: ${fontSize(1)};
  background: ${(p) => (p.$dark ? '#2D2D2D' : color('neutral150')(p))};
  color: ${(p) => (p.$dark ? '#C8C8C8' : color('neutral700')(p))};
  border-bottom: 1px solid ${(p) => (p.$dark ? '#3C3C3C' : color('neutral200')(p))};
`;

const EditorTextarea = styled.textarea`
  display: block;
  width: 100%;
  min-height: ${(p) => p.$height};
  height: ${(p) => p.$height};
  margin: 0;
  padding: ${space(4)};
  border: none;
  resize: vertical;
  box-sizing: border-box;
  font-family: 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace;
  font-size: ${fontSize(2)};
  line-height: 1.7;
  /* The HTML editor keeps its dark code-editor look in both schemes. */
  background: ${(p) => (p.$dark ? '#1E1E1E' : color('neutral100')(p))};
  color: ${(p) => (p.$dark ? '#D4D4D4' : color('neutral800')(p))};

  &:focus-visible {
    outline: 2px solid ${byScheme(brand.primary, '#7DD3FC')};
    outline-offset: -2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.8;
  }

  @media (max-width: 768px) {
    height: ${(p) => p.$mobileHeight ?? p.$height};
    min-height: ${(p) => p.$mobileHeight ?? p.$height};
  }
`;

/**
 * Labelled code textarea with a file-name bar.
 * @param {{id: string, labelledBy: string, describedBy?: string, filename: string, value: string,
 *   onChange: (value: string) => void, placeholder?: string, disabled?: boolean, dark?: boolean,
 *   height?: string, mobileHeight?: string}} props
 */
export const CodeEditor = ({
  id,
  labelledBy,
  describedBy,
  filename,
  value,
  onChange,
  placeholder,
  disabled = false,
  dark = false,
  height = '480px',
  mobileHeight = '320px',
}) => (
  <EditorFrame>
    <EditorBar $dark={dark} aria-hidden="true">
      {filename}
    </EditorBar>
    <EditorTextarea
      id={id}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      $dark={dark}
      $height={height}
      $mobileHeight={mobileHeight}
    />
  </EditorFrame>
);

/* ------------------------------------------------------------------ */
/* Selectable tiles (template gallery, placeholders)                   */
/* ------------------------------------------------------------------ */

export const Tile = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${space(2)};
  height: 100%;
  min-width: 0;
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: ${(p) => (p.$active ? 'rgba(14, 165, 233, 0.08)' : color('neutral0')(p))};
  border: 2px solid ${(p) => (p.$active ? byScheme('rgba(2, 132, 199, 0.6)', '#38BDF8')(p) : color('neutral200')(p))};
  box-shadow: ${(p) => (p.$active ? '0 8px 20px rgba(2, 132, 199, 0.2)' : theme.shadows.sm)};
  transition:
    border-color ${theme.transitions.fast},
    box-shadow ${theme.transitions.fast},
    transform ${theme.transitions.fast};

  &:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: ${byScheme('rgba(2, 132, 199, 0.6)', '#38BDF8')};
  }

  &:focus-visible {
    outline: 2px solid ${byScheme(brand.primary, '#7DD3FC')};
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  ${reducedMotion}
`;

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

const StatBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space(1)};
  height: 100%;
  padding: ${space(4)};
  border-radius: ${theme.borderRadius.md};
  text-align: center;
  background: ${(p) => (p.$tone === 'neutral' ? color('neutral100')(p) : tint[p.$tone].bg(p))};
  border: 1px solid ${(p) => (p.$tone === 'neutral' ? color('neutral200')(p) : tint[p.$tone].border(p))};
`;

const StatValue = styled.span`
  font-size: ${fontSize(5)};
  font-weight: 700;
  line-height: 1.2;
  color: ${(p) => (p.$tone === 'neutral' ? color('neutral800')(p) : tint[p.$tone].fg(p))};
`;

/**
 * One statistic tile.
 * @param {{value: string, label: string, tone?: 'neutral'|'primary'|'success'|'danger'}} props
 */
export const Stat = ({ value, label, tone = 'neutral' }) => (
  <StatBox $tone={tone}>
    <StatValue $tone={tone}>{value}</StatValue>
    <Typography variant="pi" textColor="neutral600">
      {label}
    </Typography>
  </StatBox>
);

/** Small coloured icon square used by the mode cards. */
export const IconBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: ${theme.borderRadius.lg};
  background: ${(p) => (typeof p.$background === 'function' ? p.$background(p) : p.$background)};

  svg {
    width: 24px;
    height: 24px;
  }

  svg path {
    fill: ${(p) => (typeof p.$color === 'function' ? p.$color(p) : p.$color)};
  }
`;

/** Wraps form content so the Box keeps the min-width fix for flex children. */
export const Stack = ({ gap = 4, children, ...props }) => (
  <Box {...props}>
    <Flex direction="column" alignItems="stretch" gap={gap}>
      {children}
    </Flex>
  </Box>
);
