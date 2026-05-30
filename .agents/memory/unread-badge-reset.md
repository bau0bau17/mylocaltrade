---
name: Conversation unread badge reset
description: How the messages unread red badge is cleared and the drift trap that left customer badges stuck.
---
- Unread badge is driven by per-conversation counters `conversations.customer_unread_count` / `trader_unread_count`. Two surfaces show it: the account "Messages" row (global sum via unread-count query) and each row in the messages list (via conversations list query).
- Marking-as-read happens server-side in `GET /api/conversations/:id`: it flips `messages.read_at` for unread rows from the other party AND resets the viewer's counter.
- **Trap:** resetting the counter must NOT be gated on "there were unread message rows to flip". If the counter ever drifts above zero with no matching unread rows, a gated reset leaves the red badge stuck forever. Always reset the viewer's counter to 0 whenever it is > 0 on open (idempotent, self-healing). This is why customer badges stuck while trader's "new lead" badge (driven by unconditional `traderViewedAt`) appeared to work.
- **Client trap:** the thread-open effect must invalidate BOTH the unread-count query and the conversations LIST query. Invalidating only the count refreshes the account row badge but leaves each list row's red badge stale until the list happens to refetch.

**Why:** customer unread badge would not disappear after viewing a trader message; trader side appeared fine.
**How to apply:** any change to read/unread logic must keep the reset ungated (counter authoritative-on-view) and invalidate both client queries.
