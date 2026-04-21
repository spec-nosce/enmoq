const fs = require('fs');
const path = require('path');
const { appLogger } = require('../../utils/logger');
const config = require('./config');

class ResourceRegistry {
  constructor() {
    this.resources = new Map();
    this.autoSave = false;
  }

  store(type, id, data) {
    if (!this.resources.has(type)) {
      this.resources.set(type, new Map());
    }

    this.resources.get(type).set(id, {
      ...data,
      _storedAt: Date.now(),
    });

    if (config.shouldLog('debug')) {
      appLogger.info({ type, id }, 'mock-resource-stored');
    }

    if (this.autoSave && config.get('enablePersistence')) {
      this.save();
    }

    return data;
  }

  storeFromResponse(type, idField, responseData) {
    const id = responseData[idField];
    if (!id) {
      appLogger.warn({ type, idField, responseData }, 'mock-resource-store-no-id');
      return null;
    }

    return this.store(type, id, responseData);
  }

  get(type, id) {
    const typeMap = this.resources.get(type);
    if (!typeMap) {
      return null;
    }

    return typeMap.get(id) || null;
  }

  exists(type, id) {
    return this.get(type, id) !== null;
  }

  list(type) {
    const typeMap = this.resources.get(type);
    if (!typeMap) {
      return [];
    }

    return Array.from(typeMap.values());
  }

  find(type, predicate) {
    const items = this.list(type);
    return items.filter(predicate);
  }

  update(type, id, data) {
    return this.store(type, id, data);
  }

  merge(type, id, data) {
    const existing = this.get(type, id);
    if (!existing) {
      appLogger.warn({ type, id }, 'mock-resource-merge-not-found');
      return null;
    }

    const merged = { ...existing, ...data };
    return this.store(type, id, merged);
  }

  delete(type, id) {
    const typeMap = this.resources.get(type);
    if (!typeMap) {
      return false;
    }

    const deleted = typeMap.delete(id);

    if (deleted && config.shouldLog('debug')) {
      appLogger.info({ type, id }, 'mock-resource-deleted');
    }

    return deleted;
  }

  clear(type) {
    const deleted = this.resources.delete(type);

    if (deleted && config.shouldLog('debug')) {
      appLogger.info({ type }, 'mock-resource-type-cleared');
    }

    return deleted;
  }

  clearAll() {
    this.resources.clear();
    appLogger.info({}, 'mock-resource-registry-cleared');
  }

  save(filePath = null) {
    const targetPath = filePath || config.get('persistencePath');

    try {
      const data = {};
      for (const [type, typeMap] of this.resources.entries()) {
        data[type] = {};
        for (const [id, resource] of typeMap.entries()) {
          data[type][id] = resource;
        }
      }

      fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
      appLogger.info({ filePath: targetPath }, 'mock-resource-registry-saved');
    } catch (error) {
      appLogger.error({ error, filePath: targetPath }, 'mock-resource-registry-save-error');
    }
  }

  load(filePath = null) {
    const targetPath = filePath || config.get('persistencePath');

    try {
      if (!fs.existsSync(targetPath)) {
        appLogger.warn({ filePath: targetPath }, 'mock-resource-registry-file-not-found');
        return;
      }

      const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

      for (const [type, resources] of Object.entries(data)) {
        for (const [id, resource] of Object.entries(resources)) {
          this.store(type, id, resource);
        }
      }

      appLogger.info({ filePath: targetPath }, 'mock-resource-registry-loaded');
    } catch (error) {
      appLogger.error({ error, filePath: targetPath }, 'mock-resource-registry-load-error');
    }
  }

  enableAutoSave() {
    this.autoSave = true;
  }

  disableAutoSave() {
    this.autoSave = false;
  }

  getAllResources() {
    const result = {};
    for (const [type, typeMap] of this.resources.entries()) {
      result[type] = {};
      for (const [id, resource] of typeMap.entries()) {
        result[type][id] = resource;
      }
    }
    return result;
  }
}

module.exports = ResourceRegistry;
