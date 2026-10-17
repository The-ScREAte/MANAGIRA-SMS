const { spawn } = require('node:child_process');

// Lovable supplies port 8080; normal local development keeps both app servers.
const args = process.argv.slice(2).filter(arg => arg !== '--');
const portIndex = args.indexOf('--port');
const isPreview = portIndex >= 0 && args[portIndex + 1] === '8080';
const child = isPreview
  ? spawn('node', ['node_modules/vite/bin/vite.js', ...args], { stdio: 'inherit' })
  : spawn('npm', ['run', 'dev:app'], { stdio: 'inherit' });

child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}