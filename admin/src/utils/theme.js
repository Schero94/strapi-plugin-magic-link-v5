/**
 * Magic Link design tokens.
 *
 * Strapi Design System 2 does NOT define `--colors-*` CSS custom properties
 * (for example `--colors-neutral700`). Its colours only exist on the
 * styled-components theme that the admin ThemeProvider switches between light
 * and dark mode (`theme.colors`, `theme.colorScheme`). Use these helpers:
 *
 *   import { color, fontSize, space, accent, brand, byScheme } from '../../utils/theme';
 *
 *   const Card = styled.div`
 *     background: ${color('neutral0')};          // DS token, follows dark mode
 *     border: 1px solid ${color('neutral200')};
 *     color: ${color('neutral800')};
 *     font-size: ${fontSize(2)};                  // 14px, DS scale (1rem = 10px)
 *     padding: ${space(4)};                       // 16px, DS spacing scale
 *     border-left: 3px solid ${accent.primary};   // brand accent, readable in both schemes
 *   `;
 *
 * In JSX prefer DS props (`background="neutral100"`, `textColor="neutral600"`,
 * `padding={4}`), or `const colors = useThemeColors()` for inline styles.
 *
 * Sources: @strapi/design-system 2.2.4 `dist/themes` (StrapiTheme, CommonTheme,
 * light and dark colour tokens), styled-components 6.6 `useTheme`.
 */
import { useTheme } from 'styled-components';

/**
 * Light-theme values of DS 2.2.4. Only used when no ThemeProvider is present
 * (unit tests, isolated renders). Inside the admin the real theme always wins.
 */
export const LIGHT_FALLBACK_COLORS = Object.freeze({
  alternative100: '#f6ecfc',
  alternative200: '#e0c1f4',
  alternative500: '#ac73e6',
  alternative600: '#9736e8',
  alternative700: '#8312d1',
  neutral0: '#ffffff',
  neutral100: '#f6f6f9',
  neutral150: '#eaeaef',
  neutral200: '#dcdce4',
  neutral300: '#c0c0cf',
  neutral400: '#a5a5ba',
  neutral500: '#8e8ea9',
  neutral600: '#666687',
  neutral700: '#4a4a6a',
  neutral800: '#32324d',
  neutral900: '#212134',
  neutral1000: '#181826',
  primary100: '#f0f0ff',
  primary200: '#d9d8ff',
  primary500: '#7b79ff',
  primary600: '#4945ff',
  primary700: '#271fe0',
  secondary100: '#eaf5ff',
  secondary200: '#b8e1ff',
  secondary500: '#66b7f1',
  secondary600: '#0c75af',
  secondary700: '#006096',
  success100: '#eafbe7',
  success200: '#c6f0c2',
  success500: '#5cb176',
  success600: '#328048',
  success700: '#2f6846',
  warning100: '#fdf4dc',
  warning200: '#fae7b9',
  warning500: '#f29d41',
  warning600: '#d9822f',
  warning700: '#be5d01',
  danger100: '#fcecea',
  danger200: '#f5c0b8',
  danger500: '#ee5e52',
  danger600: '#d02b20',
  danger700: '#b72b1a',
});

/** DS 2 font scale. The admin sets html font-size to 62.5%, so 1rem = 10px. */
export const FONT_SIZE_FALLBACK = Object.freeze([
  '1.1rem', // 0 -> 11px (sigma, uppercase table headers only)
  '1.2rem', // 1 -> 12px (pi, the minimum for helper text)
  '1.4rem', // 2 -> 14px (omega, body)
  '1.6rem', // 3 -> 16px
  '1.8rem', // 4 -> 18px
  '2rem', //   5 -> 20px
  '2.8rem', // 6 -> 28px
  '3.2rem', // 7 -> 32px
]);

/** DS 2 spacing scale (theme.spaces). Index 1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, 6 = 24px, 7 = 32px. */
export const SPACE_FALLBACK = Object.freeze([
  '0px',
  '4px',
  '8px',
  '12px',
  '16px',
  '20px',
  '24px',
  '32px',
  '40px',
  '48px',
  '56px',
  '64px',
]);

/**
 * styled-components interpolation for a DS colour token.
 * @param {string} token - DS colour key, e.g. 'neutral100', 'danger600'
 * @returns {(props: {theme?: object}) => string}
 */
export const color = (token) => (props) =>
  props?.theme?.colors?.[token] ?? LIGHT_FALLBACK_COLORS[token];

/**
 * Resolves a DS colour token from a theme object (inline styles and tests).
 * @param {object|undefined} themeObject
 * @param {string} token
 * @returns {string|undefined}
 */
export const resolveColor = (themeObject, token) => color(token)({ theme: themeObject });

/**
 * styled-components interpolation for a DS font size step (0-7).
 * @param {number} step
 * @returns {(props: {theme?: object}) => string}
 */
export const fontSize = (step) => (props) =>
  props?.theme?.fontSizes?.[step] ?? FONT_SIZE_FALLBACK[step];

/**
 * styled-components interpolation for a DS spacing step (theme.spaces index).
 * @param {number} step - 1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, 6 = 24px, 7 = 32px
 * @returns {(props: {theme?: object}) => string}
 */
export const space = (step) => (props) => props?.theme?.spaces?.[step] ?? SPACE_FALLBACK[step];

/**
 * @param {object|undefined} themeObject
 * @returns {boolean} true when the active DS theme is the dark theme
 */
export const isDarkTheme = (themeObject) => themeObject?.colorScheme === 'dark';

/**
 * Picks a value per colour scheme, for brand colours DS has no token for.
 * @param {string} light
 * @param {string} dark
 * @returns {(props: {theme?: object}) => string}
 */
export const byScheme = (light, dark) => (props) => (isDarkTheme(props?.theme) ? dark : light);

/**
 * Hook returning the active DS colour map, for inline `style={{ ... }}` values.
 * @returns {Record<string, string>}
 */
export const useThemeColors = () => {
  const activeTheme = useTheme();
  return activeTheme?.colors ?? LIGHT_FALLBACK_COLORS;
};

/**
 * Magic Link brand colours (sky and purple), unchanged from the current look.
 *
 * - `gradient` is the hero header and active-tab fill (#0284C7 -> #9333EA).
 *   White text on it must be large (>= 18px, or >= 14px bold): 4.1:1 at the
 *   light end.
 * - `primary`, `secondary`, `success`, `warning` and `danger` are fills for
 *   small white text (buttons, badges). Each keeps white text at >= 4.5:1.
 * - `violetGradient` is the License banner and token-details header.
 */
export const brand = Object.freeze({
  primary: '#0369A1',
  primaryHover: '#075985',
  secondary: '#9333EA',
  secondaryHover: '#7E22CE',
  success: '#15803D',
  successHover: '#166534',
  warning: '#B45309',
  warningHover: '#92400E',
  danger: '#DC2626',
  dangerHover: '#B91C1C',
  gradient: 'linear-gradient(135deg, #0284C7 0%, #9333EA 100%)',
  gradientHover: 'linear-gradient(135deg, #0369A1 0%, #7E22CE 100%)',
  successGradient: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
  violetGradient: 'linear-gradient(135deg, #667EEA 0%, #764BA2 100%)',
  onFill: '#FFFFFF',
});

/**
 * Brand accents for text, icons and borders on neutral surfaces
 * ([light, dark]). Dark values are lighter tints, so they stay readable on
 * the dark neutral0/neutral100 surfaces.
 */
export const ACCENT_VALUES = Object.freeze({
  primary: ['#0369A1', '#7DD3FC'],
  secondary: ['#7E22CE', '#D8B4FE'],
  success: ['#15803D', '#86EFAC'],
  warning: ['#B45309', '#FCD34D'],
  danger: ['#B91C1C', '#FCA5A5'],
});

/**
 * `accent.primary` etc. are styled-components interpolations. Outside a
 * styled template call them with the theme: `accent.primary({ theme })`.
 */
export const accent = Object.freeze(
  Object.fromEntries(
    Object.entries(ACCENT_VALUES).map(([name, [light, dark]]) => [name, byScheme(light, dark)])
  )
);

/**
 * Tinted surfaces (info, success, warning and danger boxes) for both schemes.
 * Pair `tint.X.bg` with `tint.X.fg` text and `tint.X.border`.
 */
const TINT_VALUES = Object.freeze({
  primary: { bg: ['#F0F9FF', 'rgba(14, 165, 233, 0.12)'], border: ['#BAE6FD', '#0C4A6E'] },
  success: { bg: ['#F0FDF4', 'rgba(34, 197, 94, 0.12)'], border: ['#BBF7D0', '#14532D'] },
  warning: { bg: ['#FFFBEB', 'rgba(245, 158, 11, 0.12)'], border: ['#FDE68A', '#78350F'] },
  danger: { bg: ['#FEF2F2', 'rgba(239, 68, 68, 0.12)'], border: ['#FECACA', '#7F1D1D'] },
});

export const tint = Object.freeze(
  Object.fromEntries(
    Object.entries(TINT_VALUES).map(([name, values]) => [
      name,
      Object.freeze({
        bg: byScheme(...values.bg),
        border: byScheme(...values.border),
        fg: accent[name],
      }),
    ])
  )
);

/** Layout breakpoints used by the views (max-width queries). */
export const breakpoints = Object.freeze({ mobile: '768px', tablet: '1024px' });

/** Static, scheme-independent tokens: spacing, radii, shadows, motion. */
export const theme = Object.freeze({
  spacing: Object.freeze({
    xs: '4px',
    sm: '8px',
    smd: '12px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    '2xl': '48px',
  }),
  borderRadius: Object.freeze({ sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '9999px' }),
  shadows: Object.freeze({
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  }),
  transitions: Object.freeze({
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  /**
   * DS 2.2.4 button heights at >= 768px (theme.sizes.button). Below 768px DS
   * grows them to 40/44/48px. Use one size per row and match custom controls
   * to it.
   */
  controlHeight: Object.freeze({ S: '32px', M: '36px', L: '40px' }),
});

export default theme;
