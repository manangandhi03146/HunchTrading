import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { utils } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, SendTransactionError } from "@solana/web3.js";
import { ACCOUNT_SIZE, getAssociatedTokenAddressSync, unpackAccount, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { HunchError, U64_MAX, HUNCH_DEVNET_RPC_URL, HUNCH_DEVNET_GENESIS_HASH, HUNCH_DEVNET_TOKEN_MINT } from "../dist/index.js";

const json = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
const MAX_LAMPORTS = 1_000_000_000n; // 1 Devnet SOL per invocation; a guard against typos.

// Moves Devnet SOL and/or TEST from a wallet you control to another test wallet (a second player or
// the resolver's fee balance). Preview reads only public accounts. The source key is read ONLY with
// explicit authorization. Never mints, never airdrops, never retries a transfer.
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    "authorize-devnet-transfer": { type: "boolean", default: false },
    from: { type: "string" }, to: { type: "string" }, amount: { type: "string", default: "0" },
    lamports: { type: "string", default: "0" }, keypair: { type: "string" }, rpc: { type: "string" },
  } });
  if (!values.from || !values.to || !/^[0-9]+$/.test(values.amount) || !/^[0-9]+$/.test(values.lamports)) {
    throw new Error("Requires --from SOURCE_WALLET --to RECIPIENT_WALLET and --amount TEST_BASE_UNITS and/or --lamports N; preview is read-only. Signing requires --authorize-devnet-transfer and --keypair PATH.");
  }
  const amount = BigInt(values.amount), lamports = BigInt(values.lamports);
  if (amount > U64_MAX) throw new Error("--amount exceeds u64");
  if (lamports > MAX_LAMPORTS) throw new Error("--lamports is limited to 1000000000 (1 Devnet SOL) per transfer");
  if (amount === 0n && lamports === 0n) throw new Error("Nothing to transfer: set --amount and/or --lamports");
  let from, to;
  try { from = new PublicKey(values.from); to = new PublicKey(values.to); } catch { throw new Error("--from and --to must be valid public addresses"); }
  if (from.equals(to)) throw new Error("--from and --to must differ");
  if (values["authorize-devnet-transfer"] && !values.keypair) throw new Error("Explicit transfer authorization requires --keypair PATH; no default key file is used");
  const connection = new Connection(values.rpc ?? process.env.SOLANA_RPC_URL ?? HUNCH_DEVNET_RPC_URL, "confirmed");
  if (await connection.getGenesisHash() !== HUNCH_DEVNET_GENESIS_HASH) throw new HunchError("CONFIGURATION_ERROR", "Funding script requires Solana Devnet");
  const mint = new PublicKey(HUNCH_DEVNET_TOKEN_MINT);
  const source = getAssociatedTokenAddressSync(mint, from), destination = getAssociatedTokenAddressSync(mint, to);
  const [sourceAccount, destinationAccount] = await connection.getMultipleAccountsInfo([source, destination], "confirmed");
  const decode = (address, account, owner) => {
    if (!account) return null;
    const token = unpackAccount(address, account);
    if (!token.owner.equals(owner) || !token.mint.equals(mint)) throw new HunchError("INVALID_RESPONSE", "Associated token account has an unexpected owner or mint");
    return token;
  };
  const sourceToken = decode(source, sourceAccount, from), destinationToken = decode(destination, destinationAccount, to);
  const createDestination = amount > 0n && !destinationToken;
  const [fromLamports, toLamports, rent] = await Promise.all([
    connection.getBalance(from, "confirmed"), connection.getBalance(to, "confirmed"),
    createDestination ? connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed") : Promise.resolve(0),
  ]);
  const sourceTest = sourceToken?.amount ?? 0n;
  const tokenReady = amount === 0n || (!!sourceToken && !sourceToken.isFrozen && sourceTest >= amount && !destinationToken?.isFrozen);
  // Fee estimate plus the destination ATA rent the source pays; the exact fee is checked by preflight.
  const requiredLamports = lamports + BigInt(rent) + 10000n;
  const solReady = BigInt(fromLamports) >= requiredLamports;
  const prerequisites = !tokenReady ? `Source holds ${sourceTest} TEST in its ATA; needs ${amount}`
    : !solReady ? `Source needs at least ${requiredLamports} lamports` : "Ready; review recipient and amounts before authorizing";
  console.log(json({
    phase: "preview", submitted: false, network: "devnet", tokenMint: mint.toBase58(),
    from: from.toBase58(), to: to.toBase58(), amount, lamports,
    sourceTokenAccount: source.toBase58(), sourceTest, destinationTokenAccount: destination.toBase58(),
    destinationTest: destinationToken?.amount ?? 0n, createDestinationTokenAccount: createDestination,
    fromLamports, toLamports, requiredLamports, ready: tokenReady && solReady, prerequisites,
  }));
  if (!values["authorize-devnet-transfer"]) {
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    if (values.rpc) console.error("Reuse --rpc or SOLANA_RPC_URL; provider credentials are omitted.");
    console.error(`Preview only; no key read, signing or submission. Review before deliberately invoking:\n${[
      "npm run fund:devnet --workspace @hunch/sdk -- --authorize-devnet-transfer", `--from ${from.toBase58()}`, `--to ${to.toBase58()}`,
      `--amount ${amount}`, `--lamports ${lamports}`, `--keypair ${quote(values.keypair ?? "/path/to/source-wallet.json")}`].join(" ")}`);
    return;
  }
  if (!tokenReady || !solReady) throw new HunchError("INSUFFICIENT_FUNDS", `${prerequisites}; no key read or transfer submitted`);
  let keypair;
  try {
    const bytes = JSON.parse(await readFile(values.keypair, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch { throw new Error("Unable to read a valid local Solana keypair file"); }
  if (!keypair.publicKey.equals(from)) throw new HunchError("INVALID_SIGNER", "Keypair public address differs from --from");
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: from, ...latest });
  if (lamports > 0n) transaction.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  if (amount > 0n) {
    transaction.add(createAssociatedTokenAccountIdempotentInstruction(from, destination, to, mint));
    transaction.add(createTransferCheckedInstruction(source, mint, destination, from, amount, 0));
  }
  transaction.sign(keypair);
  const signature = utils.bytes.bs58.encode(transaction.signature);
  try {
    if (await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }) !== signature) throw new Error("RPC returned a different signature");
  } catch (cause) {
    if (cause instanceof SendTransactionError && cause.message.startsWith("Simulation failed.")) throw new HunchError("TRANSACTION_FAILED", "RPC preflight rejected the transfer; nothing landed", { signature });
    throw new HunchError("TRANSACTION_UNCERTAIN", "Submission is uncertain; check the signature and balances before any retry", { signature, lastValidBlockHeight: latest.lastValidBlockHeight });
  }
  let confirmation;
  try { confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed"); }
  catch { throw new HunchError("TRANSACTION_UNCERTAIN", "Confirmation is uncertain; check the signature and balances before any retry", { signature, lastValidBlockHeight: latest.lastValidBlockHeight }); }
  if (confirmation.value.err !== null) throw new HunchError("TRANSACTION_FAILED", "Transfer failed on-chain", { signature, error: confirmation.value.err });
  const [afterTo, afterAccount] = await Promise.all([
    connection.getBalance(to, { commitment: "confirmed", minContextSlot: confirmation.context.slot }),
    amount > 0n ? connection.getAccountInfo(destination, { commitment: "confirmed", minContextSlot: confirmation.context.slot }) : Promise.resolve(null),
  ]);
  const afterTest = afterAccount ? decode(destination, afterAccount, to).amount : destinationToken?.amount ?? 0n;
  const verified = BigInt(afterTo) >= BigInt(toLamports) + lamports && afterTest >= (destinationToken?.amount ?? 0n) + amount;
  console.log(json({ result: verified ? "PASS" : "UNVERIFIED", network: "devnet", signature, to: to.toBase58(),
    toLamports: afterTo, destinationTokenAccount: destination.toBase58(), destinationTest: afterTest, confirmed: true, verified }));
  if (!verified) throw new HunchError("INVALID_RESPONSE", "Transfer confirmed but recipient balances did not increase as expected; inspect the signature", { signature });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never dump stacks, key contents, RPC credentials, or secret-bearing causes.
  if (error instanceof HunchError) console.error(JSON.stringify({ code: error.code, message: error.message, ...error.details }));
  else console.error(error instanceof Error && /^(Requires|--|Nothing|Unable)/.test(error.message) ? error.message : "Funding script failed: check public arguments, RPC access, and local keypair validity");
  process.exitCode = 1;
});
