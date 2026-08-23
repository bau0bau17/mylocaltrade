import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * The only query families that are safe to retain while the signed-in identity
 * changes. These endpoints are anonymous catalogue/search data and never
 * contain account-owned records.
 *
 * Everything else is deliberately treated as protected. An allowlist is safer
 * than maintaining a denylist: a newly added authenticated endpoint is private
 * by default until it has been explicitly reviewed.
 */
export function isPublicQueryKey(queryKey: QueryKey): boolean {
  const [path, params] = queryKey;
  if (typeof path !== 'string') return false;

  if (
    path === '/api/categories' ||
    path === '/api/report-categories' ||
    path === '/api/subscriptions/plans' ||
    path === '/api/healthz'
  ) {
    return queryKey.length === 1;
  }

  if (path === '/api/traders' || path === '/api/traders/featured') {
    // Generated list keys have either no params or one filter object.
    return queryKey.length === 1 || (queryKey.length === 2 && params != null);
  }

  // Public trader profile and public trader-review responses are single-route
  // keys. Do not use a broad "/api/traders" prefix: future authenticated
  // trader endpoints must remain private by default.
  return (
    queryKey.length === 1 &&
    /^\/api\/traders\/\d+(?:\/reviews)?$/.test(path)
  );
}

export function isProtectedQuery(query: Query): boolean {
  return !isPublicQueryKey(query.queryKey);
}

/**
 * A 401 only invalidates the session that supplied its bearer token. A response
 * from Account A arriving after Account B signs in must be ignored.
 */
export function isCurrentSessionUnauthorized(
  requestToken: string,
  activeToken: string | null,
): boolean {
  return activeToken != null && requestToken === activeToken;
}

/**
 * Remove account-bound request/results before a different authenticated
 * identity can render. We cancel first so a late fetch started for Account A
 * cannot publish into Account B's cache, then forcibly remove each matching
 * cache entry. QueryCache.remove is intentional here: removeQueries skips
 * active observers, while identity transitions must also evict active screens.
 */
export async function clearProtectedAuthCache(queryClient: QueryClient) {
  await queryClient.cancelQueries(
    { predicate: isProtectedQuery },
    { revert: false, silent: true },
  );

  for (const query of queryClient.getQueryCache().findAll({ predicate: isProtectedQuery })) {
    queryClient.getQueryCache().remove(query);
  }

  // Mutation results can contain account-specific response bodies as well.
  // They are never safe to carry between signed-in identities.
  queryClient.getMutationCache().clear();
}