// Test data for the end-to-end run: three people, one set of books, and the heads and banks the
// scenarios need. Fixed ids so the tests (and the gateway that signs people in) can refer to them.

export const PASSWORD = "e2e-Password-1";

export const USERS = {
  owner: { id: "11111111-1111-4111-8111-111111111111", email: "owner@e2e.test", name: "Olivia Owner" },
  admin: { id: "22222222-2222-4222-8222-222222222222", email: "admin@e2e.test", name: "Arun Admin" },
  editor: { id: "33333333-3333-4333-8333-333333333333", email: "editor@e2e.test", name: "Esha Editor" },
  accountant: { id: "44444444-4444-4444-8444-444444444444", email: "accountant@e2e.test", name: "Anand Accountant" },
  // A super admin who is not a member of any workspace: everything they see comes from the role alone.
  superAdmin: { id: "55555555-5555-4555-8555-555555555555", email: "super@e2e.test", name: "Sundar Super" },
  // Signed up, in no workspace yet: what a new person looks like before the super admin gives them a role.
  newcomer: { id: "66666666-6666-4666-8666-666666666666", email: "newcomer@e2e.test", name: "Nila Newcomer" },
};

export const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const WS_NAME = "E2E Temple";

const c = (n) => `c0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const CAT = {
  annadanam: c(1), festival: c(2), gaushala: c(3), books: c(4), construction: c(5), fixedAssets: c(6),
  donation: c(7), hundi: c(8), goshalaDonation: c(9),
};
export const BANK = { ujjivan: "b1000000-0000-4000-8000-000000000001", idfc: "b1000000-0000-4000-8000-000000000002" };
export const PERSON = { ramesh: "d0000000-0000-4000-8000-000000000001", sita: "d0000000-0000-4000-8000-000000000002" };

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** Everything is deleted and put back, so every test file starts from the same place. */
export function seedSql() {
  const users = Object.values(USERS).map((u) => `(${q(u.id)}, ${q(u.email)}, now(), ${q(JSON.stringify({ full_name: u.name }))})`).join(",\n  ");
  return `
delete from workspaces;
delete from auth.users;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ${users};
insert into workspaces (id, name, created_by) values (${q(WS)}, ${q(WS_NAME)}, ${q(USERS.owner.id)});
insert into members (workspace_id, user_id, role, see_all) values
  (${q(WS)}, ${q(USERS.owner.id)}, 'owner', true),
  (${q(WS)}, ${q(USERS.admin.id)}, 'admin', true),
  (${q(WS)}, ${q(USERS.editor.id)}, 'editor', false),
  (${q(WS)}, ${q(USERS.accountant.id)}, 'accountant', false);
update profiles set super_admin = true where id = ${q(USERS.superAdmin.id)};
delete from role_log;
insert into categories (id, workspace_id, name, kind) values
  (${q(CAT.annadanam)}, ${q(WS)}, 'Annadanam', 'expense'),
  (${q(CAT.festival)}, ${q(WS)}, 'Festival', 'expense'),
  (${q(CAT.gaushala)}, ${q(WS)}, 'Gaushala', 'expense'),
  (${q(CAT.books)}, ${q(WS)}, 'Purchase of books', 'expense'),
  (${q(CAT.construction)}, ${q(WS)}, 'Construction – Building', 'expense'),
  (${q(CAT.fixedAssets)}, ${q(WS)}, 'Fixed assets purchased', 'expense'),
  (${q(CAT.donation)}, ${q(WS)}, 'Donation', 'income'),
  (${q(CAT.hundi)}, ${q(WS)}, 'Hundi', 'income'),
  (${q(CAT.goshalaDonation)}, ${q(WS)}, 'Goshala donation', 'income');
insert into people (id, workspace_id, name) values
  (${q(PERSON.ramesh)}, ${q(WS)}, 'Ramesh'), (${q(PERSON.sita)}, ${q(WS)}, 'Sita Devi');
insert into bank_accounts (id, workspace_id, name) values
  (${q(BANK.ujjivan)}, ${q(WS)}, 'Ujjivan'), (${q(BANK.idfc)}, ${q(WS)}, 'IDFC');
`;
}
