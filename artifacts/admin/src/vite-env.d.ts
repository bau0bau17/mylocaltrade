/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute base URL for the API backend (e.g. https://mylocaltrade.replit.app).
   * When unset, the admin dashboard talks to its own origin (same-origin).
   * Used to point the dev preview at a remote/production backend.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
