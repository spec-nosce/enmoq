/**
 * Update Engine - MongoDB update operator interpreter
 *
 * Phase 3: Update operators ($set, $unset, $inc, $push, etc.)
 */

class UpdateEngine {
  constructor() {
    // Field operators
    this.fieldOps = {
      $set: (doc, updates) => {
        for (const [field, value] of Object.entries(updates)) {
          this.setFieldValue(doc, field, value);
        }
      },

      $unset: (doc, fields) => {
        for (const field of Object.keys(fields)) {
          this.unsetFieldValue(doc, field);
        }
      },

      $rename: (doc, renames) => {
        for (const [oldField, newField] of Object.entries(renames)) {
          const value = this.getFieldValue(doc, oldField);
          if (value !== undefined) {
            this.setFieldValue(doc, newField, value);
            this.unsetFieldValue(doc, oldField);
          }
        }
      },
    };

    // Numeric operators
    this.numericOps = {
      $inc: (doc, increments) => {
        for (const [field, value] of Object.entries(increments)) {
          const current = this.getFieldValue(doc, field) || 0;
          this.setFieldValue(doc, field, current + value);
        }
      },

      $mul: (doc, multipliers) => {
        for (const [field, value] of Object.entries(multipliers)) {
          const current = this.getFieldValue(doc, field) || 0;
          this.setFieldValue(doc, field, current * value);
        }
      },

      $min: (doc, values) => {
        for (const [field, value] of Object.entries(values)) {
          const current = this.getFieldValue(doc, field);
          if (current === undefined || value < current) {
            this.setFieldValue(doc, field, value);
          }
        }
      },

      $max: (doc, values) => {
        for (const [field, value] of Object.entries(values)) {
          const current = this.getFieldValue(doc, field);
          if (current === undefined || value > current) {
            this.setFieldValue(doc, field, value);
          }
        }
      },
    };

    // Array operators
    this.arrayOps = {
      $push: (doc, pushes) => {
        for (const [field, value] of Object.entries(pushes)) {
          let current = this.getFieldValue(doc, field);

          // Handle $each modifier
          if (value && typeof value === 'object' && value.$each) {
            if (!Array.isArray(current)) {
              current = [];
            }
            current.push(...value.$each);
          } else {
            if (!Array.isArray(current)) {
              current = [];
            }
            current.push(value);
          }

          this.setFieldValue(doc, field, current);
        }
      },

      $pull: (doc, pulls) => {
        for (const [field, condition] of Object.entries(pulls)) {
          const current = this.getFieldValue(doc, field);
          if (Array.isArray(current)) {
            const filtered = current.filter((item) => {
              // Simple value match
              if (typeof condition !== 'object' || condition === null) {
                return item !== condition;
              }
              // Object with operators (would need QueryEngine for complex matches)
              // For now, simple equality check
              return JSON.stringify(item) !== JSON.stringify(condition);
            });
            this.setFieldValue(doc, field, filtered);
          }
        }
      },

      $addToSet: (doc, additions) => {
        for (const [field, value] of Object.entries(additions)) {
          let current = this.getFieldValue(doc, field);
          if (!Array.isArray(current)) {
            current = [];
          }

          // Handle $each modifier
          if (value && typeof value === 'object' && value.$each) {
            for (const item of value.$each) {
              if (!current.includes(item)) {
                current.push(item);
              }
            }
          } else if (!current.includes(value)) {
            current.push(value);
          }

          this.setFieldValue(doc, field, current);
        }
      },

      $pop: (doc, pops) => {
        for (const [field, direction] of Object.entries(pops)) {
          const current = this.getFieldValue(doc, field);
          if (Array.isArray(current) && current.length > 0) {
            if (direction === -1) {
              current.shift(); // Remove first
            } else {
              current.pop(); // Remove last
            }
            this.setFieldValue(doc, field, current);
          }
        }
      },
    };
  }

  /**
   * Apply update operators to document
   * @param {object} doc - Document to update (will be mutated)
   * @param {object} updateSpec - Update specification with operators
   */
  applyUpdate(doc, updateSpec) {
    // Check if this is an operator-based update or replacement
    const hasOperators = Object.keys(updateSpec).some((key) => key.startsWith('$'));

    if (!hasOperators) {
      // This is a replacement update (not using operators)
      // Return the updateSpec as the new document (handled by repository)
      throw new Error('Replacement updates should be handled by repository layer');
    }

    // Apply each operator
    for (const [operator, value] of Object.entries(updateSpec)) {
      if (!operator.startsWith('$')) {
        throw new Error(`Update document has mixed operators and fields: ${operator}`);
      }

      const opFn = this.fieldOps[operator] || this.numericOps[operator] || this.arrayOps[operator];

      if (!opFn) {
        throw new Error(`Unsupported update operator: ${operator}`);
      }

      opFn(doc, value);
    }

    return doc;
  }

  /**
   * Get field value from document (supports nested paths)
   */
  getFieldValue(doc, field) {
    if (!field.includes('.')) {
      return doc[field];
    }

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
   * Set field value in document (supports nested paths)
   */
  setFieldValue(doc, field, value) {
    if (!field.includes('.')) {
      doc[field] = value;
      return;
    }

    const parts = field.split('.');
    let current = doc;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Unset (delete) field from document
   */
  unsetFieldValue(doc, field) {
    if (!field.includes('.')) {
      delete doc[field];
      return;
    }

    const parts = field.split('.');
    let current = doc;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        return; // Path doesn't exist
      }
      current = current[part];
    }

    delete current[parts[parts.length - 1]];
  }
}

module.exports = UpdateEngine;
