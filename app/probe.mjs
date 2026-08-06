import { Agent, JsonlLocalAgentStore } from "@cursor/sdk";
import fs from "fs";

const dir = process.argv[2];
const agentId = process.argv[3];
const model = process.argv[4];

const raw = new JsonlLocalAgentStore(dir);
const stats = {};
let windowStart = process.hrtime.bigint();
function wrap(sub, subName) {
  return new Proxy(sub, {
    get(t, prop) {
      const v = t[prop];
      if (typeof v !== "function") return v;
      return async (...args) => {
        const k = `${subName}.${String(prop)}`;
        const t0 = process.hrtime.bigint();
        try {
          return await v.apply(t, args);
        } finally {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          stats[k] ??= { n: 0, ms: 0 };
          stats[k].n++;
          stats[k].ms += ms;
        }
      };
    },
  });
}
const store = {
  agents: wrap(raw.agents, "agents"),
  checkpoints: wrap(raw.checkpoints, "checkpoints"),
  runs: wrap(raw.runs, "runs"),
  runEvents: wrap(raw.runEvents, "runEvents"),
};

function report(label) {
  let tot = 0;
  const rows = [];
  for (const [k, v] of Object.entries(stats)) {
    rows.push(`  ${k.padEnd(22)} calls=${String(v.n).padStart(5)} time=${v.ms.toFixed(0).padStart(6)}ms`);
    tot += v.ms;
  }
  console.log(`${label}  [store total ${tot.toFixed(0)}ms]`);
  rows.forEach((r) => console.log(r));
  for (const k of Object.keys(stats)) delete stats[k];
  windowStart = process.hrtime.bigint();
  return tot;
}

const size = fs.statSync(`${dir}/checkpoints.ndjson`).size;
console.log(`\n===== ${dir}  checkpoints.ndjson=${(size / 1e6).toFixed(1)}MB =====`);

let t0 = process.hrtime.bigint();
const agent = await Agent.resume(agentId, {
  apiKey: process.env.CURSOR_API_KEY,
  model: { id: model },
  local: {
    cwd: "/root/.cursor/plugins/local/issue-tracker",
    settingSources: ["user", "project", "plugins"],
    store,
  },
});
let t1 = process.hrtime.bigint();
console.log(`Agent.resume: ${(Number(t1 - t0) / 1e6).toFixed(0)}ms`);
report("  during resume:");

const sendStart = process.hrtime.bigint();
const run = await agent.send("Reply with exactly: OK");
const afterSend = process.hrtime.bigint();
console.log(`\nsend() resolved (run created): ${(Number(afterSend - sendStart) / 1e6).toFixed(0)}ms`);
report("  during send():");

let first = null;
let count = 0;
for await (const msg of run.stream()) {
  count++;
  if (!first) {
    first = process.hrtime.bigint();
    console.log(`FIRST STREAM EVENT: ${(Number(first - sendStart) / 1e6).toFixed(0)}ms after send() call  (type=${msg.type}${msg.status ? " " + msg.status : ""})`);
    report("  send()->first event:");
  }
  if (msg.type === "assistant" || count > 25) break;
}
const done = process.hrtime.bigint();
console.log(`\nTOTAL send -> first assistant/limit: ${(Number(done - sendStart) / 1e6).toFixed(0)}ms`);
report("  streaming window:");

try {
  if (run.supports("cancel")) await run.cancel();
} catch {}
await agent[Symbol.asyncDispose]();
process.exit(0);
