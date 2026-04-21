const config = require('./config');

function enableMockMode() {
  process.env.USE_MOCK_HTTP_REQUEST = 'true';
  config.set('enabled', true);
}

function disableMockMode() {
  process.env.USE_MOCK_HTTP_REQUEST = 'false';
  config.set('enabled', false);
}

function setMockMode(mode) {
  if (!['strict', 'permissive', 'passthrough'].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Must be strict, permissive, or passthrough`);
  }
  config.setMode(mode);
}

function setupTestEnvironment(options = {}) {
  enableMockMode();

  if (options.mode) {
    setMockMode(options.mode);
  }

  if (options.logLevel) {
    config.set('logLevel', options.logLevel);
  }

  if (options.networkSimulation) {
    config.enableNetworkSimulation(options.networkSimulation);
  }

  return {
    mode: config.getMode(),
    logLevel: config.get('logLevel'),
    enabled: config.isEnabled(),
  };
}

function teardownTestEnvironment() {
  disableMockMode();
  config.disableNetworkSimulation();
}

function assertRequestMade(mockHttp, urlPattern) {
  const requests = mockHttp.getRequestHistory();
  const found = requests.some((req) => new RegExp(urlPattern).test(req.url));

  if (!found) {
    throw new Error(`Expected request matching pattern ${urlPattern} but none found`);
  }

  return true;
}

function assertRequestCount(mockHttp, expectedCount) {
  const actualCount = mockHttp.getRequestHistory().length;

  if (actualCount !== expectedCount) {
    throw new Error(`Expected ${expectedCount} requests but found ${actualCount}`);
  }

  return true;
}

function assertRequestPayload(mockHttp, urlPattern, expectedPayload) {
  const requests = mockHttp.getRequestHistory();
  const matchingRequest = requests.find((req) => new RegExp(urlPattern).test(req.url));

  if (!matchingRequest) {
    throw new Error(`No request found matching pattern ${urlPattern}`);
  }

  const actualPayload = matchingRequest.data;

  for (const [key, value] of Object.entries(expectedPayload)) {
    if (actualPayload[key] !== value) {
      throw new Error(`Expected payload.${key} to be ${value} but got ${actualPayload[key]}`);
    }
  }

  return true;
}

function getRequestsByUrl(mockHttp, urlPattern) {
  const requests = mockHttp.getRequestHistory();
  return requests.filter((req) => new RegExp(urlPattern).test(req.url));
}

function getRequestsByMethod(mockHttp, method) {
  const requests = mockHttp.getRequestHistory();
  return requests.filter((req) => req.method.toLowerCase() === method.toLowerCase());
}

module.exports = {
  enableMockMode,
  disableMockMode,
  setMockMode,
  setupTestEnvironment,
  teardownTestEnvironment,
  assertRequestMade,
  assertRequestCount,
  assertRequestPayload,
  getRequestsByUrl,
  getRequestsByMethod,
};
