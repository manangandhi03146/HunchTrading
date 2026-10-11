/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/marketkit.json`.
 */
export type Marketkit = {
  "address": "J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP",
  "metadata": {
    "name": "marketkit",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "claimWinnings",
      "docs": [
        "A6 — a winner claims their proportional share of the pool from escrow."
      ],
      "discriminator": [
        161,
        215,
        24,
        59,
        14,
        236,
        242,
        221
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.authority",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.marketId",
                "account": "market"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "tokenMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "docs": [
            "The caller's position. Seed derivation binds it to (market, user,",
            "outcome), so a user can only ever claim their own position."
          ],
          "writable": true
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "docs": [
        "A3 — create a binary prediction market. Records the market metadata",
        "on-chain; the escrow vault + staking arrive in A4."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Creator + rent payer. Becomes the market `authority`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "arg",
                "path": "marketId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "resolver",
          "type": "pubkey"
        },
        {
          "name": "tokenMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "placePrediction",
      "docs": [
        "A4 — stake `amount` test-tokens on `outcome` (0 or 1). Transfers into",
        "the market's escrow vault and records an accumulated Position."
      ],
      "discriminator": [
        79,
        46,
        195,
        197,
        50,
        91,
        88,
        229
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The predictor. Signs the token transfer and pays rent for the",
            "vault / position accounts on first use."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "docs": [
            "Re-derived from its stored seeds so a forged address can't be passed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.authority",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.marketId",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "vault",
          "docs": [
            "Per-market escrow vault, owned (signed for) by the Market PDA.",
            "Created on the first prediction, reused thereafter."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "The user's token account funding the stake."
          ],
          "writable": true
        },
        {
          "name": "position",
          "docs": [
            "One accumulated position per (market, wallet, outcome)."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolveMarket",
      "docs": [
        "A5 — the market's resolver records the verified winning outcome."
      ],
      "discriminator": [
        155,
        23,
        80,
        173,
        46,
        74,
        23,
        239
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Must match `market.resolver` (enforced by `has_one`). This is the",
            "MarketKit-managed key that submits verified outcomes."
          ],
          "signer": true,
          "relations": [
            "market"
          ]
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.authority",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.marketId",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "winningOutcome",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "deadlineInPast",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6001,
      "name": "invalidOutcome",
      "msg": "Outcome must be 0 or 1"
    },
    {
      "code": 6002,
      "name": "marketNotActive",
      "msg": "Market is not active"
    },
    {
      "code": 6003,
      "name": "marketClosed",
      "msg": "Market deadline has passed"
    },
    {
      "code": 6004,
      "name": "marketStillOpen",
      "msg": "Market deadline has not passed yet"
    },
    {
      "code": 6005,
      "name": "marketNotResolved",
      "msg": "Market is not resolved"
    },
    {
      "code": 6006,
      "name": "unauthorizedResolver",
      "msg": "Only the market's resolver may submit the outcome"
    },
    {
      "code": 6007,
      "name": "alreadyClaimed",
      "msg": "Position has already been claimed"
    },
    {
      "code": 6008,
      "name": "notWinningPosition",
      "msg": "This position did not back the winning outcome"
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "market",
      "docs": [
        "A single binary prediction market.",
        "",
        "PDA seeds: [\"market\", authority, market_id]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Creator / owner of the market (also part of the PDA seeds)."
            ],
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "docs": [
              "MarketKit-managed key authorized to submit the verified outcome."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "docs": [
              "SPL test-token mint this market escrows (zero decimals => integer amounts)."
            ],
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "docs": [
              "Fixed-size unique id (not an unbounded string)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deadline",
            "docs": [
              "Unix seconds. `open` vs `closed` is derived from this off-chain."
            ],
            "type": "i64"
          },
          {
            "name": "pool",
            "docs": [
              "Total staked per outcome: [pool_0, pool_1]."
            ],
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "winningOutcome",
            "docs": [
              "Winning outcome, set once resolved."
            ],
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "docs": [
        "On-chain lifecycle. We deliberately store only THREE states, not four:",
        "the SDK derives `open` vs `closed` from the deadline, so on-chain we only",
        "record the two final states plus the pre-resolution `Active` state."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "resolved"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "One accumulated position per (market, wallet, outcome).",
        "",
        "PDA seeds: [\"position\", market, wallet, outcome]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "marketSeed",
      "type": "bytes",
      "value": "[109, 97, 114, 107, 101, 116]"
    },
    {
      "name": "positionSeed",
      "type": "bytes",
      "value": "[112, 111, 115, 105, 116, 105, 111, 110]"
    },
    {
      "name": "vaultSeed",
      "docs": [
        "Seed for the per-market escrow vault token account (used from A4 onward)."
      ],
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
