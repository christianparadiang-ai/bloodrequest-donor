import {
  NotificationChannel,
  DeliveryPayload,
  DeliveryResult,
} from "./types";

/**
 * Clean Delivery Provider Interface.
 * Domain logic depends on this abstraction, never directly on vendor SDKs.
 */
export interface NotificationDispatcher {
  readonly channel: NotificationChannel;
  dispatch(payload: DeliveryPayload): Promise<DeliveryResult>;
}

/**
 * In-App Notification Delivery Provider.
 * Stored directly in the database and accessible via donor portal.
 */
export class InAppNotificationDispatcher implements NotificationDispatcher {
  readonly channel: NotificationChannel = "IN_APP";

  async dispatch(_payload: DeliveryPayload): Promise<DeliveryResult> {
    void _payload;
    const now = new Date().toISOString();
    return {
      delivered: true,
      channel: "IN_APP",
      status: "DELIVERED",
      sentAt: now,
      deliveredAt: now,
    };
  }
}

/**
 * External Email Delivery Provider Stub.
 * When real credentials/provider (e.g. Resend, Sendgrid) are not configured,
 * we strictly DO NOT claim delivery.
 */
export class EmailNotificationDispatcher implements NotificationDispatcher {
  readonly channel: NotificationChannel = "EMAIL";

  async dispatch(_payload: DeliveryPayload): Promise<DeliveryResult> {
    void _payload;
    // Check if an email provider is configured in environment
    const hasConfig = Boolean(process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY);
    if (!hasConfig) {
      return {
        delivered: false,
        channel: "EMAIL",
        status: "FAILED",
        error: "External email delivery provider is not configured. Delivery not attempted.",
      };
    }

    // In future milestones, real provider SDK calls would happen here.
    return {
      delivered: false,
      channel: "EMAIL",
      status: "FAILED",
      error: "Email channel integration pending provider setup.",
    };
  }
}

/**
 * External SMS Delivery Provider Stub.
 * When real SMS credentials (e.g. Twilio) are not configured,
 * we strictly DO NOT claim delivery.
 */
export class SmsNotificationDispatcher implements NotificationDispatcher {
  readonly channel: NotificationChannel = "SMS";

  async dispatch(_payload: DeliveryPayload): Promise<DeliveryResult> {
    void _payload;
    const hasConfig = Boolean(process.env.TWILIO_ACCOUNT_SID);
    if (!hasConfig) {
      return {
        delivered: false,
        channel: "SMS",
        status: "FAILED",
        error: "External SMS delivery provider is not configured. Delivery not attempted.",
      };
    }

    return {
      delivered: false,
      channel: "SMS",
      status: "FAILED",
      error: "SMS channel integration pending provider setup.",
    };
  }
}

/**
 * Factory for retrieving the appropriate channel dispatcher.
 */
export function getNotificationDispatcher(channel: NotificationChannel = "IN_APP"): NotificationDispatcher {
  switch (channel) {
    case "EMAIL":
      return new EmailNotificationDispatcher();
    case "SMS":
      return new SmsNotificationDispatcher();
    case "IN_APP":
    default:
      return new InAppNotificationDispatcher();
  }
}
