import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import {
  Hunch, HunchError, computeClaimPayout, derivePositionPda, deriveVaultPda,
  HUNCH_PROGRAM_ID, HUNCH_DEVNET_RPC_URL, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER,
} from "../dist/index.js";

const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item instanceof Uint8Array ? Array.from(item) : item, 2);

// Preview reads only public accounts. A signing key is read ONLY with explicit authorization,
// and only once the preview shows a claimable, unclaimed winning position. Never retries a claim.
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    "authorize-devnet-claim": { type: "boolean", default: false },
    wallet: { type: "string" }, keypair: { type: "string" }, market: { type: "string" }, rpc: { type: "string" },
    "token-account": { type: "string" }, "create-ata": { type: "boolean", default: false },
  } });
  if (!values.wallet || !values.market) {
    throw new Error("Requires --wallet PUBLIC_ADDRESS --market MARKET_PDA; preview is read-only. Signing requires --authorize-devnet-claim and --keypair PATH.");
  }
  let user, marketAddress, explicitToken;
  try { user = new PublicKey(values.wallet); marketAddress = new PublicKey(values.market); explicitToken = values["token-account"] ? new PublicKey(values["token-account"]) : undefined; }
  catch { throw new Error("Wallet, market, and token account must be valid public addresses"); }
  if (explicitToken && values["create-ata"]) throw new Error("Use --token-account or --create-ata, not both");
  if (values["authorize-devnet-claim"] && !values.keypair) throw new Error("Explicit claim authorization requires --keypair PATH; no default key file is used");
  const connection = new Connection(values.rpc ?? process.env.SOLANA_RPC_URL ?? HUNCH_DEVNET_RPC_URL, "confirmed");
  if (await connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Claim script requires Solana Devnet");
  const reader = new Hunch({ mode: "anchor", connection });
  const market = await reader.getMarket(marketAddress.toBase58());
  if (!market) throw new HunchError("MARKET_NOT_FOUND", "Market PDA does not exist");
  if (market.tokenMint !== HUNCH_DEVNET_TOKEN_MINT || market.resolverAuthority !== HUNCH_DEVNET_RESOLVER) throw new HunchError("CONFIGURATION_ERROR", "Market must use the approved TEST mint and resolver");
  const mintAddress = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
  const positions = await reader.getPositions(market.id, user.toBase58());
  const winning = market.status === "resolved" ? positions.find(position => position.outcome === market.winningOutcome) : undefined;
  const expectedPayout = winning && !winning.claimed ? computeClaimPayout(winning.amount, market.pools, market.winningOutcome) : 0n;
  const vault = deriveVaultPda(marketAddress).address;
  const vaultAccount = await connection.getAccountInfo(vault, "confirmed");
  const vaultBalance = vaultAccount ? unpackAccount(vault, vaultAccount).amount : 0n;
  const owned = await connection.getTokenAccountsByOwner(user, { mint: mintAddress }, "confirmed");
  const tokenAccounts = owned.value.map(({ pubkey, account }) => {
    const token = unpackAccount(pubkey, account);
    if (!token.owner.equals(user) || !token.mint.equals(mintAddress)) throw new HunchError("INVALID_RESPONSE", "RPC returned a token account for a different owner or mint");
    return { address: pubkey.toBase58(), amount: token.amount, usable: token.isInitialized && !token.isFrozen };
  });
  const ata = getAssociatedTokenAddressSync(mintAddress, user).toBase58();
  const associated = tokenAccounts.find(token => token.address === ata);
  const recipient = explicitToken ? tokenAccounts.find(token => token.address === explicitToken.toBase58())
    : associated ?? tokenAccounts.filter(token => token.usable).sort((a, b) => a.address.localeCompare(b.address))[0];
  const recipientReady = recipient ? recipient.usable : !explicitToken && values["create-ata"];
  const claimable = !!winning && !winning.claimed && expectedPayout > 0n && vaultBalance >= expectedPayout;
  const prerequisites = market.status !== "resolved"
    ? `Market is ${market.status}; the resolver ${market.resolverAuthority} must resolve it on-chain before claims`
    : !winning ? (positions.length ? "Wallet only backed the losing outcome; nothing to claim" : "Wallet has no position in this market")
    : winning.claimed ? "Winning position already claimed"
    : vaultBalance < expectedPayout ? "Vault balance is below the expected payout; do not claim"
    : !recipientReady ? "No usable recipient token account; pass --create-ata or --token-account"
    : "Claimable; SDK re-checks network, accounts, fees and balances before requesting a signature";
  console.log(json({
    phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
    wallet: user.toBase58(), marketId: market.id, marketStatus: market.status, winningOutcome: market.winningOutcome,
    pools: market.pools, totalPool: market.totalPool, tokenMint: market.tokenMint, resolver: market.resolverAuthority,
    positions, winningPositionId: market.winningOutcome === null ? null : derivePositionPda(marketAddress, user, market.winningOutcome).address.toBase58(),
    expectedPayout, vault: vault.toBase58(), vaultBalance, solLamports: await connection.getBalance(user, "confirmed"),
    tokenAccounts, associatedTokenAccount: ata, recipientTokenAccount: recipient?.address ?? (values["create-ata"] && !explicitToken ? ata : null),
    createAssociatedTokenAccount: values["create-ata"], claimable, recipientReady, prerequisites,
  }));
  if (!values["authorize-devnet-claim"]) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const command = ["npm run claim:devnet --workspace @hunch/sdk -- --authorize-devnet-claim", `--wallet ${user.toBase58()}`,
      `--market ${market.id}`, `--keypair ${quote(values.keypair ?? "/path/to/winning-devnet-wallet.json")}`];
    if (explicitToken) command.push(`--token-account ${explicitToken.toBase58()}`);
    if (values["create-ata"]) command.push("--create-ata");
    if (values.rpc) console.error("Reuse --rpc or SOLANA_RPC_URL; provider credentials are omitted.");
    console.error(`Preview only; no key read, signing or submission. Review prerequisites before deliberately invoking:\n${command.join(" ")}`);
    return;
  }
  if (!claimable || !recipientReady) throw new HunchError(market.status !== "resolved" ? "MARKET_NOT_RESOLVED" : winning?.claimed ? "ALREADY_CLAIMED" : !winning ? "NO_WINNING_POSITION" : "INVALID_INPUT",
    `${prerequisites}; no key read or claim submitted`);
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
  const result = await sdk.claimWinnings(market.id, {
    ...(explicitToken ? { tokenAccount: explicitToken.toBase58() } : {}), createAssociatedTokenAccount: values["create-ata"] });
  console.log(json({ result: "PASS", network: "devnet", signature: result.signature, marketId: market.id,
    payout: result.payout, position: result.position, verification: result.verification,
    confirmed: result.transaction.status === "confirmed", verified: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never dump stacks, key contents, RPC credentials, or secret-bearing causes.
  if (error instanceof HunchError) console.error(JSON.stringify({ code: error.code, message: error.message, ...error.details }));
  else console.error(error instanceof Error && error.message.startsWith("Requires") ? error.message : "Claim script failed: check public arguments, RPC access, and local keypair validity");
  process.exitCode = 1;
});
