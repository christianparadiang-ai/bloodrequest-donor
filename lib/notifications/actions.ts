"use server";

import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {
  dispatchDonorNotification,
  markNotificationAsRead,
  getDonorNotifications,
  getUnreadNotificationCount,
} from "./service";
import {
  DispatchNotificationResult,
  FormattedNotification,
} from "./types";

/**
 * Server Action: Dispatches operational notification to a potential candidate match.
 * Server verifies Clerk authentication, ownership/role, request status, and donor consent.
 */
export async function dispatchDonorNotificationAction(
  requestId: string,
  matchId: string
): Promise<DispatchNotificationResult> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to dispatch notifications.",
      };
    }

    const result = await dispatchDonorNotification({
      requestId,
      matchId,
      clerkUserId: user.id,
      channel: "IN_APP",
    });

    if (result.success) {
      revalidatePath(`/requests/${requestId}`);
      revalidatePath(`/requests/${requestId}/matches`);
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected server error occurred during dispatch.",
    };
  }
}

/**
 * Server Action: Marks a donor's notification as READ.
 */
export async function markNotificationAsReadAction(
  notificationId: string
): Promise<{ success: boolean; notification?: FormattedNotification; error?: string }> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        error: "UNAUTHORIZED: You must be signed in to update notification status.",
      };
    }

    const result = await markNotificationAsRead(notificationId, user.id);

    if (result.success) {
      revalidatePath("/donor/notifications");
      revalidatePath("/donor");
    }

    return result;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred marking notification as read.",
    };
  }
}

/**
 * Server Action: Fetches notifications for the current donor.
 */
export async function fetchDonorNotificationsAction(
  unreadOnly: boolean = false
): Promise<{ success: boolean; notifications: FormattedNotification[]; error?: string }> {
  try {
    const user = await currentUser();
    if (!user) {
      return {
        success: false,
        notifications: [],
        error: "UNAUTHORIZED: You must be signed in to view notifications.",
      };
    }

    const notifications = await getDonorNotifications(user.id, { unreadOnly });
    return {
      success: true,
      notifications,
    };
  } catch (err: unknown) {
    return {
      success: false,
      notifications: [],
      error: err instanceof Error ? err.message : "Failed to fetch donor notifications.",
    };
  }
}

/**
 * Server Action: Fetches unread notification count for the current donor.
 */
export async function getUnreadNotificationCountAction(): Promise<number> {
  try {
    const user = await currentUser();
    if (!user) return 0;
    return await getUnreadNotificationCount(user.id);
  } catch {
    return 0;
  }
}
