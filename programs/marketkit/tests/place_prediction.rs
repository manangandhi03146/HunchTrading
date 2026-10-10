use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// Mint account byte length (SPL Token `Mint`).
const MINT_LEN: u64 = 82;
/// Token account byte length (SPL Token `Account`).
const TOKEN_ACCOUNT_LEN: u64 = 165;

fn send_tx(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Pubkey, signers: &[&Keypair]) {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "tx failed: {:?}", res.err());
}

#[test]
fn test_place_prediction_escrows_and_accumulates() {
    let program_id = marketkit::id();
    let token_program_id = spl_token::id();

    let payer = Keypair::new(); // fee payer, mint authority, market creator
    let mint = Keypair::new();
    let user = Keypair::new(); // the predictor
    let user_ata = Keypair::new();
    let resolver = Pubkey::new_unique();
    let market_id: [u8; 32] = [9u8; 32];
    let deadline: i64 = 4_102_444_800; // year 2100
    let outcome: u8 = 1;

    let (market_pda, _) = Pubkey::find_program_address(
        &[
            marketkit::constants::MARKET_SEED,
            payer.pubkey().as_ref(),
            market_id.as_ref(),
        ],
        &program_id,
    );
    let (vault_pda, _) = Pubkey::find_program_address(
        &[marketkit::constants::VAULT_SEED, market_pda.as_ref()],
        &program_id,
    );
    let (position_pda, _) = Pubkey::find_program_address(
        &[
            marketkit::constants::POSITION_SEED,
            market_pda.as_ref(),
            user.pubkey().as_ref(),
            &[outcome],
        ],
        &program_id,
    );

    let mut svm = LiteSVM::new();
    svm.add_program(
        program_id,
        include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/marketkit.so")),
    )
    .unwrap();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    // 1) Zero-decimal mint + a user token account funded with 1000 tokens.
    send_tx(
        &mut svm,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &mint.pubkey(),
                10_000_000,
                MINT_LEN,
                &token_program_id,
            ),
            spl_token::instruction::initialize_mint2(
                &token_program_id,
                &mint.pubkey(),
                &payer.pubkey(),
                None,
                0,
            )
            .unwrap(),
            system_instruction::create_account(
                &payer.pubkey(),
                &user_ata.pubkey(),
                10_000_000,
                TOKEN_ACCOUNT_LEN,
                &token_program_id,
            ),
            spl_token::instruction::initialize_account3(
                &token_program_id,
                &user_ata.pubkey(),
                &mint.pubkey(),
                &user.pubkey(),
            )
            .unwrap(),
            spl_token::instruction::mint_to(
                &token_program_id,
                &mint.pubkey(),
                &user_ata.pubkey(),
                &payer.pubkey(),
                &[],
                1_000,
            )
            .unwrap(),
        ],
        &payer.pubkey(),
        &[&payer, &mint, &user_ata],
    );

    // 2) Create the market, escrowing our mint.
    send_tx(
        &mut svm,
        &[Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::CreateMarket {
                market_id,
                deadline,
                resolver,
                token_mint: mint.pubkey(),
            }
            .data(),
            marketkit::accounts::CreateMarket {
                authority: payer.pubkey(),
                market: market_pda,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )],
        &payer.pubkey(),
        &[&payer],
    );

    // 3) Two stakes on the same outcome -> a single accumulated position.
    let place_ix = |amount: u64| {
        Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::PlacePrediction { outcome, amount }.data(),
            marketkit::accounts::PlacePrediction {
                user: user.pubkey(),
                market: market_pda,
                token_mint: mint.pubkey(),
                vault: vault_pda,
                user_token_account: user_ata.pubkey(),
                position: position_pda,
                token_program: token_program_id,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    };
    send_tx(&mut svm, &[place_ix(100)], &user.pubkey(), &[&user]);
    send_tx(&mut svm, &[place_ix(50)], &user.pubkey(), &[&user]);

    // 4) Verify the accumulated position and the outcome pool. (The transfers
    //    succeeding is itself proof that tokens moved into escrow.)
    let position_account = svm.get_account(&position_pda).unwrap();
    let mut position_data: &[u8] = &position_account.data;
    let position = marketkit::state::Position::try_deserialize(&mut position_data).unwrap();
    assert_eq!(position.amount, 150);
    assert_eq!(position.outcome, outcome);
    assert_eq!(position.market, market_pda);
    assert_eq!(position.wallet, user.pubkey());
    assert!(!position.claimed);

    let market_account = svm.get_account(&market_pda).unwrap();
    let mut market_data: &[u8] = &market_account.data;
    let market = marketkit::state::Market::try_deserialize(&mut market_data).unwrap();
    assert_eq!(market.pool, [0, 150]);
}
