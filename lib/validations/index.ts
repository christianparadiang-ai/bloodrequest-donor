import { z } from "zod";

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export const bloodGroupSchema = z.enum(BLOOD_GROUPS, {
  message: "Invalid blood group. Must be one of A+, A-, B+, B-, AB+, AB-, O+, O-.",
});

export const donorProfileFormSchema = z.object({
  blood_group: bloodGroupSchema,
  is_available: z.boolean().default(true),
  consent_to_contact: z.boolean().refine((val) => val === true, {
    message: "Explicit consent to contact for emergency requests is required.",
  }),
  service_radius_km: z
    .coerce
    .number()
    .int("Service radius must be a whole number in kilometers")
    .min(1, "Service radius must be at least 1 km")
    .max(150, "Service radius cannot exceed 150 km"),
  city: z
    .string()
    .trim()
    .min(2, "City / Municipality must be at least 2 characters")
    .max(100, "City name is too long"),
  province: z
    .string()
    .trim()
    .min(2, "Province / Region must be at least 2 characters")
    .max(100, "Province name is too long"),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const donorProfileUpdateSchema = z.object({
  blood_group: bloodGroupSchema,
  is_available: z.boolean(),
  consent_to_contact: z.boolean(),
  service_radius_km: z
    .coerce
    .number()
    .int("Service radius must be an integer in kilometers")
    .min(1, "Service radius must be at least 1 km")
    .max(150, "Service radius cannot exceed 150 km"),
  city: z
    .string()
    .trim()
    .min(2, "City / Municipality must be at least 2 characters")
    .max(100),
  province: z
    .string()
    .trim()
    .min(2, "Province must be at least 2 characters")
    .max(100),
});

export const availabilityToggleSchema = z.object({
  is_available: z.boolean(),
});

export const consentToggleSchema = z.object({
  consent_to_contact: z.boolean(),
});

export type DonorProfileFormData = z.infer<typeof donorProfileFormSchema>;
export type DonorProfileUpdateData = z.infer<typeof donorProfileUpdateSchema>;

// ============================================================================
// MILESTONE 2: BLOOD REQUISITION VALIDATION SCHEMAS
// ============================================================================

export const URGENCY_LEVELS = ["ROUTINE", "URGENT", "CRITICAL_STAT"] as const;
export const urgencyLevelSchema = z.enum(URGENCY_LEVELS, {
  message: "Invalid urgency level. Must be ROUTINE, URGENT, or CRITICAL_STAT.",
});

export const BLOOD_COMPONENTS = [
  "WHOLE_BLOOD",
  "PRBC",
  "PLATELETS",
  "FFP",
  "CRYOPRECIPITATE",
] as const;
export const bloodComponentSchema = z.enum(BLOOD_COMPONENTS, {
  message: "Invalid blood component specified.",
}).default("WHOLE_BLOOD");

export const REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACTIVE",
  "PARTIALLY_COMMITTED",
  "FULLY_COMMITTED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "EXPIRED",
  "CANCELLED",
  "REJECTED",
] as const;
export const requestStatusSchema = z.enum(REQUEST_STATUSES, {
  message: "Invalid requisition status.",
});

export const createBloodRequestSchema = z.object({
  patient_name: z
    .string()
    .trim()
    .min(2, "Patient name or identifier must be at least 2 characters")
    .max(100, "Patient identifier must not exceed 100 characters"),
  blood_group: bloodGroupSchema,
  blood_component: bloodComponentSchema,
  units_requested: z
    .coerce
    .number()
    .int("Units requested must be a whole number")
    .min(1, "At least 1 unit must be requested")
    .max(20, "Cannot request more than 20 units in a single requisition"),
  urgency_level: urgencyLevelSchema,
  hospital_name: z
    .string()
    .trim()
    .min(3, "Hospital or healthcare facility must be at least 3 characters")
    .max(150, "Hospital name is too long"),
  hospital_city: z
    .string()
    .trim()
    .min(2, "City / Municipality must be at least 2 characters")
    .max(100, "City name is too long"),
  province: z
    .string()
    .trim()
    .min(2, "Province / Region must be at least 2 characters")
    .max(100, "Province name is too long"),
  contact_name: z
    .string()
    .trim()
    .min(2, "Contact person name must be at least 2 characters")
    .max(100, "Contact name is too long")
    .optional()
    .or(z.literal("")),
  contact_number: z
    .string()
    .trim()
    .min(7, "Valid contact telephone or mobile number is required")
    .max(25, "Contact number is too long"),
  required_by: z
    .string()
    .refine(
      (val) => {
        const d = new Date(val);
        return !isNaN(d.getTime()) && d.getTime() > Date.now();
      },
      { message: "Needed-by date and time must be in the future" }
    ),
  request_reason: z
    .string()
    .trim()
    .max(500, "Reason or diagnosis context must not exceed 500 characters")
    .optional()
    .or(z.literal("")),
  medical_notes: z
    .string()
    .trim()
    .max(1000, "Additional notes must not exceed 1000 characters")
    .optional()
    .or(z.literal("")),
  is_draft: z.boolean().default(false),
});

export const updateDraftBloodRequestSchema = createBloodRequestSchema
  .omit({ is_draft: true })
  .partial();

export const cancelBloodRequestSchema = z.object({
  cancellation_reason: z
    .string()
    .trim()
    .min(3, "Please specify a cancellation reason (minimum 3 characters)")
    .max(300, "Cancellation reason must not exceed 300 characters"),
});

export const reviewBloodRequestSchema = z.object({
  target_status: z.enum(["UNDER_REVIEW", "ACTIVE", "REJECTED", "SUBMITTED", "FULFILLED", "CANCELLED"], {
    message: "Invalid review target status.",
  }),
  reviewer_notes: z
    .string()
    .trim()
    .max(500, "Reviewer notes must not exceed 500 characters")
    .optional()
    .or(z.literal("")),
  rejection_reason: z
    .string()
    .trim()
    .max(500, "Rejection reason must not exceed 500 characters")
    .optional()
    .or(z.literal("")),
});

export type CreateBloodRequestInput = z.infer<typeof createBloodRequestSchema>;
export type UpdateDraftBloodRequestInput = z.infer<typeof updateDraftBloodRequestSchema>;
export type CancelBloodRequestInput = z.infer<typeof cancelBloodRequestSchema>;
export type ReviewBloodRequestInput = z.infer<typeof reviewBloodRequestSchema>;
