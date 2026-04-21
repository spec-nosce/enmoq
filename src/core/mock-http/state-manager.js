const { appLogger } = require('../../utils/logger');
const config = require('./config');

class StateManager {
  constructor() {
    this.states = new Map();
  }

  setState(key, state) {
    this.states.set(key, {
      ...state,
      updatedAt: Date.now(),
    });

    if (config.shouldLog('debug')) {
      appLogger.info({ key, state }, 'mock-state-set');
    }
  }

  getState(key) {
    return this.states.get(key) || null;
  }

  updateState(key, updates) {
    const current = this.states.get(key) || {};
    this.setState(key, { ...current, ...updates });
  }

  getNextStatus(key, sequence) {
    const state = this.getState(key) || { statusIndex: 0 };
    const currentIndex = state.statusIndex || 0;
    const nextIndex = Math.min(currentIndex, sequence.length - 1);
    const nextStatus = sequence[nextIndex];

    this.updateState(key, {
      statusIndex: currentIndex + 1,
      lastStatus: nextStatus,
    });

    return nextStatus;
  }

  incrementCounter(key, field = 'counter') {
    const state = this.getState(key) || {};
    const currentValue = state[field] || 0;
    const newValue = currentValue + 1;

    this.updateState(key, { [field]: newValue });

    return newValue;
  }

  getCounter(key, field = 'counter') {
    const state = this.getState(key) || {};
    return state[field] || 0;
  }

  clearState(key) {
    this.states.delete(key);

    if (config.shouldLog('debug')) {
      appLogger.info({ key }, 'mock-state-cleared');
    }
  }

  resetAll() {
    this.states.clear();
    appLogger.info({}, 'mock-state-reset-all');
  }

  getAllStates() {
    const result = {};
    for (const [key, value] of this.states.entries()) {
      result[key] = value;
    }
    return result;
  }
}

module.exports = StateManager;
