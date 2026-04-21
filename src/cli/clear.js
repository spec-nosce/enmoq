/**
 * Clear mock data CLI command
 */

const fs = require('fs');
const path = require('path');

async function clear(args = []) {
  const mockDataDir = path.join(process.cwd(), '.mock-data');

  // Parse --session flag
  const sessionArg = args.find((a) => a.startsWith('--session='));
  const sessionName = sessionArg ? sessionArg.split('=')[1] : null;

  if (!fs.existsSync(mockDataDir)) {
    console.log('No mock data directory found (.mock-data/)');
    return;
  }

  if (sessionName) {
    // Clear specific session
    const sessionPath = path.join(mockDataDir, sessionName);

    if (!fs.existsSync(sessionPath)) {
      console.log(`Session '${sessionName}' not found`);
      return;
    }

    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log(`Cleared session: ${sessionName}`);
  } else {
    // Clear all sessions
    const entries = fs.readdirSync(mockDataDir, { withFileTypes: true });
    const sessions = entries.filter((e) => e.isDirectory());

    if (sessions.length === 0) {
      console.log('No sessions to clear');
      return;
    }

    sessions.forEach((session) => {
      const sessionPath = path.join(mockDataDir, session.name);
      fs.rmSync(sessionPath, { recursive: true, force: true });
    });

    console.log(`Cleared ${sessions.length} session(s)`);
  }
}

module.exports = clear;
