use {
    anchor_lang::{
        prelude::{Pubkey, Clock},
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

const MINT_LEN: u64 = 82;
const TOKEN_ACCOUNT_LEN: u64 = 165;

fn send_tx(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Pubkey, signers: &[&Keypair]) {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    assert!(svm.send_transaction(tx).is_ok(), "tx unexpectedly failed");
}

fn expect_tx_fails(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Pubkey, signers: &[&Keypair], code: u32) {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let failure = svm.send_transaction(tx).expect_err("tx unexpectedly succeeded");
    assert_eq!(format!("{:?}", failure.err), format!("InstructionError(0, Custom({code}))"), "{:?}", failure.meta.logs);
}

/// Reads an SPL token account's `amount` (u64 at byte offset 64).
fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let data = svm.get_account(token_account).unwrap().data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn create_mint(svm: &mut LiteSVM, payer: &Keypair, token_program: &Pubkey) -> Pubkey {
    let mint = Keypair::new();
    send_tx(
        svm,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &mint.pubkey(),
                10_000_000,
                MINT_LEN,
                token_program,
            ),
            spl_token::instruction::initialize_mint2(
                token_program,
                &mint.pubkey(),
                &payer.pubkey(),
                None,
                0,
            )
            .unwrap(),
        ],
        &payer.pubkey(),
        &[payer, &mint],
    );
    mint.pubkey()
}

fn create_funded_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
    token_program: &Pubkey,
) -> Pubkey {
    let acct = Keypair::new();
    send_tx(
        svm,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &acct.pubkey(),
                10_000_000,
                TOKEN_ACCOUNT_LEN,
                token_program,
            ),
            spl_token::instruction::initialize_account3(token_program, &acct.pubkey(), mint, owner)
                .unwrap(),
            spl_token::instruction::mint_to(
                token_program,
                mint,
                &acct.pubkey(),
                &payer.pubkey(),
                &[],
                amount,
            )
            .unwrap(),
        ],
        &payer.pubkey(),
        &[payer, &acct],
    );
    acct.pubkey()
}

#[test]
fn test_full_lifecycle_create_stake_resolve_claim() {
    let program_id = marketkit::id();
    let tp = spl_token::id();

    // payer is also the mint authority, market creator, and resolver.
    let payer = Keypair::new();
    let user_a = Keypair::new(); // backs the winning outcome (1)
    let user_b = Keypair::new(); // backs the losing outcome (0)

    let market_id: [u8; 32] = [3u8; 32];
    let deadline: i64 = 4_102_444_800; // year 2100

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
    let (pos_a, _) = Pubkey::find_program_address(
        &[
            marketkit::constants::POSITION_SEED,
            market_pda.as_ref(),
            user_a.pubkey().as_ref(),
            &[1],
        ],
        &program_id,
    );
    let (pos_b, _) = Pubkey::find_program_address(
        &[
            marketkit::constants::POSITION_SEED,
            market_pda.as_ref(),
            user_b.pubkey().as_ref(),
            &[0],
        ],
        &program_id,
    );

    let mut svm = LiteSVM::new();
    svm.add_program(
        program_id,
        include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/marketkit.so")),
    )
    .unwrap();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&user_a.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();

    let mint = create_mint(&mut svm, &payer, &tp);
    let a_ata = create_funded_token_account(&mut svm, &payer, &mint, &user_a.pubkey(), 1_000, &tp);
    let b_ata = create_funded_token_account(&mut svm, &payer, &mint, &user_b.pubkey(), 1_000, &tp);

    // --- Create ---
    send_tx(
        &mut svm,
        &[Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::CreateMarket {
                market_id,
                deadline,
                resolver: payer.pubkey(),
                token_mint: mint,
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

    // --- Stake: A backs outcome 1 with 100, B backs outcome 0 with 250 ---
    let stake = |user: &Pubkey, outcome: u8, amount: u64, user_ata: Pubkey, position: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::PlacePrediction { outcome, amount }.data(),
            marketkit::accounts::PlacePrediction {
                user: *user,
                market: market_pda,
                token_mint: mint,
                vault: vault_pda,
                user_token_account: user_ata,
                position,
                token_program: tp,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    };
    send_tx(&mut svm, &[stake(&user_a.pubkey(), 1, 100, a_ata, pos_a)], &user_a.pubkey(), &[&user_a]);
    send_tx(&mut svm, &[stake(&user_b.pubkey(), 0, 250, b_ata, pos_b)], &user_b.pubkey(), &[&user_b]);

    assert_eq!(token_balance(&svm, &a_ata), 900);
    assert_eq!(token_balance(&svm, &b_ata), 750);
    assert_eq!(token_balance(&svm, &vault_pda), 350);

    // --- Resolve: outcome 1 wins (submitted by the resolver = payer) ---
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = deadline;
    svm.set_sysvar(&clock);
    send_tx(
        &mut svm,
        &[Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::ResolveMarket { winning_outcome: 1 }.data(),
            marketkit::accounts::ResolveMarket {
                resolver: payer.pubkey(),
                market: market_pda,
            }
            .to_account_metas(None),
        )],
        &payer.pubkey(),
        &[&payer],
    );

    // --- Claim ---
    let claim = |user: &Pubkey, position: Pubkey, user_ata: Pubkey| {
        Instruction::new_with_bytes(
            program_id,
            &marketkit::instruction::ClaimWinnings {}.data(),
            marketkit::accounts::ClaimWinnings {
                user: *user,
                market: market_pda,
                token_mint: mint,
                vault: vault_pda,
                position,
                user_token_account: user_ata,
                token_program: tp,
            }
            .to_account_metas(None),
        )
    };

    // Loser (B) cannot claim — backed the losing outcome.
    expect_tx_fails(&mut svm, &[claim(&user_b.pubkey(), pos_b, b_ata)], &user_b.pubkey(), &[&user_b], 6008);

    // Winner (A) claims the whole 350 pool (sole winner): 100 * 350 / 100.
    send_tx(&mut svm, &[claim(&user_a.pubkey(), pos_a, a_ata)], &user_a.pubkey(), &[&user_a]);
    assert_eq!(token_balance(&svm, &a_ata), 1_250);
    assert_eq!(token_balance(&svm, &vault_pda), 0);

    // Position is marked claimed.
    let pos_account = svm.get_account(&pos_a).unwrap();
    let mut pos_data: &[u8] = &pos_account.data;
    let position = marketkit::state::Position::try_deserialize(&mut pos_data).unwrap();
    assert!(position.claimed);

    // Double-claim is rejected.
    expect_tx_fails(&mut svm, &[claim(&user_a.pubkey(), pos_a, a_ata)], &user_a.pubkey(), &[&user_a], 6007);
}
