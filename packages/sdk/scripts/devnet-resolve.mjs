import { parseArgs } from "node:util";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import {
  Hunch, HunchError, HUNCH_PROGRAM_ID, HUNCH_DEVNET_RPC_URL, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER,
} from "../dist/index.js";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111";
const MIN_FEE_LAMPORTS = 5000;
const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item instanceof Uint8Array ? undefined : item, 2);

// Operator tool for a first real settlement. Preview reads only public accounts. The resolver key is
// read ONLY with explicit authorization, from a private file outside the repository, and only once the
// preview shows the market is eligible. Resolution is irreversible and is never retried automatically.
// Production settlement should go through the signed-event resolver service instead.
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    "authorize-devnet-resolution": { type: "boolean", default: false },
    market: { type: "string" }, outcome: { type: "string" }, keypair: { type: "string" }, rpc: { type: "string" },
  } });
  if (!values.market || !["0", "1"].includes(values.outcome ?? "")) {
    throw new Error("Requires --market MARKET_PDA --outcome 0|1; preview is read-only. Signing requires --authorize-devnet-resolution and --keypair PATH.");
  }
  const outcome = Number(values.outcome);
  let marketAddress;
  try { marketAddress = new PublicKey(values.market); } catch { throw new Error("Market must be a valid public address"); }
  if (values["authorize-devnet-resolution"] && !values.keypair) throw new Error("Explicit resolution authorization requires --keypair PATH; no default key file is used");
  const connection = new Connection(values.rpc ?? process.env.SOLANA_RPC_URL ?? HUNCH_DEVNET_RPC_URL, "confirmed");
  if (await connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Resolution script requires Solana Devnet");
  const reader = new Hunch({ mode: "anchor", connection });
  const market = await reader.getMarket(marketAddress.toBase58());
  if (!market) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist");
  if (market.tokenMint !== HUNCH_DEVNET_TOKEN_MINT || market.resolverAuthority !== HUNCH_DEVNET_RESOLVER) {
    throw new HunchError("CONFIGURATION_ERROR", "Market must use the approved TEST mint and resolver");
  }
  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  if (!clock || clock.owner.toBase58() !== SYSVAR_OWNER || clock.data.length < 40) throw new HunchError("INVALID_RESPONSE", "Clock sysvar is unavailable");
  const clusterTime = Number(Buffer.from(clock.data).readBigInt64LE(32));
  const resolverLamports = await connection.getBalance(new PublicKey(market.resolverAuthority), "confirmed");
  const deadlinePassed = market.status === "closed" && clusterTime >= market.closesAt;
  const eligible = deadlinePassed && resolverLamports >= MIN_FEE_LAMPORTS;
  const prerequisites = market.status === "resolved" ? `Market already resolved with outcome ${market.winningOutcome}; nothing to do`
    : market.status === "cancelled" ? "Market was cancelled; it cannot be resolved"
    : !deadlinePassed ? `Deadline ${new Date(market.closesAt * 1000).toISOString()} has not passed on the cluster clock; the SDK refuses early resolution`
    : resolverLamports < MIN_FEE_LAMPORTS ? `Resolver ${market.resolverAuthority} needs Devnet SOL for the transaction fee`
    : "Eligible; the SDK re-checks network, market, clocks, and fees before requesting a signature";
  console.log(json({
    phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID, marketId: market.id,
    marketStatus: market.status, winningOutcome: market.winningOutcome, requestedOutcome: outcome,
    closesAt: market.closesAt, closesAtIso: new Date(market.closesAt * 1000).toISOString(), clusterTime,
    pools: market.pools, totalPool: market.totalPool, tokenMint: market.tokenMint, resolver: market.resolverAuthority,
    authority: market.authority, resolverLamports, eligible, prerequisites,
    warning: "Resolution is irreversible and decides every payout. Prefer the signed-event resolver for production settlement.",
  }));
  if (!values["authorize-devnet-resolution"]) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const command = ["npm run resolve:devnet --workspace @hunch/sdk -- --authorize-devnet-resolution", `--market ${market.id}`,
      `--outcome ${outcome}`, `--keypair ${quote(values.keypair ?? "/path/outside/repo/marketkit-resolver.json")}`];
    if (values.rpc) console.error("Reuse --rpc or SOLANA_RPC_URL; provider credentials are omitted.");
    console.error(`Preview only; no key read, signing or submission. Review prerequisites before deliberately invoking:\n${command.join(" ")}`);
    return;
  }
  if (!eligible) {
    const code = market.status === "resolved" ? "MARKET_RESOLVED" : market.status === "cancelled" ? "MARKET_CLOSED"
      : !deadlinePassed ? "MARKET_NOT_CLOSED" : "INSUFFICIENT_FUNDS";
    throw new HunchError(code, `${prerequisites}; no key read or resolution submitted`);
  }
  const keypair = await readResolverKey(values.keypair);
  if (!keypair.publicKey.equals(new PublicKey(market.resolverAuthority))) {
    throw new HunchError("INVALID_SIGNER", "Keypair public address is not this market's resolver");
  }
  const sdk = new Hunch({ mode: "anchor", connection, resolverAuthority: market.resolverAuthority, wallet: { publicKey: keypair.publicKey, async signTransaction(tx) {
    if (tx instanceof Transaction) tx.partialSign(keypair); else tx.sign([keypair]); return tx;
  } } });
  const result = await sdk.resolveMarket(market.id, outcome);
  const resolved = await reader.getMarket(market.id);
  console.log(json({ result: "PASS", network: "devnet", signature: result.signature, marketId: market.id,
    marketStatus: resolved?.status, winningOutcome: resolved?.winningOutcome, confirmed: result.status === "confirmed",
    verified: resolved?.status === "resolved" && resolved.winningOutcome === outcome }));
}

async function readResolverKey(path) {
  let real;
  try { real = await realpath(path); } catch { throw new Error("Unable to read a valid local Solana keypair file"); }
  const fromRoot = relative(await realpath(REPOSITORY_ROOT), real);
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair must be stored outside the repository");
  const info = await stat(real);
  if (!info.isFile()) throw new Error("Unable to read a valid local Solana keypair file");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new HunchError("CONFIGURATION_ERROR", "Resolver keypair file must not be readable by group or others (chmod 600)");
  try {
    const bytes = JSON.parse(await readFile(real, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch { throw new Error("Unable to read a valid local Solana keypair file"); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never dump stacks, key contents, RPC credentials, or secret-bearing causes.
  if (error instanceof HunchError) console.error(JSON.stringify({ code: error.code, message: error.message, ...error.details }));
  else console.error(error instanceof Error && error.message.startsWith("Requires") ? error.message : "Resolution script failed: check public arguments, RPC access, and local keypair validity");
  process.exitCode = 1;
});
