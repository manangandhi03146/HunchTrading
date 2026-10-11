use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{instruction::Instruction, system_instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::spl_token;
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn transaction(
    svm: &mut LiteSVM,
    ix: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> Result<(), FailedTransactionMetadata> {
    // An identical instruction must reach the program again, rather than fail AlreadyProcessed.
    svm.expire_blockhash();
    let message = Message::new_with_blockhash(ix, Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut signers = vec![payer];
    signers.extend_from_slice(extra);
    svm.send_transaction(
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &signers).unwrap(),
    )
    .map(|_| ())
}

fn reject(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, code: u32) {
    let err = transaction(svm, &[ix], payer, &[]).expect_err("operation unexpectedly succeeded");
    assert_eq!(
        format!("{:?}", err.err),
        format!("InstructionError(0, Custom({code}))"),
        "{:?}",
        err.meta.logs
    );
}

struct Fixture {
    svm: LiteSVM,
    creator: Keypair,
    resolver: Keypair,
    users: [Keypair; 3],
    tokens: [Pubkey; 3],
    mint: Pubkey,
    market: Pubkey,
    vault: Pubkey,
    deadline: i64,
}

impl Fixture {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            marketkit::id(),
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/marketkit.so"
            )),
        )
        .unwrap();
        let creator = Keypair::new();
        let resolver = Keypair::new();
        let users = [Keypair::new(), Keypair::new(), Keypair::new()];
        for wallet in [&creator, &resolver, &users[0], &users[1], &users[2]] {
            svm.airdrop(&wallet.pubkey(), 100_000_000_000).unwrap();
        }
        let mint_key = Keypair::new();
        let mint = mint_key.pubkey();
        transaction(
            &mut svm,
            &[
                system_instruction::create_account(
                    &creator.pubkey(),
                    &mint,
                    10_000_000,
                    82,
                    &spl_token::id(),
                ),
                spl_token::instruction::initialize_mint2(
                    &spl_token::id(),
                    &mint,
                    &creator.pubkey(),
                    None,
                    0,
                )
                .unwrap(),
            ],
            &creator,
            &[&mint_key],
        )
        .unwrap();
        let tokens = std::array::from_fn(|i| {
            let account = Keypair::new();
            transaction(
                &mut svm,
                &[
                    system_instruction::create_account(
                        &creator.pubkey(),
                        &account.pubkey(),
                        10_000_000,
                        165,
                        &spl_token::id(),
                    ),
                    spl_token::instruction::initialize_account3(
                        &spl_token::id(),
                        &account.pubkey(),
                        &mint,
                        &users[i].pubkey(),
                    )
                    .unwrap(),
                    spl_token::instruction::mint_to(
                        &spl_token::id(),
                        &mint,
                        &account.pubkey(),
                        &creator.pubkey(),
                        &[],
                        1000,
                    )
                    .unwrap(),
                ],
                &creator,
                &[&account],
            )
            .unwrap();
            account.pubkey()
        });
        let deadline = svm.get_sysvar::<Clock>().unix_timestamp + 300;
        let id = [42; 32];
        let market = Pubkey::find_program_address(
            &[b"market", creator.pubkey().as_ref(), &id],
            &marketkit::id(),
        )
        .0;
        let vault = Pubkey::find_program_address(&[b"vault", market.as_ref()], &marketkit::id()).0;
        let ix = Instruction::new_with_bytes(
            marketkit::id(),
            &marketkit::instruction::CreateMarket {
                market_id: id,
                deadline,
                resolver: resolver.pubkey(),
                token_mint: mint,
            }
            .data(),
            marketkit::accounts::CreateMarket {
                authority: creator.pubkey(),
                market,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        transaction(&mut svm, &[ix], &creator, &[]).unwrap();
        Self {
            svm,
            creator,
            resolver,
            users,
            tokens,
            mint,
            market,
            vault,
            deadline,
        }
    }
    fn clock(&mut self, time: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = time;
        self.svm.set_sysvar(&clock);
    }
    fn position(&self, user: usize, outcome: u8) -> Pubkey {
        Pubkey::find_program_address(
            &[
                b"position",
                self.market.as_ref(),
                self.users[user].pubkey().as_ref(),
                &[outcome],
            ],
            &marketkit::id(),
        )
        .0
    }
    fn stake(&self, user: usize, outcome: u8, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            marketkit::id(),
            &marketkit::instruction::PlacePrediction { outcome, amount }.data(),
            marketkit::accounts::PlacePrediction {
                user: self.users[user].pubkey(),
                market: self.market,
                token_mint: self.mint,
                vault: self.vault,
                user_token_account: self.tokens[user],
                position: self.position(user, outcome),
                token_program: spl_token::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }
    fn resolve(&self, resolver: Pubkey, outcome: u8) -> Instruction {
        Instruction::new_with_bytes(
            marketkit::id(),
            &marketkit::instruction::ResolveMarket {
                winning_outcome: outcome,
            }
            .data(),
            marketkit::accounts::ResolveMarket {
                resolver,
                market: self.market,
            }
            .to_account_metas(None),
        )
    }
    fn claim(&self, user: usize, outcome: u8) -> Instruction {
        Instruction::new_with_bytes(
            marketkit::id(),
            &marketkit::instruction::ClaimWinnings {}.data(),
            marketkit::accounts::ClaimWinnings {
                user: self.users[user].pubkey(),
                market: self.market,
                token_mint: self.mint,
                vault: self.vault,
                position: self.position(user, outcome),
                user_token_account: self.tokens[user],
                token_program: spl_token::id(),
            }
            .to_account_metas(None),
        )
    }
    fn market_state(&self) -> marketkit::state::Market {
        marketkit::state::Market::try_deserialize(
            &mut self.svm.get_account(&self.market).unwrap().data.as_slice(),
        )
        .unwrap()
    }
    fn position_state(&self, user: usize, outcome: u8) -> marketkit::state::Position {
        marketkit::state::Position::try_deserialize(
            &mut self
                .svm
                .get_account(&self.position(user, outcome))
                .unwrap()
                .data
                .as_slice(),
        )
        .unwrap()
    }
    fn balance(&self, address: Pubkey) -> u64 {
        u64::from_le_bytes(
            self.svm.get_account(&address).unwrap().data[64..72]
                .try_into()
                .unwrap(),
        )
    }
    fn place(&mut self, user: usize, outcome: u8, amount: u64) {
        let ix = self.stake(user, outcome, amount);
        transaction(&mut self.svm, &[ix], &self.users[user], &[]).unwrap();
    }
    fn resolved(&mut self) {
        self.clock(self.deadline);
        let ix = self.resolve(self.resolver.pubkey(), 1);
        transaction(&mut self.svm, &[ix], &self.resolver, &[]).unwrap();
    }
}

#[test]
fn early_resolution_regression() {
    let mut f = Fixture::new();
    f.clock(f.deadline - 1);
    let before = f.svm.get_account(&f.market).unwrap().data;
    let ix = f.resolve(f.resolver.pubkey(), 1);
    reject(&mut f.svm, ix, &f.resolver, 6004); // MarketStillOpen
    assert_eq!(f.svm.get_account(&f.market).unwrap().data, before);
}

#[test]
fn resolution_at_and_after_deadline_succeeds() {
    for offset in [0, 1] {
        let mut f = Fixture::new();
        f.clock(f.deadline + offset);
        let ix = f.resolve(f.resolver.pubkey(), 1);
        transaction(&mut f.svm, &[ix], &f.resolver, &[]).unwrap();
        assert_eq!(f.market_state().winning_outcome, Some(1));
        assert_eq!(
            f.market_state().status,
            marketkit::state::MarketStatus::Resolved
        );
        let ix = f.resolve(f.resolver.pubkey(), 1);
        reject(&mut f.svm, ix, &f.resolver, 6002);
    }
}

#[test]
fn creation_requires_strictly_future_deadline_and_rolls_back() {
    for offset in [-1, 0] {
        let mut f = Fixture::new();
        let id = [99; 32];
        let address = Pubkey::find_program_address(
            &[b"market", f.creator.pubkey().as_ref(), &id],
            &marketkit::id(),
        )
        .0;
        let ix = Instruction::new_with_bytes(
            marketkit::id(),
            &marketkit::instruction::CreateMarket {
                market_id: id,
                deadline: f.svm.get_sysvar::<Clock>().unix_timestamp + offset,
                resolver: f.resolver.pubkey(),
                token_mint: f.mint,
            }
            .data(),
            marketkit::accounts::CreateMarket {
                authority: f.creator.pubkey(),
                market: address,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        reject(&mut f.svm, ix, &f.creator, 6000);
        assert!(f.svm.get_account(&address).is_none());
    }
}

#[test]
fn stake_deadline_boundary_and_rejected_state_rollback() {
    let mut f = Fixture::new();
    f.clock(f.deadline - 1);
    f.place(0, 1, 100);
    for offset in [0, 1] {
        f.clock(f.deadline + offset);
        let market = f.svm.get_account(&f.market).unwrap().data;
        let position = f.svm.get_account(&f.position(0, 1)).unwrap().data;
        let ix = f.stake(0, 1, 100);
        reject(&mut f.svm, ix, &f.users[0], 6003);
        assert_eq!(f.balance(f.tokens[0]), 900);
        assert_eq!(f.balance(f.vault), 100);
        assert_eq!(f.svm.get_account(&f.market).unwrap().data, market);
        assert_eq!(f.svm.get_account(&f.position(0, 1)).unwrap().data, position);
    }
}

#[test]
fn invalid_stakes_revert_account_initialization_and_transfers() {
    for (outcome, amount, code) in [(2, 100, 6001), (1, 0, 6001), (1, 1001, 1)] {
        let mut f = Fixture::new();
        let ix = f.stake(0, outcome, amount);
        reject(&mut f.svm, ix, &f.users[0], code); // SPL InsufficientFunds = 1
        assert_eq!(f.market_state().pool, [0, 0]);
        assert_eq!(f.balance(f.tokens[0]), 1000);
        assert!(f.svm.get_account(&f.vault).is_none());
        assert!(f.svm.get_account(&f.position(0, outcome)).is_none());
    }
}

#[test]
fn resolver_and_outcome_authorization() {
    let mut f = Fixture::new();
    f.clock(f.deadline);
    let original = f.svm.get_account(&f.market).unwrap().data;
    let ix = f.resolve(f.creator.pubkey(), 1);
    reject(&mut f.svm, ix, &f.creator, 2001); // Anchor ConstraintHasOne
    let ix = f.resolve(f.resolver.pubkey(), 2);
    reject(&mut f.svm, ix, &f.resolver, 6001);
    assert_eq!(f.svm.get_account(&f.market).unwrap().data, original);
}

#[test]
fn incorrect_token_accounts_and_position_are_rejected() {
    let mut f = Fixture::new();
    let mut wrong_owner = f.stake(0, 1, 100);
    wrong_owner.accounts[4].pubkey = f.tokens[1];
    reject(&mut f.svm, wrong_owner, &f.users[0], 2015); // ConstraintTokenOwner
    let mut wrong_mint = f.stake(0, 1, 100);
    // A valid Mint account is required to reach the market's has_one check.
    let second_mint = Keypair::new();
    transaction(
        &mut f.svm,
        &[
            system_instruction::create_account(
                &f.creator.pubkey(),
                &second_mint.pubkey(),
                10_000_000,
                82,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_mint2(
                &spl_token::id(),
                &second_mint.pubkey(),
                &f.creator.pubkey(),
                None,
                0,
            )
            .unwrap(),
        ],
        &f.creator,
        &[&second_mint],
    )
    .unwrap();
    wrong_mint.accounts[2].pubkey = second_mint.pubkey();
    reject(&mut f.svm, wrong_mint, &f.users[0], 2001);
    let second_token = Keypair::new();
    transaction(
        &mut f.svm,
        &[
            system_instruction::create_account(
                &f.creator.pubkey(),
                &second_token.pubkey(),
                10_000_000,
                165,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_account3(
                &spl_token::id(),
                &second_token.pubkey(),
                &second_mint.pubkey(),
                &f.users[0].pubkey(),
            )
            .unwrap(),
        ],
        &f.creator,
        &[&second_token],
    )
    .unwrap();
    let mut wrong_token_mint = f.stake(0, 1, 100);
    wrong_token_mint.accounts[4].pubkey = second_token.pubkey();
    reject(&mut f.svm, wrong_token_mint, &f.users[0], 2014); // ConstraintTokenMint
    assert_eq!(f.market_state().pool, [0, 0]);
    assert_eq!(f.balance(f.tokens[0]), 1000);
    assert!(f.svm.get_account(&f.vault).is_none());
    f.place(0, 1, 100);
    f.place(1, 0, 250);
    f.resolved();
    let mut wrong_position = f.claim(0, 1);
    wrong_position.accounts[4].pubkey = f.position(1, 0);
    reject(&mut f.svm, wrong_position, &f.users[0], 2006); // ConstraintSeeds
    let mut wrong_destination = f.claim(0, 1);
    wrong_destination.accounts[5].pubkey = f.tokens[1];
    reject(&mut f.svm, wrong_destination, &f.users[0], 2015);
    assert!(!f.position_state(0, 1).claimed);
    assert_eq!(f.balance(f.vault), 350);
}

#[test]
fn three_participant_payout_dust_and_genuine_double_claim() {
    let mut f = Fixture::new();
    f.place(0, 1, 60);
    f.place(0, 1, 40); // accumulated stake
    f.place(2, 1, 200);
    f.place(1, 0, 250);
    assert_eq!(f.market_state().pool, [250, 300]);
    assert_eq!(f.position_state(0, 1).amount, 100);
    assert_eq!(f.balance(f.vault), 550);
    let ix = f.claim(0, 1);
    reject(&mut f.svm, ix, &f.users[0], 6005);
    assert!(!f.position_state(0, 1).claimed);
    f.resolved();
    let ix = f.stake(0, 1, 1);
    reject(&mut f.svm, ix, &f.users[0], 6002);
    let ix = f.claim(1, 0);
    reject(&mut f.svm, ix, &f.users[1], 6008);
    assert!(!f.position_state(1, 0).claimed);
    for user in [0, 2] {
        let ix = f.claim(user, 1);
        transaction(&mut f.svm, &[ix], &f.users[user], &[]).unwrap();
        assert!(f.position_state(user, 1).claimed);
        let before = f.balance(f.tokens[user]);
        let vault_before = f.balance(f.vault);
        let ix = f.claim(user, 1);
        reject(&mut f.svm, ix, &f.users[user], 6007);
        assert_eq!(f.balance(f.tokens[user]), before);
        assert_eq!(f.balance(f.vault), vault_before);
    }
    assert_eq!(f.balance(f.tokens[0]), 1083);
    assert_eq!(f.balance(f.tokens[2]), 1166);
    assert_eq!(f.balance(f.tokens[1]), 750);
    assert_eq!(f.balance(f.vault), 1);
}

#[test]
fn failed_claim_transfer_rolls_back_claimed_flag() {
    let mut f = Fixture::new();
    f.place(0, 1, 100);
    f.place(1, 0, 250);
    f.resolved();
    // Simulate corrupted/underfunded escrow to exercise rollback after claimed=true.
    let mut vault = f.svm.get_account(&f.vault).unwrap();
    vault.data[64..72].copy_from_slice(&0u64.to_le_bytes());
    f.svm.set_account(f.vault, vault).unwrap();
    let ix = f.claim(0, 1);
    reject(&mut f.svm, ix, &f.users[0], 1);
    assert!(!f.position_state(0, 1).claimed);
    assert_eq!(f.balance(f.tokens[0]), 900);
}
