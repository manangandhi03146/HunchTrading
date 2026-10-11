# hunch Devnet lifecycle verification

This branch starts at main `49a5e7055d3a490c3c7791d03315ef6107fb28e9`. After the user authorized taking over integration and fixing the React guard, it incorporates the existing live SDK/resolver commit `60fd601` from `feat/hunch-devnet-integration` and corrects the React genesis guard with regression coverage. Its existing optional SDK interfaces are used without further API changes. `apps/`, the original frontend checkout, PDA seeds, instruction arguments, account layouts, program IDs, and public contract error codes remain unchanged. No upgrade or deployment command is part of this procedure.

## Verification status

The subsequent [full functionality audit](functionality-verification.md) verifies simulation UI flows and finds a separate browser integration gap: app providers do not supply live SDK bindings, and React falls back to the legacy compatibility client. The lifecycle harness uses the completed `Hunch` API independently; its credential blockers below do not establish browser app readiness. The audit fixes module-time browser Buffer initialization and records current local test counts. Earlier CI links below identify their exact tested revisions, predating this audit.

| Result | Status |
| --- | --- |
| Current deployed program permits early resolution | Reproduced with unsigned, non-broadcast RPC simulation |
| Deadline fix | Verified in Linux CI run 38097003483: original suites passed, regression failed on baseline for the intended reason, all 18 patched Rust tests passed with isolated build outputs |
| Original three LiteSVM suites and failing regression | Baseline and intended failing early-resolution regression passed their checks in CI run 38097003483 |
| Harness safeguards | Six Node tests pass: mock rejection, protected JSON error redaction, cluster guard, stale/unsigned receipt rejection, write-before-broadcast/uncertain transaction handling, and actual program invocation |
| Live SDK/resolver integration | Existing implementation integrated; actual read-only Devnet market/position decoding verified independently against the raw IDL |
| SDK/resolver/React validation | CI run 38097650300 passes with Node 24 on Linux and Windows, including the recovery fix: 376 SDK, 56 React and 6 harness tests; resolver has 121 passing on Linux, 120 passing and one POSIX-only skip on Windows |
| Real create → stake → signed event → resolve → claim | Blocked by unavailable team resolver key and treasury signing authority; live SDK stub removed on this branch |
| Deployed deadline enforcement | Requires separately approved program upgrade; this branch does not upgrade |

Do not present simulated addresses, game signatures, mock receipts, or expected balances as real transaction evidence. A completed real run writes a distinct public evidence JSON with `complete: true`, seven confirmed transaction stages, and actual Explorer links. Until then there are **no verified lifecycle transaction signatures**.

The user confirmed that **Developer A holds the existing resolver private key**, and that neither its protected file path nor the TEST treasury signing authority is available to them. They instructed this task to continue development and testing without those credentials, not to recreate team keys or transfer funds. No further funding, faucet requests or private-key provisioning will be attempted under that instruction. The remaining real-run prerequisites belong to Developer A and the authorized treasury operator; their identities/secure provisioning channel must be established before execution.

Public evidence: [contract CI and exact toolchain versions](evidence/devnet/contract-ci-2026-10-10.json), [Linux/Windows integration CI](evidence/devnet/integration-ci-2026-10-10.json), [deployed deadline simulation](evidence/devnet/deployment-audit-2026-10-10.json), and [actual read-only SDK validation](evidence/devnet/live-sdk-read-2026-10-10.json). The successful [contract run](https://github.com/manangandhi03146/HunchTrading/actions/runs/38097003483) tested source commit `96dd89d`; the program source tree is identical on subsequent recovery commit `9e8bc7f`. The successful [integration run](https://github.com/manangandhi03146/HunchTrading/actions/runs/38097650300) tested `9e8bc7f`. Later handoff/evidence edits change documentation only. CI records Rust 1.89.0, Anchor 1.1.2, Agave CLI 4.1.2, cargo-build-sbf 4.1.0, platform-tools v1.54, Node 24.21.0 and the separate AVM bootstrap Rust 1.91.0. React production build also passed locally.

## Public configuration

| Item | Value |
| --- | --- |
| RPC | `https://api.devnet.solana.com` |
| Actual Devnet genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Program | `J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP` |
| ProgramData | `NwHWvjqKNy1UditaY3D5zawfGXmtXsjGknxLUq2Fear` |
| Observed deployment slot | `509647737` |
| Upgrade authority / TEST treasury owner | `FndLN9xiWLBa2CMMjRA4X5DwU5VZwQzaTuoF43kuMM6D` |
| Team resolver | `6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt` |
| TEST mint (classic SPL Token, zero decimals) | `9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs` |
| Existing TEST treasury token account | `7mRZVNDvywk9DHtbvEsBP2KMGdPKLQW383RWt2k9p1VM` |
| Observed treasury TEST balance | `999900` |
| Observed resolver SOL balance | `0` |

Re-query these values before a demo. This branch fixes the incorrect genesis in `INTEGRATION.md` and the truncated value in `packages/react/src/adapters/SdkMarketKitClient.ts`. Its regression tests permit the actual Devnet hash and reject both previous incorrect values before exposing the wallet to a binding.

```sh
npm ci
npm run devnet:audit
npm run devnet:audit -- --simulate-deadline
```

The second command constructs create + early resolve in one simulated transaction, sets `sigVerify: false` and `replaceRecentBlockhash: true`, and never signs or broadcasts it. The generated market does not exist on chain. Successful `Market resolved` logs before the future deadline establish the deployed defect. The local fix requires `Clock.unix_timestamp >= market.deadline`; staking remains strictly before the deadline.

## Windows and Linux setup

The environment was rechecked after the user's macOS clarification: this machine is **Windows 11 Home, 10.0.26200, 64-bit**. The isolated repository is `C:\Users\Manas\.codex\worktrees\devnet-lifecycle\hackru` on `feat/devnet-lifecycle`; the preserved frontend checkout is `C:\Users\Manas\Downloads\hackru` on `feat/widget-demos`. Both working trees were clean before this documentation/recovery change. Host Node is 22.19.0; CI uses Node 24.21.0. Tests in Linux CI establish the pinned contract toolchain independently of this host. WSL setup is not required to finish credential-free development and testing, and is not being prioritized. No machine restart was performed; simultaneous replies conflicted about restart permission.

The initial non-elevated WSL install failed. An administrator launch subsequently installed WSL, but WSL2 could not start because Virtual Machine Platform was unavailable. Feature enabling was launched with `/norestart`; an elevated DISM query confirms VirtualMachinePlatform is **Enable Pending** and Windows reports a pending reboot. Do not force a reboot while another developer is working. After a planned restart, finish Ubuntu installation and user setup.

In administrator PowerShell, if still needed:

```powershell
wsl --install -d Ubuntu
wsl --list --verbose
```

Ubuntu must show version 2. The [Microsoft WSL setup instructions](https://learn.microsoft.com/en-us/windows/wsl/install) describe the restart and first-user setup.

Keep Git operations on Windows for a Codex-managed Windows worktree. Run Linux tools in its mounted workspace:

```sh
cd /mnt/c/Users/Manas/.codex/worktrees/devnet-lifecycle/hackru
bash scripts/setup-devnet-toolchain.sh
export PATH="$HOME/.local/share/hunch/node24/bin:$HOME/.local/share/hunch/agave-v4.1.2/bin:$HOME/.avm/bin:$HOME/.cargo/bin:$PATH"
```

The script installs Rust **1.89.0**, [Anchor **1.1.2** through AVM](https://github.com/otter-sec/anchor/releases/tag/v1.1.2), [Agave **4.1.2**](https://github.com/anza-xyz/agave/releases/tag/v4.1.2), and Node **24 LTS** from the official Node distribution. AVM's released lockfile requires Rust **1.91.0** for `cargo-platform 0.3.3`, so the script installs that separate bootstrap compiler only to build AVM; the default and host contract compiler remain **1.89.0**. The first CI attempt exposed this dependency requirement before reaching any contract test. It does not configure a global wallet, create keys, or deploy. The contract runner records actual host/AVM bootstrap Rust, Anchor, CLI, Node and SBF/platform versions in `.data/devnet-lifecycle/contract-tests.json`. These records must be retained with the test result; intended version pins are not proof of installation.

Windows and Linux native Node modules must not share an installation. If `npm ci` was run on Windows, run it again from Ubuntu before executing the resolver (better-sqlite3 is native). Never remove another checkout's dependencies. Linux Rust artifacts remain in this worktree's ignored `target/`.

## Contract tests: baseline, red regression, patched green

Ordinary `npm test` does not broadcast Devnet transactions. The dedicated command only runs `anchor build --ignore-keys` and `cargo test -p marketkit`. The build flag avoids Anchor skipping SBF compilation when a generated local build key differs from the preserved deployed ID. It neither changes IDs nor deploys anything. Never use `anchor keys sync` to remedy this mismatch:

```sh
npm run test:contract
```

The CI workflow `Contract lifecycle (no deployment)` runs the baseline program logic and original tests from the recorded main SHA in a temporary archive (no clone). It applies only the same exact Anchor dependency pins used by this branch before building, then copies in the early-resolution regression and requires it to fail because resolution unexpectedly succeeds. It builds the patched source and runs every contract suite, including the integrated resolver suite. A compilation failure is not accepted as the expected regression failure. It uploads baseline regression output and the pinned toolchain/test record. Baseline and patched builds use separate Cargo/SBF output directories because sharing them reused baseline bytecode despite the changed source. The patched bytecode must differ, and the guard regression must reject early resolution.

For the equivalent manual baseline on Windows, make a temporary archive of the recorded SHA using host Git, extract it into a separate directory, copy this branch's exact dependency pins from `programs/marketkit/Cargo.toml` (without any behavior change), then run `anchor build --ignore-keys` and `cargo test -p marketkit` there using Ubuntu. Copy only `lifecycle_guards.rs` into that baseline tree and run:

```sh
cargo test -p marketkit --test lifecycle_guards early_resolution_regression -- --exact
```

It must fail with `operation unexpectedly succeeded`. Run the patched tree's `npm run test:contract` afterward. Do not alter or reset the frontend checkout to obtain a baseline.

Coverage includes create at/past now; stake at D−1, D, D+1; resolve at D−1, D, D+1; wrong resolver; invalid outcomes and zero amounts; insufficient tokens; wrong mint/owner/position; claim before resolution; stake after resolution; losing claims; accumulated positions; real program-level double-claim rejection; 183/366 payouts and one-token dust; account-init, pool, position and transfer rollback; rollback of `claimed=true` when payout CPI fails. Repeated transactions expire the LiteSVM blockhash and assert exact custom errors, including Anchor constraint errors rather than the unused `UnauthorizedResolver` variant.

## Incorporate the live SDK/resolver

Starting main has a stub `AnchorMarketAdapter` that throws `CONTRACT_UNAVAILABLE`; its resolver executable also lacks real-mode wiring. Under the user's later authorization, this branch integrates the completed implementation from `feat/hunch-devnet-integration` (`60fd601`) without waiting for a main merge. SDK reads of an existing developer-created market and position were cross-checked against the raw committed IDL; `docs/evidence/devnet/live-sdk-read-2026-10-10.json` records that read-only result. It is not a market created for this verification and provides no lifecycle transaction signatures. The real SDK is available here; execution now stops at the required Linux/runtime/key preparation boundary rather than the old adapter stub.

The harness uses existing `MarketAdapter` methods, `WalletSigner`, `buildServer`, `ResolverStore`, and `signGameEvent` interfaces. It starts the actual resolver server with the real adapter and signer through its existing public factory, using a fresh store for this verification. The integrated standalone resolver also supports real mode. The harness never selects a mock adapter, mock HTTP endpoint, or mock wallet.

The integrated constructor accepts RPC/program/mint/resolver configuration and a clock. The harness supplies the observed chain clock, the recorded TEST mint and resolver, and requires participant ATAs. It persists a cryptographically random public 32-byte market seed and its derived PDA before signing, passes `marketSeed` through the existing SDK interface, and requires the returned ID and the independently discovered transaction account to match that PDA. A UUID is only the off-chain run identifier; the live SDK correctly rejects UUIDs supplied as market IDs. The SDK calls `WalletSigner.signTransaction` before broadcasting; the wrapper journals the signature before returning it. A mode label alone is not proof of a live implementation: the harness independently confirms transactions and decodes actual accounts using the committed Anchor IDL. Coordinate before any further shared-interface changes.

## Secure resolver key and verification wallets

These are future operator instructions, not actions completed in this task. The existing key is currently unavailable to this machine, and the user prohibited recreation of team keys and fund transfers.

The team operator provisions its existing resolver key into a protected Ubuntu file outside Git, e.g. `$HOME/.config/hunch/team-resolver-keypair.json`. Use an approved secure file transfer or local provisioning channel. **Never paste the secret into chat, print it, or commit it.** No generated resolver substitute is permitted.

The directory should be mode 0700, key files mode 0600 and owned by the Ubuntu user. Do not store private keys under `/mnt/c`, in `.env` content, a repository, or public evidence. Verify only the resolver public address:

```sh
solana-keygen pubkey "$HOME/.config/hunch/team-resolver-keypair.json"
# Must equal 6S713ZCwtF2VG1X8Dpr1pA8XJBDXSMsrUrUwTbZwMHUt
export RESOLVER_KEYPAIR_PATH="$HOME/.config/hunch/team-resolver-keypair.json"
npm run devnet:prepare -- --devnet
```

Preparation creates separate creator, A, B, C, and backend game signing keys with exclusive creation (`wx`); it refuses to overwrite any key or manifest. It prints public recipients and operator commands only. If interrupted, retain existing keys and inspect the preparation state; do not delete funded keys to start again. A completely new preparation can use a new empty `HUNCH_VERIFY_KEY_DIR`, but its recipients need their own funding.

`manifest.json` remains private outside Git and supplies file paths and public identities. The game key signs Ed25519 result payloads and must be separate from the resolver's transaction key. Verification validates every key's bytes and public identity and all six signer identities are distinct.

## Funding request to the authorized operator

Preparation writes `funding-request.txt` next to the protected manifest. Share its **public addresses and commands**, not any private file. It requests transfers of **1000 existing TEST each** to A, B, C and **0.15 Devnet SOL each** to creator, A, B, C, resolver. The live preflight requires at least **0.1 SOL** per transaction signer and exactly 1000 TEST per participant. Devnet tooling never creates a replacement mint or mints TEST; LiteSVM fixtures mint only inside the local simulator.

One Devnet faucet request for 1 SOL to the existing resolver failed with RPC code `-32603`, returned no transaction signature, and left the resolver balance at zero on recheck. It was not blindly retried. The authorized operator must fund it or reconcile and complete a later faucet request. This attempt provides no lifecycle transaction evidence.

The operator sets protected key paths in their own shell. Agave does not supply the separate SPL Token CLI; the operator should check `spl-token --version` before funding. If missing, install the [published SPL Token CLI](https://crates.io/crates/spl-token-cli/5.6.1) with `cargo +1.91.0 install spl-token-cli --version 5.6.1 --locked` in their Linux environment. Record its actual version with the funding evidence. Exact commands generated per recipient specify classic SPL Token and the funded treasury key as fee payer:

```sh
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --owner "$TEST_TREASURY_KEYPAIR" --fee-payer "$TEST_TREASURY_KEYPAIR" transfer 9G1B7DcQ7u89ZdWyV6PYCqogMstkCgYMEcN5FdAuGJFs 1000 RECIPIENT_PUBLIC_KEY --from 7mRZVNDvywk9DHtbvEsBP2KMGdPKLQW383RWt2k9p1VM --fund-recipient --allow-unfunded-recipient
solana --url devnet --keypair "$SOL_OPERATOR_KEYPAIR" transfer RECIPIENT_PUBLIC_KEY 0.15 --allow-unfunded-recipient
# SOL faucet alternative, subject to rate limits:
solana --url devnet airdrop 1 RECIPIENT_PUBLIC_KEY
```

Inspect and confirm each operator transfer before retrying an uncertain request. Record funding signatures and balances alongside demo evidence. The creator does not need TEST, and the game signing key does not submit chain transactions or need SOL.

## Execute the real demo

After a team-controlled Linux environment (WSL is one option), the protected resolver file, and authorized funding are available (the live SDK is already integrated on this branch):

```sh
npm ci
npm run test:devnet-harness
npm run sdk
npm run build --workspace @marketkit/resolver
export HUNCH_VERIFY_MANIFEST="$HOME/.config/hunch/devnet-verification/manifest.json"
export RESOLVER_KEYPAIR_PATH="$HOME/.config/hunch/team-resolver-keypair.json"
export SOLANA_RPC_URL=https://api.devnet.solana.com
npm run devnet:verify -- --devnet
```

The harness starts the real resolver on an ephemeral loopback port with a fresh SQLite database and no mock HTTP registration. It registers the backend game's base64 public key, verifies `/health` reports Anchor mode and zero pending events, then creates a unique market with deadline **300 seconds after the observed chain clock**. The actual market PDA is discovered from the confirmed create transaction rather than assuming an SDK ID encoding. Creator, resolver, mint and deadline must match decoded state.

It registers the app, creator, resolver and authorized event mapping in the store, then stakes A=100 on 1, C=200 on 1, B=250 on 0. It verifies pools `[250,300]`, vault 550, position amounts and participant balances, waits for the **chain** clock to reach the deadline, signs outcome 1 using the backend game key, and POSTs through `/v1/events`. The resolver submits the sole resolution transaction using the team signer. It replays the identical signed event and requires the original record and original transaction signature.

Both winning claims go through the SDK. Required final values:

| Wallet | Initial TEST | Stake | Payout | Final TEST |
| --- | ---: | ---: | ---: | ---: |
| A | 1000 | 100 on 1 | 183 | 1083 |
| C | 1000 | 200 on 1 | 366 | 1166 |
| B | 1000 | 250 on 0 | 0 | 750 |

Both winning positions must be claimed; B must remain unclaimed; escrow must retain 1 TEST. Pools retain historical totals `[250,300]`. Final participant tokens plus escrow must conserve 3000 TEST. SOL fees/rent are separate.

## Evidence and recovery

Before each SDK mutation, the harness flushes a pending journal stage. Its wallet wrapper flushes each signed transaction's public signature, blockhash and available expiry height before returning it to the SDK for broadcast. It does not persist a private key. After submission it fetches the actual transaction, rejects errors, checks an instruction invokes the hunch program, and records confirmation, slot, block time, fee and Explorer URL. Public snapshots record decoded market/position identities, amounts, claim flags, vault and wallet balances. Reconciliation reports the observed block height and whether each recorded validity window has expired; an expired window alone does not prove the transaction never landed.

On any uncertain mutation or failed assertion, **stop**. No automatic retry is performed. Inspect the ignored journal and resolver database, and use the read-only command:

```sh
npm run devnet:reconcile -- /absolute/path/to/.data/devnet-lifecycle/hunch-RUN-ID.json
```

Query every recorded signature with history enabled. If the RPC cannot find a transaction, that is not proof it was never submitted. Inspect confirmed market, vault and positions; check the stored resolver event/resolution record; consult the signer operator and another Devnet RPC if necessary. The tool reports partial state if staking stopped early. It neither edits the journal nor broadcasts. There is no automatic resume mode. Preserve failed-run data and do not blindly rerun funded participants after a partial mutation: their exact 1000 TEST preflight should prevent reuse until reconciliation.

The integrated resolver's reconciliation also retains an unseen signature after its blockhash expires, including when `--release` is requested. Missing RPC history plus expiry cannot prove it never landed. The regression first failed against the imported implementation, then passed after this correction; replay still returns the pending record without another submission. Confirmed on-chain failure or interruption before signing can release a reservation on an unresolved market, and a fresh signed event is accepted only after that explicit release.

A complete run exports public evidence to `docs/evidence/devnet/hunch-RUN-ID.json`; incomplete journals remain ignored under `.data/`. Review exported JSON for public-only content before committing it. Include the SDK merge SHA, funding transfer signatures, actual contract test/toolchain results and CI run link in the final handoff.

Report these three conclusions separately:

1. Whether the current deployed program's **correctly timed lifecycle** completed with real confirmed transactions.
2. Whether the **local deadline fix** passed the original baseline, failing regression, and patched contract suites.
3. That **on-chain deadline enforcement remains unfixed** until an explicitly approved upgrade is performed. Successful happy-path testing does not repair the deployment.

Push only `feat/devnet-lifecycle` and open a review PR to `main`. Keep it draft until external prerequisites and real proof are complete. Never merge, push to main, synchronize program IDs, or deploy an upgrade as part of this task.
