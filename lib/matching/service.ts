import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  BloodRequest,
  DonorProfile,
  Profile,
  PotentialDonorMatch,
  UserRole,
  formatBloodGroup,
} from "@/lib/supabase/types";
import {
  evaluateCandidateSuitability,
  MEDICAL_SAFETY_DISCLAIMER,
} from "./rules";
import { logAuditEvent } from "@/lib/audit";

export interface MatchDiscoveryResult {
  success: boolean;
  requestId: string;
  requestStatus: string;
  matches: PotentialDonorMatch[];
  totalCandidatesEvaluated: number;
  error?: string;
}

const PRIVILEGED_ROLES: UserRole[] = [
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
  "HOSPITAL_STAFF",
];

/**
 * Discovers and ranks potential donors for an ACTIVE blood requisition.
 * Completely deterministic, explainable, and privacy-preserving.
 */
export async function discoverPotentialDonorsForRequest(
  requestId: string,
  clerkUserId?: string | null
): Promise<MatchDiscoveryResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      success: false,
      requestId,
      requestStatus: "UNKNOWN",
      matches: [],
      totalCandidatesEvaluated: 0,
      error: "Database configuration unavailable.",
    };
  }

  // 1. Fetch Requisition
  const { data: requestRecord, error: reqError } = await admin
    .from("blood_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (reqError || !requestRecord) {
    return {
      success: false,
      requestId,
      requestStatus: "NOT_FOUND",
      matches: [],
      totalCandidatesEvaluated: 0,
      error: "Blood requisition not found.",
    };
  }

  const req = requestRecord as BloodRequest;

  // 2. Authorization Check (if clerkUserId provided)
  let callerProfile: Profile | null = null;
  if (clerkUserId) {
    const { data: p } = await admin
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", clerkUserId)
      .single();
    if (p) callerProfile = p as Profile;

    if (callerProfile) {
      const isOwner = req.requester_id === callerProfile.id;
      const isPrivileged = PRIVILEGED_ROLES.includes(callerProfile.role);

      if (!isOwner && !isPrivileged) {
        return {
          success: false,
          requestId,
          requestStatus: req.status,
          matches: [],
          totalCandidatesEvaluated: 0,
          error: "UNAUTHORIZED: You do not have permission to view matches for this requisition.",
        };
      }
    }
  }

  // 3. Strict Lifecycle Gate: ONLY ACTIVE requests may discover donors!
  if (req.status !== "ACTIVE") {
    return {
      success: false,
      requestId,
      requestStatus: req.status,
      matches: [],
      totalCandidatesEvaluated: 0,
      error: `Requisition is in status '${req.status}' and not eligible for donor discovery. Only ACTIVE requests can discover potential donors.`,
    };
  }

  // 4. Audit Log: Discovery Initiated
  await logAuditEvent({
    actorProfileId: callerProfile?.id || null,
    action: "POTENTIAL_MATCH_DISCOVERY_STARTED",
    targetTable: "blood_requests",
    targetId: req.id,
    newState: {
      request_status: req.status,
      requested_blood_group: formatBloodGroup(req.blood_group, req.rh_factor),
    },
  });

  // 5. Query Active, Consented Donors
  const { data: donorRecords, error: donorError } = await admin
    .from("donor_profiles")
    .select("*")
    .eq("is_available", true)
    .eq("consent_to_contact", true);

  if (donorError) {
    return {
      success: false,
      requestId,
      requestStatus: req.status,
      matches: [],
      totalCandidatesEvaluated: 0,
      error: `Failed to query donor profiles: ${donorError.message}`,
    };
  }

  const donors = (donorRecords as DonorProfile[]) || [];
  const reqBloodGroup = formatBloodGroup(req.blood_group, req.rh_factor);
  const now = new Date();

  // 6. Evaluate Each Candidate Deterministically
  const evaluatedCandidates: PotentialDonorMatch[] = [];

  for (const donor of donors) {
    // Exclude donors on active medical cooldown (e.g. recent donation recovery)
    if (donor.cooldown_until && new Date(donor.cooldown_until) > now) {
      continue;
    }

    const donorBloodGroup = formatBloodGroup(donor.blood_group, donor.rh_factor);

    const evaluation = evaluateCandidateSuitability({
      donorId: donor.id,
      donorBloodGroup,
      donorIsAvailable: donor.is_available,
      donorConsentToContact: donor.consent_to_contact,
      donorServiceRadiusKm: donor.notification_radius_km || 25,
      donorCity: donor.city,
      donorProvince: donor.province,
      donorLat: donor.latitude,
      donorLon: donor.longitude,

      requestedBloodGroup: reqBloodGroup,
      requestCity: req.hospital_city,
      requestProvince: req.province,
      requestLat: req.latitude,
      requestLon: req.longitude,
    });

    if (evaluation.isPotentialCandidate) {
      evaluatedCandidates.push({
        donorId: evaluation.donorId,
        safeDonorCode: evaluation.safeDonorCode,
        bloodGroup: evaluation.bloodGroup,
        isAvailable: evaluation.isAvailable,
        hasConsent: evaluation.hasConsent,
        city: evaluation.city,
        province: evaluation.province,
        geographicMatch: evaluation.geographicMatch,
        distanceKm: evaluation.distanceKm,
        isExactLocation: evaluation.isExactLocation,
        discoveryScore: evaluation.discoveryScore,
        reasons: evaluation.reasons,
        medicalSafetyDisclaimer: MEDICAL_SAFETY_DISCLAIMER,
        matchedAt: new Date().toISOString(),
      });
    }
  }

  // 7. Deterministic Ranking
  // Ordered by:
  // 1. discoveryScore DESC
  // 2. distanceKm ASC (nulls last)
  // 3. donorId ASC (tie-breaker)
  evaluatedCandidates.sort((a, b) => {
    if (b.discoveryScore !== a.discoveryScore) {
      return b.discoveryScore - a.discoveryScore;
    }
    const distA = a.distanceKm !== null ? a.distanceKm : 99999;
    const distB = b.distanceKm !== null ? b.distanceKm : 99999;
    if (distA !== distB) {
      return distA - distB;
    }
    return a.donorId.localeCompare(b.donorId);
  });

  // 8. Persist Match Records in public.request_matches (Normalized)
  if (evaluatedCandidates.length > 0) {
    const { data: existingMatches } = await admin
      .from("request_matches")
      .select("id, donor_id, status")
      .eq("request_id", req.id);

    const existingMap = new Map<string, { id: string; status: string }>();
    if (existingMatches) {
      for (const em of existingMatches) {
        existingMap.set(em.donor_id, { id: em.id, status: em.status });
      }
    }

    const upsertRows = evaluatedCandidates.map((m) => {
      const existing = existingMap.get(m.donorId);
      return {
        ...(existing?.id ? { id: existing.id } : {}),
        request_id: req.id,
        donor_id: m.donorId,
        status: existing?.status || "POTENTIAL_CANDIDATE",
        discovery_score: m.discoveryScore,
        distance_km: m.distanceKm,
        is_exact_location: m.isExactLocation,
        reasons: m.reasons,
        updated_at: new Date().toISOString(),
      };
    });

    const { data: savedRows } = await admin
      .from("request_matches")
      .upsert(upsertRows, {
        onConflict: "request_id,donor_id",
      })
      .select("id, donor_id, status");

    const savedMap = new Map<string, { id: string; status: string }>();
    if (savedRows) {
      for (const row of savedRows) {
        savedMap.set(row.donor_id, { id: row.id, status: row.status });
      }
    }

    for (const m of evaluatedCandidates) {
      const s = savedMap.get(m.donorId);
      if (s) {
        m.matchId = s.id;
        m.status = s.status;
      }
    }
  }

  // 9. Audit Log: Matches Discovered
  await logAuditEvent({
    actorProfileId: callerProfile?.id || null,
    action: "POTENTIAL_MATCHES_DISCOVERED",
    targetTable: "request_matches",
    targetId: req.id,
    newState: {
      candidates_discovered_count: evaluatedCandidates.length,
      top_scores: evaluatedCandidates.slice(0, 3).map((m) => m.discoveryScore),
    },
  });

  return {
    success: true,
    requestId: req.id,
    requestStatus: req.status,
    matches: evaluatedCandidates,
    totalCandidatesEvaluated: donors.length,
  };
}

/**
 * Retrieves existing potential matches for an authorized user, or initiates discovery.
 */
export async function getPotentialMatchesForRequest(
  requestId: string,
  clerkUserId?: string | null
): Promise<MatchDiscoveryResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      success: false,
      requestId,
      requestStatus: "UNKNOWN",
      matches: [],
      totalCandidatesEvaluated: 0,
      error: "Database configuration unavailable.",
    };
  }

  // Check request status first
  const { data: requestRecord } = await admin
    .from("blood_requests")
    .select("status")
    .eq("id", requestId)
    .single();

  if (!requestRecord || requestRecord.status !== "ACTIVE") {
    return {
      success: false,
      requestId,
      requestStatus: requestRecord?.status || "NOT_FOUND",
      matches: [],
      totalCandidatesEvaluated: 0,
      error: `Requisition is in status '${requestRecord?.status || "UNKNOWN"}' and not eligible for donor discovery. Only ACTIVE requests can discover potential donors.`,
    };
  }

  // Execute discovery engine to retrieve ranked matches
  return await discoverPotentialDonorsForRequest(requestId, clerkUserId);
}
