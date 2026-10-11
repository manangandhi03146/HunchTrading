// The explicit npm entry avoids bundlers treating "buffer" as a Node-only builtin.
import { Buffer as BrowserBuffer } from "buffer/index.js";
import type { Buffer as NodeBuffer } from "buffer";

// SPL Token uses the global during module evaluation. Run this before importing
// the adapter dependencies, and preserve the host Buffer implementation in Node.
export type Buffer = NodeBuffer;
export const Buffer = globalThis.Buffer ?? (BrowserBuffer as unknown as typeof globalThis.Buffer);
globalThis.Buffer ??= Buffer;
