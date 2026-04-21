/**
 * enmoq config loader
 *
 * Loads the project-level enmoq.config.js with three-tier resolution:
 *
 *   1. ENMOQ_CONFIG env var — absolute or cwd-relative path to the config file.
 *      Useful for monorepos or CI where the config lives outside the project root.
 *
 *   2. Auto-discovery — walks up the directory tree from process.cwd() looking
 *      for `enmoq.config.js`, same pattern as ESLint / Prettier.
 *
 *   3. No config found — returns {} and lets default-config.js drive everything.
 *
 * The loaded config is merged with default-config.js by the caller (setup.js).
 * This file only concerns itself with finding and loading the raw config object.
 */

const fs = require('fs');
const path = require('path');

/**
 * Try loading a config file at the given absolute path.
 * Returns the exported object on success, null if the file doesn't exist.
 * Throws if the file exists but cannot be parsed.
 *
 * @param {string} filePath - Absolute path to attempt
 * @returns {Object|null}
 */
function tryLoad(filePath) {
  if (!fs.existsSync(filePath)) return null;
  // eslint-disable-next-line global-require
  return require(filePath); // eslint-disable-line import/no-dynamic-require
}

/**
 * Walk up the directory tree from `startDir` looking for `enmoq.config.js`.
 *
 * @param {string} startDir - Directory to start from
 * @returns {Object|null} Config object or null if not found
 */
function walkUpFind(startDir) {
  let dir = startDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, 'enmoq.config.js');
    const config = tryLoad(candidate);

    if (config !== null) return config;

    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Load the enmoq project config.
 *
 * @returns {Object} Merged config object (may be empty if no config file found)
 */
function loadConfig() {
  // Tier 1: explicit env var
  const envPath = process.env.ENMOQ_CONFIG;
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);

    const config = tryLoad(resolved);
    if (config !== null) return config;

    // Env var was set but file doesn't exist — warn loudly
    // eslint-disable-next-line no-console
    console.warn(
      `[enmoq] ENMOQ_CONFIG points to "${resolved}" but the file does not exist. ` +
        'Falling back to auto-discovery.'
    );
  }

  // Tier 2: walk up from cwd
  const discovered = walkUpFind(process.cwd());
  if (discovered !== null) return discovered;

  // Tier 3: no config — caller uses default-config.js
  return {};
}

module.exports = { loadConfig };
