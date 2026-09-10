---
name: Conversation report evidence retention
description: Rules for preserving private conversation media during active moderation without copying it.
---

Conversation-report evidence is a normalized manifest of message/enquiry references and private object paths, never copied message text or media bytes. Active reports and open appeals block account-cleanup deletion; a terminal decision starts the enforced 30-day appeal window, after which cleanup can release the reference.

**Why:** Account deletion cleanup can otherwise remove private customer-upload objects before a moderator or appeal reviewer has seen the evidence. Copying media would create an unnecessary second sensitive-data store.

**How to apply:** Any new media that may be reportable must be finalized, captured transactionally with the report, and protected through the same manifest. Keep actual media private; APIs should return short-lived signed URLs only after their existing viewer/CSEA authorization gates.