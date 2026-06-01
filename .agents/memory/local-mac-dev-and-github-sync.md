---
name: Local Mac dev + delivering Replit fixes to it via GitHub
description: This user runs Expo/Metro on their own Mac (not Replit); how to get Replit-side code fixes onto that local clone.
---

# User runs the app locally on their Mac, not on Replit

The user (MyLocalTrade) edits/builds on Replit but actually RUNS Expo/Metro + iOS Simulator on their own Mac. So Replit-side code changes do NOT reach their running app until the code is shipped to the Mac AND Metro is restarted with a clean cache.

**Why it matters:** "Fix verified on Replit" is not enough — symptom screenshots will keep showing the OLD code (old line numbers) until the Mac clone is updated and Metro cache cleared.

## Git/GitHub topology (as of mid-2026)
- Replit local working branch is `master`, tracking GitHub `origin/main` (`branch.master.merge=refs/heads/main`). There is also a long-lived `replit-agent` branch (hundreds of commits ahead) and Replit auto-creates a local `main` at origin/main.
- The Replit **terminal cannot push to GitHub** (HTTPS password auth unsupported, no GitHub connector/token available). Pushing must go through the **Replit Git pane (UI)**, which uses the GitHub App auth.
- No GitHub connector in `listConnections` (401). Don't try programmatic push.

## Replit-side git is locked for main agent
`git branch -m`, and other writes are blocked: "Destructive git operations are not allowed in the main agent." Don't attempt rename/merge/checkout from the agent shell — only read-only git (status, log, ls-remote, rev-list, fetch) works.

## Replit Git UI quirk
Because local branch is `master` but GitHub uses `main`, the UI offers "Push branch as 'origin/master'" (create new remote branch) instead of a clean push to main. Trying to create `main` again gives `BRANCH_ALREADY_EXISTS`. Net effect: the user ends up pushing some branch (they successfully pushed `replit-agent`).

## How to deliver specific fixes to the Mac (the move that worked)
1. Confirm the fix commits are on a branch that got pushed to GitHub (here: `origin/replit-agent`).
2. On the Mac, pull ONLY the changed files (avoid merging the 300+ commit branch history):
   ```
   cd "$(git rev-parse --show-toplevel)"
   git fetch origin
   git checkout origin/replit-agent -- "<path1>" "<path2>"
   ```
   `cd "$(git rev-parse --show-toplevel)"` is important — pathspecs are relative to cwd, so running from the wrong folder silently fails ("did not match").
3. Restart Metro CLEAN (cache is the second half of the problem):
   ```
   cd artifacts/mobile
   npx expo start -c
   ```
   Then fully kill+reopen the app in the simulator (not just `r`).

## Verifying the right code is running
Have the user `grep` for a unique marker added by the fix rather than trusting reload. For the infinite-loop fix the markers were `offeringSignature` / `customerInfoSignature` in `artifacts/mobile/lib/revenuecat.tsx`. If the LogBox stack still shows the old line numbers, they're on a stale bundle.
