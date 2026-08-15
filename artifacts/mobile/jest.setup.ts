/**
 * Jest global setup — runs before each test file.
 *
 * Provides lightweight no-op mocks for native modules that cannot run inside
 * Node.js / jsdom so that tests which import files depending on them don't
 * crash. Individual test files mock the hook-level interfaces (useAuth,
 * useTeamContext, useSubscription, …) so these deep module mocks only need to
 * prevent hard crashes on import.
 */

// ─── react-native-purchases (native iOS/Android SDK, unavailable in Node) ───
jest.mock('react-native-purchases', () => ({
  default: {
    configure: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    getOfferings: jest.fn().mockResolvedValue({ current: null }),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    setLogHandler: jest.fn(),
  },
  LOG_LEVEL: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG', VERBOSE: 'VERBOSE' },
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: 2 },
}));

jest.mock('react-native-purchases-ui', () => ({
  default: {
    presentCustomerCenter: jest.fn(),
    presentPaywallIfNeeded: jest.fn(),
  },
}));

// ─── expo-constants (reads native build metadata) ────────────────────────────
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: { extra: {} },
    appOwnership: 'expo',
  },
}));

// ─── async-storage ───────────────────────────────────────────────────────────
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── push notifications (no native push in tests) ────────────────────────────
jest.mock('@/lib/push-notifications', () => ({
  registerForPushNotificationsAsync: jest.fn().mockResolvedValue(null),
  unregisterPushNotificationsAsync: jest.fn().mockResolvedValue(null),
}));

// ─── expo-notifications ──────────────────────────────────────────────────────
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExpoToken[test]' }),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// ─── @expo/vector-icons (renders nothing, avoids font loading) ───────────────
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Icon = (props: object) => React.createElement(View, props);
  return { Feather: Icon, Ionicons: Icon, MaterialIcons: Icon };
});
