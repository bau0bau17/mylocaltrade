import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CACHE_KEY = 'user_location_cache';
const CACHE_TTL_MS = 30 * 60 * 1000;

export type LocationState = {
  label: string;
  city: string | null;
  postalCode: string | null;
  /** Device GPS coordinates. Null on web, when permission is denied, or when
   *  only a legacy (pre-coordinates) cache entry is available. Used as the
   *  search-radius anchor when the location box is empty. */
  latitude: number | null;
  longitude: number | null;
  isLoading: boolean;
  permissionDenied: boolean;
  refresh: () => void;
};

type CachedLocation = {
  label: string;
  city: string | null;
  postalCode: string | null;
  // Optional: cache entries written before search-radius support have none.
  latitude?: number | null;
  longitude?: number | null;
  timestamp: number;
};

function buildLabel(city: string | null, postalCode: string | null): string {
  if (city && postalCode) return `${city} · ${postalCode}`;
  if (city) return city;
  if (postalCode) return postalCode;
  return 'Unknown location';
}

export function useLocation(): LocationState {
  const [label, setLabel] = useState('Detecting location...');
  const [city, setCity] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const resolve = useCallback(async (force = false) => {
    if (Platform.OS === 'web') {
      setLabel('United Kingdom');
      setCity(null);
      setPostalCode(null);
      setCoords(null);
      setIsLoading(false);
      return;
    }

    if (!force) {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          const data: CachedLocation = JSON.parse(cached);
          if (Date.now() - data.timestamp < CACHE_TTL_MS) {
            setLabel(data.label);
            setCity(data.city);
            setPostalCode(data.postalCode);
            setCoords(
              data.latitude != null && data.longitude != null
                ? { latitude: data.latitude, longitude: data.longitude }
                : null,
            );
            setIsLoading(false);
            return;
          }
        }
      } catch {}
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLabel('Location unavailable');
        setCoords(null);
        setIsLoading(false);
        return;
      }

      setPermissionDenied(false);

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const results = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      const place = results?.[0];
      const resolvedCity = place?.city || place?.district || place?.subregion || null;
      const resolvedPostal = place?.postalCode
        ? place.postalCode.split(' ')[0]
        : null;

      const resolvedLabel = buildLabel(resolvedCity, resolvedPostal);

      setCity(resolvedCity);
      setPostalCode(resolvedPostal);
      setLabel(resolvedLabel);
      setCoords({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      const cacheData: CachedLocation = {
        label: resolvedLabel,
        city: resolvedCity,
        postalCode: resolvedPostal,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    } catch (err) {
      setLabel('Location unavailable');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setLabel('Detecting location...');
    resolve(true);
  }, [resolve]);

  return {
    label,
    city,
    postalCode,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    isLoading,
    permissionDenied,
    refresh,
  };
}
