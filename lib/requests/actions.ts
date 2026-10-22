"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  createBloodRequest,
  submitDraftBloodRequest,
  cancelBloodRequest,
  reviewBloodRequest,
} from "./service";
import { FormattedBloodRequest } from "@/lib/supabase/types";

export interface ActionResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Server Action: Create a blood request (as DRAFT or SUBMITTED).
 * Authenticated identity is securely derived from Clerk.
 */
export async function createBloodRequestAction(
  payload: unknown
): Promise<ActionResult<FormattedBloodRequest>> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to create a blood request.",
      };
    }

    const email = user.emailAddresses[0]?.emailAddress || "";
    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Requester";

    const result = await createBloodRequest(user.id, email, fullName, payload);

    if (!result.success || !result.request) {
      return { success: false, error: result.error || "Failed to create blood request." };
    }

    revalidatePath("/requests");
    revalidatePath("/requests/new");
    revalidatePath("/dashboard");
    revalidatePath("/admin");

    return { success: true, data: result.request };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Submit a draft blood request for verification.
 */
export async function submitDraftBloodRequestAction(
  requestId: string
): Promise<ActionResult<FormattedBloodRequest>> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to submit a requisition.",
      };
    }

    const result = await submitDraftBloodRequest(requestId, user.id);

    if (!result.success || !result.request) {
      return { success: false, error: result.error || "Failed to submit draft requisition." };
    }

    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/dashboard");
    revalidatePath("/admin");

    return { success: true, data: result.request };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Cancel a blood request with reason tracking.
 */
export async function cancelBloodRequestAction(
  requestId: string,
  payload: unknown
): Promise<ActionResult<FormattedBloodRequest>> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to cancel a requisition.",
      };
    }

    const result = await cancelBloodRequest(requestId, user.id, payload);

    if (!result.success || !result.request) {
      return { success: false, error: result.error || "Failed to cancel requisition." };
    }

    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/dashboard");
    revalidatePath("/admin");

    return { success: true, data: result.request };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Perform review transition (authorized staff / admin only).
 */
export async function reviewBloodRequestAction(
  requestId: string,
  payload: unknown
): Promise<ActionResult<FormattedBloodRequest>> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to review requisitions.",
      };
    }

    const result = await reviewBloodRequest(requestId, user.id, payload);

    if (!result.success || !result.request) {
      return { success: false, error: result.error || "Failed to complete review operation." };
    }

    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    revalidatePath("/admin");

    return { success: true, data: result.request };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action: Search and filter blood requests.
 */
export async function filterBloodRequestsAction(
  filters: import("./service").RequestFilterParams
): Promise<ActionResult<FormattedBloodRequest[]>> {
  try {
    const user = await currentUser();
    const { searchAndFilterBloodRequests } = await import("./service");
    const result = await searchAndFilterBloodRequests(filters, user?.id || null);

    if (!result.success) {
      return { success: false, error: result.error || "Failed to search requisitions." };
    }

    return { success: true, data: result.requests };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

