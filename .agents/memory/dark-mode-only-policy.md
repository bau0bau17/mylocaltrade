---
name: Dark-mode-only policy
description: MyLocalTrade mobile is intentionally dark-only; never add light mode, system appearance, or theme toggles.
---

MyLocalTrade mobile is a **dark-mode-only** app by explicit user decision (Aug 2026). The Light/Dark/System appearance task was proposed and the user **cancelled it**, then requested a dark-lock instead.

**The rule:** never implement light mode, system-appearance following, ThemeContext, or a theme toggle. Do not "fix" the following as if they were bugs:
- `userInterfaceStyle: "dark"` in app.json (plus dark splash/background colors) — intentional lock.
- Module-scope `Appearance.setColorScheme("dark")` in the root layout — runtime override so keyboards/alerts/pickers/share sheets stay dark on devices set to Light, effective in existing binaries without a rebuild.
- `<StatusBar style="light" />` in the root layout.
- ErrorFallback hardcodes `isDark = true` (deliberately ignores `useColorScheme`).
- `constants/colors.ts` keeps `light`/`dark` keys both holding the dark palette with 2k+ `Colors.light.*` refs — do NOT codemod or dedupe this as cleanup.

**Why:** user wants one consistent premium dark look; mixed native surfaces (light keyboard/alerts over dark UI) were the only problem, solved by locking appearance.

**How to apply:** if a future request asks for light mode, treat it as a product reversal needing explicit confirmation — not a refactor to sneak in.
