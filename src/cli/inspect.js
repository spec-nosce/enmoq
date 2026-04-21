/**
 * Inspect mock data CLI command
 */

const fs = require('fs').promises;
const path = require('path');

async function dirExists(dirPath) {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

async function countRecords(filePath) {
  try {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(data) ? data.length : Object.keys(data).length;
  } catch {
    return null;
  }
}

async function listAll(sessionBase, sessionDir) {
  let found = false;

  console.log(`\nMock Data (Session: ${sessionDir})\n`);
  console.log('=====================================\n');

  // Repository
  const repoDir = path.join(sessionBase, 'repository');
  if (await dirExists(repoDir)) {
    const files = (await fs.readdir(repoDir)).filter((f) => f.endsWith('.json'));
    if (files.length > 0) {
      found = true;
      console.log('Repository Collections:');
      for (const file of files) {
        const count = await countRecords(path.join(repoDir, file));
        console.log(`  ${file.replace('.json', '').padEnd(30)} (${count} records)`);
      }
      console.log('');
    }
  }

  // Queue
  const queueDir = path.join(sessionBase, 'queue');
  if (await dirExists(queueDir)) {
    const entries = await fs.readdir(queueDir, { withFileTypes: true });
    const queues = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (queues.length > 0) {
      found = true;
      console.log('Queues:');
      for (const queue of queues) {
        const count = await countRecords(path.join(queueDir, queue, 'jobs.json'));
        console.log(`  ${queue.padEnd(30)} (${count !== null ? count : 0} jobs)`);
      }
      console.log('');
    }
  }

  // HTTP
  const httpDir = path.join(sessionBase, 'http');
  if (await dirExists(httpDir)) {
    const httpFiles = ['resources.json', 'states.json', 'history.json'];
    const existing = [];
    for (const f of httpFiles) {
      const count = await countRecords(path.join(httpDir, f));
      if (count !== null) existing.push({ name: f, count });
    }
    if (existing.length > 0) {
      found = true;
      console.log('HTTP:');
      for (const { name, count } of existing) {
        console.log(`  ${name.padEnd(30)} (${count} entries)`);
      }
      console.log('');
    }
  }

  // ClickHouse
  const chDir = path.join(sessionBase, 'clickhouse', 'runtime');
  if (await dirExists(chDir)) {
    const files = (await fs.readdir(chDir)).filter((f) => f.endsWith('.json'));
    if (files.length > 0) {
      found = true;
      console.log('ClickHouse Tables:');
      for (const file of files) {
        const count = await countRecords(path.join(chDir, file));
        console.log(`  ${file.replace('.json', '').padEnd(30)} (${count} rows)`);
      }
      console.log('');
    }
  }

  // TigerBeetle
  const tbDir = path.join(sessionBase, 'tigerbeetle');
  if (await dirExists(tbDir)) {
    const tbFiles = ['accounts.json', 'transfers.json', 'pending-transfers.json'];
    const existing = [];
    for (const f of tbFiles) {
      const count = await countRecords(path.join(tbDir, f));
      if (count !== null) existing.push({ name: f, count });
    }
    if (existing.length > 0) {
      found = true;
      console.log('TigerBeetle:');
      for (const { name, count } of existing) {
        console.log(`  ${name.padEnd(30)} (${count} records)`);
      }
      console.log('');
    }
  }

  if (!found) {
    console.log(`  No mock data found for session '${sessionDir}'.`);
    console.log(`  Run tests first to generate data.\n`);
    console.log(`  Expected directory: ${sessionBase}\n`);
  }

  console.log('=====================================\n');
  console.log('Usage: enmoq inspect [collection] [--session=name]\n');
}

async function viewCollection(sessionBase, name, sessionDir) {
  // Search order: repository, clickhouse, queue, http, tigerbeetle
  const candidates = [
    { filePath: path.join(sessionBase, 'repository', `${name}.json`), type: 'Repository' },
    { filePath: path.join(sessionBase, 'clickhouse', 'runtime', `${name}.json`), type: 'ClickHouse' },
    { filePath: path.join(sessionBase, 'queue', name, 'jobs.json'), type: 'Queue' },
    { filePath: path.join(sessionBase, 'http', `${name}.json`), type: 'HTTP' },
    { filePath: path.join(sessionBase, 'tigerbeetle', `${name}.json`), type: 'TigerBeetle' },
  ];

  for (const { filePath, type } of candidates) {
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;

      console.log(`\n${type}: ${name} (Session: ${sessionDir})\n`);
      console.log('=====================================\n');
      console.log(JSON.stringify(data, null, 2));
      console.log('\n=====================================\n');
      console.log(`Total records: ${count}\n`);
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Error reading ${filePath}:`, err.message);
      }
    }
  }

  console.log(`\n⚠️  '${name}' not found in any mock type.\n`);
  await listAll(sessionBase, sessionDir);
}

async function inspect(args = []) {
  let sessionDir = 'default';
  let collectionName = null;

  for (const arg of args) {
    if (arg.startsWith('--session=')) {
      sessionDir = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      collectionName = arg;
    }
  }

  const baseDir = process.env.MOCK_DATA_DIR || path.join(process.cwd(), '.mock-data');
  const sessionBase = path.join(baseDir, sessionDir);

  if (collectionName) {
    await viewCollection(sessionBase, collectionName, sessionDir);
  } else {
    await listAll(sessionBase, sessionDir);
  }
}

module.exports = inspect;
