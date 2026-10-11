import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import {
  Hunch, HunchError, U64_MAX, derivePositionPda, deriveVaultPda,
  HUNCH_PROGRAM_ID, HUNCH_DEVNET_RPC_URL, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER,
} from "../dist/index.js";

// Preview reads only public accounts. Signing keys are read ONLY with explicit authorization.
// Never generates keys, mints tokens, requests airdrops, or automatically retries a stake.
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    "authorize-devnet-stake": { type: "boolean", default: false },
    wallet: { type: "string" }, keypair: { type: "string" }, market: { type: "string" },
    outcome: { type: "string" }, amount: { type: "string" }, rpc: { type: "string" },
    "token-account": { type: "string" }, "create-ata": { type: "boolean", default: false },
  } });
  if (!values.wallet || !values.market || !["0", "1"].includes(values.outcome) || !values.amount || !/^[0-9]+$/.test(values.amount)) {
    throw new Error("Requires --wallet PUBLIC_ADDRESS --market MARKET_PDA --outcome 0|1 --amount POSITIVE_BASE_UNITS; preview is read-only. Signing requires --authorize-devnet-stake and --keypair PATH.");
  }
  const amount = BigInt(values.amount), outcome = Number(values.outcome);
  if (amount <= 0n || amount > U64_MAX) throw new Error("--amount must be within 1..18446744073709551615");
  let user, marketAddress, explicitToken;
  try { user = new PublicKey(values.wallet); marketAddress = new PublicKey(values.market); explicitToken = values["token-account"] ? new PublicKey(values["token-account"]) : undefined; }
  catch { throw new Error("Wallet, market, and token account must be valid public addresses"); }
  if (explicitToken && values["create-ata"]) throw new Error("Use --token-account or --create-ata, not both");
  if (values["authorize-devnet-stake"] && !values.keypair) throw new Error("Explicit staking authorization requires --keypair PATH; no default key file is used");
  const connection = new Connection(values.rpc ?? process.env.SOLANA_RPC_URL ?? HUNCH_DEVNET_RPC_URL, "confirmed");
  if (await connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Staking script requires Solana Devnet");
  const reader = new Hunch({ mode: "anchor", connection });
  const market = await reader.getMarket(marketAddress.toBase58());
  if (!market) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist");
  if (market.tokenMint !== HUNCH_DEVNET_TOKEN_MINT || market.resolverAuthority !== HUNCH_DEVNET_RESOLVER) throw new HunchError("CONFIGURATION_ERROR", "Market must use the approved TEST mint and resolver");
  const mintAddress = new PublicKey(HUNCH_DEVNET_TOKEN_MINT), mint = await getMint(connection, mintAddress, "confirmed");
  const solLamports = await connection.getBalance(user, "confirmed");
  const owned = await connection.getTokenAccountsByOwner(user, { mint: mintAddress }, "confirmed");
  const tokenAccounts = owned.value.map(({ pubkey, account }) => {
    const token = unpackAccount(pubkey, account);
    if (!token.owner.equals(user) || !token.mint.equals(mintAddress)) throw new HunchError("INVALID_RESPONSE", "RPC returned a token account for a different owner or mint");
    return { address: pubkey.toBase58(), amount: token.amount, usable: token.isInitialized && !token.isFrozen };
  });
  const ata = getAssociatedTokenAddressSync(mintAddress, user).toBase58();
  const associated = tokenAccounts.find(token => token.address === ata);
  const source = explicitToken ? tokenAccounts.find(token => token.address === explicitToken.toBase58())
    : associated ?? tokenAccounts.filter(token => token.usable && token.amount >= amount).sort((a, b) => a.address.localeCompare(b.address))[0];
  const tokenReady = !!source?.usable && source.amount >= amount;
  const position = derivePositionPda(marketAddress, user, outcome).address.toBase58(), vault = deriveVaultPda(marketAddress).address.toBase58();
  console.log(JSON.stringify({
    phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
    wallet: user.toBase58(), marketId: market.id, outcome, amount: amount.toString(),
    marketStatus: market.status, deadline: market.closesAt, tokenMint: market.tokenMint, resolver: market.resolverAuthority,
    mintDecimals: mint.decimals, mintAuthority: mint.mintAuthority?.toBase58() ?? null,
    solLamports, tokenAccounts: tokenAccounts.map(token => ({ ...token, amount: token.amount.toString() })),
    tokenReady, associatedTokenAccount: ata, sourceTokenAccount: source?.address ?? null, stakeTokenAccount: !associated && values["create-ata"] && !explicitToken ? ata : source?.address ?? null,
    createAssociatedTokenAccount: values["create-ata"], positionId: position, vault,
    positions: await reader.getPositions(market.id, user.toBase58()),
    prerequisites: market.status !== "open" ? "Market is closed/resolved; create a new market with a future deadline"
      : !tokenReady ? "Obtain TEST from its mint authority or a funded holder; Devnet SOL does not grant mint authority"
      : "TEST ready; SDK will check SOL rent and fees again before requesting a signature",
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
  if (!values["authorize-devnet-stake"]) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const command = ["npm run stake:devnet --workspace @hunch/sdk -- --authorize-devnet-stake", `--wallet ${user.toBase58()}`,
      `--market ${market.id}`, `--outcome ${outcome}`, `--amount ${amount}`, `--keypair ${quote(values.keypair ?? "/path/to/funded-devnet-wallet.json")}`];
    if (explicitToken) command.push(`--token-account ${explicitToken.toBase58()}`);
    if (values["create-ata"]) command.push("--create-ata");
    if (values.rpc) console.error("Reuse --rpc or SOLANA_RPC_URL; provider credentials are omitted.");
    console.error(`Preview only; no key read, signing or submission. Review prerequisites before deliberately invoking:\n${command.join(" ")}`);
    return;
  }
  if (market.status !== "open") throw new HunchError("MARKET_CLOSED", "Market is not open; no key read or stake submitted");
  if (!tokenReady) throw new HunchError("INSUFFICIENT_FUNDS", "Wallet needs TEST tokens before staking; no key read or stake submitted");
  let keypair;
  try {
    const bytes = JSON.parse(await readFile(values.keypair, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch { throw new Error("Unable to read a valid local Solana keypair file"); }
  if (!keypair.publicKey.equals(user)) throw new HunchError("INVALID_SIGNER", "Keypair public address differs from the preview wallet");
  const sdk = new Hunch({ mode: "anchor", connection, wallet: { publicKey: user, async signTransaction(tx) {
    if (tx instanceof Transaction) tx.partialSign(keypair); else tx.sign([keypair]); return tx;
  } } });
  const result = await sdk.predict({ marketId: market.id, outcome, amount,
    ...(explicitToken ? { tokenAccount: explicitToken.toBase58() } : {}), createAssociatedTokenAccount: values["create-ata"] });
  console.log(JSON.stringify({ result: "PASS", network: "devnet", signature: result.signature,
    marketId: market.id, position: result.position, verification: result.verification,
    confirmed: result.transaction.status === "confirmed", verified: true,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? Array.from(value) : value, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never dump stacks, key contents, RPC credentials, or secret-bearing causes.
  if (error instanceof HunchError) console.error(JSON.stringify({ code: error.code, message: error.message, ...error.details }));
  else console.error("Staking script failed: check public arguments, RPC access, and local keypair validity");
  process.exitCode = 1;
});
