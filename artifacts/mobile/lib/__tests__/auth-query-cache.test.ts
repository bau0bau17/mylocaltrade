import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  clearProtectedAuthCache,
  isCurrentSessionUnauthorized,
  isPublicQueryKey,
} from '@/lib/auth-query-cache';

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

describe('authenticated query cache isolation', () => {
  it('removes Account A protected data before Account B can render while retaining public catalogue data', async () => {
    const queryClient = freshClient();
    const conversationsKey = ['/api/conversations'];
    const profileKey = ['/api/profile'];
    const publicCategoriesKey = ['/api/categories'];

    queryClient.setQueryData(conversationsKey, { conversations: [{ id: 1, customerName: 'Account A' }] });
    queryClient.setQueryData(profileKey, { fullName: 'Account A' });
    queryClient.setQueryData(publicCategoriesKey, { categories: ['Plumbing'] });

    await clearProtectedAuthCache(queryClient);

    expect(queryClient.getQueryData(conversationsKey)).toBeUndefined();
    expect(queryClient.getQueryData(profileKey)).toBeUndefined();
    expect(queryClient.getQueryData(publicCategoriesKey)).toEqual({ categories: ['Plumbing'] });

    // Account B begins with an empty protected cache rather than Account A's
    // conversation or profile response.
    expect(queryClient.getQueryData(['/api/conversations'])).toBeUndefined();
  });

  it('cannot let a delayed Account A query overwrite Account B after the session changes', async () => {
    const queryClient = freshClient();
    const conversationKey = ['/api/conversations'];
    let resolveAccountA!: (value: {
      conversations: Array<{ id: number; customerName: string }>;
    }) => void;

    const accountAObserver = new QueryObserver(queryClient, {
      queryKey: conversationKey,
      queryFn: () =>
        new Promise<{ conversations: Array<{ id: number; customerName: string }> }>((resolve) => {
          resolveAccountA = resolve;
        }),
    });
    const unsubscribe = accountAObserver.subscribe(() => {});
    const accountARequest = accountAObserver.refetch();

    await clearProtectedAuthCache(queryClient);

    // Account B's request/cache entry is a new query after Account A's active
    // entry was cancelled and removed.
    queryClient.setQueryData(conversationKey, {
      conversations: [{ id: 2, customerName: 'Account B' }],
    });

    resolveAccountA({ conversations: [{ id: 1, customerName: 'Account A' }] });
    await accountARequest.catch(() => undefined);
    await Promise.resolve();

    expect(queryClient.getQueryData(conversationKey)).toEqual({
      conversations: [{ id: 2, customerName: 'Account B' }],
    });
    unsubscribe();
  });

  it('uses a strict public allowlist and treats unknown query keys as protected', () => {
    expect(isPublicQueryKey(['/api/traders'])).toBe(true);
    expect(isPublicQueryKey(['/api/traders/123/reviews'])).toBe(true);
    expect(isPublicQueryKey(['/api/categories'])).toBe(true);
    expect(isPublicQueryKey(['/api/conversations'])).toBe(false);
    expect(isPublicQueryKey(['/api/subscriptions/status', 123])).toBe(false);
    expect(isPublicQueryKey(['company', 'team', 123])).toBe(false);
    expect(isPublicQueryKey(['future-unreviewed-key'])).toBe(false);
  });

  it('ignores a delayed Account A 401 but accepts an immediate Account B 401', () => {
    expect(isCurrentSessionUnauthorized('account-a-token', 'account-b-token')).toBe(false);
    expect(isCurrentSessionUnauthorized('account-a-token', null)).toBe(false);
    expect(isCurrentSessionUnauthorized('account-b-token', 'account-b-token')).toBe(true);
  });
});