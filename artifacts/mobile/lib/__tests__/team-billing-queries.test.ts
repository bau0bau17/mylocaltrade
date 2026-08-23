import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  refreshTeamBillingQueries,
  subscriptionStatusQueryKey,
  teamContextQueryKey,
  teamQueryKey,
} from '@/lib/team-billing-queries';

describe('Team billing query refresh', () => {
  function freshClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  }

  it('uses a separate cache identity for each account', () => {
    expect(subscriptionStatusQueryKey(11)).not.toEqual(subscriptionStatusQueryKey(22));
    expect(teamContextQueryKey(11)).not.toEqual(teamContextQueryKey(22));
    expect(teamQueryKey(11)).not.toEqual(teamQueryKey(22));
  });

  it('immediately refetches a mounted Team query for the current owner only', async () => {
    const queryClient = freshClient();
    let teamVersion = 0;
    const ownerOneKey = teamQueryKey(101);
    const ownerTwoKey = teamQueryKey(202);
    const observer = new QueryObserver(queryClient, {
      queryKey: ownerOneKey,
      queryFn: async () => ({ seats: { max: ++teamVersion } }),
    });
    const unsubscribe = observer.subscribe(() => {});

    await observer.refetch();
    queryClient.setQueryData(ownerTwoKey, { seats: { max: 99 } });

    await refreshTeamBillingQueries(queryClient, 101);

    expect(queryClient.getQueryData(ownerOneKey)).toEqual({ seats: { max: 2 } });
    expect(queryClient.getQueryData(ownerTwoKey)).toEqual({ seats: { max: 99 } });
    unsubscribe();
  });

  it('refreshes subscription, team context, and Team allowance keys together', async () => {
    const queryClient = freshClient();
    const userId = 303;
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const refetch = jest.spyOn(queryClient, 'refetchQueries');

    await refreshTeamBillingQueries(queryClient, userId);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: subscriptionStatusQueryKey(userId),
      refetchType: 'none',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: teamContextQueryKey(userId),
      refetchType: 'none',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: teamQueryKey(userId),
      refetchType: 'none',
    });
    expect(refetch).toHaveBeenCalledWith({
      queryKey: teamQueryKey(userId),
      type: 'active',
    });
  });
});