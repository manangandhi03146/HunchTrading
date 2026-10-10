import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Journal, wallet, requireReceipt, connection, preflight, confirmedTransaction, PROGRAM } from './core.mjs';

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

test('a confirmed signature must invoke hunch, not merely list its program as an account', async () => {
  const originalGet = connection.getTransaction;
  const originalStatuses = connection.getSignatureStatuses;
  const payer = Keypair.generate().publicKey;
  const tx = new Transaction({ feePayer: payer, recentBlockhash: Keypair.generate().publicKey.toBase58() });
  tx.add(new TransactionInstruction({ programId: SystemProgram.programId, keys: [{ pubkey: PROGRAM, isWritable: false, isSigner: false }], data: Buffer.alloc(0) }));
  connection.getTransaction = async () => ({ slot: 123, blockTime: 456, meta: { err: null, fee: 5000 }, transaction: { message: tx.compileMessage() } });
  connection.getSignatureStatuses = async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
  try {
    await assert.rejects(confirmedTransaction('public-fixture'), /does not invoke hunch/);
    tx.instructions[0] = new TransactionInstruction({ programId: PROGRAM, keys: [], data: Buffer.alloc(0) });
    const receipt = await confirmedTransaction('public-fixture');
    assert.equal(receipt.slot, 123); assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.feeLamports, 5000);
  } finally { connection.getTransaction = originalGet; connection.getSignatureStatuses = originalStatuses; }
});
