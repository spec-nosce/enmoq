/**
 * List mock sessions CLI command
 */

const fs = require('fs');
const path = require('path');

async function listSessions(args = []) {
  const mockDataDir = path.join(process.cwd(), '.mock-data');

  if (!fs.existsSync(mockDataDir)) {
    console.log('No mock data directory found (.mock-data/)');
    return;
  }

  const entries = fs.readdirSync(mockDataDir, { withFileTypes: true });
  const sessions = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (sessions.length === 0) {
    console.log('No sessions found');
    return;
  }

  console.log(`\nFound ${sessions.length} session(s):\n`);

  sessions.forEach((sessionName) => {
    const sessionPath = path.join(mockDataDir, sessionName);
    const stats = fs.statSync(sessionPath);

    console.log(`  ${sessionName}`);
    console.log(`    Created: ${stats.birthtime.toISOString()}`);
    console.log(`    Modified: ${stats.mtime.toISOString()}`);

    // Count collections
    const items = countItems(sessionPath);
    if (items > 0) {
      console.log(`    Items: ${items}`);
    }
    console.log('');
  });
}

function countItems(sessionPath) {
  let count = 0;

  // Repository
  const repoPath = path.join(sessionPath, 'repository');
  if (fs.existsSync(repoPath)) {
    count += fs.readdirSync(repoPath).filter((f) => f.endsWith('.json')).length;
  }

  // Queue (each subdirectory is a named queue)
  const queuePath = path.join(sessionPath, 'queue');
  if (fs.existsSync(queuePath)) {
    count += fs.readdirSync(queuePath, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  }

  // HTTP
  const httpPath = path.join(sessionPath, 'http');
  if (fs.existsSync(httpPath)) {
    count += fs.readdirSync(httpPath).filter((f) => f.endsWith('.json')).length;
  }

  // ClickHouse
  const chPath = path.join(sessionPath, 'clickhouse', 'runtime');
  if (fs.existsSync(chPath)) {
    count += fs.readdirSync(chPath).filter((f) => f.endsWith('.json')).length;
  }

  // TigerBeetle
  const tbPath = path.join(sessionPath, 'tigerbeetle');
  if (fs.existsSync(tbPath)) {
    count += fs.readdirSync(tbPath).filter((f) => f.endsWith('.json')).length;
  }

  return count;
}

module.exports = listSessions;
