const { ulid, uuid, randomBytes } = require('../../utils/randomness');

class Helpers {
  generateULID() {
    return ulid();
  }

  generateUUID() {
    return uuid();
  }

  timestamp() {
    return Date.now();
  }

  isoTimestamp() {
    return new Date().toISOString();
  }

  randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  generateAccountNumber() {
    return String(Math.floor(Math.random() * 10000000000)).padStart(10, '0');
  }

  generateIBAN() {
    const countryCode = 'GB';
    const checkDigits = String(this.randomNumber(10, 99));
    const bankCode = 'WEST';
    const accountNumber = String(Math.floor(Math.random() * 100000000000000)).padStart(14, '0');
    return `${countryCode}${checkDigits}${bankCode}${accountNumber}`;
  }

  generateBIC() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let bic = '';
    for (let i = 0; i < 8; i++) {
      bic += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return bic;
  }

  generateSortCode() {
    return `${this.randomNumber(10, 99)}-${this.randomNumber(10, 99)}-${this.randomNumber(10, 99)}`;
  }

  randomHex(length) {
    return randomBytes(length);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async applyNetworkSimulation(config) {
    if (!config || !config.enabled) {
      return;
    }

    const baseDelay = config.baseDelay || 0;
    const jitter = config.jitter || 0;
    const actualDelay = baseDelay + (Math.random() * jitter * 2 - jitter);

    if (actualDelay > 0) {
      await this.delay(actualDelay);
    }

    const failureRate = config.failureRate || 0;
    if (Math.random() < failureRate) {
      throw new Error('Simulated network failure');
    }
  }
}

module.exports = new Helpers();
