/**
 * Mock for nanoid module
 *
 * nanoid is an ESM-only module that doesn't work well with Jest's CommonJS setup.
 * This mock provides the same interface for testing purposes.
 */

const crypto = require('crypto');

/**
 * Create custom alphabet generator
 * @param {string} alphabet - Characters to use
 * @param {number} size - Length of generated string
 * @returns {Function} Generator function
 */
function customAlphabet(alphabet, size) {
  return function () {
    let result = '';
    const bytes = crypto.randomBytes(size);
    for (let i = 0; i < size; i++) {
      result += alphabet[bytes[i] % alphabet.length];
    }
    return result;
  };
}

/**
 * Generate a random ID
 * @param {number} size - Length of ID (default 21)
 * @returns {string} Random ID
 */
function nanoid(size = 21) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  const bytes = crypto.randomBytes(size);
  for (let i = 0; i < size; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

module.exports = nanoid;
module.exports.nanoid = nanoid;
module.exports.customAlphabet = customAlphabet;
