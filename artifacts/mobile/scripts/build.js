/**
 * Production "build" for the MyLocalTrade public web surface.
 *
 * The public deployment only serves a static landing page (see
 * server/serve.js), so there is no Expo web export to generate here.
 * The mobile app itself is built and distributed separately via EAS,
 * the App Store, and Google Play.
 */

console.log(
  "No web build required — the public landing page is served directly by server/serve.js.",
);
process.exit(0);
