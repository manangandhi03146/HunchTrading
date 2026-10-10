import { runMockDemo } from "./demo-flow.js";
import { runHttpMockDemo } from "./http-demo-flow.js";

runMockDemo({ transport: "http" }).then(async (result) => {
  console.log("Create -> two predictions -> sign -> HTTP event -> resolve -> claim: PASS");
  console.log("Mock tokens and receipts; no blockchain transactions were submitted.");
  console.log(JSON.stringify(result, null, 2));
  const http = await runHttpMockDemo({ transport: "http" });
  console.log("Two independent HTTP SDK clients -> shared racing/esports markets -> signed settlement -> winner claims: PASS");
  console.log(JSON.stringify(http, null, 2));
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo failed");
  process.exitCode = 1;
});
