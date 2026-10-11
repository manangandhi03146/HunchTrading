import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import type { VersionedTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { HUNCH_DEVNET_GENESIS_HASH, HunchError } from "@hunch/sdk";
import type { AnchorMarketAdapter, WalletSigner } from "@hunch/sdk";
import { verifiedSettlement } from "./server.js";
import type { EventRecord, ResolverStore } from "./store.js";

/** Repository root; resolver key files must live outside it so they can never be committed. */
export const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/**
 * Loads the resolver's Solana keypair from a server-side file outside Git.
 * Errors never include file contents. The secret stays in this closure.
 */
export function loadResolverSigner(path: string | undefined, options: { expectedPublicKey: string; repositoryRoot?: string }): WalletSigner {
  if (!path) throw new HunchError("CONFIGURATION_ERROR", "Real mode requires RESOLVER_KEYPAIR_PATH pointing to a server-side keypair file");
  const expanded = path === "~" || path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) throw new HunchError("CONFIGURATION_ERROR", "RESOLVER_KEYPAIR_PATH must be absolute (or start with ~/)");
  let real: string;
  try { real = realpathSync(expanded); }
  catch { throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair file does not exist or is unreadable"); }
  const root = realpathSync(options.repositoryRoot ?? REPOSITORY_ROOT);
  if (inside(root, real)) throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair must be stored outside the repository");
  const stat = statSync(real);
  if (!stat.isFile()) throw new HunchError("CONFIGURATION_ERROR", "RESOLVER_KEYPAIR_PATH must name a regular file");
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair file must not be readable by group or others (chmod 600)");
  }
  let keypair: Keypair;
  try {
    const bytes: unknown = JSON.parse(readFileSync(real, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch { throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair file is not a valid 64-byte Solana keypair"); }
  let expected: PublicKey;
  try { expected = new PublicKey(options.expectedPublicKey); }
  catch { throw new HunchError("CONFIGURATION_ERROR", "Expected resolver public key is invalid"); }
  if (!keypair.publicKey.equals(expected)) {
    throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair does not match the configured resolver authority", {
      expected: expected.toBase58(), actual: keypair.publicKey.toBase58(),
    });
  }
  const publicKey = keypair.publicKey;
  return Object.freeze({
    publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      if (transaction instanceof Transaction) transaction.partialSign(keypair); else transaction.sign([keypair]);
      return transaction;
    },
    toJSON: () => ({ publicKey: publicKey.toBase58() }),
  });
}

export interface RealModeStatus { resolver: string; resolverLamports: number; programId: string; tokenMint: string }

/** Read-only startup checks: Devnet genesis, deployed program, classic SPL mint, resolver balance. */
export async function validateRealMode(adapter: AnchorMarketAdapter, signer: WalletSigner, tokenMint: string): Promise<RealModeStatus> {
  const connection = adapter.connection, mint = new PublicKey(tokenMint);
  try {
    if (await connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Real resolver mode is restricted to Solana Devnet");
    const [program, mintAccount] = await connection.getMultipleAccountsInfo([adapter.programId, mint], "confirmed");
    if (!program?.executable) throw new HunchError("CONFIGURATION_ERROR", "Configured Hunch program is not deployed on this cluster");
    try {
      const decoded = unpackMint(mint, mintAccount, TOKEN_PROGRAM_ID);
      if (!decoded.isInitialized) throw new Error();
    } catch { throw new HunchError("CONFIGURATION_ERROR", "Configured token mint is not an initialized classic SPL mint"); }
    const resolverLamports = await connection.getBalance(signer.publicKey, "confirmed");
    return { resolver: signer.publicKey.toBase58(), resolverLamports, programId: adapter.programId.toBase58(), tokenMint: mint.toBase58() };
  } catch (cause) {
    if (cause instanceof HunchError) throw cause;
    throw new HunchError("NETWORK_ERROR", "Devnet RPC is unavailable; real resolver mode cannot start", undefined, { cause });
  }
}

export interface ReconcileResult {
  eventId: string;
  action: "confirmed" | "failed" | "pending" | "unchanged" | "released";
  retryable: boolean;
  record: EventRecord | null;
}

/**
 * Read-only reconciliation from on-chain truth. Never signs or resubmits. With `release`, a
 * definitively failed event whose market is still unresolved is removed so the application can
 * sign a fresh event; anything that may still land is never released.
 */
export async function reconcileEvent(options: {
  store: ResolverStore; adapter: AnchorMarketAdapter; eventId: string; now: number; release?: boolean;
}): Promise<ReconcileResult> {
  const { store, adapter, eventId, now } = options;
  const record = store.getEvent(eventId);
  if (!record) throw new HunchError("INVALID_INPUT", "Event not found");
  if (record.mode !== "anchor") throw new HunchError("INVALID_INPUT", "Only real-mode events can be reconciled");
  const result = (action: ReconcileResult["action"], retryable: boolean, updated: EventRecord | null = store.getEvent(eventId)): ReconcileResult =>
    ({ eventId, action, retryable, record: updated });
  if (record.status === "confirmed") return result("unchanged", false);
  const market = await adapter.getMarket(record.marketId);
  const signature = record.transaction?.signature ?? null;
  const chainStatus = signature ? (await adapter.getTransactionStatus(signature)).status : null;

  if (market?.status === "resolved") {
    const settlement = verifiedSettlement(market, record.outcome, now, chainStatus === "confirmed" ? "transaction" : "market-state");
    if (settlement) {
      const transaction = signature && chainStatus === "confirmed" ? { mode: "anchor" as const, id: signature, signature, status: "confirmed" as const } : record.transaction;
      return result("confirmed", false, store.updateEvent(eventId, record.status, "confirmed", now, transaction, null, settlement));
    }
    const error = { code: "OUTCOME_CONFLICT", message: "Market was resolved with a different outcome" };
    return result("failed", false, record.status === "failed" ? record : store.updateEvent(eventId, record.status, "failed", now, record.transaction, error));
  }

  // The market is unresolved. Decide whether anything recorded could still land.
  let definitive: { code: string; message: string } | null = null;
  if (!signature) {
    // Signatures are persisted before broadcast, so no signature means nothing was sent.
    definitive = record.status === "failed" ? record.error : { code: "INTERRUPTED_BEFORE_SUBMISSION", message: "Resolution stopped before any transaction was signed" };
  } else if (chainStatus === "failed") {
    definitive = { code: "TRANSACTION_FAILED", message: "Recorded resolution transaction failed on-chain" };
  }
  // A missing RPC/history result plus an expired blockhash cannot establish that the
  // transaction never landed. Retain its reservation for operator reconciliation.
  if (!definitive) return result("pending", false);
  const failed = record.status === "failed" ? record : store.updateEvent(eventId, record.status, "failed", now,
    signature ? { mode: "anchor", id: signature, signature, status: "failed" } : null, definitive);
  const retryable = market !== null && market.status !== "cancelled";
  if (options.release && retryable) {
    store.releaseFailedEvent(eventId);
    return result("released", true, null);
  }
  return result("failed", retryable, failed);
}
