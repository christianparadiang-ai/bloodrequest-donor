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

    const { extractUserEmail } = await import("@/lib/auth");
    const email = extractUserEmail(user);

    return await getAnalyticsReport({
      clerkUserId: user.id,
      email,
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

    const { extractUserEmail } = await import("@/lib/auth");
    const email = extractUserEmail(user);

    return await generateCsvExport({
      clerkUserId: user.id,
      email,
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
    const { requireAdminUser } = await import("@/lib/auth");
    const { userId } = await requireAdminUser();

    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, error: "Database client unavailable." };

    let { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (!profile) {
      const { data: p } = await admin
        .from("profiles")
        .select("id")
        .ilike("email", "christian.paradiang@urios.edu.ph")
        .maybeSingle();
      profile = p;
    }

    if (!profile) {
      return { success: false, error: "UNAUTHORIZED: Administrator profile not found." };
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
