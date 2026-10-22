"use server";

import { getAuthenticatedUserRole } from "@/lib/auth";

/**
 * Server action to securely resolve the current user's verified role and admin status.
 * Rejects client-supplied identities and enforces server-side database claims.
 */
export async function getCurrentUserRoleAction(): Promise<{
  userId: string | null;
  email: string | null;
  role: string;
  isAdmin: boolean;
}> {
  return await getAuthenticatedUserRole();
}
