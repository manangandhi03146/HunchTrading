import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
assert.equal(process.platform, 'linux', 'Run contract tests in WSL2 Ubuntu. This command never deploys.');
const checks = [['rustc', ['--version'], '1.89.0'], ['anchor', ['--version'], '1.1.2'], ['solana', ['--version'], '4.1.2']];
const versions = {};
for (const [command, args, version] of checks) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} missing`);
  versions[command] = result.stdout.trim();
  assert(versions[command].includes(version), `${command} must match pinned version ${version}`);
}
const sbf = spawnSync('cargo-build-sbf', ['--version'], { encoding: 'utf8' });
assert.equal(sbf.status, 0, 'SBF builder unavailable');
versions.sbf = sbf.stdout.trim(); versions.node = process.version;
const bootstrap = spawnSync('rustup', ['run', '1.91.0', 'rustc', '--version'], { encoding: 'utf8' });
versions.avmBootstrapRust = bootstrap.status === 0 ? bootstrap.stdout.trim() : 'not recorded';
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24 LTS');
mkdirSync('.data/devnet-lifecycle', { recursive: true });
const report = { observedAt: new Date().toISOString(), versions, commands: [], passed: false };
const path = '.data/devnet-lifecycle/contract-tests.json';
// Build-only keys may differ from the deployed ID. Never synchronize IDs or deploy.
for (const [command, args] of [['anchor', ['build', '--ignore-keys']], ['cargo', ['test', '-p', 'marketkit', ...process.argv.slice(2)] ]]) {
  console.log(`${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  report.commands.push({ command, args, exitCode: result.status });
  writeFileSync(path, JSON.stringify(report, null, 2));
  if (result.status !== 0) process.exit(result.status ?? 1);
}
report.passed = true; writeFileSync(path, JSON.stringify(report, null, 2));
