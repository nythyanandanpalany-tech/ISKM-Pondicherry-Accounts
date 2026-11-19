// npm run test:e2e [file-fragment ...]
// Starts the stack (see stack.mjs), runs every e2e/*.test.mjs one file at a time, then stops it.
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { BASE_URL, startStack } from "./stack.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs") && (!only.length || only.some((o) => f.includes(o)))).map((f) => path.join(here, f));
if (!files.length) { console.error("No e2e test files matched."); process.exit(1); }

console.log("Starting PostgreSQL schema, PostgREST, the gateway and the app…");
const stack = await startStack();
console.log(`Ready at ${BASE_URL}. Running ${files.length} file(s).\n`);

const code = await new Promise((resolve) => {
  const p = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=240000", ...files], {
    stdio: "inherit", env: { ...process.env, E2E_BASE_URL: BASE_URL },
  });
  p.on("exit", (c) => resolve(c ?? 1));
});
stack.stop();
process.exit(code);
