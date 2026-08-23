jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-url', () => ({
  getApiUrl: () => 'http://test-api',
}));

import {
  confirmBackendSubscriptionSync,
  type BackendSyncResult,
} from '@/lib/revenuecat';

const team10 = 'com.mylocaltrade.app.trader.team10.yearly';

function result(overrides: Partial<BackendSyncResult> = {}): BackendSyncResult {
  return {
    confirmed: true,
    active: true,
    productId: team10,
    ...overrides,
  };
}

describe('RevenueCat backend confirmation', () => {
  it('retries a short propagation delay until the API reports the purchased Team product', async () => {
    const sync = jest
      .fn<Promise<BackendSyncResult>, []>()
      .mockResolvedValueOnce(result({ productId: 'com.mylocaltrade.app.trader.team5.yearly' }))
      .mockResolvedValueOnce(result());
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(confirmBackendSubscriptionSync(team10, sync, wait)).resolves.toBe(true);

    expect(sync).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1);
  });

  it('stops after three unconfirmed attempts without treating device state as a seat grant', async () => {
    const sync = jest
      .fn<Promise<BackendSyncResult>, []>()
      .mockResolvedValue(result({ productId: 'com.mylocaltrade.app.trader.team5.yearly' }));
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(confirmBackendSubscriptionSync(team10, sync, wait)).resolves.toBe(false);

    expect(sync).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('confirms an Apple downgrade only when the API reports no active entitlement', async () => {
    await expect(
      confirmBackendSubscriptionSync(
        null,
        jest.fn<Promise<BackendSyncResult>, []>().mockResolvedValue(
          result({ active: false, productId: null }),
        ),
        jest.fn<Promise<void>, [number]>().mockResolvedValue(),
      ),
    ).resolves.toBe(true);
  });
});