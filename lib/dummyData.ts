import type { Category, Entry, Item, Person } from "./types";

/**
 * When NEXT_PUBLIC_SEED_DUMMY_DATA=true, the ledger (entries/categories/items/people)
 * is served from here instead of Firestore — useful for demos/screenshots without
 * touching real accounts. Everything else (workspaces, members, bank statement, store,
 * chats) still reads the real workspace, so this stays a sign-in and uses it normally.
 */
export const DUMMY_MODE = process.env.NEXT_PUBLIC_SEED_DUMMY_DATA === "true";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
const now = () => new Date().toISOString();

export const DUMMY_CATEGORIES: Category[] = [
  { id: "dummy-cat-veg", workspace_id: "", name: "Vegetables & Annadanam", kind: "expense", monthly_limit: 25000 },
  { id: "dummy-cat-puja", workspace_id: "", name: "Puja Supplies", kind: "expense", monthly_limit: 15000 },
  { id: "dummy-cat-util", workspace_id: "", name: "Utilities", kind: "expense", monthly_limit: null },
  { id: "dummy-cat-maint", workspace_id: "", name: "Maintenance & Repairs", kind: "expense", monthly_limit: null },
  { id: "dummy-cat-fest", workspace_id: "", name: "Festival & Events", kind: "expense", monthly_limit: null },
  { id: "dummy-cat-print", workspace_id: "", name: "Printing & Stationery", kind: "expense", monthly_limit: null },
  { id: "dummy-cat-don", workspace_id: "", name: "Donation", kind: "income", monthly_limit: null },
  { id: "dummy-cat-hundi", workspace_id: "", name: "Hundi", kind: "income", monthly_limit: null },
  { id: "dummy-cat-seva", workspace_id: "", name: "Seva", kind: "income", monthly_limit: null },
];

export const DUMMY_ITEMS: Item[] = [
  { id: "dummy-item-rice", workspace_id: "", category_id: "dummy-cat-veg", name: "Rice", monthly_limit: null },
  { id: "dummy-item-veg", workspace_id: "", category_id: "dummy-cat-veg", name: "Vegetables", monthly_limit: null },
  { id: "dummy-item-dal", workspace_id: "", category_id: "dummy-cat-veg", name: "Dal & Pulses", monthly_limit: null },
  { id: "dummy-item-ghee", workspace_id: "", category_id: "dummy-cat-veg", name: "Ghee & Oil", monthly_limit: null },
  { id: "dummy-item-flowers", workspace_id: "", category_id: "dummy-cat-puja", name: "Flowers & Garlands", monthly_limit: null },
  { id: "dummy-item-incense", workspace_id: "", category_id: "dummy-cat-puja", name: "Incense & Camphor", monthly_limit: null },
  { id: "dummy-item-lamp", workspace_id: "", category_id: "dummy-cat-puja", name: "Ghee for Lamps", monthly_limit: null },
  { id: "dummy-item-tulsi", workspace_id: "", category_id: "dummy-cat-puja", name: "Tulsi & Chandan", monthly_limit: null },
  { id: "dummy-item-power", workspace_id: "", category_id: "dummy-cat-util", name: "Electricity", monthly_limit: null },
  { id: "dummy-item-water", workspace_id: "", category_id: "dummy-cat-util", name: "Water", monthly_limit: null },
  { id: "dummy-item-gas", workspace_id: "", category_id: "dummy-cat-util", name: "Gas Cylinder", monthly_limit: null },
  { id: "dummy-item-plumb", workspace_id: "", category_id: "dummy-cat-maint", name: "Plumbing", monthly_limit: null },
  { id: "dummy-item-elec", workspace_id: "", category_id: "dummy-cat-maint", name: "Electrical", monthly_limit: null },
  { id: "dummy-item-clean", workspace_id: "", category_id: "dummy-cat-maint", name: "Cleaning Supplies", monthly_limit: null },
  { id: "dummy-item-decor", workspace_id: "", category_id: "dummy-cat-fest", name: "Decorations", monthly_limit: null },
  { id: "dummy-item-prasad", workspace_id: "", category_id: "dummy-cat-fest", name: "Prasadam Distribution", monthly_limit: null },
  { id: "dummy-item-sound", workspace_id: "", category_id: "dummy-cat-fest", name: "Sound & Lighting", monthly_limit: null },
  { id: "dummy-item-books", workspace_id: "", category_id: "dummy-cat-print", name: "Receipt Books", monthly_limit: null },
  { id: "dummy-item-banner", workspace_id: "", category_id: "dummy-cat-print", name: "Banners & Posters", monthly_limit: null },
  { id: "dummy-item-gen-don", workspace_id: "", category_id: "dummy-cat-don", name: "General Donation", monthly_limit: null },
  { id: "dummy-item-anna-don", workspace_id: "", category_id: "dummy-cat-don", name: "Annadanam Donation", monthly_limit: null },
  { id: "dummy-item-fest-don", workspace_id: "", category_id: "dummy-cat-don", name: "Festival Donation", monthly_limit: null },
  { id: "dummy-item-main-hundi", workspace_id: "", category_id: "dummy-cat-hundi", name: "Main Hundi", monthly_limit: null },
  { id: "dummy-item-gau-hundi", workspace_id: "", category_id: "dummy-cat-hundi", name: "Gaushala Hundi", monthly_limit: null },
  { id: "dummy-item-anna-seva", workspace_id: "", category_id: "dummy-cat-seva", name: "Annadanam Seva", monthly_limit: null },
  { id: "dummy-item-arch-seva", workspace_id: "", category_id: "dummy-cat-seva", name: "Archana Seva", monthly_limit: null },
  { id: "dummy-item-abhi-seva", workspace_id: "", category_id: "dummy-cat-seva", name: "Abhishekam Seva", monthly_limit: null },
];

export const DUMMY_PEOPLE: Person[] = [
  { id: "dummy-p-ramesh", workspace_id: "", name: "Ramesh" },
  { id: "dummy-p-sita", workspace_id: "", name: "Sita Devi" },
  { id: "dummy-p-anand", workspace_id: "", name: "Anand Kumar" },
];

const base = { created_by: "dummy-user", created_at: now(), updated_at: now(), claim_settled_at: null as string | null, bill_path: null as string | null, payment_proof_path: null as string | null, fund_source: null as string | null, beneficiary: null as string | null };

export const DUMMY_ENTRIES: Entry[] = [
  { ...base, id: "dummy-1", workspace_id: "", type: "expense", entry_date: iso(0), amount: 650, category_id: "dummy-cat-puja", item_id: "dummy-item-flowers", person_id: "dummy-p-ramesh", payment_mode: "Cash", note: "Flowers & garlands for evening aarti", reference_no: null, receipt_available: true, claim_status: null },
  { ...base, id: "dummy-2", workspace_id: "", type: "expense", entry_date: iso(1), amount: 2200, category_id: "dummy-cat-veg", item_id: "dummy-item-rice", person_id: "dummy-p-sita", payment_mode: "UPI", note: "Weekly rice & provisions", reference_no: "412233445566", receipt_available: true, claim_status: null },
  { ...base, id: "dummy-3", workspace_id: "", type: "income", entry_date: iso(2), amount: 5000, category_id: "dummy-cat-don", item_id: null, person_id: "dummy-p-anand", payment_mode: "UPI", note: "Monthly donation", reference_no: "R-2041", receipt_available: false, claim_status: null },
  { ...base, id: "dummy-4", workspace_id: "", type: "expense", entry_date: iso(3), amount: 3400, category_id: "dummy-cat-util", item_id: null, person_id: null, payment_mode: "Bank Transfer", note: "Electricity bill", reference_no: "ELC-998211", receipt_available: true, claim_status: null },
  { ...base, id: "dummy-5", workspace_id: "", type: "income", entry_date: iso(4), amount: 12500, category_id: "dummy-cat-hundi", item_id: null, person_id: null, payment_mode: "Cash", note: "Weekly hundi collection", reference_no: null, receipt_available: false, claim_status: null },
  { ...base, id: "dummy-6", workspace_id: "", type: "expense", entry_date: iso(5), amount: 1800, category_id: "dummy-cat-maint", item_id: null, person_id: "dummy-p-ramesh", payment_mode: "Cash", note: "Plumbing repair (paid from own pocket)", reference_no: null, receipt_available: true, claim_status: "submitted" },
  { ...base, id: "dummy-7", workspace_id: "", type: "expense", entry_date: iso(6), amount: 4200, category_id: "dummy-cat-fest", item_id: null, person_id: "dummy-p-sita", payment_mode: "UPI", note: "Diwali decorations", reference_no: "412556677889", receipt_available: true, claim_status: null },
  { ...base, id: "dummy-8", workspace_id: "", type: "income", entry_date: iso(7), amount: 2000, category_id: "dummy-cat-seva", item_id: null, person_id: "dummy-p-anand", payment_mode: "Cash", note: "Annadanam seva contribution", reference_no: null, receipt_available: false, claim_status: null },
  { ...base, id: "dummy-9", workspace_id: "", type: "expense", entry_date: iso(8), amount: 980, category_id: "dummy-cat-veg", item_id: null, person_id: "dummy-p-ramesh", payment_mode: "Cash", note: "Vegetables for Sunday annadanam", reference_no: null, receipt_available: false, claim_status: null },
  { ...base, id: "dummy-10", workspace_id: "", type: "expense", entry_date: iso(10), amount: 560, category_id: "dummy-cat-print", item_id: null, person_id: "dummy-p-sita", payment_mode: "UPI", note: "Receipt books & stationery", reference_no: "412998877665", receipt_available: true, claim_status: null },
];
