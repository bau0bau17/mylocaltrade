---
name: RevenueCat purchase cancellation red LogBox
description: Why catching userCancelled isn't enough to stop the red "Purchase was cancelled" error, and how to suppress it.
---

When a user dismisses the Apple / Test Store purchase sheet, `purchasePackage` rejects with a `userCancelled` error AND the native SDK separately emits its own log "Purchase was cancelled." at ERROR level. react-native-purchases' default log handler routes ERROR logs to `console.error`, which shows as a red LogBox in dev — even if the app's catch block already swallows the cancellation.

**Why:** Two independent surfaces. App-level catch (`isUserCancelledError`) only stops the Alert/UI; it does nothing about the SDK's internal logging. You must also install `Purchases.setLogHandler(...)` (in the configure path, after `setLogLevel`, before `configure`) to intercept and demote the cancellation log.

**How to apply:** In the custom log handler, match the SDK's specific message `/purchase was cancelled/i` and drop it (don't `console.error`). Do NOT match a broad `/cancel/i` — a genuine cancellation *failure* contains "cancel" too and should still log as an error. Route real ERROR→console.error, WARN→console.warn so legitimate failures stay visible.
