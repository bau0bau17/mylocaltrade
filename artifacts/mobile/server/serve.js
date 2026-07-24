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

  // Deep-link redirect: email "Open conversation" buttons point here. We bounce
  // the visitor into the installed native app via its custom scheme
  // (mylocaltrade://messages/<id>), with the landing page as a visible fallback
  // when the app isn't installed. No Expo Go / dev preview is ever involved.
  if (pathname === "/open") {
    const raw = url.searchParams.get("c");
    const id = raw && /^[0-9]+$/.test(raw) ? raw : null;
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
      : (target && NAMED_TARGETS[target]) || "mylocaltrade://";
    const html = openRedirectTemplate.replace(
      /DEEP_LINK_PLACEHOLDER/g,
      deepLink,
    );
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
    return;
  }

  // Public landing page at the root only.
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
