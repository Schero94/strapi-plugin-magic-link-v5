import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { defaultTtlFromSettings, normalizeToken } from './tokenModel';

/**
 * Loads the magic-link tokens (GET /magic-link/tokens, permission `read`).
 *
 * @param {{enabled: boolean}} options - false until RBAC allows reading
 * @returns {{tokens: object[], isLoading: boolean, error: unknown, refetch: () => Promise<boolean>}}
 *   refetch resolves true on success, false on failure (never throws)
 */
export const useTokenList = ({ enabled }) => {
  const { get } = useFetchClient();
  const [tokens, setTokens] = useState([]);
  // Starts busy: the first fetch runs as soon as RBAC allows reading.
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Sets state only after the request settles, so the mount effect does not
  // cascade renders; refetch() shows the loader first.
  const fetchTokens = useCallback(async () => {
    try {
      const response = await get('/magic-link/tokens');
      const raw = response?.data?.data ?? response?.data ?? [];
      if (mounted.current) {
        setTokens(Array.isArray(raw) ? raw.map(normalizeToken) : []);
        setError(null);
      }
      return true;
    } catch (fetchError) {
      if (mounted.current) setError(fetchError ?? new Error('load failed'));
      return false;
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [get]);

  const refetch = useCallback(() => {
    if (!enabled) return Promise.resolve(false);
    setIsLoading(true);
    return fetchTokens();
  }, [enabled, fetchTokens]);

  useEffect(() => {
    if (!enabled) return;
    // fetchTokens sets state only after the request settles.
    const load = async () => {
      await fetchTokens();
    };
    load();
  }, [enabled, fetchTokens]);

  return { tokens, isLoading: enabled && isLoading, error, refetch };
};

/**
 * Reads the plugin settings for the create form default TTL and the login
 * link fallback. Only runs with `settings.read`; otherwise the defaults stay.
 *
 * @param {{enabled: boolean}} options
 * @returns {{settings: object|null, defaultTtlHours: number}}
 */
export const useTokenSettings = ({ enabled }) => {
  const { get } = useFetchClient();
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    get('/magic-link/settings')
      .then((response) => {
        const data = response?.data?.settings ?? response?.data?.data ?? response?.data ?? null;
        if (active) setSettings(data && typeof data === 'object' ? data : null);
      })
      .catch(() => {
        // Optional data: the form keeps its 24h default and the link falls back.
        if (active) setSettings(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, get]);

  // Without settings.read the defaults apply, even if settings were loaded before.
  const visible = enabled ? settings : null;
  return { settings: visible, defaultTtlHours: defaultTtlFromSettings(visible?.expire_period) };
};
