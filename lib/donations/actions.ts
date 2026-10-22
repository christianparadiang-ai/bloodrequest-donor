"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  scheduleDonation,
  markDonationAttended,
  recordDonation,
  cancelDonationAppointment,
  markDonationNoShow,
  getRequestFulfillmentSummary,
  getDonorDonations,
} from "./service";
import {
  scheduleDonationSchema,
  markAttendedSchema,
  recordDonationSchema,
  cancelDonationSchema,
  markNoShowSchema,
  adjustDonorPointsSchema,
  DonationActionResult,
  RequestFulfillmentSummary,
  FormattedDonation,
} from "./types";

/**
 * Server Action: Schedule a donation appointment.
 * Verifies authenticated Clerk identity server-side.
 */
export async function scheduleDonationAction(rawInput: unknown): Promise<DonationActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: You must be signed in to schedule a donation." };
    }

    const parsed = scheduleDonationSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input parameters." };
    }

    const result = await scheduleDonation({
      ...parsed.data,
      clerkUserId: user.id,
    });

    if (result.success && result.donation) {
      revalidatePath(`/requests/${result.donation.requestId}`);
      revalidatePath("/donor");
      revalidatePath("/donor/notifications");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Mark donor attendance at facility.
 * Enforces staff/admin authorization server-side.
 */
export async function markDonationAttendedAction(rawInput: unknown): Promise<DonationActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const parsed = markAttendedSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input parameters." };
    }

    const result = await markDonationAttended({
      ...parsed.data,
      clerkUserId: user.id,
    });

    if (result.success && result.donation) {
      revalidatePath(`/requests/${result.donation.requestId}`);
      revalidatePath("/admin");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Record completed blood collection and units.
 * Updates request fulfillment status transactionally.
 */
export async function recordDonationAction(rawInput: unknown): Promise<DonationActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const parsed = recordDonationSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input parameters." };
    }

    const result = await recordDonation({
      ...parsed.data,
      clerkUserId: user.id,
    });

    if (result.success && result.donation) {
      revalidatePath(`/requests/${result.donation.requestId}`);
      revalidatePath("/requests");
      revalidatePath("/admin");
      revalidatePath("/donor");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Cancel a scheduled appointment.
 */
export async function cancelDonationAppointmentAction(rawInput: unknown): Promise<DonationActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const parsed = cancelDonationSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input parameters." };
    }

    const result = await cancelDonationAppointment({
      ...parsed.data,
      clerkUserId: user.id,
    });

    if (result.success && result.donation) {
      revalidatePath(`/requests/${result.donation.requestId}`);
      revalidatePath("/donor");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Mark a scheduled donor as no-show.
 */
export async function markDonationNoShowAction(rawInput: unknown): Promise<DonationActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const parsed = markNoShowSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid input parameters." };
    }

    const result = await markDonationNoShow({
      ...parsed.data,
      clerkUserId: user.id,
    });

    if (result.success && result.donation) {
      revalidatePath(`/requests/${result.donation.requestId}`);
      revalidatePath("/admin");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Server Action: Fetch fulfillment summary for a requisition.
 */
export async function fetchRequestFulfillmentAction(
  requestId: string
): Promise<RequestFulfillmentSummary | null> {
  try {
    const user = await currentUser();
    return await getRequestFulfillmentSummary(requestId, user?.id || null);
  } catch {
    return null;
  }
}

/**
 * Server Action: Fetch donation history for authenticated donor.
 */
export async function fetchDonorDonationsAction(): Promise<{
  success: boolean;
  donations: FormattedDonation[];
  error?: string;
}> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, donations: [], error: "UNAUTHORIZED: Active session required." };
    }
    return await getDonorDonations(user.id);
  } catch (err: unknown) {
    return {
      success: false,
      donations: [],
      error: err instanceof Error ? err.message : "Failed to retrieve donations.",
    };
  }
}

/**
 * Server Action: Fetch authenticated donor's points summary and recognition tier.
 */
export async function fetchDonorPointsSummaryAction() {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }
    const { getDonorPointsSummary } = await import("./points");
    const summary = await getDonorPointsSummary(user.id);
    return { success: true, summary };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to retrieve points summary.",
    };
  }
}

/**
 * Server Action: Fetch privacy-conscious donor recognition leaderboard.
 */
export async function fetchDonorLeaderboardAction(limit = 10) {
  try {
    const { getDonorLeaderboard } = await import("./points");
    const leaderboard = await getDonorLeaderboard(limit);
    return { success: true, leaderboard };
  } catch (err: unknown) {
    return {
      success: false,
      leaderboard: [],
      error: err instanceof Error ? err.message : "Failed to load leaderboard.",
    };
  }
}

/**
 * Server Action: Administrator manual points adjustment.
 */
export async function adjustDonorPointsAction(params: unknown) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const parsed = adjustDonorPointsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid adjustment parameters.",
      };
    }

    const { adjustDonorPoints } = await import("./points");
    const result = await adjustDonorPoints({
      donorProfileIdOrUserId: parsed.data.donorProfileIdOrUserId,
      points: parsed.data.points,
      reason: parsed.data.reason,
      adminClerkUserId: user.id,
      transactionType: parsed.data.transactionType,
    });

    if (result.success) {
      revalidatePath("/admin");
      revalidatePath("/admin/reports");
      revalidatePath("/donor");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Adjustment error occurred.",
    };
  }
}

