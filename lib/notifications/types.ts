import {
  NotificationType,
  NotificationDeliveryStatus,
  NotificationRecord,
  FormattedNotification,
} from "@/lib/supabase/types";

export type {
  NotificationType,
  NotificationDeliveryStatus,
  NotificationRecord,
  FormattedNotification,
};

export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS";

export const NOTIFICATION_SAFETY_DISCLAIMER =
  "This notification coordinates potential blood donation availability only. It is NOT a clinical determination of medical eligibility, compatibility, or donor suitability. All donation suitability is determined on-site by certified blood bank professionals.";

export const VALID_LIFECYCLE_TRANSITIONS: Record<
  NotificationDeliveryStatus,
  NotificationDeliveryStatus[]
> = {
  PENDING: ["SENT", "DELIVERED", "FAILED"],
  SENT: ["DELIVERED", "FAILED"],
  DELIVERED: ["READ"],
  READ: [],
  FAILED: ["PENDING"],
  PROCESSING: ["SENT", "DELIVERED", "FAILED"],
};

export function isValidLifecycleTransition(
  currentStatus: NotificationDeliveryStatus,
  newStatus: NotificationDeliveryStatus
): boolean {
  if (currentStatus === newStatus) return true;
  const allowed = VALID_LIFECYCLE_TRANSITIONS[currentStatus] || [];
  return allowed.includes(newStatus);
}

export interface DispatchNotificationInput {
  requestId: string;
  matchId: string;
  clerkUserId: string;
  channel?: NotificationChannel;
}

export interface DispatchNotificationResult {
  success: boolean;
  notification?: FormattedNotification;
  alreadyDispatched?: boolean;
  matchStatus?: string;
  error?: string;
}

export interface DeliveryPayload {
  notificationId: string;
  recipientUserId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  delivered: boolean;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  deliveredAt?: string;
  sentAt?: string;
  error?: string;
}
