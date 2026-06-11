---
name: Never reproduce bugs with destructive writes on live user accounts
description: Use throwaway accounts or a rolled-back transaction; live PUTs overwrite unrecoverable data.
---

When reproducing a bug against the running API, do NOT replay a write (PUT/POST) against a real
user's row — it overwrites their fields and there is no row-level undo (audit log stores no
snapshots; only a full DB checkpoint rollback exists, which is too broad).

**Why:** a live PUT to `/api/profile` during a reproduction overwrote a real test account's
description/address/services/areas with placeholder data that could not be recovered.

**How to apply:** prefer a dedicated throwaway account, a read-only check, or wrap the write in a
transaction you ROLLBACK. If you must mutate a real row, snapshot ALL its columns first
(`SELECT *`) so you can restore exactly.
