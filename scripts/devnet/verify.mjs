import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { AnchorMarketAdapter } from '@hunch/sdk';
import { buildServer, ResolverStore, signGameEvent } from '@marketkit/resolver';
import { requireOptIn, preflight, chainClock, loadProtectedKey, wallet, Journal, PROGRAM, MINT, RESOLVER,
  RPC, connection, coder, snapshot, json, sleep } from './core.mjs';

requireOptIn();
const chain = await preflight();
assert.equal(chain.deploymentSlot, '509647737', 'Deployment changed since reviewed audit; coordinate before executing');
let observedClock = chain.chainClock.unixTimestamp;
// This deliberately fails on the current CONTRACT_UNAVAILABLE implementation before reading keys.
// Integrate the reviewed live implementation using its existing public constructor/interface.
const adapter = new AnchorMarketAdapter({ rpcUrl: RPC, programId: PROGRAM.toBase58() });
assert.equal(adapter.mode, 'anchor', 'Mock adapters are forbidden');
assert(process.env.HUNCH_VERIFY_MANIFEST, 'HUNCH_VERIFY_MANIFEST must reference the protected WSL manifest');
const manifest = JSON.parse(readFileSync(process.env.HUNCH_VERIFY_MANIFEST, 'utf8'));
const keys = Object.fromEntries(['creator', 'A', 'B', 'C', 'game'].map(role => {
  const key = loadProtectedKey(manifest.wallets[role].path);
  assert.equal(key.publicKey.toBase58(), manifest.wallets[role].publicKey, `${role} identity mismatch`);
  return [role, key];
}));
const resolverKey = loadProtectedKey(process.env.RESOLVER_KEYPAIR_PATH ?? manifest.resolver.path);
assert.equal(resolverKey.publicKey.toBase58(), RESOLVER, 'Must use the existing team resolver');
assert.equal(new Set([...Object.values(keys), resolverKey].map(key => key.publicKey.toBase58())).size, 6, 'All signer roles must be separate');
for (const key of [keys.creator, keys.A, keys.B, keys.C, resolverKey]) {
  assert(await connection.getBalance(key.publicKey) >= 100_000_000, `${key.publicKey} requires at least 0.1 Devnet SOL`);
}
for (const role of ['A', 'B', 'C']) {
  const account = await getAccount(connection, getAssociatedTokenAddressSync(MINT, keys[role].publicKey), 'confirmed', TOKEN_PROGRAM_ID);
  assert(account.mint.equals(MINT) && account.owner.equals(keys[role].publicKey));
  assert.equal(account.amount, 1000n, `${role} must start with exactly 1000 existing TEST`);
}

const runId = `hunch-${randomUUID()}`;
const appId = `${runId}-game`;
const eventId = `${runId}-result`;
const marketId = runId;
const directory = resolve('.data/devnet-lifecycle');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const journalPath = join(directory, `${runId}.json`);
const dbPath = join(directory, `${runId}.sqlite`);
assert(!existsSync(dbPath), 'Resolver database must be fresh');
const participants = {
  A: { publicKey: keys.A.publicKey.toBase58(), outcome: 1 },
  B: { publicKey: keys.B.publicKey.toBase58(), outcome: 0 },
  C: { publicKey: keys.C.publicKey.toBase58(), outcome: 1 },
};
const journal = new Journal(journalPath, { runId, appId, eventId, marketId, chain,
  creator: keys.creator.publicKey.toBase58(), resolver: RESOLVER, participants,
  gamePublicKeyBase64: keys.game.publicKey.toBuffer().toString('base64'),
  snapshots: [], conclusions: { currentDeploymentLifecycle: 'pending', localDeadlineFix: 'separate contract test report', onChainDeadlineEnforcement: 'requires approved upgrade' } });
const signers = Object.fromEntries(['creator', 'A', 'B', 'C'].map(role => [role, wallet(keys[role], journal)]));
const store = new ResolverStore(dbPath);
store.registerApp({ appId, publicKey: keys.game.publicKey.toBuffer().toString('base64'), enabled: true });
const server = buildServer({ adapter, signer: wallet(resolverKey, journal), store, clock: () => observedClock, logger: false });
let resolverUrl;
try {
  resolverUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  const health = await (await fetch(`${resolverUrl}/health`)).json();
  assert(health.ok && health.mode === 'anchor' && health.pendingEvents === 0, 'Real resolver health check failed');
  journal.data.resolverHealth = health; journal.save();
  observedClock = (await chainClock()).unixTimestamp;
  const deadline = observedClock + 300;
  journal.data.deadline = deadline; journal.data.deadlineObservedClock = observedClock; journal.save();
  const created = await journal.mutation('create', async () => {
    const result = await adapter.createMarket({ id: marketId, question: 'Deterministic signed hunch Devnet verification result',
      outcomes: ['Outcome 0', 'Outcome 1'], closesAt: deadline, resolverAuthority: RESOLVER }, signers.creator);
    assert.equal(result.market.id, marketId, 'SDK market identifier differs from requested ID; coordinate integration');
    return result.transaction;
  });
  // Discover the actual address from the confirmed transaction. Never guess the SDK's identifier encoding.
  const createTx = await connection.getTransaction(created.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  assert(createTx?.meta && !createTx.meta.err);
  const accountKeys = createTx.transaction.message.getAccountKeys({ accountKeysFromLookups: createTx.meta.loadedAddresses });
  const markets = [];
  for (let index = 0; index < accountKeys.length; index++) {
    const address = accountKeys.get(index);
    const account = await connection.getAccountInfo(address);
    if (!account?.owner.equals(PROGRAM)) continue;
    let state;
    try { state = coder.decode('Market', account.data); } catch { continue; }
    if (state.authority.equals(keys.creator.publicKey) && state.resolver.toBase58() === RESOLVER &&
        state.token_mint.equals(MINT) && state.deadline.toString() === String(deadline)) markets.push(address);
  }
  assert.equal(markets.length, 1, 'Cannot uniquely discover the created market');
  const marketAddress = markets[0].toBase58();
  journal.data.marketAddress = marketAddress; journal.save();
  const recordSnapshot = async (stage, options) => {
    const state = { stage, ...await snapshot(marketAddress, participants, options), chainClock: await chainClock() };
    journal.data.snapshots.push(state);
    const record = journal.data.stages.find(item => item.name === stage);
    if (record) record.snapshotSlot = state.slot;
    journal.save();
    return state;
  };
  await recordSnapshot('create', { allowMissingPositions: true, allowMissingVault: true });
  store.registerMarket({ marketId, appId, authority: keys.creator.publicKey.toBase58(), resolverAuthority: RESOLVER, eventId });
  journal.data.registration = store.getMarketMapping(marketId); journal.save();
  for (const [role, outcome, amount] of [['A', 1, 100n], ['C', 1, 200n], ['B', 0, 250n]]) {
    observedClock = (await chainClock()).unixTimestamp;
    assert(observedClock < deadline, 'Deadline elapsed before stakes completed; stop and reconcile');
    await journal.mutation(`stake-${role}`, async () => (await adapter.predict({ marketId, outcome, amount }, signers[role])).transaction);
    await recordSnapshot(`stake-${role}`, { allowMissingPositions: true });
  }
  const beforeClaims = await recordSnapshot('after-stakes');
  assert.deepEqual(beforeClaims.pools, ['250', '300']);
  assert.equal(beforeClaims.vaultBalance, 550n);
  assert.equal(beforeClaims.authority, keys.creator.publicKey.toBase58());
  assert.equal(beforeClaims.resolver, RESOLVER);
  assert.equal(beforeClaims.mint, MINT.toBase58());
  assert.equal(beforeClaims.winningOutcome, null);
  assert.equal(beforeClaims.status.toLowerCase(), 'active');
  for (const [role, amount, balance] of [['A', '100', 900n], ['C', '200', 800n], ['B', '250', 750n]]) {
    const position = beforeClaims.positions.find(p => p.label === role);
    assert.equal(position.amount, amount); assert.equal(position.tokenBalance, balance); assert.equal(position.claimed, false);
  }
  console.log(`Stakes confirmed. Waiting for chain deadline ${deadline}; journal: ${journalPath}`);
  const waitStarted = Date.now();
  let lastProgress = 0;
  do {
    observedClock = (await chainClock()).unixTimestamp;
    if (observedClock >= deadline) break;
    assert(Date.now() - waitStarted < 15 * 60_000, 'Chain deadline wait timed out; stop and reconcile');
    if (Date.now() - lastProgress >= 30_000) { console.log(`Chain clock ${observedClock}; ${deadline - observedClock}s until resolution`); lastProgress = Date.now(); }
    await sleep(3000);
  } while (true);
  const resolutionClock = await chainClock();
  assert(resolutionClock.unixTimestamp >= deadline, 'Chain clock moved back before the deadline');
  observedClock = resolutionClock.unixTimestamp;
  journal.data.resolutionObservedClock = resolutionClock; journal.save();
  const event = signGameEvent({ appId, eventId, marketId, outcome: 1, timestamp: observedClock }, keys.game.secretKey);
  journal.data.signedEvent = event; journal.save();
  let originalRecord;
  await journal.mutation('resolver-resolution', async () => {
    const response = await fetch(`${resolverUrl}/v1/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
    originalRecord = await response.json();
    journal.data.resolutionRecord = originalRecord; journal.save();
    assert(response.ok && originalRecord.mode === 'anchor' && !originalRecord.error, 'Signed event did not resolve successfully');
    return originalRecord.transaction;
  });
  const resolvedState = await recordSnapshot('resolver-resolution');
  assert.equal(resolvedState.winningOutcome, 1);
  assert.equal(resolvedState.status.toLowerCase(), 'resolved');
  assert.equal(resolvedState.vaultBalance, 550n);
  const replay = await fetch(`${resolverUrl}/v1/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  const replayRecord = await replay.json();
  assert(replay.ok); assert.deepEqual(replayRecord, originalRecord, 'Replay must return the original resolution record');
  journal.data.replay = { originalRecord, replayRecord, resolutionSignatures: journal.data.stages.find(s => s.name === 'resolver-resolution').signatures };
  const resolutionStage = journal.data.stages.find(s => s.name === 'resolver-resolution');
  assert(resolutionStage.confirmation.blockTime !== null && resolutionStage.confirmation.blockTime >= deadline, 'Resolution block timestamp does not establish after-deadline execution');
  assert.equal(new Set(resolutionStage.signatures).size, 1, 'Expected exactly one resolver transaction');
  journal.save();
  for (const [role, payout] of [['A', 183n], ['C', 366n]]) {
    await journal.mutation(`claim-${role}`, async () => {
      const result = await adapter.claimWinnings(marketId, signers[role]);
      assert.equal(result.payout, payout, 'SDK payout differs from expected integer payout');
      return result.transaction;
    });
    await recordSnapshot(`claim-${role}`);
  }
  const finalState = await recordSnapshot('final');
  assert.deepEqual(finalState.pools, ['250', '300']);
  assert.equal(finalState.vaultBalance, 1n);
  for (const [role, balance, claimed] of [['A', 1083n, true], ['C', 1166n, true], ['B', 750n, false]]) {
    const position = finalState.positions.find(p => p.label === role);
    assert.equal(position.tokenBalance, balance); assert.equal(position.claimed, claimed);
  }
  assert.equal(finalState.positions.reduce((total, p) => total + p.tokenBalance, finalState.vaultBalance), 3000n);
  journal.data.complete = true; journal.data.conclusions.currentDeploymentLifecycle = 'verified'; journal.save();
  const evidenceDirectory = resolve('docs/evidence/devnet');
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidencePath = join(evidenceDirectory, `${runId}.json`);
  writeFileSync(evidencePath, json(journal.data), { flag: 'wx' });
  console.log(`Verified lifecycle. Public evidence: ${evidencePath}`);
} catch (error) {
  journal.data.stoppedAt = new Date().toISOString(); journal.data.reconciliationRequired = true; journal.save();
  throw error;
} finally {
  await server.close(); store.close();
}
