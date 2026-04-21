const helpers = require('./helpers');

class BehaviorContext {
  constructor(registry, stateManager, requestHistory) {
    this.registry = registry;
    this.stateManager = stateManager;
    this.requestHistory = requestHistory;
    this.helpers = helpers;
  }

  // ID Generation
  generateULID() {
    return this.helpers.generateULID();
  }

  generateUUID() {
    return this.helpers.generateUUID();
  }

  // Timestamps
  timestamp() {
    return this.helpers.timestamp();
  }

  isoTimestamp() {
    return this.helpers.isoTimestamp();
  }

  // Random Data
  randomNumber(min, max) {
    return this.helpers.randomNumber(min, max);
  }

  generateAccountNumber() {
    return this.helpers.generateAccountNumber();
  }

  generateIBAN() {
    return this.helpers.generateIBAN();
  }

  generateBIC() {
    return this.helpers.generateBIC();
  }

  generateSortCode() {
    return this.helpers.generateSortCode();
  }

  randomHex(length) {
    return this.helpers.randomHex(length);
  }

  // Registry Access
  getResource(type, id) {
    return this.registry.get(type, id);
  }

  storeResource(type, id, data) {
    return this.registry.store(type, id, data);
  }

  resourceExists(type, id) {
    return this.registry.exists(type, id);
  }

  findResources(type, predicate) {
    return this.registry.find(type, predicate);
  }

  listResources(type) {
    return this.registry.list(type);
  }

  // State Access
  getState(key) {
    return this.stateManager.getState(key);
  }

  setState(key, state) {
    return this.stateManager.setState(key, state);
  }

  updateState(key, updates) {
    return this.stateManager.updateState(key, updates);
  }

  getNextStatus(key, sequence) {
    return this.stateManager.getNextStatus(key, sequence);
  }

  incrementCounter(key, field = 'counter') {
    return this.stateManager.incrementCounter(key, field);
  }

  getCounter(key, field = 'counter') {
    return this.stateManager.getCounter(key, field);
  }

  // Network Simulation
  async applyNetworkSimulation(config) {
    return this.helpers.applyNetworkSimulation(config);
  }
}

module.exports = BehaviorContext;
