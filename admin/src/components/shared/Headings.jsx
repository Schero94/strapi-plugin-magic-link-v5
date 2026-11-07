import { Typography } from '@strapi/design-system';
import { Page } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { useMagicLinkIntl } from '../../hooks/useMagicLinkIntl';

/**
 * Sets the browser tab title to "<page> | Magic Link" (Page.Title from
 * @strapi/strapi/admin). Render it once per view; it renders nothing.
 *
 *   <PluginPageTitle>{t('tokens.pageTitle', 'Tokens')}</PluginPageTitle>
 *
 * @param {{children: string}} props
 */
export const PluginPageTitle = ({ children }) => {
  const { t } = useMagicLinkIntl();
  return <Page.Title>{t('common.pageTitle', '{page} | Magic Link', { page: children })}</Page.Title>;
};

/**
 * Section heading (h2): DS delta variant (16px desktop / 18px mobile,
 * semiBold), neutral800.
 * Use for card and accordion section titles inside a page with one h1.
 */
export const SectionHeading = styled(Typography).attrs((props) => ({
  tag: props.tag ?? 'h2',
  variant: props.variant ?? 'delta',
  textColor: props.textColor ?? 'neutral800',
}))``;

/** Sub-section heading (h3) for groups inside cards and modals. */
export const SubsectionHeading = styled(Typography).attrs((props) => ({
  tag: props.tag ?? 'h3',
  variant: props.variant ?? 'omega',
  fontWeight: props.fontWeight ?? 'bold',
  textColor: props.textColor ?? 'neutral800',
}))``;
