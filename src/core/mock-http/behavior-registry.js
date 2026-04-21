const fs = require('fs');
const path = require('path');
const { appLogger } = require('../../utils/logger');
const config = require('./config');

class BehaviorRegistry {
  constructor() {
    this.behaviors = new Map();
  }

  register(method, urlPattern, behaviorFn, name = null) {
    const key = `${method.toUpperCase()}:${urlPattern}`;

    this.behaviors.set(key, {
      method: method.toUpperCase(),
      urlPattern,
      regex: new RegExp(urlPattern),
      handler: behaviorFn,
      name: name || key,
    });

    if (config.shouldLog('debug')) {
      appLogger.info({ method, urlPattern, name }, 'mock-behavior-registered');
    }
  }

  registerBehavior(behavior) {
    if (!behavior.method || !behavior.urlPattern || !behavior.handler) {
      appLogger.error({ behavior }, 'mock-behavior-invalid-structure');
      throw new Error('Behavior must have method, urlPattern, and handler');
    }

    this.register(behavior.method, behavior.urlPattern, behavior.handler, behavior.name || null);
  }

  find(method, url) {
    const normalizedMethod = method.toUpperCase();
    const matches = [];

    for (const [key, behavior] of this.behaviors) {
      if (behavior.method !== normalizedMethod) {
        continue;
      }

      const match = behavior.regex.exec(url);
      if (match) {
        matches.push({
          behavior,
          urlParams: match.slice(1),
          fullMatch: match[0],
        });
      }
    }

    if (matches.length === 0) {
      return null;
    }

    if (matches.length === 1) {
      return matches[0];
    }

    matches.sort((a, b) => {
      const aLength = a.fullMatch.length;
      const bLength = b.fullMatch.length;
      return bLength - aLength;
    });

    return matches[0];
  }

  loadBehaviors(directory) {
    if (!fs.existsSync(directory)) {
      appLogger.warn({ directory }, 'mock-behaviors-directory-not-found');
      return;
    }

    // Resolve to absolute path for require()
    const absoluteDirectory = path.isAbsolute(directory)
      ? directory
      : path.resolve(process.cwd(), directory);
    const loadedCount = this._loadBehaviorsRecursive(absoluteDirectory);
    appLogger.info({ directory: absoluteDirectory, count: loadedCount }, 'mock-behaviors-loaded');

    return loadedCount;
  }

  _loadBehaviorsRecursive(directory) {
    let count = 0;
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        count += this._loadBehaviorsRecursive(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        if (entry.name.includes('test-data') || entry.name.includes('magic-values')) {
          continue;
        }

        try {
          const behavior = require(fullPath);
          if (behavior && behavior.method && behavior.urlPattern && behavior.handler) {
            this.registerBehavior(behavior);
            count++;
          }
        } catch (error) {
          appLogger.error({ error, filePath: fullPath }, 'mock-behavior-load-error');
        }
      }
    }

    return count;
  }

  unregister(method, urlPattern) {
    const key = `${method.toUpperCase()}:${urlPattern}`;
    const deleted = this.behaviors.delete(key);

    if (deleted && config.shouldLog('debug')) {
      appLogger.info({ method, urlPattern }, 'mock-behavior-unregistered');
    }

    return deleted;
  }

  clear() {
    this.behaviors.clear();
    appLogger.info({}, 'mock-behaviors-cleared');
  }

  list() {
    return Array.from(this.behaviors.values()).map((b) => ({
      method: b.method,
      urlPattern: b.urlPattern,
      name: b.name,
    }));
  }

  count() {
    return this.behaviors.size;
  }
}

module.exports = BehaviorRegistry;
