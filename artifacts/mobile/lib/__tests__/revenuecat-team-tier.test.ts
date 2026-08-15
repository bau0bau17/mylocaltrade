/**
 * resolveTeamTier – unit tests (Phase C)
 *
 * Display-tier resolution must FAIL CLOSED exactly like the server's seat
 * resolver: only the offering's team packages and the EXACT known product ids
 * (confirmed App Store Connect ids + dev Test Store ids) may map to a tier.
 * Shape-alike ids (team50, team15, suffixed variants) must resolve to null so
 * the UI falls back to the generic "Premium" label and never invents seats.
 */

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-url', () => ({
  getApiUrl: () => 'http://test-api',
}));

import { resolveTeamTier } from '@/lib/revenuecat';
import type { PurchasesOffering } from 'react-native-purchases';

function offeringWith(
  pkgs: Array<{ identifier: string; product: string }>,
): PurchasesOffering {
  return {
    availablePackages: pkgs.map((p) => ({
      identifier: p.identifier,
      product: { identifier: p.product },
    })),
  } as unknown as PurchasesOffering;
}

describe('resolveTeamTier', () => {
  it('maps the exact confirmed App Store Connect ids without an offering', () => {
    expect(resolveTeamTier('com.mylocaltrade.app.trader.team5.yearly', null)).toBe('team5');
    expect(resolveTeamTier('com.mylocaltrade.app.trader.team10.yearly', null)).toBe('team10');
    expect(resolveTeamTier('com.mylocaltrade.app.trader.team20.yearly', null)).toBe('team20');
  });

  it('maps the exact dev Test Store ids', () => {
    expect(resolveTeamTier('team5', null)).toBe('team5');
    expect(resolveTeamTier('team10', null)).toBe('team10');
    expect(resolveTeamTier('team20', null)).toBe('team20');
  });

  it('Solo products are never a team tier', () => {
    expect(resolveTeamTier('com.mylocaltrade.app.trader.monthly', null)).toBeNull();
    expect(resolveTeamTier('com.mylocaltrade.app.trader.yearly', null)).toBeNull();
    expect(resolveTeamTier('monthly', null)).toBeNull();
    expect(resolveTeamTier('yearly', null)).toBeNull();
  });

  it('fails closed on shape-alike and unknown ids — no substring guessing', () => {
    for (const id of [
      'com.mylocaltrade.app.trader.team50.yearly',
      'com.mylocaltrade.app.trader.team15.yearly',
      'com.mylocaltrade.app.trader.team5.yearly.v2',
      'com.mylocaltrade.app.team5.yearly', // old invented id (missing .trader.)
      'com.mylocaltrade.app.trader.team5.monthly',
      'team5beta',
      'team_50',
      'team',
      'something.entirely.else',
    ]) {
      expect(resolveTeamTier(id, null)).toBeNull();
    }
    expect(resolveTeamTier(null, null)).toBeNull();
  });

  it('matches the active product against the offering team packages first', () => {
    const offering = offeringWith([
      { identifier: '$rc_annual', product: 'com.mylocaltrade.app.trader.yearly' },
      { identifier: 'team_10_annual', product: 'some.future.renamed.team10.product' },
    ]);
    // Unknown to the exact-id map, but the offering says this product IS the
    // team_10_annual package → team10.
    expect(resolveTeamTier('some.future.renamed.team10.product', offering)).toBe('team10');
    // The solo package in the same offering never maps to a tier.
    expect(resolveTeamTier('com.mylocaltrade.app.trader.yearly', offering)).toBeNull();
  });

  it('an offering with team packages does not leak a tier onto unrelated ids', () => {
    const offering = offeringWith([
      { identifier: 'team_5_annual', product: 'com.mylocaltrade.app.trader.team5.yearly' },
    ]);
    expect(resolveTeamTier('com.mylocaltrade.app.trader.team50.yearly', offering)).toBeNull();
  });
});
