# Devnet wallet funds

The dashboard now links **Livestream demo · SypherPK / Fortnite** from Example Applications. It opens Hunch's standalone `/fortnite` page. `/livestream` redirects there. The page embeds an existing Twitch VOD and retains explicit disclosure of its scripted events and simulated trading. It is not a live feed or an endorsed SypherPK market.

The top-left **Funds** section links to `/wallet`, with **Add** and **Remove** shortcuts. This is an actual Solana Devnet wallet flow, separate from `/funding`, which remains the exhibition funding and exchange model.

## Use the wallet flow

1. Start the shared API with `npm run dev:shared`, and the dashboard with `npm run dev`.
2. Open `http://127.0.0.1:5175/wallet`. Use Phantom or Solflare and select Devnet in the extension. Hunch never requests or stores private keys.
3. Connect the wallet. The page reads its real Devnet SOL and configured zero-decimal TEST balances. A balance read checks the RPC genesis hash against the SDK's Devnet constant. `VITE_SOLANA_RPC_URL` can select another Devnet provider.
4. **Add:** copy the receiving public address and transfer Devnet SOL from a wallet you control, or click **Request 0.1 Devnet SOL**. If the public RPC faucet is rate limited, use the linked official Solana faucet and refresh the balance.
5. **Remove:** enter a different wallet's public address and a SOL amount. Review the destination, network and actual RPC fee quote. Approve the transaction in the wallet extension. The page rejects program/vault destinations, insufficient balance, and transfers leaving a nonzero balance below the rent-exempt minimum.
6. Inspect the resulting Explorer link with `cluster=devnet`. A pending receipt blocks another funds operation for that wallet. **Check status** looks up the saved signature, without broadcasting again.

Hunch uses the connected wallet directly. There is no separate Hunch custodial balance or secret browser-generated deposit wallet. Incoming transfers require the source wallet's authorized operator. Outgoing transfers require the connected wallet's signature. This page does not withdraw locked market stakes, send TEST, swap SOL for TEST, access the team treasury or mint any tokens. Live TEST funding still requires its authorized operator.

## Confirmation and recovery

The transfer helper checks the cluster again before signing. It rejects expired quotes and altered signed messages. It saves the expected signature before calling `sendRawTransaction`, enables preflight, and submits once with `maxRetries: 0`. It confirms using that signature and the reviewed blockhash's validity window. A timeout keeps the receipt pending. Receipt status distinguishes confirmed/finalized success from an on-chain error.

Public signatures, amounts and addresses persist in local storage scoped to the RPC endpoint. No private keys persist. Do not clear that history while reconciling a pending action. If a signature remains absent, check the Devnet Explorer and the source wallet's activity with the operator before any manual retry. Never assume an RPC timeout means a transaction failed. A faucet RPC error can also be uncertain: refresh the receiving balance before requesting again.

The SypherPK exhibition and shared simulation still use simulated credits. Funding an actual Devnet wallet never alters those ledgers. The page explains that separation. A real create/stake/resolve/claim lifecycle remains dependent on team credentials and authorized TEST funding.

## Verification

`npm run test --workspace @hunch/dashboard` covers exact lamport parsing, invalid recipients, cluster rejection, fee and rent limits, changed balances, expired quotes, persisted signatures before broadcast, timeout handling, single submission, altered signed transactions, result reconciliation and the funds UI review flow. All RPC calls and signatures in tests use mocks and ephemeral test signers. Ordinary tests submit no Devnet transactions.

`npm run build --workspace @hunch/dashboard` verifies frontend types and the production bundle. Completing a real wallet transfer must be verified with a team-controlled wallet; do not present unit tests or simulated demo receipts as blockchain evidence.

Primary references: [Solana genesis hash RPC](https://solana.com/docs/rpc/http/getgenesishash), [fee quotes](https://solana.com/docs/rpc/http/getfeeformessage), [airdrop requests](https://solana.com/docs/rpc/http/requestairdrop), [transactions](https://solana.com/docs/core/transactions).
