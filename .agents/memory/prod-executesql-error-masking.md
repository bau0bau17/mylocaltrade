---
name: executeSql on production masks SQL errors
description: Production executeSql can return success=true with only "START TRANSACTION\nROLLBACK" output when the SQL actually failed.
---

# executeSql (production) masks SQL errors

When running read-only queries against the **production** database via the database skill's `executeSql`, a failing statement (syntax error, missing column, etc.) can come back as `success: true` with output containing only:

```
START TRANSACTION
ROLLBACK
```

— no rows and no error message.

**Why:** the wrapper runs the statement inside a transaction and rolls back; the underlying SQL error is swallowed.

**How to apply:** never treat "no rows returned" from a prod query as "no data". If the output is just START TRANSACTION/ROLLBACK with nothing between, the query errored — re-check the SQL (column names against the *prod* schema, which may lag dev) and retry. Verify prod schema assumptions with `information_schema` queries first when dev and prod may have drifted.
