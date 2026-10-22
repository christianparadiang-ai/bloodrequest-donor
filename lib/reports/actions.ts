"use server";

import { currentUser } from "@clerk/nextjs/server";
import {
  getAnalyticsReport,
  generateCsvExport,
  ReportCategory,
} from "./service";
import { PeriodType } from "./dates";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function fetchAnalyticsReportAction(params: {
  periodType: PeriodType;
  date?: string;
  year?: number;
  month?: number;
  customStart?: string;
  customEnd?: string;
}) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    return await getAnalyticsReport({
      clerkUserId: user.id,
      ...params,
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load report analytics.",
    };
  }
}

export async function exportCsvReportAction(params: {
  category: ReportCategory;
  periodType: PeriodType;
  date?: string;
  year?: number;
  month?: number;
  customStart?: string;
  customEnd?: string;
}) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    return await generateCsvExport({
      clerkUserId: user.id,
      ...params,
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate CSV export.",
    };
  }
}

export async function updatePointsConfigAction(params: {
  key: string;
  value: number;
}) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, error: "Database client unavailable." };

    const { extractUserEmail, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_CLERK_ID } = await import("@/lib/auth");
    const email = extractUserEmail(user) || "";

    const isAuthorizedAdmin =
      email === INITIAL_ADMIN_EMAIL.toLowerCase() ||
      user.id === INITIAL_ADMIN_CLERK_ID;

    let { data: profile } = await admin
      .from("profiles")
      .select("id, role, email, clerk_user_id")
      .eq("clerk_user_id", user.id)
      .maybeSingle();

    if (!profile && email) {
      const { data: profileByEmail } = await admin
        .from("profiles")
        .select("id, role, email, clerk_user_id")
        .ilike("email", email)
        .maybeSingle();

      if (profileByEmail) {
        profile = profileByEmail;
        await admin
          .from("profiles")
          .update({ clerk_user_id: user.id, updated_at: new Date().toISOString() })
          .eq("id", profileByEmail.id);
      }
    }

    if (!isAuthorizedAdmin || !profile) {
      return { success: false, error: "UNAUTHORIZED: Only the authorized administrator can modify points configuration." };
    }

    const { error } = await admin
      .from("points_config")
      .update({
        value: params.value,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      })
      .eq("key", params.key);

    if (error) throw error;

    revalidatePath("/admin/reports");
    revalidatePath("/admin");
    revalidatePath("/donor");

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update points configuration.",
    };
  }
}
