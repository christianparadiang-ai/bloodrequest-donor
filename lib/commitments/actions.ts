"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  submitDonorResponse,
  withdrawDonorCommitment,
  getRequestCommitments,
  getDonorCommitments,
} from "./service";
import {
  SubmitDonorResponseResult,
  WithdrawCommitmentResult,
  FormattedDonorCommitment,
} from "./types";

/**
 * Server Action: Submits a donor's operational response (INTERESTED or DECLINED).
 * Identity is securely derived server-side via Clerk currentUser().
 */
export async function submitDonorResponseAction(input: {
  notificationId?: string;
  matchId?: string;
  requestId?: string;
  response: "INTERESTED" | "DECLINED";
  reason?: string;
}): Promise<SubmitDonorResponseResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        response: "NOT_RESPONDED",
        matchStatus: "UNKNOWN",
        error: "UNAUTHORIZED: You must be signed in to respond to blood requests.",
      };
    }

    const result = await submitDonorResponse({
      ...input,
      clerkUserId: user.id,
    });

    if (result.success) {
      revalidatePath("/donor/notifications");
      revalidatePath("/donor");
      if (input.requestId) {
        revalidatePath(`/requests/${input.requestId}`);
      }
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      response: "NOT_RESPONDED",
      matchStatus: "UNKNOWN",
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Allows a donor to voluntarily withdraw an active commitment.
 */
export async function withdrawDonorCommitmentAction(
  commitmentId: string,
  reason?: string
): Promise<WithdrawCommitmentResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to withdraw a commitment.",
      };
    }

    const result = await withdrawDonorCommitment({
      commitmentId,
      clerkUserId: user.id,
      reason,
    });

    if (result.success && result.commitment) {
      revalidatePath("/donor/notifications");
      revalidatePath("/donor");
      revalidatePath(`/requests/${result.commitment.requestId}`);
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Fetches commitments for an authorized blood request owner or staff.
 */
export async function fetchRequestCommitmentsAction(
  requestId: string
): Promise<{ success: boolean; commitments: FormattedDonorCommitment[]; error?: string }> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        commitments: [],
        error: "UNAUTHORIZED: You must be signed in to view commitments.",
      };
    }

    return await getRequestCommitments(requestId, user.id);
  } catch (err: unknown) {
    return {
      success: false,
      commitments: [],
      error: err instanceof Error ? err.message : "Failed to fetch commitments.",
    };
  }
}

/**
 * Server Action: Fetches all commitments for the currently logged in donor.
 */
export async function fetchDonorCommitmentsAction(): Promise<{
  success: boolean;
  commitments: FormattedDonorCommitment[];
  error?: string;
}> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, commitments: [], error: "UNAUTHORIZED: Sign-in required." };
    }

    const commitments = await getDonorCommitments(user.id);
    return { success: true, commitments };
  } catch (err: unknown) {
    return {
      success: false,
      commitments: [],
      error: err instanceof Error ? err.message : "Failed to fetch commitments.",
    };
  }
}
