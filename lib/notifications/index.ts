export * from "./types";
export * from "./dispatcher";
export * from "./service";
export * from "./actions";

export interface OutboxNotificationPayload {
  recipientId: string;
  channel: "IN_APP" | "EMAIL" | "SMS";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Foundation outbox dispatcher stub preserved for backward compatibility.
 */
export async function queueNotification(
  _payload: OutboxNotificationPayload
): Promise<{ success: boolean; queuedAt: string }> {
  void _payload;
  return {
    success: true,
    queuedAt: new Date().toISOString(),
  };
}
