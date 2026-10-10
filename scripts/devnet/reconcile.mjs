import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preflight, connection, snapshot, json } from './core.mjs';

assert(process.argv[2], 'Usage: npm run devnet:reconcile -- /absolute/path/to/journal.json');
await preflight();
const journal = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const report = { runId: journal.runId, readOnly: true, stages: [] };
for (const stage of journal.stages) {
  const signatures = [...new Set(stage.signatures)];
  const statuses = signatures.length ? await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true }) : null;
  report.stages.push({ name: stage.name, localState: stage.state,
    signatures: signatures.map((signature, i) => ({ signature, status: statuses.value[i] })) });
}
if (journal.marketAddress && journal.participants) {
  try { report.onChainState = await snapshot(journal.marketAddress, journal.participants); }
  catch { report.onChainState = 'Full snapshot unavailable (possibly partial staking). Inspect the recorded market and position addresses individually before recovery.'; }
}
report.instruction = 'No transactions retried. Unknown signatures require RPC/history and signer review. Reconcile market, vault, positions and resolver event database before recovering; do not rerun verification blindly.';
console.log(json(report));
