import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { PublicKey } from "@solana/web3.js";
import type { SignedGameEvent, TransactionResult, Outcome, AdapterMode } from "@hunch/sdk";
import { decodeBase64, identifier, ResolverError } from "./validation.js";

export type EventStatus = "received" | "processing" | "submitted" | "confirmed" | "failed";
export interface AppRegistration { appId: string; publicKey: string; enabled: boolean }
export interface MarketMapping {
  marketId: string;
  appId: string;
  authority: string;
  resolverAuthority: string;
  eventId: string;
}
/** Written only after the resolved market itself was read back with the event's outcome. */
export interface Settlement {
  marketStatus: "resolved";
  winningOutcome: Outcome;
  verifiedAt: number;
  /** "market-state": reconciled from the market account when no signature status was available. */
  source: "transaction" | "market-state";
}
export interface EventRecord {
  eventId: string;
  appId: string;
  marketId: string;
  outcome: Outcome;
  timestamp: number;
  status: EventStatus;
  mode: AdapterMode;
  transaction: TransactionResult | null;
  error: { code: string; message: string } | null;
  /** Anchor: block height after which an unseen recorded signature can never land. */
  lastValidBlockHeight: number | null;
  settlement: Settlement | null;
  receivedAt: number;
  updatedAt: number;
}
interface EventRow {
  event_id: string; app_id: string; market_id: string; outcome: Outcome;
  timestamp: number; status: EventStatus; mode: AdapterMode; payload_hash: string;
  transaction_json: string | null; error_json: string | null;
  last_valid_block_height: number | null; settlement_json: string | null;
  received_at: number; updated_at: number;
}
const SCHEMA_VERSION = 2;

/** Small concrete SQLite repository. No storage framework or worker is needed. */
export class ResolverStore {
  private readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true });
    if (!Number.isInteger(version) || (version as number) < 0 || (version as number) > SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`Unsupported resolver database version: ${version}`);
    }
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE applications (
          app_id TEXT PRIMARY KEY,
          public_key TEXT NOT NULL,
          enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
        );
        CREATE TABLE market_mappings (
          market_id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL REFERENCES applications(app_id),
          authority TEXT NOT NULL,
          resolver_authority TEXT NOT NULL,
          event_id TEXT NOT NULL UNIQUE
        );
        CREATE TABLE events (
          event_id TEXT PRIMARY KEY,
          app_id TEXT NOT NULL REFERENCES applications(app_id),
          market_id TEXT NOT NULL UNIQUE REFERENCES market_mappings(market_id),
          outcome INTEGER NOT NULL CHECK(outcome IN (0,1)),
          timestamp INTEGER NOT NULL,
          payload_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('received','processing','submitted','confirmed','failed')),
          mode TEXT NOT NULL CHECK(mode IN ('mock','anchor')),
          transaction_json TEXT,
          error_json TEXT,
          received_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version = 1;
      `);
    }).immediate();
    // v2: pre-broadcast signature expiry and verified on-chain settlement. Additive only.
    if (this.db.pragma("user_version", { simple: true }) === 1) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE events ADD COLUMN last_valid_block_height INTEGER;
        ALTER TABLE events ADD COLUMN settlement_json TEXT;
        PRAGMA user_version = 2;
      `);
    }).immediate();
  }

  registerApp(input: AppRegistration): void {
    identifier.parse(input.appId);
    if (!decodeBase64(input.publicKey, 32)) throw new Error("Application public key must be canonical base64 encoding of 32 Ed25519 bytes");
    const existing = this.getApp(input.appId);
    if (existing) {
      if (existing.publicKey !== input.publicKey) throw new Error("Application is already registered with a different key");
      this.db.prepare("UPDATE applications SET enabled = ? WHERE app_id = ?").run(input.enabled ? 1 : 0, input.appId);
      return;
    }
    this.db.prepare("INSERT INTO applications (app_id, public_key, enabled) VALUES (?, ?, ?)")
      .run(input.appId, input.publicKey, input.enabled ? 1 : 0);
  }

  getApp(appId: string): AppRegistration | null {
    const row = this.db.prepare("SELECT * FROM applications WHERE app_id = ?").get(appId) as
      { app_id: string; public_key: string; enabled: number } | undefined;
    return row ? { appId: row.app_id, publicKey: row.public_key, enabled: row.enabled === 1 } : null;
  }

  registerMarket(input: MarketMapping): void {
    identifier.parse(input.marketId); identifier.parse(input.appId); identifier.parse(input.eventId);
    new PublicKey(input.authority); new PublicKey(input.resolverAuthority);
    if (!this.getApp(input.appId)) throw new Error("Register the application before its market mapping");
    const existing = this.getMarketMapping(input.marketId);
    if (existing) {
      if (existing.appId !== input.appId || existing.authority !== input.authority ||
          existing.resolverAuthority !== input.resolverAuthority || existing.eventId !== input.eventId) {
        throw new Error("Market mapping already exists; mappings cannot be reassigned");
      }
      return;
    }
    this.db.prepare(`INSERT INTO market_mappings (market_id, app_id, authority, resolver_authority, event_id)
      VALUES (?, ?, ?, ?, ?)`).run(input.marketId, input.appId, input.authority, input.resolverAuthority, input.eventId);
  }

  getMarketMapping(marketId: string): MarketMapping | null {
    const row = this.db.prepare("SELECT * FROM market_mappings WHERE market_id = ?").get(marketId) as
      { market_id: string; app_id: string; authority: string; resolver_authority: string; event_id: string } | undefined;
    return row ? { marketId: row.market_id, appId: row.app_id, authority: row.authority, resolverAuthority: row.resolver_authority, eventId: row.event_id } : null;
  }

  /** Roll back a new HTTP mock registration rejected by the adapter. */
  removeUnprocessedMarketMapping(marketId: string): void {
    this.db.prepare(`DELETE FROM market_mappings WHERE market_id = ?
      AND NOT EXISTS (SELECT 1 FROM events WHERE events.market_id = market_mappings.market_id)`).run(marketId);
  }

  getEvent(eventId: string): EventRecord | null {
    const row = this.db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as EventRow | undefined;
    return row ? this.record(row) : null;
  }

  private record(row: EventRow): EventRecord {
    return {
      eventId: row.event_id, appId: row.app_id, marketId: row.market_id, outcome: row.outcome,
      timestamp: row.timestamp, status: row.status, mode: row.mode,
      transaction: row.transaction_json ? JSON.parse(row.transaction_json) as TransactionResult : null,
      error: row.error_json ? JSON.parse(row.error_json) as EventRecord["error"] : null,
      lastValidBlockHeight: row.last_valid_block_height ?? null,
      settlement: row.settlement_json ? JSON.parse(row.settlement_json) as Settlement : null,
      receivedAt: row.received_at, updatedAt: row.updated_at,
    };
  }

  existingEvent(eventId: string, hash: string, mode: AdapterMode): EventRecord | null {
    const row = this.db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as EventRow | undefined;
    if (!row) return null;
    if (row.payload_hash !== hash || row.mode !== mode) {
      throw new ResolverError(409, "EVENT_CONFLICT", "Event ID was already used with a different payload or mode");
    }
    return this.record(row);
  }

  /** Reservation and uniqueness checks run under a SQLite write transaction. */
  receive(event: SignedGameEvent, hash: string, mode: AdapterMode, now: number): { record: EventRecord; created: boolean } {
    return this.db.transaction(() => {
      const existing = this.existingEvent(event.eventId, hash, mode);
      if (existing) return { record: existing, created: false };
      if (this.db.prepare("SELECT event_id FROM events WHERE market_id = ?").get(event.marketId)) {
        throw new ResolverError(409, "MARKET_EVENT_CONFLICT", "Market already has a reserved result event");
      }
      this.db.prepare(`INSERT INTO events
        (event_id, app_id, market_id, outcome, timestamp, payload_hash, status, mode, received_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`).run(
        event.eventId, event.appId, event.marketId, event.outcome, event.timestamp, hash, mode, now, now,
      );
      return { record: this.getEvent(event.eventId)!, created: true };
    }).immediate();
  }

  updateEvent(eventId: string, expected: EventStatus, status: EventStatus, now: number,
    transaction: TransactionResult | null = null, error: EventRecord["error"] = null, settlement: Settlement | null = null): EventRecord {
    const result = this.db.prepare(`UPDATE events SET status = ?, updated_at = ?, transaction_json = ?, error_json = ?, settlement_json = ?
      WHERE event_id = ? AND status = ?`).run(status, now, transaction ? JSON.stringify(transaction) : null,
      error ? JSON.stringify(error) : null, settlement ? JSON.stringify(settlement) : null, eventId, expected);
    if (result.changes !== 1) throw new Error("Event processing state changed unexpectedly");
    return this.getEvent(eventId)!;
  }

  /** Persist a signed resolution before broadcast so a crash or timeout can always be reconciled. */
  recordSigned(eventId: string, signature: string, lastValidBlockHeight: number, now: number): EventRecord {
    if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0) throw new Error("Invalid expiry block height");
    const transaction: TransactionResult = { mode: "anchor", id: signature, signature, status: "submitted" };
    const result = this.db.prepare(`UPDATE events SET status = 'submitted', updated_at = ?, transaction_json = ?, last_valid_block_height = ?
      WHERE event_id = ? AND status = 'processing' AND transaction_json IS NULL`).run(now, JSON.stringify(transaction), lastValidBlockHeight, eventId);
    if (result.changes !== 1) throw new Error("Event processing state changed unexpectedly");
    return this.getEvent(eventId)!;
  }

  /** Events awaiting a terminal, verified outcome. */
  unsettledEvents(): EventRecord[] {
    return (this.db.prepare("SELECT * FROM events WHERE status IN ('received','processing','submitted') ORDER BY received_at").all() as EventRow[])
      .map((row) => this.record(row));
  }

  /**
   * Remove a definitively failed reservation so the app can sign a fresh event.
   * Callers must first prove on-chain that nothing landed (see reconcileEvent).
   */
  releaseFailedEvent(eventId: string): void {
    const result = this.db.prepare("DELETE FROM events WHERE event_id = ? AND status = 'failed'").run(eventId);
    if (result.changes !== 1) throw new Error("Only a failed event can be released");
  }

  pendingCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM events WHERE status IN ('received','processing','submitted')").get() as { count: number }).count;
  }
  close(): void { this.db.close(); }
}
