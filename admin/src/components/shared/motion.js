/**
 * Reduced-motion helpers.
 *
 * Users who ask the OS for reduced motion must not get infinite or decorative
 * animations. Visuals stay unchanged for everyone else.
 *
 *   const Badge = styled.span`
 *     ${motionSafe(css`animation: ${pulse} 2s infinite;`)}
 *   `;
 *
 *   const Card = styled.div`
 *     transition: transform 0.2s ease;
 *     &:hover { transform: translateY(-2px); }
 *     ${reducedMotion}
 *   `;
 */
import { useEffect, useState } from 'react';
import { css } from 'styled-components';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Turns off animations, transitions and hover/active transforms of the element
 * it is placed in (and of its ::before/::after) when reduced motion is requested.
 */
export const reducedMotion = css`
  @media (prefers-reduced-motion: reduce) {
    animation: none !important;
    transition: none !important;

    &::before,
    &::after {
      animation: none !important;
      transition: none !important;
    }

    &:hover,
    &:active,
    &:focus-visible {
      transform: none !important;
    }
  }
`;

/**
 * Only applies the given CSS when the user has no reduced-motion preference.
 * @param {ReturnType<typeof css>|string} block
 */
export const motionSafe = (block) => css`
  @media (prefers-reduced-motion: no-preference) {
    ${block}
  }
`;

/**
 * @param {Window|undefined} win
 * @returns {boolean} whether the user currently prefers reduced motion
 */
export const prefersReducedMotion = (win = typeof window === 'undefined' ? undefined : window) => {
  try {
    return Boolean(win?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches);
  } catch {
    return false;
  }
};

/**
 * React hook that follows the OS reduced-motion preference (for JS animations,
 * e.g. confetti, auto-scrolling or count-up effects).
 * @returns {boolean}
 */
export const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(query.matches);
    onChange();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return reduced;
};
