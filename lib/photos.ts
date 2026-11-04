import { db } from "./db";

const BUCKET = "receipts";
const PAGE = 100; // Supabase's list() default

/**
 * Remove every photo stored under a workspace.
 *
 * Deleting a workspace cascades cleanly through the database, but nothing clears the files in
 * Storage: the bills and payment screenshots stay in the bucket, unreachable but still stored,
 * still counted against the plan and still on the invoice. Call this *before* the workspace row
 * goes, because the Storage policies decide access from workspace membership.
 */
export async function purgeWorkspacePhotos(workspaceId: string): Promise<{ removed: number; error: { message: string } | null }> {
  const bucket = db.storage.from(BUCKET);
  let removed = 0;
  // list() returns a page at a time, and each pass has just deleted the page before it.
  for (let page = 0; page < 500; page++) {
    const { data, error } = await bucket.list(workspaceId);
    if (error) return { removed, error };
    // Entries without an id are folders, not files.
    const names = (data ?? []).filter((f) => f.id).map((f) => `${workspaceId}/${f.name}`);
    if (!names.length) return { removed, error: null };
    const { error: rmErr } = await bucket.remove(names);
    if (rmErr) return { removed, error: rmErr };
    removed += names.length;
    if (names.length < PAGE) return { removed, error: null };
  }
  return { removed, error: { message: "There were too many photos to remove in one go. Please try again to clear the rest." } };
}
