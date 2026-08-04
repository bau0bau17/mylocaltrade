const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// undici@7.x creates a temporary `undici_tmp_XXXX` directory during its
// postinstall build and then removes it. Metro picks it up via the file-system
// walker before the cleanup finishes and then crashes with ENOENT when it tries
// to watch the already-deleted path. Block those temp dirs.
config.resolver.blockList = [
  /node_modules[/\\]undici[/\\]node_modules[/\\]undici_tmp_.*/,
  /node_modules[/\\]\.pnpm[/\\]undici@[^/\\]+[/\\]node_modules[/\\]undici_tmp_.*/,
];

module.exports = config;
