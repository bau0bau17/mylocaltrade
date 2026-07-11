import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type RefetchFn = () => Promise<unknown>;

// Shared pull-to-refresh behaviour. Pass the screen's own refetch functions to
// scope the refresh to that screen's queries; when none are given it falls
// back to refetching every active (mounted) query. Local `refreshing` state
// keeps the spinner tied to the user's gesture only.
export function usePullToRefresh(...refetchFns: RefetchFn[]) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const fnsRef = useRef(refetchFns);
  fnsRef.current = refetchFns;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (fnsRef.current.length > 0) {
        await Promise.all(fnsRef.current.map((fn) => fn()));
      } else {
        await queryClient.refetchQueries({ type: 'active' });
      }
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  return { refreshing, onRefresh };
}
