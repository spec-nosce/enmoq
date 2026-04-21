/**
 * Randomness utilities for enmoq
 * Standalone implementation to avoid external dependencies
 */

const crypto = require('crypto');

/**
 * Generate random bytes as hex string
 * @param {number} size - Number of bytes
 * @returns {string} Hex string
 */
function randomBytes(size = 16) {
  return crypto.randomBytes(size).toString('hex');
}

/**
 * Generate a random number between min and max (inclusive)
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number
 */
function randomNumbers(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate UUID v4
 * @returns {string} UUID
 */
function uuid() {
  return crypto.randomUUID();
}

/**
 * Generate ULID (Universally Unique Lexicographically Sortable Identifier)
 * Based on ulid spec: https://github.com/ulid/spec
 *
 * @returns {string} ULID string (26 characters)
 */
function ulid() {
  const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's Base32
  const ENCODING_LEN = ENCODING.length;
  const TIME_LEN = 10;
  const RANDOM_LEN = 16;

  // Timestamp part (10 characters, 48 bits)
  const now = Date.now();
  let timeStr = '';
  let time = now;

  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    timeStr = ENCODING[mod] + timeStr;
    time = Math.floor(time / ENCODING_LEN);
  }

  // Random part (16 characters, 80 bits)
  let randomStr = '';
  const randomBytesArray = crypto.randomBytes(10); // 80 bits

  for (let i = 0; i < RANDOM_LEN; i++) {
    const byteIndex = Math.floor((i * 10) / 16);
    const byte = randomBytesArray[byteIndex];
    randomStr += ENCODING[byte % ENCODING_LEN];
  }

  return timeStr + randomStr;
}

module.exports = {
  randomBytes,
  randomNumbers,
  uuid,
  ulid,
};
