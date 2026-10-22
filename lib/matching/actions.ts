"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  discoverPotentialDonorsForRequest,
  getPotentialMatchesForRequest,
  MatchDiscoveryResult,
} from "./service";

export interface MatchingActionResult {
  success: boolean;
  result?: MatchDiscoveryResult;
  error?: string;
}

/**
 * Server Action: Triggers potential donor discovery engine for an ACTIVE requisition.
 * Identity is securely derived from Clerk server-side.
 */
export async function triggerDonorDiscoveryAction(
  requestId: string
): Promise<MatchingActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to perform potential donor discovery.",
      };
    }

    const discoveryResult = await discoverPotentialDonorsForRequest(
      requestId,
      user.id
    );

    if (!discoveryResult.success) {
      return {
        success: false,
        error: discoveryResult.error || "Potential donor discovery could not be completed.",
      };
    }

    revalidatePath(`/requests/${requestId}`);

    return {
      success: true,
      result: discoveryResult,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Queries current potential matches for a requisition.
 */
export async function fetchPotentialMatchesAction(
  requestId: string
): Promise<MatchingActionResult> {
  try {
    const user = await currentUser();

    const matchesResult = await getPotentialMatchesForRequest(
      requestId,
      user?.id || null
    );

    return {
      success: matchesResult.success,
      result: matchesResult,
      error: matchesResult.error,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}
