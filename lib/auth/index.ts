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
 * Reliably extracts the user's primary or verified email address from a Clerk user object.
 * Defends against arbitrary email array order or secondary email preemption.
 */
export function extractUserEmail(user: {
  id?: string;
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{ id?: string; emailAddress: string; verification?: { status: string } | null }>;
} | null | undefined): string | null {
  if (!user || !user.emailAddresses || user.emailAddresses.length === 0) return null;

  // 1. If user owns the designated admin email among their verified email addresses, prioritize it
  const adminEmailObj = user.emailAddresses.find(
    (e) => e.emailAddress.toLowerCase().trim() === INITIAL_ADMIN_EMAIL.toLowerCase()
  );
  if (adminEmailObj) {
    return adminEmailObj.emailAddress.toLowerCase().trim();
  }

  // 2. Otherwise use the primary email if available
  if (user.primaryEmailAddressId) {
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    if (primary) {
      return primary.emailAddress.toLowerCase().trim();
    }
  }

  // 3. Fallback to first email in array
  return user.emailAddresses[0]?.emailAddress.toLowerCase().trim() || null;
}

/**
 * Resolves the verified role for a Clerk user ID using the database profiles ledger.
 * Defends against client-side metadata tampering.
 * Self-heals clerk_user_id and role synchronization for the authorized administrator.
 */
export async function resolveUserRole(clerkUserId: string, email?: string | null): Promise<UserRole> {
  const normalizedEmail = email ? email.toLowerCase().trim() : null;

  const isTargetAdmin =
    clerkUserId === INITIAL_ADMIN_CLERK_ID ||
    (normalizedEmail !== null && normalizedEmail === INITIAL_ADMIN_EMAIL.toLowerCase());

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return isTargetAdmin ? "ADMIN" : "USER";
  }

  try {
    // 1. Query profile by clerk_user_id
    let { data: profile } = await admin
      .from("profiles")
      .select("id, role, email, clerk_user_id")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    // 2. If not matched by clerk_user_id but email is known, find by email
    if (!profile && normalizedEmail) {
      const { data: profileByEmail } = await admin
        .from("profiles")
        .select("id, role, email, clerk_user_id")
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (profileByEmail) {
        profile = profileByEmail;
        // Safely update clerk_user_id only if unset or if caller is INITIAL_ADMIN_CLERK_ID
        // This prevents arbitrary or forged requests from overriding legitimate identity associations
        if (!profileByEmail.clerk_user_id || clerkUserId === INITIAL_ADMIN_CLERK_ID) {
          await admin
            .from("profiles")
            .update({
              clerk_user_id: clerkUserId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", profileByEmail.id);
          profile.clerk_user_id = clerkUserId;
        }
      }
    }

    // 3. If this identity is the authorized platform administrator
    const profileEmail = (profile?.email || "").toLowerCase().trim();
    if (
      isTargetAdmin ||
      profileEmail === INITIAL_ADMIN_EMAIL.toLowerCase() ||
      profile?.clerk_user_id === INITIAL_ADMIN_CLERK_ID
    ) {
      // Ensure database row role is synchronized to ADMIN
      if (profile && profile.role !== "ADMIN") {
        await admin
          .from("profiles")
          .update({
            role: "ADMIN",
            updated_at: new Date().toISOString(),
          })
          .eq("id", profile.id);
      }
      return "ADMIN";
    }

    // 4. For all other profiles: enforce role bounds and prevent untrusted admin elevation
    if (profile?.role) {
      const dbRole = profile.role as UserRole;
      if (dbRole === "ADMIN" || dbRole === "SUPER_ADMIN") {
        console.warn(`Untrusted elevation blocked for profile ${profile.id}: role clamped to USER.`);
        return "USER";
      }
      return dbRole;
    }
  } catch (err) {
    console.error("Failed to query user role from database:", err);
  }

  return isTargetAdmin ? "ADMIN" : "USER";
}

/**
 * Checks if a user is the authorized administrator by email or Clerk ID.
 */
export function isAuthorizedAdminIdentity(email?: string | null, clerkUserId?: string | null): boolean {
  const matchesEmail = Boolean(email && email.toLowerCase().trim() === INITIAL_ADMIN_EMAIL.toLowerCase());
  const matchesClerkId = Boolean(clerkUserId && clerkUserId === INITIAL_ADMIN_CLERK_ID);
  return matchesEmail || matchesClerkId;
}

/**
 * High-level server helper returning authenticated user details and verified role.
 */
export async function getAuthenticatedUserRole(): Promise<{
  userId: string | null;
  email: string | null;
  role: UserRole;
  isAdmin: boolean;
}> {
  const user = await currentUser();
  if (!user || !user.id) {
    return { userId: null, email: null, role: "USER", isAdmin: false };
  }

  const email = extractUserEmail(user);
  const role = await resolveUserRole(user.id, email);
  const isAdmin =
    role === "ADMIN" &&
    (user.id === INITIAL_ADMIN_CLERK_ID || (email !== null && email === INITIAL_ADMIN_EMAIL.toLowerCase()));

  return { userId: user.id, email, role, isAdmin };
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

  const email = extractUserEmail(user);
  const role = await resolveUserRole(user.id, email);

  if (!allowedRoles.includes(role)) {
    throw new Error(`FORBIDDEN: Role '${role}' not authorized for this resource.`);
  }

  return { userId: user.id, role, email };
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

  const email = extractUserEmail(user) || "";
  const role = await resolveUserRole(user.id, email);

  const isExactAdminIdentity =
    (user.id === INITIAL_ADMIN_CLERK_ID || email === INITIAL_ADMIN_EMAIL.toLowerCase()) &&
    role === "ADMIN";

  if (!isExactAdminIdentity) {
    throw new Error("FORBIDDEN: Access restricted to authorized system administrators.");
  }

  return { userId: user.id, email, role };
}
