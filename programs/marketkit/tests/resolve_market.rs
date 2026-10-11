use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{clock::Clock, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    marketkit::state::{Market, MarketStatus},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const ONE_HOUR: i64 = 3_600;

struct Fixture {
    svm: LiteSVM,
    creator: Keypair,
    resolver: Keypair,
    market: Pubkey,
    deadline: i64,
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) -> Result<(), String> {
    // A fresh blockhash keeps repeated identical instructions from being deduplicated.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|failure| format!("{:?}", failure.err))
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar::<Clock>(&clock);
}

fn setup() -> Fixture {
    let program_id = marketkit::id();
    let creator = Keypair::new();
    let resolver = Keypair::new();
    let market_id = [9u8; 32];
    let (market, _) = Pubkey::find_program_address(
        &[
            marketkit::constants::MARKET_SEED,
            creator.pubkey().as_ref(),
            market_id.as_ref(),
        ],
        &program_id,
    );
    let mut svm = LiteSVM::new();
    svm.add_program(
        program_id,
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/marketkit.so"
        )),
    )
    .unwrap();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&resolver.pubkey(), 1_000_000_000).unwrap();
    let deadline = svm.get_sysvar::<Clock>().unix_timestamp + ONE_HOUR;
    let create = Instruction::new_with_bytes(
        program_id,
        &marketkit::instruction::CreateMarket {
            market_id,
            deadline,
            resolver: resolver.pubkey(),
            token_mint: Pubkey::new_unique(),
        }
        .data(),
        marketkit::accounts::CreateMarket {
            authority: creator.pubkey(),
            market,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, create, &creator).expect("create_market failed");
    Fixture {
        svm,
        creator,
        resolver,
        market,
        deadline,
    }
}

fn resolve_ix(market: Pubkey, resolver: &Pubkey, winning_outcome: u8) -> Instruction {
    Instruction::new_with_bytes(
        marketkit::id(),
        &marketkit::instruction::ResolveMarket { winning_outcome }.data(),
        marketkit::accounts::ResolveMarket {
            resolver: *resolver,
            market,
        }
        .to_account_metas(None),
    )
}

fn market_state(svm: &LiteSVM, market: &Pubkey) -> Market {
    let account = svm.get_account(market).unwrap();
    Market::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn test_resolve_rejected_while_market_is_open() {
    let mut f = setup();
    let ix = resolve_ix(f.market, &f.resolver.pubkey(), 1);
    let err = send(&mut f.svm, ix, &f.resolver).unwrap_err();
    assert!(
        err.contains("Custom(6004)"),
        "expected MarketStillOpen, got {err}"
    );
    let market = market_state(&f.svm, &f.market);
    assert_eq!(market.status, MarketStatus::Active);
    assert_eq!(market.winning_outcome, None);
}

#[test]
fn test_resolve_rejected_one_second_before_deadline() {
    let mut f = setup();
    set_time(&mut f.svm, f.deadline - 1);
    let ix = resolve_ix(f.market, &f.resolver.pubkey(), 0);
    let err = send(&mut f.svm, ix, &f.resolver).unwrap_err();
    assert!(
        err.contains("Custom(6004)"),
        "expected MarketStillOpen, got {err}"
    );
}

#[test]
fn test_resolve_succeeds_at_deadline_and_only_once() {
    let mut f = setup();
    set_time(&mut f.svm, f.deadline);
    let ix = resolve_ix(f.market, &f.resolver.pubkey(), 1);
    send(&mut f.svm, ix, &f.resolver).expect("resolution at the deadline should succeed");
    let market = market_state(&f.svm, &f.market);
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.winning_outcome, Some(1));

    let again = resolve_ix(f.market, &f.resolver.pubkey(), 0);
    let err = send(&mut f.svm, again, &f.resolver).unwrap_err();
    assert!(
        err.contains("Custom(6002)"),
        "expected MarketNotActive, got {err}"
    );
    assert_eq!(market_state(&f.svm, &f.market).winning_outcome, Some(1));
}

#[test]
fn test_resolve_rejects_other_signers_after_deadline() {
    let mut f = setup();
    set_time(&mut f.svm, f.deadline + ONE_HOUR);
    // The market creator is not its resolver; has_one rejects it (ConstraintHasOne = 2001).
    let ix = resolve_ix(f.market, &f.creator.pubkey(), 1);
    let err = send(&mut f.svm, ix, &f.creator).unwrap_err();
    assert!(
        err.contains("Custom(2001)"),
        "expected ConstraintHasOne, got {err}"
    );
    assert_eq!(market_state(&f.svm, &f.market).status, MarketStatus::Active);
}

#[test]
fn test_resolve_rejects_invalid_outcome_after_deadline() {
    let mut f = setup();
    set_time(&mut f.svm, f.deadline);
    let ix = resolve_ix(f.market, &f.resolver.pubkey(), 2);
    let err = send(&mut f.svm, ix, &f.resolver).unwrap_err();
    assert!(
        err.contains("Custom(6001)"),
        "expected InvalidOutcome, got {err}"
    );
}
