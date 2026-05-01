import assert from "node:assert/strict";
import {
  AGENT_HUB_INGEST_SCHEMA_VERSION,
  parseAgentHubIngestBody,
} from "../lib/agent-hub-ingest-contract";

const a = parseAgentHubIngestBody({
  schemaVersion: AGENT_HUB_INGEST_SCHEMA_VERSION,
  snapshot: "x",
  cdpError: null,
  extraField: 1,
});
assert.equal(a.snapshot, "x");
assert.equal(a.cdpError, null);
assert.equal((a as { extraField?: number }).extraField, 1);

parseAgentHubIngestBody({ snapshot: "", cdpError: "e" });
parseAgentHubIngestBody({});

console.log("ingest-contract-smoke: ok");
