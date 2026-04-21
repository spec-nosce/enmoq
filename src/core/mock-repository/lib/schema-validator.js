/**
 * Schema Validator - Validate documents against schema definitions
 *
 * Supports:
 * - Type validation (string, number, boolean, object, array, date)
 * - Required fields
 * - Min/max values for numbers
 * - Min/max length for strings and arrays
 * - Enum values
 * - Pattern matching (regex)
 * - Nested object validation
 * - Array element validation
 * - Custom validators
 */

class SchemaValidator {
  constructor() {
    this.schemas = new Map();
  }

  /**
   * Register a schema for a model
   * @param {string} modelName - Model name
   * @param {object} schema - Schema definition
   */
  registerSchema(modelName, schema) {
    this.schemas.set(modelName, schema);
  }

  /**
   * Validate a document against registered schema
   * @param {string} modelName - Model name
   * @param {object} doc - Document to validate
   * @param {boolean} isUpdate - Whether this is an update operation
   * @returns {object} Validation result { valid: boolean, errors: [] }
   */
  validate(modelName, doc, isUpdate = false) {
    const schema = this.schemas.get(modelName);

    if (!schema) {
      // No schema registered, pass validation
      return { valid: true, errors: [] };
    }

    const errors = [];
    this.validateObject(doc, schema, '', errors, isUpdate);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate an object against schema
   * @param {object} doc - Document/object to validate
   * @param {object} schema - Schema definition
   * @param {string} path - Current field path (for nested objects)
   * @param {Array} errors - Array to collect errors
   * @param {boolean} isUpdate - Whether this is an update operation
   */
  validateObject(doc, schema, path, errors, isUpdate) {
    // Check required fields (skip for updates)
    if (!isUpdate) {
      for (const [field, fieldSchema] of Object.entries(schema)) {
        if (fieldSchema.required && (doc[field] === undefined || doc[field] === null)) {
          errors.push({
            field: path ? `${path}.${field}` : field,
            message: `Field is required`,
            code: 'REQUIRED_FIELD',
          });
        }
      }
    }

    // Validate present fields
    for (const [field, value] of Object.entries(doc)) {
      const fieldSchema = schema[field];
      const fieldPath = path ? `${path}.${field}` : field;

      // Skip if field not in schema (allow extra fields)
      if (!fieldSchema) continue;

      // Skip null/undefined for optional fields
      if (!fieldSchema.required && (value === null || value === undefined)) {
        continue;
      }

      this.validateField(value, fieldSchema, fieldPath, errors);
    }
  }

  /**
   * Validate a single field
   * @param {*} value - Field value
   * @param {object} fieldSchema - Field schema definition
   * @param {string} path - Field path
   * @param {Array} errors - Array to collect errors
   */
  validateField(value, fieldSchema, path, errors) {
    // Type validation
    if (fieldSchema.type) {
      const typeValid = this.validateType(value, fieldSchema.type, path, errors);
      if (!typeValid) return; // Skip further validation if type is wrong
    }

    // Enum validation
    if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
      errors.push({
        field: path,
        message: `Value must be one of: ${fieldSchema.enum.join(', ')}`,
        code: 'INVALID_ENUM',
      });
    }

    // Min/max for numbers
    if (typeof value === 'number') {
      if (fieldSchema.min !== undefined && value < fieldSchema.min) {
        errors.push({
          field: path,
          message: `Value must be at least ${fieldSchema.min}`,
          code: 'MIN_VALUE',
        });
      }
      if (fieldSchema.max !== undefined && value > fieldSchema.max) {
        errors.push({
          field: path,
          message: `Value must be at most ${fieldSchema.max}`,
          code: 'MAX_VALUE',
        });
      }
    }

    // Min/max length for strings
    if (typeof value === 'string') {
      if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
        errors.push({
          field: path,
          message: `Length must be at least ${fieldSchema.minLength} characters`,
          code: 'MIN_LENGTH',
        });
      }
      if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
        errors.push({
          field: path,
          message: `Length must be at most ${fieldSchema.maxLength} characters`,
          code: 'MAX_LENGTH',
        });
      }

      // Pattern matching
      if (fieldSchema.match) {
        const regex = new RegExp(fieldSchema.match);
        if (!regex.test(value)) {
          errors.push({
            field: path,
            message: `Value does not match required pattern`,
            code: 'PATTERN_MISMATCH',
          });
        }
      }
    }

    // Array validation
    if (Array.isArray(value)) {
      if (fieldSchema.minItems !== undefined && value.length < fieldSchema.minItems) {
        errors.push({
          field: path,
          message: `Array must have at least ${fieldSchema.minItems} items`,
          code: 'MIN_ITEMS',
        });
      }
      if (fieldSchema.maxItems !== undefined && value.length > fieldSchema.maxItems) {
        errors.push({
          field: path,
          message: `Array must have at most ${fieldSchema.maxItems} items`,
          code: 'MAX_ITEMS',
        });
      }

      // Validate array elements
      if (fieldSchema.items) {
        value.forEach((item, index) => {
          this.validateField(item, fieldSchema.items, `${path}[${index}]`, errors);
        });
      }
    }

    // Nested object validation
    if (fieldSchema.properties && typeof value === 'object' && !Array.isArray(value)) {
      this.validateObject(value, fieldSchema.properties, path, errors, false);
    }

    // Custom validator
    if (fieldSchema.validate && typeof fieldSchema.validate === 'function') {
      const customValid = fieldSchema.validate(value);
      if (customValid !== true) {
        errors.push({
          field: path,
          message: typeof customValid === 'string' ? customValid : 'Custom validation failed',
          code: 'CUSTOM_VALIDATION',
        });
      }
    }
  }

  /**
   * Validate type
   * @param {*} value - Value to check
   * @param {string|Array} expectedType - Expected type(s)
   * @param {string} path - Field path
   * @param {Array} errors - Array to collect errors
   * @returns {boolean} Whether type is valid
   */
  validateType(value, expectedType, path, errors) {
    const types = Array.isArray(expectedType) ? expectedType : [expectedType];
    const actualType = this.getType(value);

    if (!types.includes(actualType)) {
      errors.push({
        field: path,
        message: `Expected type ${types.join(' or ')}, got ${actualType}`,
        code: 'INVALID_TYPE',
      });
      return false;
    }

    return true;
  }

  /**
   * Get type of value
   * @param {*} value - Value to check
   * @returns {string} Type name
   */
  getType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof Date) return 'date';
    return typeof value;
  }

  /**
   * Clear all registered schemas
   */
  clearSchemas() {
    this.schemas.clear();
  }
}

module.exports = SchemaValidator;
