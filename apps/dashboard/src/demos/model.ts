// Exhibition ledger only. These actions never call a wallet, RPC, resolver, or DEX.
export type Side = 0 | 1; // Yes, No
export type Receipt = {
  id: string;
  action: string;
  tokens: number;
  lamports: number;
};
export type DemoState = {
  version: 1;
  connected: boolean;
  sol: number;
  tokens: number;
  faucetUsed: boolean;
  grantUsed: boolean;
  pool: [number, number];
  position: [number, number];
  claimed: boolean;
  placement: number | null;
  tick: number;
  receipts: Receipt[];
  activity: {
    id: number;
    name: string;
    side: Side;
    amount: number;
    cue: string;
  }[];
  history: { tick: number; share: number }[];
  exchangeSol: number;
  exchangeTokens: number;
};
export const FEE = 5_000;
export const LAMPORTS = 1_000_000_000;
export const INITIAL_POOL: [number, number] = [6_200, 3_800];
export function initialDemo(): DemoState {
  return {
    version: 1,
    connected: false,
    sol: 0,
    tokens: 0,
    faucetUsed: false,
    grantUsed: false,
    pool: [...INITIAL_POOL],
    position: [0, 0],
    claimed: false,
    placement: null,
    tick: 0,
    receipts: [],
    activity: [],
    history: [{ tick: 0, share: 62 }],
    exchangeSol: 100 * LAMPORTS,
    exchangeTokens: 1_000_000,
  };
}
export type MatchCue = { second: number; label: string; detail: string; bias: number };
export const CUES = [
  {
    second: 0,
    label: "Opening prediction",
    detail: "A fresh match. The modeled crowd starts at 62% Yes.",
    bias: 62,
  },
  {
    second: 30,
    label: "Elimination secured",
    detail: "Modeled viewers favor Yes after a successful fight.",
    bias: 86,
  },
  {
    second: 65,
    label: "Storm pressure",
    detail: "A risky rotation brings a wave of No stakes.",
    bias: 14,
  },
  {
    second: 100,
    label: "Shield recovered",
    detail: "Recovery shifts the modeled crowd back toward Yes.",
    bias: 82,
  },
  {
    second: 140,
    label: "Another fight",
    detail: "A second elimination attracts more Yes stakes.",
    bias: 91,
  },
  {
    second: 180,
    label: "Endgame pressure",
    detail: "The last rotation divides the modeled crowd.",
    bias: 26,
  },
  {
    second: 220,
    label: "Top-nine checkpoint",
    detail: "This exhibition scenario reaches ninth place. New stakes close.",
    bias: 100,
  },
] as const;
export function cueAt(second: number, cues: readonly MatchCue[] = CUES) {
  return [...cues].reverse().find((c) => c.second <= second) ?? cues[0];
}
export function share(pool: [number, number]) {
  return (pool[0] / (pool[0] + pool[1])) * 100;
}
export function payout(state: DemoState) {
  if (state.placement === null) return 0;
  const winner: Side = state.placement < 10 ? 0 : 1;
  return Math.floor(
    (state.position[winner] * (state.pool[0] + state.pool[1])) /
      state.pool[winner],
  );
}
export function quoteSwap(state: DemoState, input: number) {
  if (!Number.isSafeInteger(input) || input <= 0 || input > LAMPORTS) return 0;
  // Constant-product AMM model, no swap fee. SOL transaction fee is accounted separately.
  return Math.floor(
    (state.exchangeTokens * input) / (state.exchangeSol + input),
  );
}
export type Action =
  | { type: "connect" | "faucet" | "grant" | "claim" | "reset" | "restartMarket" }
  | { type: "stake"; side: Side; amount: number }
  | { type: "tick"; tick: number; second: number; cues?: readonly MatchCue[] }
  | { type: "cue"; cue: string; bias: number }
  | { type: "resolve"; placement: number }
  | { type: "swap"; input: number };
function receipt(
  state: DemoState,
  action: string,
  tokens = 0,
  lamports = -FEE,
) {
  const sequence = Number(state.receipts[0]?.id.replace("DEMO-", "") ?? 0) + 1;
  return [
    {
      id: `DEMO-${String(sequence).padStart(4, "0")}`,
      action,
      tokens,
      lamports,
    },
    ...state.receipts,
  ].slice(0, 100);
}
function crowd(
  state: DemoState,
  bias: number,
  cue: string,
  tick: number,
): DemoState {
  const pool: [number, number] = [...state.pool];
  const trades = Array.from({ length: 3 }, (_, i) => {
    const side: Side = (tick * 37 + i * 23) % 100 < bias ? 0 : 1;
    const amount = 40 + ((tick * 17 + i * 53) % 180);
    pool[side] += amount;
    return {
      id: tick * 3 + i,
      name: [
        "stormwatch",
        "dropzone",
        "builddiff",
        "endgame",
        "highground",
        "zonecaller",
      ][(tick + i) % 6],
      side,
      amount,
      cue,
    };
  });
  return {
    ...state,
    pool,
    tick,
    activity: [...trades, ...state.activity].slice(0, 24),
    history: [...state.history, { tick, share: share(pool) }].slice(-100),
  };
}
export function demoReducer(state: DemoState, action: Action): DemoState {
  switch (action.type) {
    case "reset":
      return initialDemo();
    case "restartMarket": {
      // Restart the exhibition, keeping funding usable across page visits.
      // Release unclaimed demo stakes so reopening never silently loses credits.
      const returned = state.claimed ? 0 : state.position[0] + state.position[1];
      return {
        ...state,
        pool: [...INITIAL_POOL],
        position: [0, 0],
        tokens: state.tokens + returned,
        claimed: false,
        placement: null,
        tick: 0,
        activity: [],
        history: [{ tick: 0, share: 62 }],
        receipts: returned ? receipt(state, "Restart demo · release unclaimed stakes", returned, 0) : state.receipts,
      };
    }
    case "connect":
      return { ...state, connected: true };
    case "faucet":
      return !state.connected || state.faucetUsed
        ? state
        : {
            ...state,
            faucetUsed: true,
            sol: state.sol + LAMPORTS / 4,
            receipts: receipt(state, "Demo SOL faucet", 0, LAMPORTS / 4),
          };
    case "grant":
      return !state.connected || state.grantUsed || state.sol < FEE
        ? state
        : {
            ...state,
            grantUsed: true,
            tokens: state.tokens + 1_000,
            sol: state.sol - FEE,
            receipts: receipt(state, "Demo HUNCH grant", 1_000),
          };
    case "stake": {
      if (
        !state.connected ||
        state.placement !== null ||
        ![0, 1].includes(action.side) ||
        !Number.isSafeInteger(action.amount) ||
        action.amount <= 0 ||
        action.amount > state.tokens ||
        state.sol < FEE
      )
        return state;
      const pool: [number, number] = [...state.pool];
      const position: [number, number] = [...state.position];
      pool[action.side] += action.amount;
      position[action.side] += action.amount;
      return {
        ...state,
        pool,
        position,
        tokens: state.tokens - action.amount,
        sol: state.sol - FEE,
        receipts: receipt(
          state,
          `Stake ${action.side === 0 ? "Yes" : "No"}`,
          -action.amount,
        ),
        activity: [
          {
            id: -state.receipts.length - 1,
            name: "You",
            side: action.side,
            amount: action.amount,
            cue: "Your prediction",
          },
          ...state.activity,
        ].slice(0, 24),
        history: [
          ...state.history,
          { tick: state.tick, share: share(pool) },
        ].slice(-100),
      };
    }
    case "tick": {
      if (
        state.placement !== null ||
        !Number.isInteger(action.tick) ||
        action.tick <= state.tick ||
        action.tick > 55
      )
        return state;
      let next = state;
      for (let tick = state.tick + 1; tick <= action.tick; tick++) {
        const cue = cueAt(Math.min(action.second, tick * 4), action.cues);
        next = crowd(next, cue.bias, cue.label, tick);
      }
      return next;
    }
    case "cue":
      return state.placement !== null
        ? state
        : crowd(
            state,
            Math.max(0, Math.min(100, action.bias)),
            action.cue,
            state.tick + 1,
          );
    case "resolve":
      return state.placement !== null ||
        !Number.isInteger(action.placement) ||
        action.placement < 1 ||
        action.placement > 100
        ? state
        : {
            ...state,
            placement: action.placement,
            receipts: receipt(
              state,
              `Modeled resolver: #${action.placement} → ${action.placement < 10 ? "Yes" : "No"}`,
              0,
              0,
            ),
          };
    case "claim": {
      const amount = payout(state);
      if (!state.connected || state.claimed || !amount || state.sol < FEE)
        return state;
      return {
        ...state,
        claimed: true,
        tokens: state.tokens + amount,
        sol: state.sol - FEE,
        receipts: receipt(state, "Claim winnings", amount),
      };
    }
    case "swap": {
      const output = quoteSwap(state, action.input);
      if (!state.connected || output <= 0 || state.sol < action.input + FEE)
        return state;
      return {
        ...state,
        sol: state.sol - action.input - FEE,
        tokens: state.tokens + output,
        exchangeSol: state.exchangeSol + action.input,
        exchangeTokens: state.exchangeTokens - output,
        receipts: receipt(
          state,
          "Modeled SOL → HUNCH swap",
          output,
          -action.input - FEE,
        ),
      };
    }
  }
}
export function loadDemo(raw: string | null): DemoState {
  if (!raw) return initialDemo();
  try {
    const s = JSON.parse(raw) as DemoState;
    const uint = (v: unknown) =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    if (
      s.version !== 1 ||
      ![s.connected, s.faucetUsed, s.grantUsed, s.claimed].every(
        (v) => typeof v === "boolean",
      ) ||
      ![s.sol, s.tokens, s.tick, s.exchangeSol, s.exchangeTokens].every(uint) ||
      !Array.isArray(s.pool) ||
      s.pool.length !== 2 ||
      !s.pool.every((v) => uint(v) && v > 0) ||
      !Array.isArray(s.position) ||
      s.position.length !== 2 ||
      !s.position.every(uint) ||
      !(
        s.placement === null ||
        (Number.isInteger(s.placement) &&
          s.placement >= 1 &&
          s.placement <= 100)
      ) ||
      !Array.isArray(s.receipts) ||
      !Array.isArray(s.activity) ||
      !Array.isArray(s.history)
    )
      return initialDemo();
    if (
      !s.receipts.every(
        (r) =>
          typeof r.id === "string" &&
          typeof r.action === "string" &&
          Number.isFinite(r.tokens) &&
          Number.isFinite(r.lamports),
      ) ||
      !s.activity.every(
        (a) =>
          typeof a.name === "string" &&
          typeof a.cue === "string" &&
          [0, 1].includes(a.side) &&
          uint(a.amount) &&
          Number.isInteger(a.id),
      ) ||
      !s.history.every(
        (h) =>
          uint(h.tick) &&
          Number.isFinite(h.share) &&
          h.share >= 0 &&
          h.share <= 100,
      )
    )
      return initialDemo();
    return {
      ...s,
      receipts: s.receipts.slice(0, 100),
      activity: s.activity.slice(0, 24),
      history: s.history.slice(-100),
    };
  } catch {
    return initialDemo();
  }
}
