---
name: Pull-to-refresh conventions (mobile)
description: How pull-to-refresh is wired across the Expo app and the traps that failed review
---

Shared hook `usePullToRefresh(...refetchFns)` — pass the screen's own query `refetch` functions to scope the refresh; with no args it falls back to `queryClient.refetchQueries({ type: 'active' })` (only acceptable for screens with many nested queries, e.g. account and trader profile).

**Why:** review failed twice on the same gaps:
1. Attaching `RefreshControl` only to the data-branch FlatList leaves empty states unrefreshable — wrap the empty-state View in a `ScrollView` with `refreshControl` and `contentContainerStyle={{ flexGrow: 1 }}` (or use `ListEmptyComponent`).
2. Global `refetchQueries({type:'active'})` refetches other mounted tabs' queries — scope per screen where practical.

**How to apply:** any new data screen gets `RefreshControl` (tintColor `Colors.light.primary`) on both the populated and empty branches, with scoped refetch fns. Deliberately excluded: edit forms (edit-profile, business-profile, services, gallery — useEffect syncs would clobber in-progress edits), static/legal pages, auth forms.
