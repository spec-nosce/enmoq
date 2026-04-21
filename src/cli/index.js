#!/usr/bin/env node

/**
 * enmoq CLI
 *
 * Commands:
 * - enmoq inspect [collection] [--session=name]
 * - enmoq sessions
 * - enmoq clear [--session=name]
 */

const commands = {
  inspect: require('./inspect'),
  sessions: require('./list-sessions'),
  clear: require('./clear'),
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`
enmoq CLI

Usage:
  enmoq <command> [options]

Commands:
  inspect [collection]    Inspect mock data (optionally filter by collection)
  sessions                List all mock sessions
  clear                   Clear mock data

Options:
  --session=<name>        Target specific session (default: all)
  --help, -h              Show this help message

Examples:
  enmoq inspect
  enmoq inspect users --session=test-123
  enmoq sessions
  enmoq clear --session=old-session
  `);
  process.exit(0);
}

if (commands[command]) {
  commands[command](args.slice(1))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "enmoq --help" for usage information');
  process.exit(1);
}
