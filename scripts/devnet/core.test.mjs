import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { Journal, wallet, requireReceipt, connection, preflight } from './core.mjs';

test('mock and failed receipts cannot count as real Devnet evidence', () => {
  for (const receipt of [{ mode: 'mock', signature: null, status: 'confirmed' },
    { mode: 'anchor', signature: 'fake', status: 'confirmed' },
    { mode: 'anchor', signature: '1'.repeat(88), status: 'failed' }]) {
    assert.throws(() => requireReceipt(receipt));
  }
});

test('wrong genesis prevents all subsequent account checks', async () => {
  const original = connection.getGenesisHash;
  connection.getGenesisHash = async () => 'wrong-cluster';
  try { await assert.rejects(preflight(), /not Solana Devnet/); }
  finally { connection.getGenesisHash = original; }
});

test('signature is flushed before SDK can broadcast; uncertain mutation never retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hunch-journal-'));
  try {
    const path = join(directory, 'run.json');
    const journal = new Journal(path, { runId: 'unit-test' });
    assert.throws(() => new Journal(path, {}), /EEXIST/);
    const key = Keypair.generate();
    const signer = wallet(key, journal);
    let calls = 0;
    await assert.rejects(journal.mutation('stake', async () => {
      calls++;
      assert.equal(JSON.parse(readFileSync(path)).stages[0].state, 'pending');
      const tx = new Transaction({ feePayer: key.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() });
      tx.add(SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
      await signer.signTransaction(tx);
      assert.equal(JSON.parse(readFileSync(path)).stages[0].signatures.length, 1);
      throw new Error('simulated network loss after signing');
    }), /Stop; inspect/);
    assert.equal(calls, 1);
    const disk = JSON.parse(readFileSync(path));
    assert.equal(disk.stages[0].state, 'reconcile-required');
    assert.equal(disk.stages[0].signatures.length, 1);
    assert.equal(disk.complete, false);
    assert(!readFileSync(path, 'utf8').includes('secretKey'));
  } finally { rmSync(directory, { recursive: true }); }
});
