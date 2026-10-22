import {
  DonationStatus,
  DonationRecord,
  FormattedDonation,
  RequestFulfillmentSummary,
  BloodComponentType,
  BloodGroup,
} from "@/lib/supabase/types";
import { z } from "zod";

export type {
  DonationStatus,
  DonationRecord,
  FormattedDonation,
  RequestFulfillmentSummary,
  BloodComponentType,
  BloodGroup,
};

export const DONATION_SAFETY_DISCLAIMER =
  "OPERATIONAL NOTICE: A donation record documents operational attendance and units collected at an authorized facility. It does NOT represent clinical health clearance, medical eligibility, transfusion safety authorization, or laboratory compatibility. Certified blood bank medical personnel are exclusively responsible for all clinical testing and cross-matching.";

/**
 * Valid operational donation state machine transitions.
 */
export const VALID_DONATION_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
  SCHEDULED: ["ATTENDED", "CANCELLED", "NO_SHOW"],
  ATTENDED: ["RECORDED", "CANCELLED"],
  RECORDED: [], // Terminal
  CANCELLED: [], // Terminal
  NO_SHOW: [], // Terminal
};

export function isValidDonationTransition(
  current: DonationStatus,
  next: DonationStatus
): boolean {
  if (current === next) return true;
  const allowed = VALID_DONATION_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

export const scheduleDonationSchema = z.object({
  commitmentId: z.string().uuid("Invalid commitment UUID"),
  scheduledAt: z.string().datetime().optional(),
  facilityName: z.string().min(2).max(150).optional(),
  notes: z.string().max(500).optional(),
});

export type ScheduleDonationInput = z.infer<typeof scheduleDonationSchema> & {
  clerkUserId: string;
};

export const markAttendedSchema = z.object({
  donationId: z.string().uuid("Invalid donation UUID"),
  attendedAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export type MarkAttendedInput = z.infer<typeof markAttendedSchema> & {
  clerkUserId: string;
};

export const recordDonationSchema = z.object({
  donationId: z.string().uuid("Invalid donation UUID"),
  unitsDonated: z.number().int().min(1, "At least 1 unit must be donated").max(4, "Cannot record more than 4 units per donation"),
  componentType: z.enum(["WHOLE_BLOOD", "PRBC", "PLATELETS", "FFP", "CRYOPRECIPITATE"]).default("WHOLE_BLOOD"),
  facilityName: z.string().min(2).max(150).optional(),
  notes: z.string().max(500).optional(),
});

export type RecordDonationInput = z.infer<typeof recordDonationSchema> & {
  clerkUserId: string;
};

export const cancelDonationSchema = z.object({
  donationId: z.string().uuid("Invalid donation UUID"),
  reason: z.string().min(3, "Cancellation reason must be at least 3 characters").max(500),
});

export type CancelDonationInput = z.infer<typeof cancelDonationSchema> & {
  clerkUserId: string;
};

export const markNoShowSchema = z.object({
  donationId: z.string().uuid("Invalid donation UUID"),
  reason: z.string().max(500).optional(),
});

export type MarkNoShowInput = z.infer<typeof markNoShowSchema> & {
  clerkUserId: string;
};

export const adjustDonorPointsSchema = z.object({
  donorProfileIdOrUserId: z.string().min(1, "Donor identifier is required"),
  points: z
    .number()
    .int("Points must be an integer")
    .min(1, "Points amount must be at least 1")
    .max(5000, "Maximum 5,000 points per adjustment"),
  reason: z
    .string()
    .trim()
    .min(5, "Adjustment reason must be at least 5 characters")
    .max(255, "Reason exceeds maximum length of 255 characters"),
  transactionType: z.enum(["MANUAL_ADJUSTMENT", "REVERSAL"]).default("MANUAL_ADJUSTMENT"),
});

export type AdjustDonorPointsInput = z.infer<typeof adjustDonorPointsSchema>;

export interface DonationActionResult<T = FormattedDonation> {
  success: boolean;
  donation?: T;
  fulfillmentSummary?: RequestFulfillmentSummary;
  alreadyProcessed?: boolean;
  error?: string;
}
