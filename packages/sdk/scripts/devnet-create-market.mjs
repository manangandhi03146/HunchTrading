import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  Hunch, HunchError, deriveMarketPda, generateMarketSeed,
  HUNCH_PROGRAM_ID, HUNCH_DEVNET_TOKEN_MINT, HUNCH_DEVNET_RESOLVER,
} from "../dist/index.js";

// Deliberately opt-in. No default key file, key generation, airdrop, or automatic retries.
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    "authorize-devnet-create": { type: "boolean", default: false },
    keypair: { type: "string" }, seed: { type: "string" }, "closes-at": { type: "string" },
    rpc: { type: "string" }, question: { type: "string" },
  } });
  if (!values.keypair) {
    throw new Error("Requires --keypair /path/to/funded-devnet-wallet.json for a preview. Add --authorize-devnet-create only when deliberately authorizing one Devnet creation transaction.");
  }
  if (values.seed !== undefined && !/^[a-fA-F0-9]{64}$/.test(values.seed)) throw new Error("--seed must contain exactly 64 hexadecimal characters (32 public bytes)");
  const deadline = values["closes-at"] === undefined ? Math.floor(Date.now() / 1000) + 3600 : Number(values["closes-at"]);
  if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) throw new Error("--closes-at must be future integer Unix seconds");
  let keypair;
  try {
    const bytes = JSON.parse(await readFile(values.keypair, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    // Never expose malformed file contents, underlying parser errors, or private material.
    throw new Error("Unable to read a valid local Solana keypair file");
  }
  const marketSeed = values.seed === undefined ? generateMarketSeed() : Uint8Array.from(Buffer.from(values.seed, "hex"));
  const seedHex = Buffer.from(marketSeed).toString("hex");
  const marketId = deriveMarketPda(keypair.publicKey, marketSeed).address.toBase58();
  const question = values.question ?? "Devnet creation verification";
  console.log(JSON.stringify({
    phase: "preview", submitted: false, network: "devnet", programId: HUNCH_PROGRAM_ID,
    creator: keypair.publicKey.toBase58(), marketId, marketSeed: seedHex, closesAt: deadline,
    tokenMint: HUNCH_DEVNET_TOKEN_MINT, resolver: HUNCH_DEVNET_RESOLVER,
    question, outcomes: ["Yes", "No"],
  }, null, 2));
  if (!values["authorize-devnet-create"]) {
    // Reuse the preview's exact seed/deadline so authorization cannot create a
    // different PDA merely because a second invocation generated another seed.
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const command = [
      "npm run create:devnet --workspace @hunch/sdk -- --authorize-devnet-create",
      `--keypair ${quote(values.keypair)}`, `--seed ${seedHex}`, `--closes-at ${deadline}`,
      `--question ${quote(question)}`,
    ];
    // Never print an RPC URL that might contain provider credentials.
    if (values.rpc) console.error("Reuse your --rpc option or SOLANA_RPC_URL when authorizing; RPC credentials are omitted from this preview.");
    console.error(`Preview only; nothing signed or submitted. Authorization requires --authorize-devnet-create.\n${command.join(" ")}`);
    return;
  }
  const sdk = new Hunch({
    mode: "anchor", rpcUrl: values.rpc ?? process.env.SOLANA_RPC_URL,
    programId: HUNCH_PROGRAM_ID, tokenMint: HUNCH_DEVNET_TOKEN_MINT, resolverAuthority: HUNCH_DEVNET_RESOLVER,
    wallet: {
      publicKey: keypair.publicKey,
      async signTransaction(transaction) {
        if (transaction instanceof Transaction) transaction.partialSign(keypair);
        else transaction.sign([keypair]);
        return transaction;
      },
    },
  });
  const result = await sdk.createMarket({
    marketSeed, closesAt: deadline,
    question, outcomes: ["Yes", "No"],
  });
  console.log(JSON.stringify({
    result: "PASS", network: "devnet", signature: result.signature, marketId: result.market.id,
    marketSeed: seedHex, confirmed: result.transaction.status === "confirmed", verified: true,
    tokenMint: result.market.tokenMint, resolver: result.market.resolverAuthority,
    pools: result.market.pools.map(value => value.toString()),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  if (error instanceof HunchError) {
    console.error(JSON.stringify({ code: error.code, message: error.message, ...error.details }));
  } else {
    // Only controlled input errors are printed; no secret-bearing cause or stack.
    console.error(error instanceof Error && !error.code ? error.message : "Invalid command arguments");
  }
  process.exitCode = 1;
});
