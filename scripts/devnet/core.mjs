import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, statSync, realpathSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { Connection, PublicKey, Keypair, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getMint, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import anchor from '@coral-xyz/anchor';

export const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const PROGRAM = new PublicKey('J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP');
export const MINT = new PublicKey('9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs');
export const RESOLVER = '6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt';
export const TREASURY_OWNER = 'FndLN9xiWLBa2CMMjRA4X5DwU5VZwQzaTuoF43kuMM6D';
export const TREASURY_TOKEN = new PublicKey('7mRZVNDvywk9DHtbvEsBP2KMGdPKLQW383RWt2k9p1VM');
export const connection = new Connection(RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true });
export const idl = JSON.parse(readFileSync(new URL('../../packages/sdk/src/idl/marketkit.json', import.meta.url), 'utf8'));
export const coder = new anchor.BorshAccountsCoder(idl);
export const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
export const explorer = signature => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export const sleep = ms => new Promise(done => setTimeout(done, ms));

export function readSafeJSON(path) {
  // Native JSON errors can echo malformed private-file contents into a stack trace.
  const contents = readFileSync(path, 'utf8');
  try { return JSON.parse(contents); }
  catch { throw new Error('Invalid JSON file; contents suppressed to protect key material'); }
}

export async function chainClock() {
  const account = await connection.getAccountInfoAndContext(SYSVAR_CLOCK_PUBKEY);
  assert(account.value && account.value.data.length >= 40, 'Clock sysvar unavailable');
  return { unixTimestamp: Number(account.value.data.readBigInt64LE(32)), slot: account.context.slot };
}

export async function preflight() {
  assert.equal(await connection.getGenesisHash(), GENESIS, 'RPC is not Solana Devnet');
  const program = await connection.getAccountInfo(PROGRAM);
  assert(program?.executable, 'Program is absent or not executable');
  assert.equal(program.owner.toBase58(), 'BPFLoaderUpgradeab1e11111111111111111111111');
  assert.equal(program.data.readUInt32LE(0), 2);
  const programDataAddress = new PublicKey(program.data.subarray(4, 36));
  const programData = await connection.getAccountInfo(programDataAddress);
  assert(programData && programData.owner.equals(program.owner));
  assert.equal(programData.data.readUInt32LE(0), 3);
  const mint = await getMint(connection, MINT, 'confirmed', TOKEN_PROGRAM_ID);
  assert.equal(mint.decimals, 0, 'TEST must have zero decimals');
  assert(mint.isInitialized, 'Mint is not initialized');
  const treasury = await getAccount(connection, TREASURY_TOKEN, 'confirmed', TOKEN_PROGRAM_ID);
  assert(treasury.mint.equals(MINT) && treasury.owner.toBase58() === TREASURY_OWNER);
  return { observedAt: new Date().toISOString(), rpc: new URL(RPC).origin, genesisHash: GENESIS,
    program: PROGRAM.toBase58(), programData: programDataAddress.toBase58(),
    deploymentSlot: programData.data.readBigUInt64LE(4).toString(),
    upgradeAuthority: programData.data[12] ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null,
    mint: MINT.toBase58(), decimals: mint.decimals, tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    mintSupply: mint.supply, treasuryOwner: TREASURY_OWNER, treasuryTokenAccount: TREASURY_TOKEN.toBase58(),
    treasuryBalance: treasury.amount, resolver: RESOLVER, resolverLamports: await connection.getBalance(new PublicKey(RESOLVER)),
    chainClock: await chainClock() };
}

export function requireOptIn() {
  assert(process.argv.includes('--devnet'), 'Explicit --devnet flag required; ordinary tests never broadcast');
}

export function outsideRepository(path) {
  const root = realpathSync(new URL('../../', import.meta.url));
  const rel = relative(root, realpathSync(path));
  assert(isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'), 'Keys must be outside the repository');
}

export function loadProtectedKey(path) {
  assert.equal(process.platform, 'linux', 'Provision private keys in WSL/Linux, not on Windows or a mounted Windows volume');
  const absolute = resolve(path);
  assert(!realpathSync(absolute).startsWith('/mnt/'), 'Keys must live in the Linux filesystem');
  outsideRepository(absolute);
  const metadata = statSync(absolute);
  assert(metadata.isFile() && (metadata.mode & 0o077) === 0 && metadata.uid === process.getuid(), 'Key requires owner-only permissions and current-user ownership');
  const bytes = readSafeJSON(absolute);
  assert(Array.isArray(bytes) && bytes.length === 64 && bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255), 'Invalid protected key file');
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function requireReceipt(receipt) {
  assert.equal(receipt?.mode, 'anchor', 'Mock receipt rejected');
  assert(typeof receipt.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt.signature), 'Real transaction signature required');
  assert.notEqual(receipt.status, 'failed', 'SDK reports failed transaction');
  return receipt.signature;
}

export class Journal {
  constructor(path, initial) {
    this.path = path;
    this.data = { ...initial, stages: [], complete: false };
    writeFileSync(path, json(this.data), { flag: 'wx', mode: 0o600 });
  }
  save() {
    // Flush before invoking SDK/network mutations. File is private local recovery data.
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, json(this.data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.path);
    if (process.platform === 'linux') {
      const directory = openSync(dirname(this.path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
  async mutation(name, fn) {
    const stage = { name, state: 'pending', startedAt: new Date().toISOString(), signatures: [] };
    this.data.stages.push(stage); this.active = stage; this.save();
    try {
      const receipt = await fn();
      const signature = requireReceipt(receipt);
      assert(stage.signatures.includes(signature), 'Receipt was not signed in this journal stage; stale or substituted receipts are forbidden');
      this.save();
      stage.confirmation = await confirmedTransaction(signature);
      stage.state = 'confirmed'; this.save(); return receipt;
    } catch (error) {
      if (typeof error?.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code)) stage.errorCode = error.code;
      stage.state = 'reconcile-required'; this.save();
      throw new Error(`${name} did not verify. Stop; inspect ${this.path} with devnet:reconcile before any retry.`);
    } finally { this.active = undefined; }
  }
  signed(transaction) {
    assert(this.active, 'Refusing to sign outside a journaled lifecycle stage');
    const bytes = transaction.version !== undefined ? transaction.signatures[0] : transaction.signature;
    assert(bytes && bytes.some(b => b !== 0), 'Fee-payer signature must be present before broadcast');
    const signature = anchor.utils.bytes.bs58.encode(bytes);
    this.active.signatures.push(signature);
    this.active.signedTransactions ??= [];
    this.active.signedTransactions.push({ signature,
      blockhash: transaction.recentBlockhash ?? transaction.message?.recentBlockhash ?? null,
      lastValidBlockHeight: Number.isSafeInteger(transaction.lastValidBlockHeight) ? transaction.lastValidBlockHeight : null });
    this.save();
  }
}

export function wallet(keypair, journal) {
  return { publicKey: keypair.publicKey, async signTransaction(transaction) {
    if (transaction.version !== undefined) transaction.sign([keypair]);
    else transaction.partialSign(keypair);
    journal.signed(transaction);
    return transaction;
  } };
}

export async function confirmedTransaction(signature) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (tx) {
      assert(tx.meta && tx.meta.err === null, `Transaction failed: ${signature}`);
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      assert(tx.transaction.message.compiledInstructions.some(ix => keys.get(ix.programIdIndex)?.equals(PROGRAM)), 'Transaction does not invoke hunch program');
      const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      assert(statuses.value[0] && !statuses.value[0].err);
      assert(['confirmed', 'finalized'].includes(statuses.value[0].confirmationStatus));
      return { signature, explorer: explorer(signature), slot: tx.slot, blockTime: tx.blockTime,
        status: statuses.value[0].confirmationStatus, feeLamports: tx.meta.fee };
    }
    await sleep(2000);
  }
  throw new Error('Transaction confirmation uncertain');
}

export async function decodedMarket(address) {
  const key = new PublicKey(address);
  const account = await connection.getAccountInfoAndContext(key);
  assert(account.value?.owner.equals(PROGRAM), 'Market account is not owned by deployed program');
  const raw = coder.decode('Market', account.value.data);
  const expected = PublicKey.findProgramAddressSync([Buffer.from('market'), raw.authority.toBuffer(), Buffer.from(raw.market_id)], PROGRAM)[0];
  assert(expected.equals(key), 'Market PDA does not match decoded state');
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), key.toBuffer()], PROGRAM)[0];
  return { key, raw, vault, slot: account.context.slot };
}

export async function snapshot(marketAddress, participants, { allowMissingPositions = false, allowMissingVault = false } = {}) {
  const { key, raw, vault, slot } = await decodedMarket(marketAddress);
  const vaultAccount = await connection.getAccountInfo(vault);
  assert(vaultAccount || allowMissingVault, 'Expected escrow account does not exist');
  const escrow = vaultAccount ? await getAccount(connection, vault, 'confirmed', TOKEN_PROGRAM_ID) : null;
  if (escrow) assert(escrow.owner.equals(key) && escrow.mint.equals(MINT), 'Escrow authority/mint mismatch');
  const positions = [];
  for (const [label, info] of Object.entries(participants)) {
    const owner = new PublicKey(info.publicKey);
    const address = PublicKey.findProgramAddressSync([Buffer.from('position'), key.toBuffer(), owner.toBuffer(), Buffer.from([info.outcome])], PROGRAM)[0];
    const account = await connection.getAccountInfo(address);
    assert(account || allowMissingPositions, 'Expected position does not exist');
    if (account) assert(account.owner.equals(PROGRAM), 'Position owner mismatch');
    const state = account ? coder.decode('Position', account.data) : null;
    if (state) assert(state.market.equals(key) && state.wallet.equals(owner) && state.outcome === info.outcome, 'Position identity mismatch');
    const ata = getAssociatedTokenAddressSync(MINT, owner);
    const token = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID);
    assert(token.owner.equals(owner) && token.mint.equals(MINT));
    positions.push({ label, publicKey: owner.toBase58(), tokenAccount: ata.toBase58(), tokenBalance: token.amount,
      positionAddress: address.toBase58(), positionExists: Boolean(state), amount: state?.amount.toString() ?? null,
      outcome: state?.outcome ?? null, claimed: state?.claimed ?? null,
      solLamports: await connection.getBalance(owner) });
  }
  return { observedAt: new Date().toISOString(), slot, marketAddress: key.toBase58(), authority: raw.authority.toBase58(),
    resolver: raw.resolver.toBase58(), mint: raw.token_mint.toBase58(), deadline: raw.deadline.toString(),
    pools: raw.pool.map(n => n.toString()), winningOutcome: raw.winning_outcome, status: Object.keys(raw.status)[0],
    vault: vault.toBase58(), vaultExists: Boolean(escrow), vaultBalance: escrow?.amount ?? null, positions };
}
