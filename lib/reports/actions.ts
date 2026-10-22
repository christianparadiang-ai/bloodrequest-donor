"use server";

import { currentUser } from "@clerk/nextjs/server";
import {
  getAnalyticsReport,
  generateCsvExport,
  ReportCategory,
} from "./service";
import { PeriodType } from "./dates";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { UserRole } from "@/lib/supabase/types";
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

    const { data: profile } = await admin
      .from("profiles")
      .select("id, role")
      .eq("clerk_user_id", user.id)
      .single();

    if (!profile || !["ADMIN", "SUPER_ADMIN"].includes(profile.role as UserRole)) {
      return { success: false, error: "UNAUTHORIZED: Only administrators can modify points configuration." };
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
