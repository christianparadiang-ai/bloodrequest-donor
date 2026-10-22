import { currentUser, auth } from "@clerk/nextjs/server";
import { UserRole } from "@/lib/supabase/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * EXACT INITIAL AUTHORIZED ADMINISTRATOR IDENTITY.
 * Authorizes exclusively christian.paradiang@urios.edu.ph as the initial Admin account.
 */
export const INITIAL_ADMIN_EMAIL = "christian.paradiang@urios.edu.ph";
export const INITIAL_ADMIN_CLERK_ID = "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU";

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
 * Resolves the verified role for a Clerk user ID using the database profiles ledger.
 * Defends against client-side metadata tampering.
 */
export async function resolveUserRole(clerkUserId: string, email?: string | null): Promise<UserRole> {
  const isTargetAdmin =
    clerkUserId === INITIAL_ADMIN_CLERK_ID ||
    (email && email.toLowerCase() === INITIAL_ADMIN_EMAIL.toLowerCase());

  if (isTargetAdmin) {
    return "ADMIN";
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return "USER";

  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    if (profile?.role) {
      const dbRole = profile.role as UserRole;
      // Strictly prevent any account other than christian.paradiang@urios.edu.ph from obtaining ADMIN or SUPER_ADMIN
      if (dbRole === "ADMIN" || dbRole === "SUPER_ADMIN") {
        return "USER";
      }
      return dbRole;
    }
  } catch (err) {
    console.error("Failed to query user role from database:", err);
  }

  return "USER";
}

/**
 * Checks if a user is the authorized administrator by email or Clerk ID.
 */
export function isAuthorizedAdminIdentity(email?: string | null, clerkUserId?: string | null): boolean {
  const matchesEmail = Boolean(email && email.toLowerCase() === INITIAL_ADMIN_EMAIL.toLowerCase());
  const matchesClerkId = Boolean(clerkUserId && clerkUserId === INITIAL_ADMIN_CLERK_ID);
  return matchesEmail || matchesClerkId;
}

/**
 * Checks if the current authenticated user has one of the allowed roles.
 * Roles are extracted securely from database and verified server claims.
 */
export async function requireUserWithRole(allowedRoles: UserRole[]): Promise<{
  userId: string;
  role: UserRole;
  email: string | null;
}> {
  const user = await currentUser();

  if (!user || !user.id) {
    throw new Error("UNAUTHORIZED: Active session required.");
  }

  const primaryEmail = user.emailAddresses?.[0]?.emailAddress || null;
  const role = await resolveUserRole(user.id, primaryEmail);

  if (!allowedRoles.includes(role)) {
    throw new Error(`FORBIDDEN: Role '${role}' not authorized for this resource.`);
  }

  return { userId: user.id, role, email: primaryEmail };
}

/**
 * Strict server-side authorization guard for administrative features.
 * Ensures only authorized administrator (christian.paradiang@urios.edu.ph)
 * with verified Clerk identity and trusted server-side ADMIN role can execute privileged operations.
 */
export async function requireAdminUser(): Promise<{
  userId: string;
  email: string;
  role: UserRole;
}> {
  const user = await currentUser();

  if (!user || !user.id) {
    throw new Error("UNAUTHORIZED: Administrator session required.");
  }

  const verifiedEmailObj = user.emailAddresses?.find(
    (e) => e.verification?.status === "verified" && e.emailAddress.toLowerCase() === INITIAL_ADMIN_EMAIL.toLowerCase()
  );
  const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();

  const isExactAdminIdentity =
    (user.id === INITIAL_ADMIN_CLERK_ID || Boolean(verifiedEmailObj)) &&
    primaryEmail === INITIAL_ADMIN_EMAIL;

  const role = await resolveUserRole(user.id, verifiedEmailObj ? primaryEmail : null);

  if (!isExactAdminIdentity || (role !== "ADMIN" && role !== "SUPER_ADMIN")) {
    throw new Error("FORBIDDEN: Access restricted to authorized system administrators.");
  }

  return { userId: user.id, email: primaryEmail, role };
}
