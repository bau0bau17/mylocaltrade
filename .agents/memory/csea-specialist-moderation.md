---
name: CSEA specialist moderation
description: Restricted handling rules for suspected child sexual exploitation or abuse material.
---

Suspected CSEA must be routed through a fail-closed specialist-only workflow, not ordinary
admin moderation. Its access list is configured outside source control, and escalated records
must stay out of normal queues and detail views.

**Why:** General moderators do not need access to this especially sensitive content. An escalation
is an internal safeguarding step, not a legal conclusion or final moderation decision, so it must
not unlock the ordinary reporter appeal path.

**How to apply:** Keep specialist intake, active-case handling, and completion distinct; preserve
their audit events; handle both profile/review and conversation/message reports; never expose a
CSEA category to public reporting forms. Configure the specialist-admin allowlist before release.