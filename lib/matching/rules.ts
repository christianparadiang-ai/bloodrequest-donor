import { BloodGroup } from "@/lib/supabase/types";

// ============================================================================
// MEDICAL SAFETY BOUNDARY NOTICE
// ============================================================================

export const MEDICAL_SAFETY_DISCLAIMER =
  "OPERATIONAL NOTICE: Potential donor match candidate discovery only. This evaluation is based on voluntary donor availability, contact consent, configured service radius, and red cell ABO/Rh compatibility criteria. It does NOT represent medical eligibility, clinical suitability, or guaranteed transfusion compatibility. Qualified medical professionals and blood center staff must perform all standard clinical testing and cross-matching.";

// ============================================================================
// DETERMINISTIC ABO / Rh DISCOVERY COMPATIBILITY MATRIX
// ============================================================================

export const COMPATIBLE_DONOR_BLOOD_GROUPS: Record<BloodGroup, BloodGroup[]> = {
  "O-": ["O-"],
  "O+": ["O+", "O-"],
  "A-": ["A-", "O-"],
  "A+": ["A+", "A-", "O+", "O-"],
  "B-": ["B-", "O-"],
  "B+": ["B+", "B-", "O+", "O-"],
  "AB-": ["AB-", "A-", "B-", "O-"],
  "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
};

/**
 * Deterministic check for ABO/Rh candidate suitability.
 */
export function isPotentialBloodGroupMatch(
  donorBloodGroup: BloodGroup,
  requestedBloodGroup: BloodGroup
): boolean {
  const compatible = COMPATIBLE_DONOR_BLOOD_GROUPS[requestedBloodGroup];
  if (!compatible) return false;
  return compatible.includes(donorBloodGroup);
}

// ============================================================================
// GEOGRAPHIC DISTANCE CALCULATION (HAVERSINE)
// ============================================================================

/**
 * Calculates great-circle distance between two GPS coordinates in kilometers.
 * Deterministic and reproducible.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance * 10) / 10;
}

// ============================================================================
// PRIVACY-SAFE IDENTIFIER GENERATION
// ============================================================================

/**
 * Generates an opaque, privacy-safe donor pseudonym for candidate discovery.
 * Prevents exposing donor identity, full names, or PII.
 */
export function generateSafeDonorCode(donorProfileId: string): string {
  const shortId = donorProfileId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `DONOR-${shortId}`;
}

// ============================================================================
// CANDIDATE EVALUATION & SCORING
// ============================================================================

export interface CandidateEvaluationInput {
  donorId: string;
  donorBloodGroup: BloodGroup;
  donorIsAvailable: boolean;
  donorConsentToContact: boolean;
  donorServiceRadiusKm: number;
  donorCity: string;
  donorProvince?: string | null;
  donorLat?: number | null;
  donorLon?: number | null;

  requestedBloodGroup: BloodGroup;
  requestCity: string;
  requestProvince?: string | null;
  requestLat?: number | null;
  requestLon?: number | null;
}

export interface CandidateEvaluationResult {
  donorId: string;
  safeDonorCode: string;
  bloodGroup: BloodGroup;
  isAvailable: boolean;
  hasConsent: boolean;
  city: string;
  province?: string | null;
  bloodGroupMatch: boolean;
  availabilityMatch: boolean;
  consentMatch: boolean;
  geographicMatch: boolean;
  distanceKm: number | null;
  isExactLocation: boolean;
  isPotentialCandidate: boolean;
  discoveryScore: number;
  reasons: string[];
  medicalSafetyDisclaimer: string;
}

/**
 * Evaluates candidate donor against requisition criteria with full explainability.
 * Produces deterministic, explainable discovery score and reasons.
 */
export function evaluateCandidateSuitability(
  input: CandidateEvaluationInput
): CandidateEvaluationResult {
  const reasons: string[] = [];

  // 1. Blood Group Check
  const bloodGroupMatch = isPotentialBloodGroupMatch(
    input.donorBloodGroup,
    input.requestedBloodGroup
  );

  const isExactType = input.donorBloodGroup === input.requestedBloodGroup;
  if (isExactType) {
    reasons.push(`Exact ABO/Rh match (${input.donorBloodGroup})`);
  } else if (bloodGroupMatch) {
    reasons.push(
      `Compatible donor blood group (${input.donorBloodGroup} for ${input.requestedBloodGroup} request)`
    );
  } else {
    reasons.push(
      `Incompatible blood group (${input.donorBloodGroup} cannot donate to ${input.requestedBloodGroup})`
    );
  }

  // 2. Operational Availability Check
  const availabilityMatch = Boolean(input.donorIsAvailable);
  if (availabilityMatch) {
    reasons.push("Operational availability confirmed");
  } else {
    reasons.push("Donor is currently marked UNAVAILABLE");
  }

  // 3. Contact Consent Check
  const consentMatch = Boolean(input.donorConsentToContact);
  if (consentMatch) {
    reasons.push("Explicit contact consent on record");
  } else {
    reasons.push("Donor has NOT consented to contact for emergency requests");
  }

  // 4. Geographic Suitability Check
  let geographicMatch = false;
  let distanceKm: number | null = null;
  let isExactLocation = false;

  const hasDonorCoords =
    typeof input.donorLat === "number" &&
    typeof input.donorLon === "number" &&
    !isNaN(input.donorLat) &&
    !isNaN(input.donorLon);

  const hasRequestCoords =
    typeof input.requestLat === "number" &&
    typeof input.requestLon === "number" &&
    !isNaN(input.requestLat) &&
    !isNaN(input.requestLon);

  if (hasDonorCoords && hasRequestCoords) {
    // Exact GPS calculation
    distanceKm = calculateHaversineDistanceKm(
      input.requestLat as number,
      input.requestLon as number,
      input.donorLat as number,
      input.donorLon as number
    );
    isExactLocation = true;

    if (distanceKm <= input.donorServiceRadiusKm) {
      geographicMatch = true;
      reasons.push(
        `Within service radius: ~${distanceKm} km (donor radius limit: ${input.donorServiceRadiusKm} km)`
      );
    } else {
      geographicMatch = false;
      reasons.push(
        `Outside service radius: ~${distanceKm} km exceeds donor limit of ${input.donorServiceRadiusKm} km`
      );
    }
  } else {
    // Conservative regional fallback
    const donorCityNorm = input.donorCity.trim().toLowerCase();
    const reqCityNorm = input.requestCity.trim().toLowerCase();
    const donorProvNorm = (input.donorProvince || "").trim().toLowerCase();
    const reqProvNorm = (input.requestProvince || "").trim().toLowerCase();

    if (donorCityNorm && reqCityNorm && donorCityNorm === reqCityNorm) {
      geographicMatch = true;
      reasons.push(
        `Same city/municipality (${input.donorCity}) [Regional approximation without GPS]`
      );
    } else if (donorProvNorm && reqProvNorm && donorProvNorm === reqProvNorm) {
      geographicMatch = true;
      reasons.push(
        `Same province/region (${input.donorProvince}) [Regional approximation without GPS]`
      );
    } else {
      geographicMatch = false;
      reasons.push(
        `Different geographic locality (${input.donorCity} vs ${input.requestCity})`
      );
    }
  }

  // Overall candidate determination: MUST satisfy blood group, availability, consent, and geography
  const isPotentialCandidate =
    bloodGroupMatch && availabilityMatch && consentMatch && geographicMatch;

  // 5. Deterministic Discovery Score (0 to 100)
  let discoveryScore = 0;
  if (isPotentialCandidate) {
    // Blood group base: 60 for exact match, 45 for compatible alternative
    discoveryScore += isExactType ? 60 : 45;

    // Geographic component
    if (isExactLocation && distanceKm !== null) {
      if (distanceKm <= 5) discoveryScore += 30;
      else if (distanceKm <= 15) discoveryScore += 25;
      else if (distanceKm <= 30) discoveryScore += 20;
      else if (distanceKm <= 50) discoveryScore += 15;
      else discoveryScore += 10;
    } else {
      // Approximation fallback
      const sameCity =
        input.donorCity.trim().toLowerCase() ===
        input.requestCity.trim().toLowerCase();
      discoveryScore += sameCity ? 20 : 10;
    }

    // Active readiness component
    discoveryScore += 10;

    // Bounded 0 - 100
    discoveryScore = Math.min(100, Math.max(0, discoveryScore));
  }

  return {
    donorId: input.donorId,
    safeDonorCode: generateSafeDonorCode(input.donorId),
    bloodGroup: input.donorBloodGroup,
    isAvailable: availabilityMatch,
    hasConsent: consentMatch,
    city: input.donorCity,
    province: input.donorProvince,
    bloodGroupMatch,
    availabilityMatch,
    consentMatch,
    geographicMatch,
    distanceKm,
    isExactLocation,
    isPotentialCandidate,
    discoveryScore,
    reasons,
    medicalSafetyDisclaimer: MEDICAL_SAFETY_DISCLAIMER,
  };
}
