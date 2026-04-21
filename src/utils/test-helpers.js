/**
 * Test helpers for clearing mock data between tests
 * Use these in your test files for data isolation
 */

const path = require('path');
const fs = require('fs').promises;

/**
 * Clear all model data from the mock repository
 * This removes all JSON files from the .mock-data directory
 * AND clears the in-memory cache
 * Use this in beforeEach() for test isolation
 *
 * @returns {Promise<void>}
 */
async function clearModelData() {
  // Clear in-memory cache first (if store exists)
  if (global.__mockJsonStore) {
    global.__mockJsonStore.invalidateAll();
  }

  const dataDir = path.join(process.cwd(), '.mock-data', 'repository');

  try {
    // Check if directory exists
    await fs.access(dataDir);

    // Read all files in the directory
    const files = await fs.readdir(dataDir);

    // Delete each JSON file
    for (const file of files) {
      if (file.endsWith('.json')) {
        await fs.unlink(path.join(dataDir, file));
      }
    }
  } catch (error) {
    // If directory doesn't exist, that's fine - no data to clear
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Clear data for a specific model
 * @param {string} modelName - Name of the model to clear
 * @returns {Promise<void>}
 */
async function clearModel(modelName) {
  // Clear from cache
  if (global.__mockJsonStore) {
    global.__mockJsonStore.invalidate(modelName);
  }

  const dataDir = path.join(process.cwd(), '.mock-data', 'repository');
  const filePath = path.join(dataDir, `${modelName}.json`);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    // If file doesn't exist, that's fine
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Get all persisted data for a model (for debugging)
 * @param {string} modelName - Name of the model
 * @returns {Promise<Array>}
 */
async function getModelData(modelName) {
  const dataDir = path.join(process.cwd(), '.mock-data', 'repository');
  const filePath = path.join(dataDir, `${modelName}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

module.exports = {
  clearModelData,
  clearModel,
  getModelData,
};
