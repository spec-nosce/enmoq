/**
 * AggregationEngine - MongoDB Aggregation Pipeline Emulator
 *
 * Supports pipeline stages:
 * - $match: Filter documents using query operators
 * - $project: Select, reshape, and compute fields
 * - $group: Group documents and apply accumulators
 * - $sort: Sort documents
 * - $limit: Limit number of documents
 * - $lookup: Join with another collection (left outer join)
 */

const QueryEngine = require('./query-engine');

class AggregationEngine {
  constructor(jsonStore) {
    this.jsonStore = jsonStore;
    this.queryEngine = new QueryEngine();
  }

  /**
   * Execute aggregation pipeline
   * @param {string} collectionName - Collection to aggregate
   * @param {Array} pipeline - Array of stage objects
   * @returns {Array} - Aggregated results
   */
  async aggregate(collectionName, pipeline) {
    if (!Array.isArray(pipeline)) {
      throw new Error('Pipeline must be an array');
    }

    // Load initial documents
    let documents = await this.jsonStore.load(collectionName);

    // Process each stage in sequence
    for (const stage of pipeline) {
      const stageKeys = Object.keys(stage);
      if (stageKeys.length !== 1) {
        throw new Error('Each pipeline stage must have exactly one operator');
      }

      const operator = stageKeys[0];
      const stageConfig = stage[operator];

      switch (operator) {
        case '$match':
          documents = this.applyMatch(documents, stageConfig);
          break;

        case '$project':
          documents = this.applyProject(documents, stageConfig);
          break;

        case '$group':
          documents = this.applyGroup(documents, stageConfig);
          break;

        case '$sort':
          documents = this.applySort(documents, stageConfig);
          break;

        case '$limit':
          documents = this.applyLimit(documents, stageConfig);
          break;

        case '$lookup':
          documents = await this.applyLookup(documents, stageConfig);
          break;

        case '$facet':
          documents = await this.applyFacet(documents, stageConfig);
          break;

        default:
          throw new Error(`Unsupported pipeline stage: ${operator}`);
      }
    }

    return documents;
  }

  /**
   * $match stage - Filter documents
   * @param {Array} documents
   * @param {Object} query
   * @returns {Array}
   */
  applyMatch(documents, query) {
    return this.queryEngine.match(documents, query);
  }

  /**
   * $project stage - Select and transform fields
   * @param {Array} documents
   * @param {Object} projection
   * @returns {Array}
   */
  applyProject(documents, projection) {
    return documents.map((doc) => {
      const projected = {};

      // Check if projection uses inclusion or exclusion mode
      const hasInclusions = Object.values(projection).some((v) => v === 1 || v === true);
      const hasExclusions = Object.values(projection).some((v) => v === 0 || v === false);

      // Mixed inclusion/exclusion not allowed (except for _id)
      if (hasInclusions && hasExclusions) {
        const hasNonIdExclusions = Object.entries(projection).some(
          ([key, val]) => key !== '_id' && (val === 0 || val === false)
        );
        if (hasNonIdExclusions) {
          throw new Error('Cannot mix inclusion and exclusion in projection');
        }
      }

      // Handle _id default inclusion
      const explicitIdExclusion = projection._id === 0 || projection._id === false;
      if (!explicitIdExclusion && hasInclusions) {
        projected._id = doc._id;
      }

      for (const [field, value] of Object.entries(projection)) {
        if (field === '_id' && (value === 0 || value === false)) {
          // Exclude _id
          delete projected._id;
          continue;
        }

        if (value === 1 || value === true) {
          // Include field
          projected[field] = this.getNestedValue(doc, field);
        } else if (value === 0 || value === false) {
          // Exclusion mode - include all except excluded
          if (!hasInclusions) {
            // Copy all fields first (will exclude later)
            Object.assign(projected, doc);
          }
        } else if (typeof value === 'string' && value.startsWith('$')) {
          // Computed field reference
          const sourceField = value.substring(1); // Remove $
          projected[field] = this.getNestedValue(doc, sourceField);
        } else if (typeof value === 'object' && value !== null) {
          // Computed field with operators
          projected[field] = this.evaluateExpression(doc, value);
        } else {
          // Literal value
          projected[field] = value;
        }
      }

      // Handle exclusion mode
      if (!hasInclusions && hasExclusions) {
        for (const [field, value] of Object.entries(projection)) {
          if (value === 0 || value === false) {
            delete projected[field];
          }
        }
      }

      return projected;
    });
  }

  /**
   * $group stage - Group documents and compute aggregates
   * @param {Array} documents
   * @param {Object} groupSpec
   * @returns {Array}
   */
  applyGroup(documents, groupSpec) {
    const { _id: groupKey, ...accumulators } = groupSpec;

    // Group documents by _id expression
    const groups = new Map();

    for (const doc of documents) {
      // Evaluate group key
      let key;
      if (groupKey === null || groupKey === undefined) {
        key = null; // Group all documents together
      } else if (typeof groupKey === 'string' && groupKey.startsWith('$')) {
        // Field reference
        const field = groupKey.substring(1);
        key = this.getNestedValue(doc, field);
      } else if (typeof groupKey === 'object' && groupKey !== null) {
        // Compound key
        key = JSON.stringify(
          Object.entries(groupKey).reduce((acc, [k, v]) => {
            if (typeof v === 'string' && v.startsWith('$')) {
              acc[k] = this.getNestedValue(doc, v.substring(1));
            } else {
              acc[k] = v;
            }
            return acc;
          }, {})
        );
      } else {
        key = groupKey;
      }

      // Initialize group if not exists
      const keyStr = key === null ? '__null__' : String(key);
      if (!groups.has(keyStr)) {
        groups.set(keyStr, { _id: key, docs: [] });
      }

      groups.get(keyStr).docs.push(doc);
    }

    // Apply accumulators to each group
    const results = [];
    for (const [keyStr, group] of groups) {
      const result = { _id: group._id };

      for (const [field, accumulator] of Object.entries(accumulators)) {
        result[field] = this.applyAccumulator(group.docs, accumulator);
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Apply accumulator expression
   * @param {Array} documents - Documents in the group
   * @param {Object} accumulator - Accumulator expression
   * @returns {*}
   */
  applyAccumulator(documents, accumulator) {
    if (typeof accumulator !== 'object' || accumulator === null) {
      throw new Error('Accumulator must be an object');
    }

    const accumulatorKeys = Object.keys(accumulator);
    if (accumulatorKeys.length !== 1) {
      throw new Error('Accumulator must have exactly one operator');
    }

    const operator = accumulatorKeys[0];
    const expression = accumulator[operator];

    switch (operator) {
      case '$sum': {
        if (expression === 1) {
          // Count documents
          return documents.length;
        }
        // Sum field values
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$sum requires a field reference or 1');
        }

        return documents.reduce((sum, doc) => {
          const value = this.getNestedValue(doc, field);
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
      }

      case '$avg': {
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$avg requires a field reference');
        }

        const values = documents
          .map((doc) => this.getNestedValue(doc, field))
          .filter((v) => typeof v === 'number');

        return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
      }

      case '$min': {
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$min requires a field reference');
        }

        const values = documents
          .map((doc) => this.getNestedValue(doc, field))
          .filter((v) => v !== undefined && v !== null);

        return values.length > 0 ? Math.min(...values) : null;
      }

      case '$max': {
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$max requires a field reference');
        }

        const values = documents
          .map((doc) => this.getNestedValue(doc, field))
          .filter((v) => v !== undefined && v !== null);

        return values.length > 0 ? Math.max(...values) : null;
      }

      case '$push': {
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$push requires a field reference');
        }

        return documents.map((doc) => this.getNestedValue(doc, field));
      }

      case '$addToSet': {
        const field =
          typeof expression === 'string' && expression.startsWith('$')
            ? expression.substring(1)
            : null;

        if (!field) {
          throw new Error('$addToSet requires a field reference');
        }

        const uniqueValues = new Set();
        documents.forEach((doc) => {
          const value = this.getNestedValue(doc, field);
          if (value !== undefined && value !== null) {
            uniqueValues.add(JSON.stringify(value));
          }
        });

        return Array.from(uniqueValues).map((v) => JSON.parse(v));
      }

      case '$count':
        return documents.length;

      default:
        throw new Error(`Unsupported accumulator: ${operator}`);
    }
  }

  /**
   * $sort stage - Sort documents
   * @param {Array} documents
   * @param {Object} sortSpec
   * @returns {Array}
   */
  applySort(documents, sortSpec) {
    return this.queryEngine.sort(documents, sortSpec);
  }

  /**
   * $limit stage - Limit number of documents
   * @param {Array} documents
   * @param {number} limit
   * @returns {Array}
   */
  applyLimit(documents, limit) {
    if (typeof limit !== 'number' || limit < 0) {
      throw new Error('$limit must be a non-negative number');
    }
    return documents.slice(0, limit);
  }

  /**
   * $lookup stage - Join with another collection (left outer join)
   * @param {Array} documents
   * @param {Object} lookupSpec
   * @returns {Array}
   */
  async applyLookup(documents, lookupSpec) {
    const { from, localField, foreignField, as } = lookupSpec;

    if (!from || !localField || !foreignField || !as) {
      throw new Error('$lookup requires: from, localField, foreignField, as');
    }

    // Load foreign collection
    const foreignDocs = await this.jsonStore.load(from);

    // Perform left outer join
    return documents.map((doc) => {
      const localValue = this.getNestedValue(doc, localField);

      // Find matching foreign documents
      const matches = foreignDocs.filter((foreignDoc) => {
        const foreignValue = this.getNestedValue(foreignDoc, foreignField);
        return this.valuesEqual(localValue, foreignValue);
      });

      // Add matches as array field
      return {
        ...doc,
        [as]: matches,
      };
    });
  }

  /**
   * Evaluate computed expression
   * @param {Object} doc
   * @param {Object} expression
   * @returns {*}
   */
  evaluateExpression(doc, expression) {
    // For now, support simple operators
    const operators = Object.keys(expression);
    if (operators.length === 0) {
      return expression;
    }

    const operator = operators[0];
    const operands = expression[operator];

    switch (operator) {
      case '$concat': {
        if (!Array.isArray(operands)) {
          throw new Error('$concat requires an array');
        }
        return operands
          .map((op) => {
            if (typeof op === 'string' && op.startsWith('$')) {
              return String(this.getNestedValue(doc, op.substring(1)) || '');
            }
            return String(op);
          })
          .join('');
      }

      case '$add': {
        if (!Array.isArray(operands)) {
          throw new Error('$add requires an array');
        }
        return operands.reduce((sum, op) => {
          const value =
            typeof op === 'string' && op.startsWith('$')
              ? this.getNestedValue(doc, op.substring(1))
              : op;
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
      }

      case '$multiply': {
        if (!Array.isArray(operands)) {
          throw new Error('$multiply requires an array');
        }
        return operands.reduce((product, op) => {
          const value =
            typeof op === 'string' && op.startsWith('$')
              ? this.getNestedValue(doc, op.substring(1))
              : op;
          return product * (typeof value === 'number' ? value : 1);
        }, 1);
      }

      case '$subtract': {
        if (!Array.isArray(operands) || operands.length !== 2) {
          throw new Error('$subtract requires exactly 2 operands');
        }
        const [a, b] = operands.map((op) => {
          const value =
            typeof op === 'string' && op.startsWith('$')
              ? this.getNestedValue(doc, op.substring(1))
              : op;
          return typeof value === 'number' ? value : 0;
        });
        return a - b;
      }

      case '$literal': {
        // Returns the value without parsing (prevents $-prefixed strings from being interpreted as field paths)
        return operands;
      }

      default:
        throw new Error(`Unsupported expression operator: ${operator}`);
    }
  }

  /**
   * Get nested field value using dot notation
   * @param {Object} obj
   * @param {string} path
   * @returns {*}
   */
  getNestedValue(obj, path) {
    const parts = path.split('.');
    let value = obj;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Compare two values for equality
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  valuesEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    return false;
  }

  /**
   * $facet stage - Run multiple pipelines on the same input documents
   * Returns a single document with results from each pipeline
   * @param {Array} documents
   * @param {Object} facetConfig - Object with pipeline names as keys and pipelines as values
   * @returns {Array} - Array with single document containing all facet results
   */
  async applyFacet(documents, facetConfig) {
    const result = {};

    // Process each facet pipeline
    for (const [facetName, pipeline] of Object.entries(facetConfig)) {
      if (!Array.isArray(pipeline)) {
        throw new Error(`Facet "${facetName}" must be an array of pipeline stages`);
      }

      // Clone documents for this facet
      let facetDocs = JSON.parse(JSON.stringify(documents));

      // Execute pipeline for this facet
      for (const stage of pipeline) {
        const stageKeys = Object.keys(stage);
        if (stageKeys.length !== 1) {
          throw new Error('Each pipeline stage must have exactly one operator');
        }

        const operator = stageKeys[0];
        const stageConfig = stage[operator];

        switch (operator) {
          case '$match':
            facetDocs = this.applyMatch(facetDocs, stageConfig);
            break;
          case '$project':
            facetDocs = this.applyProject(facetDocs, stageConfig);
            break;
          case '$group':
            facetDocs = this.applyGroup(facetDocs, stageConfig);
            break;
          case '$sort':
            facetDocs = this.applySort(facetDocs, stageConfig);
            break;
          case '$limit':
            facetDocs = this.applyLimit(facetDocs, stageConfig);
            break;
          case '$lookup':
            facetDocs = await this.applyLookup(facetDocs, stageConfig);
            break;
          default:
            throw new Error(`Unsupported pipeline stage in facet: ${operator}`);
        }
      }

      result[facetName] = facetDocs;
    }

    // Return as array with single document (MongoDB behavior)
    return [result];
  }
}

module.exports = AggregationEngine;
