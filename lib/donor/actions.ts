"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  saveDonorProfile,
  toggleDonorAvailability,
  toggleDonorContactConsent,
} from "./service";
import { BloodGroup } from "@/lib/supabase/types";

export interface ActionResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Server Action to save or update the donor profile.
 * Authenticated identity is securely derived from Clerk.
 */
export async function saveDonorProfileAction(
  formData: {
    blood_group: BloodGroup;
    is_available: boolean;
    consent_to_contact: boolean;
    service_radius_km: number;
    city: string;
    province: string;
  }
): Promise<ActionResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: You must be signed in to manage a donor profile." };
    }

    const primaryEmail = user.emailAddresses[0]?.emailAddress || "";
    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Donor";

    const result = await saveDonorProfile(user.id, primaryEmail, fullName, formData);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/donor");
    revalidatePath("/donor/onboarding");
    revalidatePath("/dashboard");

    return { success: true, data: result.donor };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred.",
    };
  }
}

/**
 * Server Action to toggle operational availability.
 */
export async function toggleAvailabilityAction(
  isAvailable: boolean
): Promise<ActionResult<{ isAvailable: boolean }>> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const result = await toggleDonorAvailability(user.id, { is_available: isAvailable });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/donor");
    revalidatePath("/dashboard");

    return { success: true, data: { isAvailable: Boolean(result.isAvailable) } };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to toggle availability.",
    };
  }
}

/**
 * Server Action to toggle contact consent.
 */
export async function toggleConsentAction(
  consentToContact: boolean
): Promise<ActionResult<{ consentToContact: boolean }>> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required." };
    }

    const result = await toggleDonorContactConsent(user.id, { consent_to_contact: consentToContact });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath("/donor");
    revalidatePath("/dashboard");

    return { success: true, data: { consentToContact: Boolean(result.consentToContact) } };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update contact consent.",
    };
  }
}

/**
 * Server Action: Search and filter donors with privacy masking.
 */
export async function filterDonorsAction(
  filters: import("./service").DonorFilterParams
): Promise<ActionResult<import("./service").DonorDirectoryEntry[]>> {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, error: "UNAUTHORIZED: Active session required to access donor directory." };
    }

    const { listAndFilterDonors } = await import("./service");
    const result = await listAndFilterDonors(filters);
    if (!result.success) {
      return { success: false, error: result.error || "Failed to search donors." };
    }
    return { success: true, data: result.donors };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error searching donors.",
    };
  }
}

