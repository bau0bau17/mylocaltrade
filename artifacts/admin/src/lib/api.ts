const TOKEN_KEY = "mlt_admin_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Resolve the API origin. By default the admin dashboard talks to its own
 * origin (same-origin in production). Setting VITE_API_BASE_URL to an absolute
 * URL (e.g. https://mylocaltrade.replit.app) points the dev preview at a
 * remote backend without affecting the deployed build. Trailing slashes are
 * trimmed so URL composition stays predictable.
 */
const API_BASE_URL: string = (() => {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
})();

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, API_BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  // When targeting a remote backend we must send absolute URLs; for same-origin
  // a relative path keeps requests on the current host.
  const isRemote = API_BASE_URL !== window.location.origin;
  return isRemote ? url.toString() : url.pathname + url.search;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401) {
    setToken(null);
    try {
      window.dispatchEvent(new CustomEvent("mlt-admin:unauthorized"));
    } catch {
      /* ignore */
    }
  }

  let data: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const errMessage =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : null) ?? res.statusText ?? "Request failed";
    throw new ApiError(errMessage, res.status, data);
  }

  return data as T;
}

export interface AuthedFetchOptions {
  /** Optional human-readable reason recorded in the server-side audit log. */
  reason?: string;
  /**
   * Recorded in the audit log and controls Content-Disposition. Trader
   * verification documents only accept "view" — the server refuses
   * mode=download for document endpoints (compliance: no document downloads).
   * "download" remains for non-document exports such as the audit CSV report.
   */
  mode?: "view" | "download";
}

export interface AuthedBlob {
  url: string;
  mimeType: string;
  /** Call when the consumer is done with the blob URL to release memory. */
  revoke: () => void;
}

/**
 * Authenticated browser-side download for generated exports (e.g. the audit
 * CSV report). Streams the response into a blob and triggers a save dialog.
 *
 * NOT for trader verification documents — those may only be viewed in-app
 * and the server rejects mode=download on document endpoints.
 */
export async function downloadAuthed(
  path: string,
  suggestedName: string,
  opts: AuthedFetchOptions = {},
): Promise<void> {
  const token = getToken();
  const res = await fetch(
    buildUrl(path, { mode: opts.mode ?? "download", reason: opts.reason || undefined }),
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      try {
        window.dispatchEvent(new CustomEvent("mlt-admin:unauthorized"));
      } catch {
        /* ignore */
      }
    }
    throw new ApiError("Download failed", res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Authenticated browser-side fetch returning a blob URL for in-app preview
 * (rendered inside <img>/<iframe> in a Dialog). The caller is responsible
 * for calling `revoke()` when the preview closes.
 */
export async function fetchAuthedBlob(
  path: string,
  opts: AuthedFetchOptions = {},
): Promise<AuthedBlob> {
  const token = getToken();
  const res = await fetch(
    buildUrl(path, { mode: opts.mode ?? "view", reason: opts.reason || undefined }),
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      try {
        window.dispatchEvent(new CustomEvent("mlt-admin:unauthorized"));
      } catch {
        /* ignore */
      }
    }
    throw new ApiError("Preview failed", res.status);
  }
  const rawContentType = res.headers.get("Content-Type") ?? "";
  const mimeType = rawContentType.split(";")[0].trim().toLowerCase();
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  return {
    url,
    mimeType,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    },
  };
}

