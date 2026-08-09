---
name: Conversation screen composer layout
description: Chat detail screen ordering (trail → composer → info cards) and the collapse-cards-while-typing keyboard pattern; intentional, user-requested.
---

# Conversation screen composer layout

**Rule:** On the conversation detail screen, the order is message trail (flex:1 FlatList) → composer → quote/appointment/contact/lifecycle cards. While the keyboard is open the card region is collapsed (`keyboardOpen` state from Keyboard listeners) so the composer sits directly above the keyboard; the card wrapper carries the bottom safe-area inset, not the composer.

**Why:** User-requested fix (Aug 2026, screenshots): the cards used to be pinned between the trail and the composer, and their fixed height pushed the composer completely off-screen when the iPhone keyboard opened. Collapsing them while typing is deliberate, not a bug.

**How to apply:**
- Never reintroduce pinned content between the composer and the keyboard, and don't "fix" the cards disappearing during typing — they return on keyboard hide.
- Any new pinned section below the composer must go inside the `!keyboardOpen` wrapper (which owns `paddingBottom: insets.bottom`).
- Keyboard listeners fire globally: a TextInput inside one of the screen's modals also collapses the cards behind the overlay — harmless, expected.
- KAV stays `behavior="padding"` (iOS) with offset 0; the tab bar is hidden on this route.
