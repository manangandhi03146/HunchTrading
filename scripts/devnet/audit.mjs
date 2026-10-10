import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
import { preflight, connection, chainClock, PROGRAM, MINT, RESOLVER, TREASURY_OWNER, idl, json } from './core.mjs';

const report = await preflight();
if (process.argv.includes('--simulate-deadline')) {
  const marketId = randomBytes(32);
  const authority = new PublicKey(TREASURY_OWNER);
  const resolver = new PublicKey(RESOLVER);
  const market = PublicKey.findProgramAddressSync([Buffer.from('market'), authority.toBuffer(), marketId], PROGRAM)[0];
  const clock = await chainClock();
  const deadline = clock.unixTimestamp + 600;
  const instructionCoder = new anchor.BorshInstructionCoder(idl);
  const create = new TransactionInstruction({ programId: PROGRAM,
    keys: [{ pubkey: authority, isSigner: true, isWritable: true }, { pubkey: market, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
    data: instructionCoder.encode('create_market', { market_id: [...marketId], deadline: new anchor.BN(deadline), resolver, token_mint: MINT }) });
  const resolve = new TransactionInstruction({ programId: PROGRAM,
    keys: [{ pubkey: resolver, isSigner: true, isWritable: false }, { pubkey: market, isSigner: false, isWritable: true }],
    data: instructionCoder.encode('resolve_market', { winning_outcome: 1 }) });
  const latest = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: authority, recentBlockhash: latest.blockhash, instructions: [create, resolve] }).compileToLegacyMessage();
  const result = await connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  report.deadlineSimulation = { broadcast: false, signed: false, transactionSignature: null,
    simulatedMarket: market.toBase58(), simulatedMarketIdHex: marketId.toString('hex'), observedClock: clock,
    proposedDeadline: deadline, simulationSlot: result.context.slot, error: result.value.err, logs: result.value.logs,
    earlyResolutionAccepted: result.value.err === null && result.value.logs?.some(line => line.includes('Market resolved:')),
    explanation: 'Unsigned create + early resolve in one RPC simulation. No real market or transaction was submitted.' };
}
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) writeFileSync(process.argv[outputIndex + 1], json(report), { flag: 'wx' });
console.log(json(report));
