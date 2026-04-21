/**
 * Model Configuration Loader
 * Extracts configuration from actual Mongoose models
 */

const { ulid } = require('../../../utils/randomness');

/**
 * Extract model configuration from Mongoose model
 * @param {string} modelName - Model name (e.g., 'Identity')
 * @returns {object} Model configuration
 */
function extractModelConfig(modelName) {
  try {
    // Load the actual Mongoose models
    const models = require('@app/models');

    // Try direct lookup first (for capitalized names like 'Identity')
    let Model = models[modelName];

    // If not found, try to find by collection name (modelName property)
    if (!Model) {
      for (const [exportName, model] of Object.entries(models)) {
        if (model && model.modelName === modelName) {
          Model = model;
          break;
        }
      }
    }

    if (!Model) {
      console.warn(`Model ${modelName} not found in @app/models, using defaults`);
      return getDefaultConfig();
    }

    // Extract configuration from __appConfig
    const config = {
      paranoid: Model.__appConfig?.paranoid || false,
      supportULIDID: Model.__appConfig?.supportULIDID || false,
      uniqueFields: Model.__appConfig?.uniqueFields || [],
      defaults: {},
      allowedFields: new Set(),
      // refs: { fieldName -> collection name } — used for populate support
      refs: {},
    };

    // Extract field defaults, allowed fields, and refs from schema
    const { schema } = Model;
    if (schema && schema.paths) {
      for (const [fieldName, schemaType] of Object.entries(schema.paths)) {
        // Add to allowed fields (excluding internal Mongoose fields)
        if (!fieldName.startsWith('__') && fieldName !== 'id') {
          config.allowedFields.add(fieldName);
        }

        // Extract defaults
        if (schemaType.defaultValue !== undefined) {
          config.defaults[fieldName] = schemaType.defaultValue;
        } else if (schemaType.options && schemaType.options.default !== undefined) {
          config.defaults[fieldName] = schemaType.options.default;
        }

        // Collect ref → collection-name mappings for populate
        if (schemaType.options?.ref) {
          config.refs[fieldName] = schemaType.options.ref;
        }
      }
    }

    // Extract timestamp plugin config from schema
    if (schema && schema.plugins) {
      const timestampPlugin = schema.plugins.find(
        (p) => p.fn.name === 'timestamps' || p.fn.toString().includes('created')
      );

      if (timestampPlugin) {
        config.timestamps = {
          createdIndexOrder: timestampPlugin.opts?.createdIndexOrder || 'asc',
        };
      } else {
        config.timestamps = { createdIndexOrder: 'asc' };
      }
    } else {
      config.timestamps = { createdIndexOrder: 'asc' };
    }

    return config;
  } catch (error) {
    console.warn(`Could not load config for ${modelName}:`, error.message);
    return getDefaultConfig();
  }
}

/**
 * Get default configuration
 */
function getDefaultConfig() {
  return {
    paranoid: false,
    supportULIDID: true,
    uniqueFields: [],
    timestamps: { createdIndexOrder: 'asc' },
    defaults: {},
    allowedFields: new Set(),
    refs: {},
  };
}

/**
 * Add automatic fields to document
 * @param {object} doc - Document to enhance
 * @param {object} config - Model configuration
 * @param {string} operation - Operation type: 'create', 'update', or 'delete'
 * @returns {object} Enhanced document
 */
function addAutoFields(doc, config, operation = 'create') {
  const now = Date.now();
  let enhanced = { ...doc };

  // Filter out fields not in the model schema (if allowedFields is defined)
  if (config.allowedFields && config.allowedFields.size > 0) {
    const filtered = {};

    // Convert allowedFields Set to include top-level keys for nested paths
    const topLevelFields = new Set();
    for (const field of config.allowedFields) {
      // For nested paths like 'config.overdraft_limit', add 'config' as allowed
      const topLevel = field.split('.')[0];
      topLevelFields.add(topLevel);
    }

    for (const [key, value] of Object.entries(enhanced)) {
      // Allow field if it's directly in allowedFields OR if it's a top-level parent of a nested field
      if (config.allowedFields.has(key) || topLevelFields.has(key)) {
        filtered[key] = value;
      }
    }
    enhanced = filtered;
  }

  // Apply model defaults for fields not provided (only on create)
  if (operation === 'create' && config.defaults) {
    for (const [field, defaultValue] of Object.entries(config.defaults)) {
      // Handle nested paths (e.g., 'config.overdraft_limit')
      if (field.includes('.')) {
        const parts = field.split('.');
        let current = enhanced;
        let shouldApplyDefault = false;

        // Navigate/create nested structure
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (current[part] === undefined) {
            current[part] = {};
            shouldApplyDefault = true; // Parent was created, so child needs default
          }
          current = current[part];
        }

        // Set the value if not already defined
        const lastPart = parts[parts.length - 1];
        if (current[lastPart] === undefined) {
          current[lastPart] = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
        }
      } else {
        // Handle flat fields
        if (enhanced[field] === undefined) {
          enhanced[field] = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
        }
      }
    }
  }

  // Add ULID if configured and _id not provided
  if (config.supportULIDID && !enhanced._id) {
    enhanced._id = ulid();
  }

  // Add timestamps based on operation
  if (operation === 'create') {
    enhanced.created = enhanced.created || now;
    enhanced.updated = enhanced.updated || now;
    if (config.paranoid) {
      enhanced.deleted = enhanced.deleted ?? 0;
    }
  } else if (operation === 'update') {
    // On update, only update the 'updated' field
    enhanced.updated = now;
  } else if (operation === 'delete') {
    // On delete (paranoid), set deleted timestamp
    if (config.paranoid) {
      enhanced.deleted = now;
      enhanced.updated = now;
    }
  }

  return enhanced;
}

module.exports = {
  extractModelConfig,
  addAutoFields,
};
