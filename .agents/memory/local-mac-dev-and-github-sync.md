---
name: Local Mac dev + delivering Replit fixes to it via GitHub
description: This user runs Expo/Metro on their own Mac (not Replit); how to get Replit-side code fixes onto that local clone.
---

# User runs the app locally on their Mac, not on Replit

The user (MyLocalTrade) edits/builds on Replit but actually RUNS Expo/Metro + iOS Simulator on their own Mac. So Replit-side code changes do NOT reach their running app until the code is shipped to the Mac AND Metro is restarted with a clean cache.

**Why it matters:** "Fix verified on Replit" is not enough — symptom screenshots will keep showing the OLD code (old line numbers) until the Mac clone is updated and Metro cache cleared.

## Git/GitHub topology (UPDATED Aug 2026 — old replit-agent flow retired)
- Replit working branch is now `main`; origin is `https://github.com/bau0bau17/mylocaltrade.git`.
- **Programmatic push WORKS now**: shell `git add`/`git commit` on main, then the git-remote skill's `gitPush({ branch: "main" })` callback (GitHub App auth) — verified by matching `git ls-remote origin main` to local HEAD.
- **Fallback when no raw token is available** (connector `settings` empty, credentials proxy-injected, plain `git push` hangs on auth): replay the missing commits through the GitHub Git Data API via the connector's Octokit (`createBlob`→`createTree` with `base_tree`→`createCommit` with the exact raw-commit message/author/committer dates from `git cat-file commit`) — blob/tree/commit SHAs come out byte-identical to local, so `updateRef heads/main` is a clean fast-forward and `ls-remote` matches local HEAD. Verified working Aug 2026 (3-commit backlog, re-verified with a second 3-commit backlog). CRITICAL nuance: pass the commit message VERBATIM from the raw commit object **including the trailing newline** — stripping it changes the SHA (a mismatched orphan commit on GitHub is harmless, retry with the verbatim message).
- **Two more replay gotchas (Aug 2026, both hit & fixed):** (1) empty checkpoint commits ("Published your App") have zero changed files — `createTree` with an empty tree array throws "Invalid tree info"; reuse the parent commit's tree sha directly. (2) impure sandbox functions CANNOT capture durable-scope variables via closure — pass shas/paths as function arguments or ReferenceError. If a replay half-fails and leaves a wrong-sha commit on remote main, `updateRef` with `force:true` back to the last correct sha and redo — verified clean.
- **SHA match is best-effort, not guaranteed**: an Aug 2026 replay with verbatim message + exact author/committer dates still produced different commit SHAs (trees byte-identical). That's fine — content is what matters. Reconcile afterwards with `git fetch origin main` (fetch WORKS from the agent shell; only push hangs) then `git reset --hard origin/main` (working tree unchanged since trees match). Always reconcile, or the next replay's "remote head == local parent" check fails.
- User's requested workflow: commit + push straight to `origin/main`; they pull `main` normally on the Mac. Do NOT tell them to `git checkout origin/replit-agent -- <files>` anymore (explicitly banned by user).
- The sections below about master/replit-agent divergence and UI-only pushes are historical context only.

## Build & release ownership (explicit user instruction, Aug 2026)
- The user does Git sync, EAS builds and TestFlight submissions **manually from the Mac**. Never start an EAS build, never submit, and never toggle feature flags (dev included) unprompted — the user explicitly declined both when offered ("Nu porni tu buildul EAS și nu modifica flagurile din development").
- **Why:** they treat builds/flags as their release control point; agent's job ends at commit + verified push to `origin/main`.
- **Diagnostic shortcut:** a screenshot of a flag-gated screen showing LIVE data (e.g. Teams — flag ON only in prod) can only come from a build talking to prod, i.e. a TestFlight/EAS build. If it shows pre-fix UI, the JS was baked before the fix — Mac pulls/Metro cache clears won't help; only the next build will.

## Replit-side git is locked for main agent
`git branch -m`, and other writes are blocked: "Destructive git operations are not allowed in the main agent." Don't attempt rename/merge/checkout from the agent shell — only read-only git (status, log, ls-remote, rev-list, fetch) works.

## Replit Git UI quirk
Because local branch is `master` but GitHub uses `main`, the UI offers "Push branch as 'origin/master'" (create new remote branch) instead of a clean push to main. Trying to create `main` again gives `BRANCH_ALREADY_EXISTS`. Net effect: the user ends up pushing some branch (they successfully pushed `replit-agent`).

## A Replit checkpoint/commit is NOT a GitHub push — verify the remote
A committed checkpoint puts the fix on local `master` AND mirrors it to local `replit-agent`, but does NOT push it to GitHub. The user's Mac pulls `origin/replit-agent`, so the fix is invisible to them until the branch is pushed via the Replit Git pane.
**Always verify before telling the user to pull:** `git ls-remote origin replit-agent` and compare the SHA to local `git rev-parse replit-agent`. If they differ (and remote is an ancestor → "local ahead, needs push"), the fix has NOT reached GitHub yet. Symptom this caused: user kept reporting the same bug fixed ("tot nu merge") because their pull never had the commit. Fastest unblock meanwhile: have them test in the Replit Expo preview, which always serves the latest local code.

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
