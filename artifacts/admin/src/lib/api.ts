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

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
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
  /** view (default for previews) or download — recorded in the audit log and controls Content-Disposition. */
  mode?: "view" | "download";
}

export interface AuthedBlob {
  url: string;
  mimeType: string;
  /** Call when the consumer is done with the blob URL to release memory. */
  revoke: () => void;
}

/**
 * Authenticated browser-side download for files that require Authorization.
 * Streams the response into a blob and triggers a save dialog.
 *
 * `opts.reason` is forwarded to the server-side audit log so the admin can
 * record why a download was performed (e.g. ICO subject access request).
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
 * MIME types that are safe to open as inline blob URLs in a new tab.
 * HTML, SVG, XML, and other active content types are excluded because a blob
 * URL inherits the admin application's origin and could execute scripts with
 * access to admin localStorage (including the bearer token).
 * PDFs are rendered by the browser's sandboxed PDF plugin (no JS execution).
 * Images are inert — they cannot execute code.
 */
const SAFE_INLINE_BLOB_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

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

/**
 * Authenticated browser-side preview: fetches a file with the admin token,
 * turns it into a blob URL, and opens it in a new tab only when the content
 * type is known-safe (image or PDF). Any other type triggers a forced download
 * to prevent stored-XSS via attacker-controlled blob content executing at the
 * admin origin.
 */
export async function viewAuthed(path: string, suggestedName?: string): Promise<void> {
  const token = getToken();
  const res = await fetch(buildUrl(path, { mode: "view" }), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
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
  // Derive the MIME type from the response Content-Type header (strip parameters).
  const rawContentType = res.headers.get("Content-Type") ?? "";
  const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  if (SAFE_INLINE_BLOB_TYPES.has(mimeType)) {
    // Safe to open inline — images and PDFs cannot run scripts.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      // Popup blocked — fall back to navigating the current tab.
      window.location.assign(url);
    }
    // Revoke after a generous delay so the new tab has time to render the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    // Unknown or potentially executable type — force a download instead of
    // rendering inline so it cannot run as the admin origin.
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName ?? "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
