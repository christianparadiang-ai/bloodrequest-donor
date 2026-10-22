import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  BloodRequest,
  FormattedBloodRequest,
  Profile,
  RequestStatus,
  UserRole,
  parseBloodGroup,
  formatBloodGroup,
} from "@/lib/supabase/types";
import {
  createBloodRequestSchema,
  cancelBloodRequestSchema,
  reviewBloodRequestSchema,
  CreateBloodRequestInput,
} from "@/lib/validations";
import { logAuditEvent } from "@/lib/audit";
import { getOrCreateUserProfile } from "@/lib/donor/service";
import { resolveUserRole } from "@/lib/auth";

// ============================================================================
// PRIVACY & MASKING HELPERS
// ============================================================================

export function maskPhoneNumber(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.length <= 6) return "****";
  const start = cleaned.slice(0, 4);
  const end = cleaned.slice(-3);
  return `${start} *** ${end}`;
}

export function maskPatientName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].length > 2 ? `${parts[0].slice(0, 1)}***` : parts[0];
  }
  return parts.map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" ");
}

// ============================================================================
// STATUS TRANSITION RULES ENGINE (SERVER-ENFORCED)
// ============================================================================

export const PRIVILEGED_ROLES: UserRole[] = [
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
  "HOSPITAL_STAFF",
];

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
}

export function validateStatusTransition(
  currentStatus: RequestStatus,
  targetStatus: RequestStatus,
  userRole: UserRole,
  isOwner: boolean
): TransitionResult {
  // Terminal states cannot transition anywhere
  const terminalStates: RequestStatus[] = [
    "FULFILLED",
    "CANCELLED",
    "EXPIRED",
    "REJECTED",
  ];
  if (terminalStates.includes(currentStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition from terminal status '${currentStatus}'.`,
    };
  }

  // Idempotent no-op
  if (currentStatus === targetStatus) {
    return { allowed: true };
  }

  const isPrivileged = PRIVILEGED_ROLES.includes(userRole);

  // OWNER (NON-PRIVILEGED) CAPABILITIES
  if (isOwner && !isPrivileged) {
    // Owner can submit draft
    if (currentStatus === "DRAFT" && targetStatus === "SUBMITTED") {
      return { allowed: true };
    }
    // Owner can cancel own requests from non-terminal states
    if (
      ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE"].includes(currentStatus) &&
      targetStatus === "CANCELLED"
    ) {
      return { allowed: true };
    }

    // Explicitly reject self-promotion to ACTIVE or other states
    return {
      allowed: false,
      reason: `Unauthorized: Requesters cannot transition a request from '${currentStatus}' directly to '${targetStatus}'. Verification review is required.`,
    };
  }

  // PRIVILEGED ROLES (REVIEWERS / ADMINS / HOSPITAL STAFF)
  if (isPrivileged) {
    if (currentStatus === "SUBMITTED") {
      if (["UNDER_REVIEW", "ACTIVE", "REJECTED", "CANCELLED"].includes(targetStatus)) {
        return { allowed: true };
      }
    }
    if (currentStatus === "UNDER_REVIEW") {
      if (["ACTIVE", "REJECTED", "SUBMITTED", "CANCELLED"].includes(targetStatus)) {
        return { allowed: true };
      }
    }
    if (currentStatus === "ACTIVE") {
      if (
        [
          "PARTIALLY_COMMITTED",
          "FULLY_COMMITTED",
          "FULFILLED",
          "CANCELLED",
          "EXPIRED",
        ].includes(targetStatus)
      ) {
        return { allowed: true };
      }
    }
    if (currentStatus === "PARTIALLY_COMMITTED" || currentStatus === "FULLY_COMMITTED") {
      if (["FULFILLED", "CANCELLED", "EXPIRED"].includes(targetStatus)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Transition from '${currentStatus}' to '${targetStatus}' is not permitted by protocol.`,
    };
  }

  return {
    allowed: false,
    reason: "Unauthorized: Insufficient permissions to alter requisition lifecycle status.",
  };
}

// ============================================================================
// FORMATTING MAPPER
// ============================================================================

export function formatBloodRequestRecord(
  req: BloodRequest,
  viewerProfileId?: string | null
): FormattedBloodRequest {
  const isOwner = Boolean(viewerProfileId && req.requester_id === viewerProfileId);

  return {
    id: req.id,
    requesterId: req.requester_id,
    isOwner,
    // Patient name unmasked for owner; masked for external viewers
    patientName: isOwner
      ? req.patient_name_masked
      : maskPatientName(req.patient_name_masked),
    bloodGroup: formatBloodGroup(req.blood_group, req.rh_factor),
    bloodComponent: req.blood_component,
    unitsRequested: req.units_requested,
    unitsCommitted: req.units_committed,
    unitsReserved: req.units_reserved,
    unitsDonated: req.units_donated,
    urgencyLevel: req.urgency_level,
    status: req.status,
    hospitalName: req.hospital_name,
    hospitalCity: req.hospital_city,
    province: req.province || "",
    contactName: req.contact_name || "",
    // Phone masked for external viewers
    contactNumber: isOwner
      ? req.contact_number_masked
      : maskPhoneNumber(req.contact_number_masked),
    requiredBy: req.required_by,
    requestReason: req.request_reason || undefined,
    medicalNotes: req.medical_notes || undefined,
    documentVerificationStatus: req.document_verification_status,
    reviewerId: req.reviewer_id,
    reviewedAt: req.reviewed_at,
    rejectionReason: req.rejection_reason,
    cancellationReason: req.cancellation_reason,
    createdAt: req.created_at,
    updatedAt: req.updated_at,
  };
}

// ============================================================================
// SERVICE OPERATIONS
// ============================================================================

/**
 * Creates a new blood request safely with server-side Zod validation.
 */
export async function createBloodRequest(
  clerkUserId: string,
  email: string,
  fullName: string,
  payload: unknown
): Promise<{ success: boolean; request?: FormattedBloodRequest; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, error: "Database configuration unavailable." };
    }

    // 1. Authenticated user profile lookup / sync
    const profile = await getOrCreateUserProfile(clerkUserId, email, fullName);

    // 2. Server-side validation
    const validated: CreateBloodRequestInput = createBloodRequestSchema.parse(payload);

    // 3. Blood group parsing
    const { bloodGroup, rhFactor } = parseBloodGroup(validated.blood_group);

    // 4. Determine status: DRAFT if is_draft is true, otherwise SUBMITTED
    const initialStatus: RequestStatus = validated.is_draft ? "DRAFT" : "SUBMITTED";

    const insertPayload = {
      requester_id: profile.id,
      patient_name_masked: validated.patient_name,
      hospital_name: validated.hospital_name,
      hospital_city: validated.hospital_city,
      province: validated.province,
      blood_group: bloodGroup,
      rh_factor: rhFactor,
      blood_component: validated.blood_component,
      units_requested: validated.units_requested,
      units_committed: 0,
      units_reserved: 0,
      units_donated: 0,
      urgency_level: validated.urgency_level,
      status: initialStatus,
      contact_name: validated.contact_name || null,
      contact_number_masked: validated.contact_number,
      request_reason: validated.request_reason || null,
      medical_notes: validated.medical_notes || null,
      document_verification_status: "UNVERIFIED",
      required_by: new Date(validated.required_by).toISOString(),
    };

    const { data: created, error: insertError } = await admin
      .from("blood_requests")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !created) {
      return {
        success: false,
        error: `Failed to create blood requisition: ${insertError?.message || "Unknown error"}`,
      };
    }

    const createdReq = created as BloodRequest;

    // 5. Audit Logging
    await logAuditEvent({
      actorProfileId: profile.id,
      action: "BLOOD_REQUEST_CREATED",
      targetTable: "blood_requests",
      targetId: createdReq.id,
      newState: {
        status: createdReq.status,
        blood_group: validated.blood_group,
        units_requested: createdReq.units_requested,
        hospital_name: createdReq.hospital_name,
        urgency_level: createdReq.urgency_level,
      },
    });

    if (initialStatus === "SUBMITTED") {
      await logAuditEvent({
        actorProfileId: profile.id,
        action: "BLOOD_REQUEST_SUBMITTED",
        targetTable: "blood_requests",
        targetId: createdReq.id,
        newState: {
          status: "SUBMITTED",
          submitted_at: new Date().toISOString(),
        },
      });
    }

    return {
      success: true,
      request: formatBloodRequestRecord(createdReq, profile.id),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create blood request.",
    };
  }
}

/**
 * Retrieves a blood request by ID with privacy authorization checks.
 */
export async function getBloodRequestById(
  requestId: string,
  clerkUserId?: string | null
): Promise<{
  success: boolean;
  request?: FormattedBloodRequest;
  authorized: boolean;
  error?: string;
}> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, authorized: false, error: "Database configuration unavailable." };
    }

    // Look up viewer profile if authenticated
    let viewerProfile: Profile | null = null;
    if (clerkUserId) {
      const { data: p } = await admin
        .from("profiles")
        .select("*")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      if (p) viewerProfile = p as Profile;
    }

    const { data: record, error } = await admin
      .from("blood_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    if (error || !record) {
      return { success: false, authorized: false, error: "Blood requisition not found." };
    }

    const req = record as BloodRequest;
    const isOwner = Boolean(viewerProfile && req.requester_id === viewerProfile.id);
    const userRole = clerkUserId ? await resolveUserRole(clerkUserId) : "USER";
    const isPrivileged = PRIVILEGED_ROLES.includes(userRole) || Boolean(viewerProfile && PRIVILEGED_ROLES.includes(viewerProfile.role));

    // Access control checks:
    // Drafts are strictly private to owner and privileged staff
    if (req.status === "DRAFT" && !isOwner && !isPrivileged) {
      return {
        success: false,
        authorized: false,
        error: "FORBIDDEN: You do not have permission to view this draft requisition.",
      };
    }

    // Cancelled / Rejected requests are visible only to owner and privileged staff
    if (["CANCELLED", "REJECTED"].includes(req.status) && !isOwner && !isPrivileged) {
      return {
        success: false,
        authorized: false,
        error: "FORBIDDEN: This requisition is no longer publicly accessible.",
      };
    }

    return {
      success: true,
      authorized: true,
      request: formatBloodRequestRecord(req, viewerProfile?.id),
    };
  } catch (err: unknown) {
    return {
      success: false,
      authorized: false,
      error: err instanceof Error ? err.message : "Error retrieving request.",
    };
  }
}

/**
 * Lists all requests created by the authenticated requester.
 */
export async function listUserBloodRequests(
  clerkUserId: string
): Promise<{ success: boolean; requests: FormattedBloodRequest[]; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, requests: [], error: "Database configuration unavailable." };
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (!profile) {
      return { success: true, requests: [] };
    }

    const { data, error } = await admin
      .from("blood_requests")
      .select("*")
      .eq("requester_id", profile.id)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, requests: [], error: error.message };
    }

    const formatted = (data as BloodRequest[] || []).map((r) =>
      formatBloodRequestRecord(r, profile.id)
    );

    return { success: true, requests: formatted };
  } catch (err: unknown) {
    return {
      success: false,
      requests: [],
      error: err instanceof Error ? err.message : "Error listing requests.",
    };
  }
}

/**
 * Lists all active public blood requests across the system.
 */
export async function listActiveBloodRequests(
  viewerClerkUserId?: string | null
): Promise<{ success: boolean; requests: FormattedBloodRequest[]; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, requests: [], error: "Database configuration unavailable." };
    }

    let viewerProfileId: string | null = null;
    if (viewerClerkUserId) {
      const { data: p } = await admin
        .from("profiles")
        .select("id")
        .eq("clerk_user_id", viewerClerkUserId)
        .maybeSingle();
      if (p) viewerProfileId = p.id;
    }

    const { data, error } = await admin
      .from("blood_requests")
      .select("*")
      .in("status", ["ACTIVE", "PARTIALLY_COMMITTED", "FULLY_COMMITTED"])
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, requests: [], error: error.message };
    }

    const formatted = (data as BloodRequest[] || []).map((r) =>
      formatBloodRequestRecord(r, viewerProfileId)
    );

    return { success: true, requests: formatted };
  } catch (err: unknown) {
    return {
      success: false,
      requests: [],
      error: err instanceof Error ? err.message : "Error listing active requests.",
    };
  }
}

/**
 * Submits an existing DRAFT blood request for review.
 */
export async function submitDraftBloodRequest(
  requestId: string,
  clerkUserId: string
): Promise<{ success: boolean; request?: FormattedBloodRequest; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, error: "Database configuration unavailable." };

    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (!profile) return { success: false, error: "UNAUTHORIZED: Profile not found." };

    const { data: existing, error: findError } = await admin
      .from("blood_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (findError || !existing) return { success: false, error: "Requisition not found." };

    const req = existing as BloodRequest;
    const isOwner = req.requester_id === profile.id;

    // Validate status transition
    const transition = validateStatusTransition(req.status, "SUBMITTED", profile.role as UserRole, isOwner);
    if (!transition.allowed) {
      return { success: false, error: transition.reason };
    }

    const { data: updated, error: updateError } = await admin
      .from("blood_requests")
      .update({
        status: "SUBMITTED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || "Failed to submit draft." };
    }

    await logAuditEvent({
      actorProfileId: profile.id,
      action: "BLOOD_REQUEST_SUBMITTED",
      targetTable: "blood_requests",
      targetId: requestId,
      previousState: { status: req.status },
      newState: { status: "SUBMITTED" },
    });

    return {
      success: true,
      request: formatBloodRequestRecord(updated as BloodRequest, profile.id),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error submitting draft requisition.",
    };
  }
}

/**
 * Cancels a blood request with reason tracking.
 */
export async function cancelBloodRequest(
  requestId: string,
  clerkUserId: string,
  payload: unknown
): Promise<{ success: boolean; request?: FormattedBloodRequest; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, error: "Database configuration unavailable." };

    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", clerkUserId)
      .single();

    if (!profile) return { success: false, error: "UNAUTHORIZED: Profile not found." };

    const validated = cancelBloodRequestSchema.parse(payload);

    const { data: existing, error: findError } = await admin
      .from("blood_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (findError || !existing) return { success: false, error: "Requisition not found." };

    const req = existing as BloodRequest;
    const isOwner = req.requester_id === profile.id;

    // Validate status transition
    const transition = validateStatusTransition(req.status, "CANCELLED", profile.role as UserRole, isOwner);
    if (!transition.allowed) {
      return { success: false, error: transition.reason };
    }

    const { data: updated, error: updateError } = await admin
      .from("blood_requests")
      .update({
        status: "CANCELLED",
        cancellation_reason: validated.cancellation_reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || "Failed to cancel request." };
    }

    await logAuditEvent({
      actorProfileId: profile.id,
      action: "BLOOD_REQUEST_CANCELLED",
      targetTable: "blood_requests",
      targetId: requestId,
      previousState: { status: req.status },
      newState: {
        status: "CANCELLED",
        cancellation_reason: validated.cancellation_reason,
      },
    });

    return {
      success: true,
      request: formatBloodRequestRecord(updated as BloodRequest, profile.id),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error cancelling requisition.",
    };
  }
}

/**
 * Performs an authorized review lifecycle transition (SUBMITTED -> UNDER_REVIEW -> ACTIVE/REJECTED).
 */
export async function reviewBloodRequest(
  requestId: string,
  reviewerClerkUserId: string,
  payload: unknown,
  reviewerEmail?: string | null
): Promise<{ success: boolean; request?: FormattedBloodRequest; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, error: "Database configuration unavailable." };

    let { data: reviewerProfile } = await admin
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", reviewerClerkUserId)
      .maybeSingle();

    if (!reviewerProfile && reviewerEmail) {
      const { data: profileByEmail } = await admin
        .from("profiles")
        .select("*")
        .ilike("email", reviewerEmail.toLowerCase().trim())
        .maybeSingle();

      if (profileByEmail) {
        reviewerProfile = profileByEmail;
        await admin
          .from("profiles")
          .update({
            clerk_user_id: reviewerClerkUserId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profileByEmail.id);
      }
    }

    if (!reviewerProfile) {
      return { success: false, error: "UNAUTHORIZED: Reviewer profile not found." };
    }

    const role = await resolveUserRole(reviewerClerkUserId, reviewerEmail || reviewerProfile.email);
    if (!PRIVILEGED_ROLES.includes(role)) {
      return {
        success: false,
        error: `FORBIDDEN: Role '${role}' is not authorized to perform requisition review operations.`,
      };
    }

    const validated = reviewBloodRequestSchema.parse(payload);

    const { data: existing, error: findError } = await admin
      .from("blood_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (findError || !existing) return { success: false, error: "Requisition not found." };

    const req = existing as BloodRequest;
    const isOwner = req.requester_id === reviewerProfile.id;

    // Enforce transition validation
    const transition = validateStatusTransition(req.status, validated.target_status, role, isOwner);
    if (!transition.allowed) {
      return { success: false, error: transition.reason };
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      status: validated.target_status,
      reviewer_id: reviewerProfile.id,
      reviewed_at: now,
      updated_at: now,
    };

    if (validated.target_status === "ACTIVE") {
      updateData.document_verification_status = "VERIFIED";
    } else if (validated.target_status === "REJECTED") {
      updateData.document_verification_status = "REJECTED";
      updateData.rejection_reason = validated.rejection_reason || "Verification requirements not met";
    }

    const { data: updated, error: updateError } = await admin
      .from("blood_requests")
      .update(updateData)
      .eq("id", requestId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || "Failed to update review status." };
    }

    await logAuditEvent({
      actorProfileId: reviewerProfile.id,
      action: "BLOOD_REQUEST_REVIEWED",
      targetTable: "blood_requests",
      targetId: requestId,
      previousState: { status: req.status },
      newState: {
        status: validated.target_status,
        reviewer_id: reviewerProfile.id,
        rejection_reason: validated.rejection_reason,
      },
    });

    return {
      success: true,
      request: formatBloodRequestRecord(updated as BloodRequest, reviewerProfile.id),
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error reviewing requisition.",
    };
  }
}

/**
 * Lists requisitions in review queue (SUBMITTED or UNDER_REVIEW).
 * Orders newest requisitions first so incoming requests appear immediately.
 */
export async function listReviewQueueBloodRequests(
  reviewerClerkUserId: string,
  reviewerEmail?: string | null
): Promise<{ success: boolean; requests: FormattedBloodRequest[]; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return { success: false, requests: [], error: "Database configuration unavailable." };

    const role = await resolveUserRole(reviewerClerkUserId, reviewerEmail);
    if (!PRIVILEGED_ROLES.includes(role)) {
      return {
        success: false,
        requests: [],
        error: `FORBIDDEN: Role '${role}' not authorized to view the verification queue.`,
      };
    }

    let reviewerProfileId: string | null = null;
    const { data: reviewerProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", reviewerClerkUserId)
      .maybeSingle();

    if (reviewerProfile) {
      reviewerProfileId = reviewerProfile.id;
    } else if (reviewerEmail) {
      const { data: profileByEmail } = await admin
        .from("profiles")
        .select("id")
        .eq("email", reviewerEmail.toLowerCase())
        .maybeSingle();
      if (profileByEmail) {
        reviewerProfileId = profileByEmail.id;
        // Self-heal clerk_user_id link
        await admin
          .from("profiles")
          .update({ clerk_user_id: reviewerClerkUserId })
          .eq("id", profileByEmail.id);
      }
    }

    const { data, error } = await admin
      .from("blood_requests")
      .select("*")
      .in("status", ["SUBMITTED", "UNDER_REVIEW"])
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, requests: [], error: error.message };
    }

    const formatted = ((data as BloodRequest[]) || []).map((r) =>
      formatBloodRequestRecord(r, reviewerProfileId)
    );

    return { success: true, requests: formatted };
  } catch (err: unknown) {
    return {
      success: false,
      requests: [],
      error: err instanceof Error ? err.message : "Error listing review queue.",
    };
  }
}

export interface RequestFilterParams {
  query?: string;
  bloodGroup?: string;
  component?: string;
  urgency?: string;
  status?: string;
  hospital?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Searches and filters blood requests with multi-parameter filtering:
 * Blood group, component, urgency, status, hospital, date range, and text query.
 * Enforces role-based visibility rules.
 */
export async function searchAndFilterBloodRequests(
  filters: RequestFilterParams,
  viewerClerkUserId?: string | null
): Promise<{ success: boolean; requests: FormattedBloodRequest[]; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, requests: [], error: "Database configuration unavailable." };
    }

    let viewerProfileId: string | null = null;
    let viewerRole: UserRole = "USER";
    if (viewerClerkUserId) {
      viewerRole = await resolveUserRole(viewerClerkUserId);
      const { data: p } = await admin
        .from("profiles")
        .select("id, role")
        .eq("clerk_user_id", viewerClerkUserId)
        .maybeSingle();
      if (p) {
        viewerProfileId = p.id;
      }
    }

    const isPrivileged = PRIVILEGED_ROLES.includes(viewerRole);

    let queryBuilder = admin.from("blood_requests").select("*");

    // Non-privileged viewers can only see active public requests or their own requests
    if (!isPrivileged) {
      if (viewerProfileId) {
        queryBuilder = queryBuilder.or(
          `requester_id.eq.${viewerProfileId},status.in.(ACTIVE,PARTIALLY_COMMITTED,FULLY_COMMITTED,PARTIALLY_FULFILLED,FULFILLED)`
        );
      } else {
        queryBuilder = queryBuilder.in("status", [
          "ACTIVE",
          "PARTIALLY_COMMITTED",
          "FULLY_COMMITTED",
        ]);
      }
    }

    // Status filter
    if (filters.status && filters.status !== "ALL") {
      if (filters.status === "OPEN") {
        queryBuilder = queryBuilder.in("status", ["ACTIVE", "SUBMITTED", "UNDER_REVIEW"]);
      } else if (filters.status === "IN_PROGRESS") {
        queryBuilder = queryBuilder.in("status", [
          "PARTIALLY_COMMITTED",
          "FULLY_COMMITTED",
          "PARTIALLY_FULFILLED",
        ]);
      } else {
        queryBuilder = queryBuilder.eq("status", filters.status);
      }
    }

    // Blood group filter
    if (filters.bloodGroup && filters.bloodGroup !== "ALL") {
      const { bloodGroup, rhFactor } = parseBloodGroup(filters.bloodGroup as import("@/lib/supabase/types").BloodGroup);
      queryBuilder = queryBuilder.eq("blood_group", bloodGroup).eq("rh_factor", rhFactor);
    }

    // Component filter
    if (filters.component && filters.component !== "ALL") {
      queryBuilder = queryBuilder.eq("blood_component", filters.component);
    }

    // Urgency filter
    if (filters.urgency && filters.urgency !== "ALL") {
      queryBuilder = queryBuilder.eq("urgency_level", filters.urgency);
    }

    // Hospital filter
    if (filters.hospital) {
      queryBuilder = queryBuilder.ilike("hospital_name", `%${filters.hospital}%`);
    }

    // General text query
    if (filters.query) {
      queryBuilder = queryBuilder.or(
        `hospital_name.ilike.%${filters.query}%,hospital_city.ilike.%${filters.query}%,patient_name_masked.ilike.%${filters.query}%`
      );
    }

    // Date filters
    if (filters.startDate) {
      queryBuilder = queryBuilder.gte("created_at", filters.startDate);
    }
    if (filters.endDate) {
      queryBuilder = queryBuilder.lte("created_at", filters.endDate);
    }

    queryBuilder = queryBuilder.order("created_at", { ascending: false });

    const { data, error } = await queryBuilder;
    if (error) throw error;

    const formatted = (data as BloodRequest[] || []).map((r) =>
      formatBloodRequestRecord(r, viewerProfileId)
    );

    return { success: true, requests: formatted };
  } catch (err: unknown) {
    return {
      success: false,
      requests: [],
      error: err instanceof Error ? err.message : "Error filtering blood requests.",
    };
  }
}

