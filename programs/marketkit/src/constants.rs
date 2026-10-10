use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

/// Seed for the per-market escrow vault token account (used from A4 onward).
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
