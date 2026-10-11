import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { HUNCH_DEVNET_GENESIS_HASH } from "@hunch/sdk";
import {
  loadReceipts,
  parseSol,
  prepareTransfer,
  receiptStatus,
  recipientKey,
  sendTransfer,
  type FundsReceipt,
} from "./transactions";

// Ephemeral test-only signers. No team wallet or RPC is used by this suite.
const signer = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();
const MINIMUM = 890_880;
const rpc = {
  getGenesisHash: vi.fn(),
  getLatestBlockhash: vi.fn(),
  getBalance: vi.fn(),
  getAccountInfo: vi.fn(),
  getMinimumBalanceForRentExemption: vi.fn(),
  getFeeForMessage: vi.fn(),
  getBlockHeight: vi.fn(),
  sendRawTransaction: vi.fn(),
  confirmTransaction: vi.fn(),
  getSignatureStatuses: vi.fn(),
};
const connection = rpc as unknown as Connection;
const sign = vi.fn(async (tx: Transaction) => {
  tx.partialSign(signer);
  return tx;
});
beforeEach(() => {
  vi.clearAllMocks();
  rpc.getGenesisHash.mockResolvedValue(HUNCH_DEVNET_GENESIS_HASH);
  rpc.getLatestBlockhash.mockResolvedValue({
    blockhash,
    lastValidBlockHeight: 1000,
  });
  rpc.getBalance.mockResolvedValue(1_000_000_000);
  rpc.getAccountInfo.mockResolvedValue({
    owner: SystemProgram.programId,
    executable: false,
    data: Buffer.alloc(0),
    lamports: MINIMUM,
  });
  rpc.getMinimumBalanceForRentExemption.mockResolvedValue(MINIMUM);
  rpc.getFeeForMessage.mockResolvedValue({ value: 5000 });
  rpc.getBlockHeight.mockResolvedValue(900);
  rpc.confirmTransaction.mockResolvedValue({ value: { err: null } });
  rpc.sendRawTransaction.mockImplementation(async (raw: Uint8Array) =>
    bs58.encode(Transaction.from(raw).signature!),
  );
});
describe("Devnet SOL validation", () => {
  it.each([
    ["0.000000001", 1],
    ["0.1", 100_000_000],
    ["1.000000009", 1_000_000_009],
    ["9007199.254740991", Number.MAX_SAFE_INTEGER],
  ])("parses %s exactly", (input, expected) =>
    expect(parseSol(input)).toBe(expected),
  );
  it.each([
    "0",
    "-1",
    "1e3",
    "Infinity",
    "NaN",
    "0.0000000001",
    "9007199.254740992",
    "",
    " 1",
    ".5",
    "1.",
  ])("rejects invalid input %s", (input) =>
    expect(() => parseSol(input)).toThrow(),
  );
  it("rejects self, malformed and off-curve destinations", () => {
    expect(() =>
      recipientKey(signer.publicKey.toBase58(), signer.publicKey),
    ).toThrow("different wallet");
    expect(() => recipientKey("not-a-wallet", signer.publicKey)).toThrow(
      "valid Solana",
    );
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      SystemProgram.programId,
    );
    expect(() => recipientKey(pda.toBase58(), signer.publicKey)).toThrow(
      "vault",
    );
  });
  it("blocks another cluster before preparing a transaction", async () => {
    rpc.getGenesisHash.mockResolvedValue("mainnet");
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.01",
      ),
    ).rejects.toThrow("not Solana Devnet");
    expect(rpc.getLatestBlockhash).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
  it("quotes a single native SOL transfer and its fee", async () => {
    const q = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    expect(q.lamports).toBe(10_000_000);
    expect(q.fee).toBe(5000);
    expect(q.transaction.instructions).toHaveLength(1);
    expect(
      q.transaction.instructions[0].programId.equals(SystemProgram.programId),
    ).toBe(true);
  });
  it("rejects insufficient funds including the quoted fee", async () => {
    rpc.getBalance.mockResolvedValue(10_000_000);
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.01",
      ),
    ).rejects.toThrow("including the network fee");
  });
  it("rejects an unavailable fee quote", async () => {
    rpc.getFeeForMessage.mockResolvedValue({ value: null });
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.01",
      ),
    ).rejects.toThrow("quote the network fee");
  });
  it("rejects a token or executable account as the SOL recipient", async () => {
    rpc.getAccountInfo.mockResolvedValue({
      owner: recipient,
      executable: false,
      data: Buffer.alloc(165),
      lamports: 10_000_000,
    });
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.01",
      ),
    ).rejects.toThrow("plain SOL wallet");
  });
  it("requires a new recipient to retain the rent-exempt minimum", async () => {
    rpc.getAccountInfo.mockResolvedValue(null);
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.000001",
      ),
    ).rejects.toThrow("new wallet");
  });
  it("rejects leaving a source below rent but permits draining it including fees", async () => {
    await expect(
      prepareTransfer(
        connection,
        signer.publicKey,
        recipient.toBase58(),
        "0.99999",
      ),
    ).rejects.toThrow("source wallet");
    expect(
      (
        await prepareTransfer(
          connection,
          signer.publicKey,
          recipient.toBase58(),
          "0.999995",
        )
      ).lamports,
    ).toBe(999_995_000);
  });
});
describe("single submission and receipt reconciliation", () => {
  it("persists the signature before broadcasting and confirms the exact transfer", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    const saved = vi.fn();
    const result = await sendTransfer(connection, quote, sign, saved);
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: result.signature,
        status: "pending",
      }),
    );
    expect(saved.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.sendRawTransaction.mock.invocationCallOrder[0],
    );
    expect(result.status).toBe("confirmed");
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({
      skipPreflight: false,
      maxRetries: 0,
    });
  });
  it("retains a pending signature after a broadcast timeout and never resends", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    rpc.sendRawTransaction.mockRejectedValue(new Error("RPC timeout"));
    const saved = vi.fn();
    await expect(sendTransfer(connection, quote, sign, saved)).rejects.toThrow(
      "RPC timeout",
    );
    expect(saved).toHaveBeenCalledOnce();
    expect(saved.mock.calls[0][0].status).toBe("pending");
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
    expect(rpc.confirmTransaction).not.toHaveBeenCalled();
  });
  it("does not broadcast when receipt persistence fails", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    await expect(
      sendTransfer(connection, quote, sign, () => {
        throw new Error("Storage unavailable");
      }),
    ).rejects.toThrow("Storage");
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("blocks an expired quote before requesting a signature", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    rpc.getBlockHeight.mockResolvedValue(1001);
    await expect(
      sendTransfer(connection, quote, sign, vi.fn()),
    ).rejects.toThrow("expired");
    expect(sign).not.toHaveBeenCalled();
  });
  it("blocks a changed balance before requesting a signature", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    rpc.getBalance.mockResolvedValue(100);
    await expect(
      sendTransfer(connection, quote, sign, vi.fn()),
    ).rejects.toThrow("balance changed");
    expect(sign).not.toHaveBeenCalled();
  });
  it("rejects a wallet-mutated message without broadcasting", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    await expect(
      sendTransfer(
        connection,
        quote,
        async (tx) => {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: signer.publicKey,
              toPubkey: recipient,
              lamports: 1,
            }),
          );
          tx.partialSign(signer);
          return tx;
        },
        vi.fn(),
      ),
    ).rejects.toThrow("different or invalid");
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("reports an on-chain error as failed", async () => {
    const quote = await prepareTransfer(
      connection,
      signer.publicKey,
      recipient.toBase58(),
      "0.01",
    );
    rpc.confirmTransaction.mockResolvedValue({
      value: { err: { InstructionError: [0, "InsufficientFunds"] } },
    });
    expect((await sendTransfer(connection, quote, sign, vi.fn())).status).toBe(
      "failed",
    );
  });
  const receipt: FundsReceipt = {
    signature: bs58.encode(new Uint8Array(64).fill(1)),
    owner: signer.publicKey.toBase58(),
    recipient: recipient.toBase58(),
    kind: "send",
    status: "pending",
    lamports: 1000,
    createdAt: 100,
  };
  it.each([
    [null, "pending"],
    [{ err: null, confirmationStatus: "processed" }, "pending"],
    [{ err: null, confirmationStatus: "confirmed" }, "confirmed"],
    [{ err: null, confirmationStatus: "finalized" }, "confirmed"],
    [
      {
        err: { InstructionError: [0, "InvalidArgument"] },
        confirmationStatus: "confirmed",
      },
      "failed",
    ],
  ])("reconciles status without a send: %j", async (status, expected) => {
    rpc.getSignatureStatuses.mockResolvedValue({ value: [status] });
    expect((await receiptStatus(connection, receipt)).status).toBe(expected);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("restores public pending receipts and rejects malformed storage", () => {
    expect(loadReceipts(JSON.stringify([receipt]))).toEqual([receipt]);
    expect(loadReceipts("not json")).toEqual([]);
    expect(
      loadReceipts(JSON.stringify([{ ...receipt, lamports: -1 }])),
    ).toEqual([]);
  });
});
