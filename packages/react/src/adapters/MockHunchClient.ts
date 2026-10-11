import type { HunchClient } from "./HunchClient";
import {
  effectiveStatus,
  type Claimable,
  type CreateMarketParams,
  type Market,
  type MarketEvent,
  type Outcome,
  type Position,
  type RaceState,
  type TransactionResult,
} from "../types";

interface State {
  markets: Market[];
  positions: Position[];
  balances: Record<string, bigint>;
  events: MarketEvent[];
  races: Record<string, RaceState>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAmount(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}
function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isOutcome(value: unknown): value is Outcome {
  return value === 0 || value === 1;
}
function isState(value: unknown): value is State {
  if (
    !isRecord(value) ||
    !Array.isArray(value.markets) ||
    !Array.isArray(value.positions) ||
    !isRecord(value.balances) ||
    !Array.isArray(value.events) ||
    !isRecord(value.races)
  )
    return false;
  const marketIds = new Set<string>();
  for (const market of value.markets) {
    if (
      !isRecord(market) ||
      typeof market.id !== "string" ||
      !market.id ||
      marketIds.has(market.id) ||
      typeof market.question !== "string" ||
      !Array.isArray(market.outcomes) ||
      market.outcomes.length !== 2 ||
      !market.outcomes.every((label) => typeof label === "string") ||
      !Array.isArray(market.pools) ||
      market.pools.length !== 2 ||
      !market.pools.every(isAmount) ||
      !isAmount(market.totalPool) ||
      market.totalPool !== market.pools[0] + market.pools[1] ||
      !isTime(market.closesAt) ||
      !["open", "closed", "resolved", "cancelled"].includes(
        String(market.status),
      ) ||
      !(market.winningOutcome === null || isOutcome(market.winningOutcome)) ||
      (market.status === "resolved" && !isOutcome(market.winningOutcome))
    )
      return false;
    marketIds.add(market.id);
  }
  if (
    !value.positions.every(
      (position) =>
        isRecord(position) &&
        typeof position.marketId === "string" &&
        marketIds.has(position.marketId) &&
        typeof position.wallet === "string" &&
        isOutcome(position.outcome) &&
        isAmount(position.amount) &&
        typeof position.claimed === "boolean",
    )
  )
    return false;
  if (!Object.values(value.balances).every(isAmount)) return false;
  if (
    !value.events.every(
      (event) =>
        isRecord(event) &&
        typeof event.id === "string" &&
        typeof event.marketId === "string" &&
        typeof event.message === "string" &&
        isTime(event.timestamp) &&
        event.simulated === true &&
        [
          "created",
          "prediction",
          "event_received",
          "signature_verified",
          "resolution_submitted",
          "confirmed",
          "failed",
          "claim",
        ].includes(String(event.type)),
    )
  )
    return false;
  return Object.entries(value.races).every(
    ([id, race]) =>
      marketIds.has(id) &&
      isRecord(race) &&
      race.marketId === id &&
      ["upcoming", "racing", "finished"].includes(String(race.status)) &&
      isTime(race.durationMs) &&
      race.durationMs > 0 &&
      race.simulated === true &&
      (race.startedAt === undefined || isTime(race.startedAt)) &&
      (race.status !== "racing" || isTime(race.startedAt)) &&
      (race.winner === null || isOutcome(race.winner)) &&
      (race.status !== "finished" || isOutcome(race.winner)),
  );
}
const STORAGE_KEY = "hunch.frontend.demo.v1";
const DEMO_STORAGE_SUFFIX = ".frontend.demo.v1";
function restoreState(saved: string): State | null {
  try {
    const restored: unknown = JSON.parse(saved, (_key, value) =>
      typeof value === "string" && /^bigint:\d+$/.test(value)
        ? BigInt(value.slice(7))
        : value,
    );
    return isState(restored) ? restored : null;
  } catch {
    return null;
  }
}
export const DEMO_WALLET = "DemoSpectator";
// A deterministic game-server fixture, never an authoritative live result.
const RACE_FIXTURE_WINNER: Outcome = 0;
function seed(): State {
  const now = Math.floor(Date.now() / 1000);
  const make = (
    id: string,
    question: string,
    outcomes: [string, string],
    pools: [bigint, bigint],
    extra: Partial<Market> = {},
  ): Market => ({
    id,
    question,
    outcomes,
    pools,
    totalPool: pools[0] + pools[1],
    status: "open",
    closesAt: now + 300,
    winningOutcome: null,
    createdAt: now - 3600,
    ...extra,
  });
  return {
    markets: [
      make(
        "race-42",
        "Who takes the checkered flag?",
        ["Player A", "Player B"],
        [620n, 380n],
        { application: "Velocity Racing", closesAt: now + 60 },
      ),
      make(
        "nova-titan",
        "Who wins the championship final?",
        ["Team Nova", "Team Titan"],
        [1840n, 1160n],
        { application: "Nexus Invitational", closesAt: now + 3600 },
      ),
      make(
        "orbit-echo",
        "Who advances to the final?",
        ["Team Orbit", "Team Echo"],
        [420n, 580n],
        {
          application: "Nexus Invitational",
          status: "resolved",
          winningOutcome: 1,
          closesAt: now - 1800,
        },
      ),
      make(
        "zenith-pulse",
        "Who wins the opening series?",
        ["Team Zenith", "Team Pulse"],
        [740n, 260n],
        { application: "Nexus Invitational", closesAt: now + 7200 },
      ),
    ],
    positions: [],
    balances: {},
    races: {},
    events: [
      {
        id: "seed-event",
        marketId: "orbit-echo",
        type: "confirmed",
        timestamp: now - 1800,
        message: "Simulated settlement · Team Echo wins",
        simulated: true,
      },
    ],
  };
}
export class MockHunchClient implements HunchClient {
  readonly mode = "mock" as const;
  private state: State;
  private listeners = new Set<() => void>();
  constructor(
    private readonly options: { persist?: boolean; latencyMs?: number } = {},
  ) {
    this.state = seed();
    if (options.persist !== false && typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved !== null) {
          const restored = restoreState(saved);
          if (restored) this.state = restored;
        } else {
          // Import a single validated same-origin snapshot from a previous
          // namespace. The versioned suffix identifies the demo ledger schema.
          let previous:
            { key: string; saved: string; state: State } | undefined;
          for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (
              !key ||
              key === STORAGE_KEY ||
              !key.endsWith(DEMO_STORAGE_SUFFIX)
            )
              continue;
            const candidate = localStorage.getItem(key);
            const restored =
              candidate !== null ? restoreState(candidate) : null;
            if (!restored || candidate === null) continue;
            // Ambiguous snapshots remain untouched rather than picking a ledger.
            if (previous) return;
            previous = { key, saved: candidate, state: restored };
          }
          if (previous) {
            this.state = previous.state;
            localStorage.setItem(STORAGE_KEY, previous.saved);
            localStorage.removeItem(previous.key);
          }
        }
      } catch {
        /* Keep the restored state or fixture when storage is unavailable. */
      }
    }
  }
  private async wait() {
    await new Promise((resolve) =>
      setTimeout(resolve, this.options.latencyMs ?? 280),
    );
  }
  private snapshot<T>(value: T): T {
    return structuredClone(value);
  }
  private save() {
    if (this.options.persist !== false && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(this.state, (_key, value) =>
            typeof value === "bigint" ? `bigint:${value}` : value,
          ),
        );
      } catch {
        /* Demo remains usable with blocked/full storage. */
      }
    }
    this.listeners.forEach((listener) => listener());
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private market(id: string) {
    const market = this.state.markets.find((item) => item.id === id);
    if (!market)
      throw new Error(
        `Market “${id}” was not found. Select an existing market or create one in the dashboard.`,
      );
    market.status = effectiveStatus(market);
    return market;
  }
  private balance(wallet: string) {
    return this.state.balances[wallet] ?? 1000n;
  }
  private event(marketId: string, type: MarketEvent["type"], message: string) {
    this.state.events.unshift({
      id: crypto.randomUUID(),
      marketId,
      type,
      message,
      timestamp: Math.floor(Date.now() / 1000),
      simulated: true,
    });
    this.state.events = this.state.events.slice(0, 100);
  }
  private receipt(): TransactionResult {
    return {
      signature: `demo-${crypto.randomUUID()}`,
      simulated: true,
      status: "submitted",
    };
  }
  async getMarket(id: string) {
    await this.wait();
    this.updateRace(id);
    return this.snapshot(this.market(id));
  }
  async listMarkets() {
    await this.wait();
    this.state.markets.forEach((market) => this.updateRace(market.id));
    return this.snapshot(
      this.state.markets.map((market) => ({
        ...market,
        status: effectiveStatus(market),
      })),
    );
  }
  async getPositions(id: string, wallet: string) {
    await this.wait();
    return this.snapshot(
      this.state.positions.filter(
        (position) => position.marketId === id && position.wallet === wallet,
      ),
    );
  }
  async getTokenBalance(wallet: string) {
    await this.wait();
    return this.balance(wallet);
  }
  async getClaimableAmount(id: string, wallet: string): Promise<Claimable> {
    await this.wait();
    const market = this.market(id);
    const positions = this.state.positions.filter(
      (position) => position.marketId === id && position.wallet === wallet,
    );
    if (market.status === "cancelled")
      return {
        amount: positions
          .filter((p) => !p.claimed)
          .reduce((sum, p) => sum + p.amount, 0n),
        claimed: positions.length > 0 && positions.every((p) => p.claimed),
      };
    const position = positions.find((p) => p.outcome === market.winningOutcome);
    if (market.status !== "resolved" || !position)
      return { amount: 0n, claimed: false };
    if (position.claimed) return { amount: 0n, claimed: true };
    const pool = market.pools[position.outcome];
    return {
      amount: pool === 0n ? 0n : (position.amount * market.totalPool) / pool,
      claimed: false,
    };
  }
  async predict(params: {
    marketId: string;
    outcome: Outcome;
    amount: bigint;
    walletAddress: string;
  }) {
    await this.wait();
    const market = this.market(params.marketId);
    if (!params.walletAddress)
      throw new Error("Connect the demo account first.");
    if (params.outcome !== 0 && params.outcome !== 1)
      throw new Error("Choose a valid outcome.");
    if (market.status !== "open")
      throw new Error("Predictions have closed for this market.");
    if (
      params.amount <= 0n ||
      params.amount > this.balance(params.walletAddress)
    )
      throw new Error("Insufficient TEST balance or invalid amount.");
    const position = this.state.positions.find(
      (p) =>
        p.marketId === params.marketId &&
        p.wallet === params.walletAddress &&
        p.outcome === params.outcome,
    );
    if (position) position.amount += params.amount;
    else
      this.state.positions.push({
        marketId: params.marketId,
        wallet: params.walletAddress,
        outcome: params.outcome,
        amount: params.amount,
        claimed: false,
      });
    market.pools[params.outcome] += params.amount;
    market.totalPool += params.amount;
    this.state.balances[params.walletAddress] =
      this.balance(params.walletAddress) - params.amount;
    this.event(
      market.id,
      "prediction",
      `${params.amount} TEST committed to ${market.outcomes[params.outcome]} (simulated)`,
    );
    this.save();
    return this.receipt();
  }
  async claimWinnings(params: {
    marketId: string;
    outcome: Outcome;
    walletAddress: string;
  }) {
    const eligible = await this.getClaimableAmount(
      params.marketId,
      params.walletAddress,
    );
    const market = this.market(params.marketId);
    if (
      market.status === "resolved" &&
      params.outcome !== market.winningOutcome
    )
      throw new Error("This is not the winning outcome.");
    if (eligible.claimed || eligible.amount <= 0n)
      throw new Error("There is no unclaimed payout for this account.");
    // Re-check after the asynchronous boundary to reject two simultaneous claims.
    const positions = this.state.positions.filter(
      (p) =>
        p.marketId === market.id &&
        p.wallet === params.walletAddress &&
        (market.status === "cancelled" || p.outcome === params.outcome),
    );
    if (positions.every((p) => p.claimed))
      throw new Error("This payout was already claimed.");
    positions.forEach((p) => {
      p.claimed = true;
    });
    this.state.balances[params.walletAddress] =
      this.balance(params.walletAddress) + eligible.amount;
    this.event(
      market.id,
      "claim",
      `${eligible.amount} TEST claimed (simulated)`,
    );
    this.save();
    return this.receipt();
  }
  async createMarket(params: CreateMarketParams) {
    await this.wait();
    if (
      !params.question.trim() ||
      params.outcomes.some((label) => !label.trim()) ||
      params.outcomes[0].trim() === params.outcomes[1].trim() ||
      params.closesAt <= Date.now() / 1000
    )
      throw new Error(
        "Provide a question, two distinct outcomes, and a future closing time.",
      );
    const market: Market = {
      ...params,
      id: `market-${crypto.randomUUID()}`,
      pools: [0n, 0n],
      totalPool: 0n,
      status: "open",
      winningOutcome: null,
      createdAt: Math.floor(Date.now() / 1000),
      application: "Your application",
    };
    this.state.markets.unshift(market);
    this.event(market.id, "created", "Market created (simulated)");
    this.save();
    return { market: this.snapshot(market), transaction: this.receipt() };
  }
  async confirmTransaction(result: TransactionResult) {
    await this.wait();
    if (!result.simulated)
      throw new Error(
        "A real transaction cannot be confirmed by the mock client.",
      );
    return { ...result, status: "confirmed" as const };
  }
  async getEvents() {
    await this.wait();
    return this.snapshot(this.state.events);
  }
  private updateRace(id: string) {
    const race = this.state.races[id];
    if (
      race?.status === "racing" &&
      race.startedAt !== undefined &&
      Date.now() >= race.startedAt + race.durationMs
    ) {
      race.status = "finished";
      race.winner = RACE_FIXTURE_WINNER;
      const market = this.market(id);
      market.status = "resolved";
      market.winningOutcome = race.winner;
      this.event(
        id,
        "event_received",
        "Simulated game-server fixture received",
      );
      this.event(
        id,
        "signature_verified",
        "Signature verification simulated · no real signature was verified",
      );
      this.event(
        id,
        "confirmed",
        "Simulated resolution completed · Player A wins",
      );
      this.save();
    }
  }
  async getRace(id: string) {
    await this.wait();
    this.market(id);
    this.updateRace(id);
    return this.snapshot(
      this.state.races[id] ?? {
        marketId: id,
        status: "upcoming",
        durationMs: 12000,
        winner: null,
        simulated: true,
      },
    );
  }
  async startRace(id: string) {
    await this.wait();
    const market = this.market(id);
    if (market.status !== "closed")
      throw new Error("The market must close before the race starts.");
    if (this.state.races[id]?.status === "racing")
      throw new Error("This race is already running.");
    const race: RaceState = {
      marketId: id,
      status: "racing",
      startedAt: Date.now(),
      durationMs: 12000,
      winner: null,
      simulated: true,
    };
    this.state.races[id] = race;
    this.save();
    return this.snapshot(race);
  }
  async newDemoRace() {
    const { market } = await this.createMarket({
      question: "Who takes the checkered flag?",
      outcomes: ["Player A", "Player B"],
      closesAt: Math.floor(Date.now() / 1000) + 120,
    });
    return market;
  }
  async closeDemoMarket(id: string) {
    await this.wait();
    const market = this.market(id);
    if (market.status !== "open")
      throw new Error("Only an open simulated market can be closed.");
    market.closesAt = Math.floor(Date.now() / 1000);
    market.status = "closed";
    this.save();
  }
}
