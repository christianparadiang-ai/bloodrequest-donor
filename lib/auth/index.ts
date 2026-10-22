import { currentUser, auth } from "@clerk/nextjs/server";
import { UserRole } from "@/lib/supabase/types";

/**
 * Server-side helper to get the authenticated user ID from Clerk.
 * Rejects any client-supplied userId to prevent IDOR attacks.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Server-side helper to get the current authenticated Clerk user details.
 */
export async function getAuthenticatedUser() {
  return await currentUser();
}

/**
 * Checks if the current authenticated user has one of the allowed roles.
 * Roles are extracted securely from Clerk user metadata or database.
 */
export async function requireUserWithRole(allowedRoles: UserRole[]): Promise<{
  userId: string;
  role: UserRole;
}> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    throw new Error("UNAUTHORIZED: Active session required.");
  }

  // Extract role from session claims metadata if present, default to USER
  const role = ((sessionClaims?.metadata as Record<string, unknown>)?.role as UserRole) || "USER";

  if (!allowedRoles.includes(role)) {
    throw new Error(`FORBIDDEN: Role '${role}' not authorized for this resource.`);
  }

  return { userId, role };
}
