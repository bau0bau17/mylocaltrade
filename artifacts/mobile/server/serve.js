/**
 * Standalone production server for the MyLocalTrade public web surface.
 *
 * The mobile app is distributed via the App Store and Google Play
 * (TestFlight for beta), so the public deployment root must NOT expose Expo Go,
 * development previews, QR codes, deep links, or Expo manifests/bundles.
 * This server therefore serves only a simple, production-safe landing page.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const OPEN_TEMPLATE_PATH = path.resolve(
  __dirname,
  "templates",
  "open-redirect.html",
);
// Full marketing site (mirrored from the original mylocaltrade.co.uk landing
// page project) — prerendered HTML pages + hashed asset bundles. When present,
// it is served for every non-special route; the minimal template above remains
// only as a fallback if this directory is ever missing.
const LANDING_SITE_DIR = path.resolve(__dirname, "landing-site");
const LANDING_SITE_INDEX = path.join(LANDING_SITE_DIR, "index.html");
const hasLandingSite = fs.existsSync(LANDING_SITE_INDEX);
// Real (symlink-resolved) site root, used to keep resolved files contained
// even if a symlink ever lands inside landing-site/.
const LANDING_SITE_REAL = hasLandingSite ? fs.realpathSync(LANDING_SITE_DIR) : null;
// The whole mirrored site is ~2.3MB, so serve every file from an in-memory
// cache instead of hitting the disk (and blocking the event loop) per request.
const fileCache = new Map();
function readCached(filePath) {
  let buf = fileCache.get(filePath);
  if (!buf) {
    buf = fs.readFileSync(filePath);
    fileCache.set(filePath, buf);
  }
  return buf;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

/**
 * Resolve a URL pathname to a file inside landing-site/, guarding against
 * path traversal. Extensionless routes map to their prerendered
 * `<route>/index.html`; unknown routes fall back to the SPA root index.html.
 * Returns { filePath, contentType, cacheControl } or null.
 */
function resolveLandingFile(pathname) {
  if (!hasLandingSite) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Strip leading slashes so prefix checks and joins see a relative path.
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let filePath = path.join(LANDING_SITE_DIR, safe);
  if (!filePath.startsWith(LANDING_SITE_DIR + path.sep) && filePath !== LANDING_SITE_DIR) {
    return null;
  }
  const ext = path.extname(filePath);
  if (!ext || ext === ".") {
    // Prerendered page (e.g. /contact -> contact/index.html), else SPA fallback.
    const pageIndex = path.join(filePath, "index.html");
    filePath = fs.existsSync(pageIndex) ? pageIndex : LANDING_SITE_INDEX;
  } else if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  // Symlink containment: the fully resolved file must stay inside the site dir.
  try {
    const real = fs.realpathSync(filePath);
    if (real !== LANDING_SITE_REAL && !real.startsWith(LANDING_SITE_REAL + path.sep)) {
      return null;
    }
    filePath = real;
  } catch {
    return null;
  }
  const finalExt = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[finalExt] || "application/octet-stream";
  // Hashed bundles under /assets/ (+ fonts) are immutable; HTML stays revalidated.
  const cacheControl = safe.startsWith("assets/") || safe.startsWith("fonts/")
    ? "public, max-age=31536000, immutable"
    : finalExt === ".html"
      ? "public, max-age=300"
      : "public, max-age=3600";
  return { filePath, contentType, cacheControl };
}
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");
const PORT = process.env.PORT || 18115;

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "MyLocalTrade";
  } catch {
    return "MyLocalTrade";
  }
}

const appName = getAppName();
const landingPage = fs
  .readFileSync(TEMPLATE_PATH, "utf-8")
  .replace(/APP_NAME_PLACEHOLDER/g, appName);
const openRedirectTemplate = fs
  .readFileSync(OPEN_TEMPLATE_PATH, "utf-8")
  .replace(/APP_NAME_PLACEHOLDER/g, appName);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  // Health/status probe for deployment startup checks.
  if (pathname === "/status" || pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // iOS Universal Links: Apple fetches this file to verify the domain is
  // associated with the app (associatedDomains in app.json). Once verified,
  // tapping an https://mylocaltrade.co.uk/open... link opens the installed
  // app directly — no Safari hop. Must be served as JSON with no redirect.
  if (
    pathname === "/.well-known/apple-app-site-association" ||
    pathname === "/apple-app-site-association"
  ) {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    });
    res.end(
      JSON.stringify({
        applinks: {
          details: [
            {
              appIDs: ["WNLMR5HM4J.com.mylocaltrade.app"],
              components: [{ "/": "/open" }],
            },
          ],
        },
      }),
    );
    return;
  }

  // Deep-link redirect: email "Open conversation" buttons point here. We bounce
  // the visitor into the installed native app via its custom scheme
  // (mylocaltrade://messages/<id>), with the landing page as a visible fallback
  // when the app isn't installed. No Expo Go / dev preview is ever involved.
  if (pathname === "/open") {
    const raw = url.searchParams.get("c");
    const id = raw && /^[0-9]+$/.test(raw) ? raw : null;
    // Company-team invitation: /open?j=<token> carries the single-use invite
    // token (base64url) into the app's join screen. Charset-checked only —
    // the API validates the token itself; nothing is logged here.
    const joinRaw = url.searchParams.get("j");
    const joinToken =
      joinRaw && /^[A-Za-z0-9_-]{16,200}$/.test(joinRaw) ? joinRaw : null;
    // Named in-app targets (allowlisted): /open?t=support → contact form.
    const target = url.searchParams.get("t");
    const NAMED_TARGETS = {
      support: "mylocaltrade://contact-support",
      // Trader lead inbox: email "Open my leads" buttons (new enquiry +
      // unanswered-lead reminder) land here.
      leads: "mylocaltrade://trader-dashboard/leads",
    };
    const deepLink = id
      ? `mylocaltrade://messages/${id}`
      : joinToken
        ? `mylocaltrade://auth/join-team?token=${encodeURIComponent(joinToken)}`
        : (target && NAMED_TARGETS[target]) || "mylocaltrade://";
    const html = openRedirectTemplate.replace(
      /DEEP_LINK_PLACEHOLDER/g,
      deepLink,
    );
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The URL may carry a single-use invitation token: never cache the
      // response, and never let the token leak via the Referer header when
      // the visitor follows the fallback link (belt-and-braces with the
      // template's <meta name="referrer">).
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end(html);
    return;
  }

  // Full marketing site (mirrored build). Special routes above always win;
  // every other path is served from the static site, with unknown routes
  // falling back to the SPA index so client-side routing can take over.
  if (hasLandingSite && (req.method === "GET" || req.method === "HEAD")) {
    const resolved = resolveLandingFile(pathname === "" ? "/" : pathname);
    if (resolved) {
      // The early-access confirmation page URL carries a single-use token:
      // never cache it and never let the token leak via the Referer header
      // (belt-and-braces with the page's own <meta name="referrer">).
      const isConfirmPage =
        pathname === "/confirm-early-access" ||
        pathname.startsWith("/confirm-early-access/");
      res.writeHead(200, {
        "content-type": resolved.contentType,
        "cache-control": isConfirmPage ? "no-store" : resolved.cacheControl,
        ...(isConfirmPage ? { "referrer-policy": "no-referrer" } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(readCached(resolved.filePath));
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  // Fallback (landing-site missing): minimal landing page at the root only.
  if (pathname === "/" || pathname === "") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    });
    res.end(landingPage);
    return;
  }

  // Everything else (including any Expo manifest/bundle/asset requests) is not
  // served in production.
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`MyLocalTrade landing server listening on port ${PORT}`);
});
