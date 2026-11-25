import type { Role } from "./types";

/**
 * What each role is called on screen, and what it may do. The database decides (see
 * supabase/migrations/20260101000008_roles.sql); these words only describe it.
 */
export const ROLES: Record<Role, { label: string; does: string }> = {
  owner: { label: "Owner", does: "Everything in this workspace, including deleting it." },
  admin: { label: "Admin", does: "Everything in this workspace: edit and delete entries, members, settings." },
  accountant: { label: "Main accountant", does: "Sees everything, adds entries and journals, keeps the books, bank and weekly settlement. Cannot edit or delete entries." },
  editor: { label: "Entry user", does: "Adds entries and sees only their own. Cannot edit or delete." },
  viewer: { label: "Viewer", does: "Reads only, and only their own entries unless full view is on." },
};
export const SUPER_ADMIN = { label: "Super admin", does: "Everything, in every workspace. Sees all users and sets everyone's roles." };

/** Roles a workspace admin can hand out. Owner is only ever given by a super admin. */
export const ASSIGNABLE: Role[] = ["admin", "accountant", "editor", "viewer"];
export const ALL_ROLES: Role[] = ["owner", ...ASSIGNABLE];

export const roleLabel = (r: Role | string) => ROLES[r as Role]?.label ?? r;
/** Full view is the switch for roles that otherwise see only their own entries. */
export const hasFullViewSwitch = (r: Role) => r === "editor" || r === "viewer";
