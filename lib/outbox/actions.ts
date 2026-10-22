"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { UserRole } from "@/lib/supabase/types";
import { getOutboxMetrics, getRecentOutboxEvents } from "./service";
import { processOutboxBatch } from "./worker";
import { reconcilePlatformState } from "./reconciliation";
import { resolveUserRole } from "@/lib/auth";
import {
  FormattedOutboxEvent,
  OutboxMetrics,
  ProcessOutboxBatchResult,
  ReconciliationResult,
} from "./types";

const PRIVILEGED_ROLES: UserRole[] = [
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
  "HOSPITAL_STAFF",
];

async function assertPrivilegedStaff(): Promise<{
  authorized: boolean;
  profileId?: string;
  role?: UserRole;
  error?: string;
}> {
  const user = await currentUser();
  if (!user) {
    return { authorized: false, error: "UNAUTHORIZED: Sign in required." };
  }

  const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  const role = await resolveUserRole(user.id, primaryEmail);

  if (!PRIVILEGED_ROLES.includes(role)) {
    return {
      authorized: false,
      error: "FORBIDDEN: Administrative or staff role required for outbox management.",
    };
  }

  const admin = createSupabaseAdminClient();
  let profileId: string | undefined;
  if (admin) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();
    profileId = profile?.id;
  }

  return { authorized: true, profileId, role };
}

/**
 * Server Action to trigger outbox batch delivery processing.
 */
export async function processOutboxAction(
  batchSize: number = 20
): Promise<{ success: boolean; result?: ProcessOutboxBatchResult; error?: string }> {
  const auth = await assertPrivilegedStaff();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  try {
    const result = await processOutboxBatch({ batchSize });
    revalidatePath("/admin");
    return { success: true, result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to process outbox batch",
    };
  }
}

/**
 * Server Action to trigger platform expiration reconciliation.
 */
export async function reconcilePlatformAction(): Promise<{
  success: boolean;
  result?: ReconciliationResult;
  error?: string;
}> {
  const auth = await assertPrivilegedStaff();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  try {
    const result = await reconcilePlatformState();
    revalidatePath("/admin");
    return { success: true, result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to run platform reconciliation",
    };
  }
}

/**
 * Server Action to fetch operational outbox metrics and recent events for admin UI.
 */
export async function getOutboxDashboardDataAction(): Promise<{
  success: boolean;
  metrics?: OutboxMetrics;
  recentEvents?: FormattedOutboxEvent[];
  error?: string;
}> {
  const auth = await assertPrivilegedStaff();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  try {
    const metrics = await getOutboxMetrics();
    const recentEvents = await getRecentOutboxEvents(10);
    return { success: true, metrics, recentEvents };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load outbox dashboard data",
    };
  }
}
