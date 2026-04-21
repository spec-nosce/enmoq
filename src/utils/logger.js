/**
 * Logger utility for enmoq
 * Standalone implementation with console fallback
 */

/**
 * Create a logger instance
 * Accepts external logger or falls back to console
 *
 * @param {Object} externalLogger - Optional external logger (e.g., from @app-core/logger)
 * @returns {Object} Logger instance
 */
function createLogger(externalLogger = null) {
  if (externalLogger) {
    return externalLogger;
  }

  // Fallback to console with structured format
  return {
    info(data, logkey) {
      if (process.env.ENMOQ_DEBUG === 'true') {
        console.log(
          `[enmoq:info:${logkey || 'default'}]`,
          typeof data === 'object' ? JSON.stringify(data) : data
        );
      }
    },

    warn(data, logkey) {
      if (process.env.ENMOQ_DEBUG === 'true' || process.env.NODE_ENV !== 'test') {
        console.warn(
          `[enmoq:warn:${logkey || 'default'}]`,
          typeof data === 'object' ? JSON.stringify(data) : data
        );
      }
    },

    error(data, logkey) {
      console.error(
        `[enmoq:error:${logkey || 'default'}]`,
        typeof data === 'object' ? JSON.stringify(data) : data
      );
    },

    errorX(data, logkey) {
      console.error(
        `[enmoq:CRITICAL:${logkey || 'default'}]`,
        typeof data === 'object' ? JSON.stringify(data) : data
      );
    },

    debug(data, logkey) {
      if (process.env.ENMOQ_DEBUG === 'true') {
        console.debug(
          `[enmoq:debug:${logkey || 'default'}]`,
          typeof data === 'object' ? JSON.stringify(data) : data
        );
      }
    },
  };
}

// Default logger instance
const appLogger = createLogger();

module.exports = {
  createLogger,
  appLogger,
};
