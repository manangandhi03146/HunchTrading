import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { requireOptIn, outsideRepository, MINT, RESOLVER, TREASURY_TOKEN, json } from './core.mjs';

requireOptIn();
assert.equal(process.platform, 'linux', 'Run preparation in WSL2 Ubuntu; no private keys will be created on Windows');
const directory = resolve(process.env.HUNCH_VERIFY_KEY_DIR ?? join(homedir(), '.config/hunch/devnet-verification'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
outsideRepository(directory);
assert(!realpathSync(directory).startsWith('/mnt/'), 'Use Linux home storage');
assert.equal(statSync(directory).mode & 0o077, 0, 'Key directory must be owner-only');
const wallets = {};
// wx deliberately refuses to replace an existing key or an incomplete previous preparation.
for (const role of ['creator', 'A', 'B', 'C', 'game']) {
  const key = Keypair.generate();
  const path = join(directory, `${role}-keypair.json`);
  writeFileSync(path, json([...key.secretKey]), { mode: 0o600, flag: 'wx' });
  wallets[role] = { publicKey: key.publicKey.toBase58(), path,
    ...(role === 'game' ? { publicKeyBase64: key.publicKey.toBuffer().toString('base64') } : {}),
    ...(['A', 'B', 'C'].includes(role) ? { tokenAccount: getAssociatedTokenAddressSync(MINT, key.publicKey).toBase58(), initialTest: '1000' } : {}) };
}
const manifest = { wallets, resolver: { publicKey: RESOLVER, path: process.env.RESOLVER_KEYPAIR_PATH ?? join(homedir(), '.config/hunch/team-resolver-keypair.json') } };
const manifestPath = join(directory, 'manifest.json');
writeFileSync(manifestPath, json(manifest), { mode: 0o600, flag: 'wx' });
const commands = [];
for (const role of ['A', 'B', 'C']) {
  commands.push(`spl-token --url devnet --owner "$TEST_TREASURY_KEYPAIR" transfer ${MINT} 1000 ${wallets[role].publicKey} --from ${TREASURY_TOKEN} --fund-recipient --allow-unfunded-recipient`);
}
for (const entry of [wallets.creator, wallets.A, wallets.B, wallets.C, manifest.resolver]) {
  commands.push(`solana --url devnet --keypair "$SOL_OPERATOR_KEYPAIR" transfer ${entry.publicKey} 0.15 --allow-unfunded-recipient`);
  commands.push(`# Faucet alternative: solana --url devnet airdrop 1 ${entry.publicKey}`);
}
const fundingPath = join(directory, 'funding-request.txt');
writeFileSync(fundingPath, `Existing TEST transfers only; no minting. Authorized operator sets protected key paths locally.\n${commands.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
console.log(json({ manifestPath, publicRecipients: Object.fromEntries(Object.entries(wallets).map(([role, info]) => [role, info.publicKey])), resolver: RESOLVER, fundingPath, operatorCommands: commands }));
