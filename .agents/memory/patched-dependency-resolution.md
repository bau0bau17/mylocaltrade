---
name: Patched dependency resolution
description: How to verify that pnpm consumers resolve a freshly patched dependency rather than a stale virtual-store copy.
---

Verify a patched dependency through the actual consuming tool's module resolution and inspect that resolved package's patched source. Do not infer the active copy from an arbitrary virtual-store directory.

**Why:** pnpm can retain unreferenced historical patched copies in the virtual store, and a normal install may leave an inconsistent old snapshot in place even when lockfile metadata lists a patch. A changed, valid patch checksum creates a fresh immutable snapshot.

**How to apply:** When a dependency patch is security-sensitive, confirm the lockfile patch hash, resolve the package from the relevant consumer (for example Metro), and assert the intended guards in that resolved copy. Treat old virtual-store folders as non-evidence.