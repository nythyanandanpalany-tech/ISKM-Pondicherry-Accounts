// Brings the whole thing up on a laptop for the end-to-end tests, and takes it down again:
//
//   PostgreSQL (you point PG* at one)  ->  the real schema, triggers and row level security
//   PostgREST                          ->  the same REST layer Supabase uses
//   gateway.mjs                        ->  stands in for Supabase Auth (see there)
//   next build + next start            ->  the actual app (a throwaway copy, built for the gateway)
//
// Needs: a PostgreSQL server you may create databases on (as for `npm run test:rls`), the PostgREST
// binary (POSTGREST_BIN, default `postgrest` on PATH) and Chromium for Playwright. The database is
// dropped and recreated each run, so never aim this at one you care about.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway } from "./gateway.mjs";
import { seedSql } from "./fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, "..");
export const PORTS = { app: Number(process.env.E2E_APP_PORT ?? 3100), gateway: 54321, rest: 54322 };
export const DB = process.env.EF_E2E_DB ?? "ef_e2e";
export const SECRET = "e2e-jwt-secret-that-is-long-enough-for-hs256-0123456789";
export const BASE_URL = `http://localhost:${PORTS.app}`;
/** The app is built from a copy, so the run never touches your own `.next`, `.env` files or a dev server you have open. */
export const APP_DIR = process.env.E2E_APP_DIR ?? path.join(os.tmpdir(), "ef-e2e-app");

const psqlEnv = { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c client_min_messages=warning` };
export function psql(args, input) {
  return execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { env: psqlEnv, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
/** One value, or a few rows, straight from the database — how the tests check what really got stored. */
export const sql = (query) => psql(["-d", DB, "-At", "-F", "|", "-c", query]).trim();
export const reseed = () => psql(["-d", DB], seedSql());

export function prepareDatabase() {
  psql(["-d", "postgres", "-c", `drop database if exists ${DB} with (force)`, "-c", `create database ${DB}`]);
  psql(["-d", DB, "-f", path.join(ROOT, "supabase/tests/stubs.sql")]);
  psql(["-d", DB, "-f", path.join(ROOT, "supabase/schema.sql")]);
  reseed();
}

function dbUri() {
  const host = process.env.PGHOST ?? "localhost", user = process.env.PGUSER ?? "postgres";
  if (host.startsWith("/")) return `postgresql://${user}@/${DB}?host=${encodeURIComponent(host)}`;
  const pass = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : "";
  return `postgresql://${user}${pass}@${host}:${process.env.PGPORT ?? 5432}/${DB}`;
}

async function until(label, probe, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await probe()) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`${label} did not come up within ${ms / 1000}s`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const children = [];
function run(label, cmd, args, env, cwd = ROOT) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  p.stdout.on("data", (d) => { log += d; });
  p.stderr.on("data", (d) => { log += d; });
  p.on("exit", (code) => { if (code && !p.killed) console.error(`[${label}] exited ${code}\n${log.slice(-3000)}`); });
  p.log = () => log;
  children.push(p);
  return p;
}

/** Copy the source (not secrets, not build output), share node_modules cheaply, and build it for the gateway. */
function buildApp(env) {
  fs.mkdirSync(APP_DIR, { recursive: true });
  execFileSync("rsync", ["-a", "--delete", "--exclude", "node_modules", "--exclude", ".next", "--exclude", ".git", "--exclude", ".env*", "--exclude", "e2e/.artifacts", `${ROOT}/`, `${APP_DIR}/`]);
  const nm = path.join(APP_DIR, "node_modules");
  if (!fs.existsSync(nm)) {
    // `cp -c` clones on APFS (instant, no extra disk); elsewhere fall back to a plain copy.
    try { execFileSync("cp", ["-cR", path.join(ROOT, "node_modules"), nm]); } catch { execFileSync("cp", ["-R", path.join(ROOT, "node_modules"), nm]); }
  }
  const r = spawnSync(path.join(nm, ".bin/next"), ["build"], { cwd: APP_DIR, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`next build failed:\n${(r.stdout + r.stderr).slice(-4000)}`);
}

export async function startStack() {
  prepareDatabase();
  run("postgrest", process.env.POSTGREST_BIN ?? "postgrest", [], {
    PGRST_DB_URI: dbUri(), PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: SECRET,
    PGRST_SERVER_HOST: "127.0.0.1", PGRST_SERVER_PORT: String(PORTS.rest),
    PGRST_DB_MAX_ROWS: "1000",              // the same cap a real Supabase project has
    PGRST_DB_PRE_REQUEST: "", PGRST_LOG_LEVEL: "warn",
  });
  await until("PostgREST", async () => (await fetch(`http://127.0.0.1:${PORTS.rest}/`)).ok);
  const gateway = await startGateway({ port: PORTS.gateway, postgrest: `http://127.0.0.1:${PORTS.rest}`, secret: SECRET });

  const appEnv = {
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORTS.gateway}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key",
    NEXT_PUBLIC_SEED_DUMMY_DATA: "false", NEXT_TELEMETRY_DISABLED: "1",
    TELEGRAM_API_BASE: `http://127.0.0.1:${PORTS.gateway}`,  // "Find my group" asks the gateway, never Telegram
  };
  buildApp(appEnv);
  const app = run("next", path.join(APP_DIR, "node_modules/.bin/next"), ["start", "-p", String(PORTS.app)], appEnv, APP_DIR);
  await until("the app", async () => (await fetch(`${BASE_URL}/login`)).ok);
  return { app, stop: () => stopStack(gateway) };
}

export function stopStack(gateway) {
  gateway?.close();
  for (const p of children) { p.killed = true; p.kill("SIGTERM"); }
}
