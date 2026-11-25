// Makes the account in SUPER_ADMIN_EMAIL a super admin on the live project, with SUPER_ADMIN_PASSWORD
// as its password — creating the account (already confirmed) if it does not exist yet.
//
//   node --env-file=.env scripts/bootstrap-super-admin.mjs
//
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (a personal access token: it can fetch the
// project's service key and run SQL), plus NEXT_PUBLIC_SUPABASE_URL. Nothing here runs in the browser
// or on Vercel. After the first super admin exists, everyone else is promoted from the app's
// Users & permissions screen; this is only for the first one, or to recover access.
const env = (k) => {
  const v = process.env[k]?.trim();
  if (!v) { console.error(`Missing ${k} in the environment.`); process.exit(1); }
  return v;
};
const email = env("SUPER_ADMIN_EMAIL").toLowerCase();
const password = env("SUPER_ADMIN_PASSWORD");
const token = env("SUPABASE_ACCESS_TOKEN"), ref = env("SUPABASE_PROJECT_REF");
const url = env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const api = `https://api.supabase.com/v1/projects/${ref}`;

async function call(u, init, what) {
  const r = await fetch(u, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${what} failed (${r.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => call(`${api}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
}, "SQL");
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

const keys = await call(`${api}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } }, "Fetching the service key");
const service = keys.find((k) => k.name === "service_role" || k.type === "secret")?.api_key;
if (!service) throw new Error("No service key found on the project.");
const admin = (path, method, body) => call(`${url}/auth/v1/admin${path}`, {
  method, headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
}, `Auth admin ${method} ${path}`);

const [found] = await sql(`select id from auth.users where lower(email) = ${lit(email)}`);
let id = found?.id;
if (id) {
  await admin(`/users/${id}`, "PUT", { password, email_confirm: true });
  console.log(`Updated the password of ${email}.`);
} else {
  id = (await admin("/users", "POST", { email, password, email_confirm: true })).id;
  console.log(`Created ${email} (already confirmed).`);
}

const [before] = await sql(`select super_admin from profiles where id = ${lit(id)}`);
if (!before) throw new Error(`No profile row for ${email}; is the roles migration applied?`);
if (!before.super_admin) {
  await sql(`update profiles set super_admin = true where id = ${lit(id)};
             insert into role_log (by_user, user_id, change) values (null, ${lit(id)}, 'made super admin (bootstrap)');`);
}
const [after] = await sql(`select p.super_admin, u.email_confirmed_at is not null as confirmed from profiles p join auth.users u on u.id = p.id where p.id = ${lit(id)}`);
console.log(`${email}: super admin = ${after.super_admin}, confirmed = ${after.confirmed}`);
