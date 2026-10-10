use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_create_market() {
    let program_id = marketkit::id();
    let authority = Keypair::new();
    let resolver = Pubkey::new_unique();
    let token_mint = Pubkey::new_unique();
    let market_id: [u8; 32] = [7u8; 32];
    let deadline: i64 = 4_102_444_800; // year 2100

    let (market_pda, _bump) = Pubkey::find_program_address(
        &[
            marketkit::constants::MARKET_SEED,
            authority.pubkey().as_ref(),
            market_id.as_ref(),
        ],
        &program_id,
    );

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/marketkit.so"));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        program_id,
        &marketkit::instruction::CreateMarket {
            market_id,
            deadline,
            resolver,
            token_mint,
        }
        .data(),
        marketkit::accounts::CreateMarket {
            authority: authority.pubkey(),
            market: market_pda,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "create_market failed: {:?}", res.err());

    // Verify the stored market state.
    let account = svm.get_account(&market_pda).unwrap();
    let mut data: &[u8] = &account.data;
    let market = marketkit::state::Market::try_deserialize(&mut data).unwrap();

    assert_eq!(market.authority, authority.pubkey());
    assert_eq!(market.resolver, resolver);
    assert_eq!(market.token_mint, token_mint);
    assert_eq!(market.market_id, market_id);
    assert_eq!(market.deadline, deadline);
    assert_eq!(market.pool, [0, 0]);
    assert_eq!(market.winning_outcome, None);
    assert_eq!(market.status, marketkit::state::MarketStatus::Active);
}
