/**
 * Query Engine - MongoDB query interpreter for JSON arrays
 *
 * Phase 1: Basic equality queries
 * Phase 2: Query operators ($gt, $gte, $lt, $lte, $ne, $in, $nin, $or, $and, $exists)
 * Phase 6: Advanced query operators ($regex, $all, $elemMatch, $size)
 */

class QueryEngine {
  constructor() {
    // Comparison operators
    this.comparisonOps = {
      $eq: (fieldValue, queryValue) => fieldValue === queryValue,
      $ne: (fieldValue, queryValue) => fieldValue !== queryValue,
      $gt: (fieldValue, queryValue) => fieldValue > queryValue,
      $gte: (fieldValue, queryValue) => fieldValue >= queryValue,
      $lt: (fieldValue, queryValue) => fieldValue < queryValue,
      $lte: (fieldValue, queryValue) => fieldValue <= queryValue,
    };

    // Array operators
    this.arrayOps = {
      $in: (fieldValue, queryArray) => queryArray.includes(fieldValue),
      $nin: (fieldValue, queryArray) => !queryArray.includes(fieldValue),
      $all: (fieldValue, queryArray) => {
        // Field must be an array containing all specified values
        if (!Array.isArray(fieldValue)) return false;
        return queryArray.every((val) => fieldValue.includes(val));
      },
      $size: (fieldValue, expectedSize) => {
        // Field must be an array with exact size
        if (!Array.isArray(fieldValue)) return false;
        return fieldValue.length === expectedSize;
      },
      $elemMatch: (fieldValue, queryObject) => {
        // Field must be an array with at least one element matching the query
        if (!Array.isArray(fieldValue)) return false;

        // Create a temporary QueryEngine instance to match array elements
        const engine = new QueryEngine();

        return fieldValue.some((element) => {
          // If element is a primitive (string, number, etc.), check if query is an operator
          if (typeof element !== 'object' || element === null) {
            // Check if queryObject has operators
            const hasOperators =
              typeof queryObject === 'object' &&
              queryObject !== null &&
              Object.keys(queryObject).some((k) => k.startsWith('$'));

            if (hasOperators) {
              // Apply operators directly to the primitive value
              // Create temp doc with value field
              return engine.matchField({ value: element }, 'value', queryObject);
            }
            // Direct equality check
            return element === queryObject;
          }

          // Element is an object, match it directly
          return engine.matchSingle(element, queryObject);
        });
      },
    };

    // Element operators
    this.elementOps = {
      $exists: (fieldValue, shouldExist) => {
        const exists = fieldValue !== undefined && fieldValue !== null;
        return shouldExist ? exists : !exists;
      },
    };

    // String/Pattern operators
    this.stringOps = {
      $regex: (fieldValue, pattern, options = {}) => {
        if (typeof fieldValue !== 'string') return false;

        // Handle pattern as string or RegExp object
        let regexPattern = pattern;
        let regexFlags = '';

        if (typeof pattern === 'string') {
          regexPattern = pattern;
          regexFlags = options.$options || '';
        } else if (pattern instanceof RegExp) {
          regexPattern = pattern.source;
          regexFlags = pattern.flags;
        }

        try {
          const regex = new RegExp(regexPattern, regexFlags);
          return regex.test(fieldValue);
        } catch (e) {
          throw new Error(`Invalid regex pattern: ${regexPattern}`);
        }
      },
    };
  }

  /**
   * Match documents against query
   * @param {Array} documents - Documents to filter
   * @param {object} query - MongoDB-style query
   * @returns {Array} Matched documents
   */
  match(documents, query) {
    return documents.filter((doc) => this.matchSingle(doc, query));
  }

  /**
   * Check if single document matches query
   * @param {object} doc - Document to check
   * @param {object} query - Query object
   * @returns {boolean} True if matches
   */
  matchSingle(doc, query) {
    // Separate logical operators from regular fields
    const logicalOps = [];
    const regularFields = {};

    for (const [key, value] of Object.entries(query)) {
      if (key === '$or' || key === '$and' || key === '$nor' || key === '$not') {
        logicalOps.push({ op: key, value });
      } else {
        regularFields[key] = value;
      }
    }

    // Check logical operators
    for (const { op, value } of logicalOps) {
      if (op === '$or') {
        if (!value.some((subQuery) => this.matchSingle(doc, subQuery))) {
          return false;
        }
      } else if (op === '$and') {
        if (!value.every((subQuery) => this.matchSingle(doc, subQuery))) {
          return false;
        }
      } else if (op === '$nor') {
        if (value.some((subQuery) => this.matchSingle(doc, subQuery))) {
          return false;
        }
      } else if (op === '$not') {
        if (this.matchSingle(doc, value)) {
          return false;
        }
      }
    }

    // Check regular fields (implicit AND)
    for (const [key, value] of Object.entries(regularFields)) {
      if (!this.matchField(doc, key, value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match a single field
   * Supports both equality and operators
   */
  matchField(doc, field, queryValue) {
    const docValue = this.getFieldValue(doc, field);

    // Simple equality: { age: 30 }
    if (typeof queryValue !== 'object' || queryValue === null || Array.isArray(queryValue)) {
      return docValue === queryValue;
    }

    // Handle $regex with optional $options
    if (queryValue.$regex !== undefined) {
      const options = queryValue.$options !== undefined ? { $options: queryValue.$options } : {};
      return this.stringOps.$regex(docValue, queryValue.$regex, options);
    }

    // Operator-based: { age: { $gte: 18, $lt: 65 } }
    for (const [operator, opValue] of Object.entries(queryValue)) {
      if (operator.startsWith('$')) {
        // Skip $options as it's handled with $regex
        if (operator === '$options') continue;

        const opFn =
          this.comparisonOps[operator] ||
          this.arrayOps[operator] ||
          this.elementOps[operator] ||
          this.stringOps[operator];

        if (!opFn) {
          throw new Error(`Unsupported operator: ${operator}`);
        }

        if (!opFn(docValue, opValue)) {
          return false;
        }
      } else {
        // Nested object equality (not an operator)
        return docValue === queryValue;
      }
    }

    return true;
  }

  /**
   * Get field value from document (supports nested paths)
   * @param {object} doc - Document
   * @param {string} field - Field path (e.g., 'user.email')
   * @returns {*} Field value
   */
  getFieldValue(doc, field) {
    if (!field.includes('.')) {
      return doc[field];
    }

    // Handle nested paths
    const parts = field.split('.');
    let value = doc;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  /**
   * Apply sorting
   * @param {Array} documents - Documents to sort
   * @param {object} sortSpec - Sort specification { field: 1 or -1 }
   * @returns {Array} Sorted documents
   */
  sort(documents, sortSpec) {
    if (!sortSpec || Object.keys(sortSpec).length === 0) {
      return documents;
    }

    const sorted = [...documents];
    const fields = Object.entries(sortSpec);

    sorted.sort((a, b) => {
      for (const [field, order] of fields) {
        const aVal = this.getFieldValue(a, field);
        const bVal = this.getFieldValue(b, field);

        if (aVal < bVal) return order === 1 ? -1 : 1;
        if (aVal > bVal) return order === 1 ? 1 : -1;
      }
      return 0;
    });

    return sorted;
  }

  /**
   * Apply limit
   */
  limit(documents, count) {
    return documents.slice(0, count);
  }

  /**
   * Apply projection
   * @param {Array} documents - Documents to project
   * @param {object|Array} projections - Fields to include
   * @returns {Array} Projected documents
   */
  project(documents, projections) {
    if (!projections || (Array.isArray(projections) && projections.length === 0)) {
      return documents;
    }

    // Convert array to object
    const fields = Array.isArray(projections)
      ? projections.reduce((acc, f) => ({ ...acc, [f]: 1 }), {})
      : projections;

    return documents.map((doc) => {
      const projected = {};

      for (const field of Object.keys(fields)) {
        if (fields[field]) {
          projected[field] = this.getFieldValue(doc, field);
        }
      }

      return projected;
    });
  }
}

module.exports = QueryEngine;
