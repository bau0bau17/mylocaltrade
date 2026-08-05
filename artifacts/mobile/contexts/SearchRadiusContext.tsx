import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SEARCH_RADIUS,
  isValidSearchRadius,
  type SearchRadius,
} from '@/constants/searchRadius';

const STORAGE_KEY = 'search_radius_miles';

type SearchRadiusContextValue = {
  radius: SearchRadius;
  setRadius: (value: SearchRadius) => void;
};

const SearchRadiusContext = createContext<SearchRadiusContextValue | null>(null);

/**
 * Global committed search radius, shared by Home (radius sheet) and Search
 * (filter sheet drafts commit into it) and remembered between app launches.
 * Lives in context because the Search tab stays mounted — a change made on
 * Home must reach it live, not on next mount.
 */
export function SearchRadiusProvider({ children }: { children: React.ReactNode }) {
  const [radius, setRadiusState] = useState<SearchRadius>(DEFAULT_SEARCH_RADIUS);

  // Load the remembered choice once on mount. Unknown or legacy stored
  // values fall back to the default (the options list may change between
  // releases).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled || stored == null) return;
        const parsed: unknown = JSON.parse(stored);
        if (isValidSearchRadius(parsed)) setRadiusState(parsed);
      } catch {
        // Unreadable value: keep the default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRadius = useCallback((value: SearchRadius) => {
    setRadiusState(value);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value)).catch(() => {});
  }, []);

  // Consumers should destructure { radius, setRadius }; this object only
  // changes identity when the radius itself changes (setRadius is stable).
  const value = useMemo(() => ({ radius, setRadius }), [radius, setRadius]);

  return <SearchRadiusContext.Provider value={value}>{children}</SearchRadiusContext.Provider>;
}

export function useSearchRadius(): SearchRadiusContextValue {
  const ctx = useContext(SearchRadiusContext);
  if (!ctx) throw new Error('useSearchRadius must be used within SearchRadiusProvider');
  return ctx;
}
