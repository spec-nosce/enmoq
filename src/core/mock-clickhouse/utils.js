/**
 * Utility functions for ClickHouse Mock
 */

/**
 * Serialize BigInt and Date objects to JSON-compatible format
 */
function serializeValue(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === 'object') {
    const serialized = {};
    for (const [key, val] of Object.entries(value)) {
      serialized[key] = serializeValue(val);
    }
    return serialized;
  }
  return value;
}

/**
 * Deserialize values from JSON back to their proper types
 */
function deserializeValue(value, type) {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Decimal types
  if (type && type.startsWith('Decimal')) {
    return parseFloat(value);
  }

  // Handle DateTime types
  if (type && type.startsWith('DateTime')) {
    return new Date(value);
  }

  return value;
}

/**
 * Parse column type from CREATE TABLE statement
 */
function parseColumnType(typeString) {
  // Remove LowCardinality wrapper
  if (typeString.startsWith('LowCardinality(')) {
    typeString = typeString.slice(15, -1);
  }

  // Extract base type and parameters
  const match = typeString.match(/^(\w+)(?:\(([^)]+)\))?$/);
  if (!match) {
    throw new Error(`Invalid column type: ${typeString}`);
  }

  const [, baseType, params] = match;
  return {
    type: baseType,
    params: params ? params.split(',').map((p) => p.trim()) : [],
    original: typeString,
  };
}

/**
 * Validate value against column type
 */
function validateValueType(value, columnDef) {
  if (value === null || value === undefined) {
    return true; // ClickHouse allows NULL by default
  }

  const { type } = parseColumnType(columnDef.type);

  switch (type) {
    case 'String':
      return typeof value === 'string';

    case 'Decimal64':
    case 'Decimal256':
      return typeof value === 'number' || !isNaN(parseFloat(value));

    case 'DateTime64':
      return value instanceof Date || !isNaN(Date.parse(value));

    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Int64':
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
    case 'UInt64':
      return typeof value === 'number' || typeof value === 'bigint';

    default:
      return true; // Unknown types pass validation
  }
}

/**
 * Convert JavaScript value to ClickHouse format
 */
function convertToClickHouseType(value, columnDef) {
  if (value === null || value === undefined) {
    return null;
  }

  const { type, params } = parseColumnType(columnDef.type);

  switch (type) {
    case 'String':
      return String(value);

    case 'Decimal64':
    case 'Decimal256': {
      const num = typeof value === 'string' ? parseFloat(value) : value;
      const scale = params[0] ? parseInt(params[0]) : 2;
      return parseFloat(num.toFixed(scale));
    }

    case 'DateTime64': {
      if (value instanceof Date) {
        return value;
      }
      return new Date(value);
    }

    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
      return parseInt(value);

    case 'Int64':
    case 'UInt64':
      return typeof value === 'bigint' ? value : BigInt(value);

    default:
      return value;
  }
}

/**
 * Format value for JSONEachRow output
 */
function formatForJSON(value, columnDef) {
  if (value === null || value === undefined) {
    return null;
  }

  const { type } = parseColumnType(columnDef.type);

  switch (type) {
    case 'Decimal64':
    case 'Decimal256':
      return typeof value === 'number' ? value : parseFloat(value);

    case 'DateTime64':
      return value instanceof Date ? value.toISOString() : value;

    case 'Int64':
    case 'UInt64':
      return typeof value === 'bigint' ? Number(value) : value;

    default:
      return value;
  }
}

module.exports = {
  serializeValue,
  deserializeValue,
  parseColumnType,
  validateValueType,
  convertToClickHouseType,
  formatForJSON,
};
