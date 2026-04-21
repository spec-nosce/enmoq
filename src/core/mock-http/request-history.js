const { appLogger } = require('../../utils/logger');
const config = require('./config');

class RequestHistory {
  constructor() {
    this.requests = [];
  }

  record(request, response, behaviorName = null) {
    const entry = {
      timestamp: Date.now(),
      method: request.method,
      url: request.url,
      headers: request.headers,
      data: request.data,
      response: {
        status: response.status,
        headers: response.headers,
        data: response.body,
      },
      behaviorName,
    };

    this.requests.push(entry);

    if (config.shouldLog('debug')) {
      appLogger.info({ entry }, 'mock-http-request-recorded');
    }
  }

  getAll() {
    return [...this.requests];
  }

  getLast() {
    return this.requests[this.requests.length - 1] || null;
  }

  getLastN(n) {
    return this.requests.slice(-n);
  }

  findByUrl(pattern) {
    const regex = new RegExp(pattern);
    return this.requests.filter((req) => regex.test(req.url));
  }

  findByMethod(method) {
    return this.requests.filter((req) => req.method.toLowerCase() === method.toLowerCase());
  }

  count() {
    return this.requests.length;
  }

  clear() {
    this.requests = [];
    if (config.shouldLog('debug')) {
      appLogger.info({}, 'mock-http-request-history-cleared');
    }
  }
}

module.exports = RequestHistory;
