import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DonorProfile,
  Profile,
  parseBloodGroup,
  formatBloodGroup,
  BloodGroup,
} from "@/lib/supabase/types";
import {
  donorProfileFormSchema,
  availabilityToggleSchema,
  consentToggleSchema,
  DonorProfileFormData,
} from "@/lib/validations";
import { logAuditEvent } from "@/lib/audit";

export interface FormattedDonorData {
  id: string;
  profileId: string;
  fullName: string;
  email: string;
  bloodGroup: BloodGroup;
  isAvailable: boolean;
  consentToContact: boolean;
  serviceRadiusKm: number;
  city: string;
  province: string;
  totalDonationsCount: number;
  lastDonationDate: string | null;
  reliabilityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCompletionStatus {
  isComplete: boolean;
  percentage: number;
  statusLabel: string;
  missingItems: string[];
}

/**
 * Ensures a user has a public.profiles record matching their Clerk identity.
 */
export async function getOrCreateUserProfile(clerkUserId: string, email: string, fullName: string): Promise<Profile> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error("Database configuration unavailable");
  }

  // 1. Check existing profile
  const { data: existing, error: selectError } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (existing && !selectError) {
    return existing as Profile;
  }

  // 2. Create profile if missing
  const { data: created, error: insertError } = await admin
    .from("profiles")
    .insert({
      clerk_user_id: clerkUserId,
      email: email || "unknown@lifedrop.internal",
      full_name: fullName || "Donor User",
      role: "USER",
    })
    .select("*")
    .single();

  if (insertError || !created) {
    throw new Error(`Failed to initialize profile record: ${insertError?.message}`);
  }

  return created as Profile;
}

/**
 * Retrieves the donor profile for an authenticated Clerk user.
 */
export async function getDonorProfile(clerkUserId: string): Promise<FormattedDonorData | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  // 1. Fetch user profile
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (!profile) return null;

  // 2. Fetch linked donor profile
  const { data: donor } = await admin
    .from("donor_profiles")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!donor) return null;

  const d = donor as DonorProfile;
  return {
    id: d.id,
    profileId: d.profile_id,
    fullName: profile.full_name,
    email: profile.email,
    bloodGroup: formatBloodGroup(d.blood_group, d.rh_factor),
    isAvailable: d.is_available,
    consentToContact: d.consent_to_contact,
    serviceRadiusKm: d.notification_radius_km,
    city: d.city,
    province: d.province || "",
    totalDonationsCount: d.total_donations_count,
    lastDonationDate: d.last_donation_date,
    reliabilityScore: d.reliability_score,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

/**
 * Calculates completion percentage and state.
 * Strictly adheres to medical boundary: NEVER outputs "Medically eligible".
 */
export function calculateProfileCompletion(donor: FormattedDonorData | null): ProfileCompletionStatus {
  if (!donor) {
    return {
      isComplete: false,
      percentage: 0,
      statusLabel: "Complete your donor profile",
      missingItems: [
        "Blood Group (ABO + Rh)",
        "City / Municipality",
        "Province / Region",
        "Service Area Radius",
        "Explicit Contact Consent",
      ],
    };
  }

  const missing: string[] = [];
  let score = 0;

  if (donor.bloodGroup) score += 20;
  else missing.push("Blood Group");

  if (donor.city && donor.city.trim().length > 0) score += 20;
  else missing.push("City / Municipality");

  if (donor.province && donor.province.trim().length > 0) score += 20;
  else missing.push("Province / Region");

  if (donor.serviceRadiusKm && donor.serviceRadiusKm >= 1) score += 20;
  else missing.push("Service Area Radius");

  if (donor.consentToContact) score += 20;
  else missing.push("Explicit Contact Consent");

  const isComplete = score === 100;

  return {
    isComplete,
    percentage: score,
    statusLabel: isComplete ? "Donor profile complete" : "Complete your donor profile",
    missingItems: missing,
  };
}

/**
 * Creates or updates a donor profile with server-side validation and audit logging.
 */
export async function saveDonorProfile(
  clerkUserId: string,
  userEmail: string,
  userFullName: string,
  rawFormData: unknown
): Promise<{ success: boolean; error?: string; donor?: FormattedDonorData }> {
  // 1. Server-side validation with Zod
  const validation = donorProfileFormSchema.safeParse(rawFormData);
  if (!validation.success) {
    const errorMsg = validation.error.issues.map((i) => i.message).join(". ");
    return { success: false, error: errorMsg };
  }

  const data: DonorProfileFormData = validation.data;
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database service is currently unreachable." };
  }

  // 2. Resolve user profile
  const userProfile = await getOrCreateUserProfile(clerkUserId, userEmail, userFullName);

  // 3. Parse blood group into ABO and Rh
  const { bloodGroup, rhFactor } = parseBloodGroup(data.blood_group);

  // 4. Check if donor profile already exists for audit tracking
  const { data: existingDonor } = await admin
    .from("donor_profiles")
    .select("*")
    .eq("profile_id", userProfile.id)
    .single();

  const isNew = !existingDonor;

  // 5. Upsert donor profile
  const payload = {
    profile_id: userProfile.id,
    blood_group: bloodGroup,
    rh_factor: rhFactor,
    is_available: data.is_available,
    consent_to_contact: data.consent_to_contact,
    notification_radius_km: data.service_radius_km,
    city: data.city,
    province: data.province,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    updated_at: new Date().toISOString(),
  };

  let savedDonorId: string;

  if (isNew) {
    const { data: inserted, error: insertErr } = await admin
      .from("donor_profiles")
      .insert(payload)
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return { success: false, error: `Failed to create donor profile: ${insertErr?.message}` };
    }
    savedDonorId = inserted.id;

    // Elevate role to DONOR if currently USER
    if (userProfile.role === "USER") {
      await admin.from("profiles").update({ role: "DONOR" }).eq("id", userProfile.id);
    }

    // 6. Audit log for creation
    await logAuditEvent({
      actorProfileId: userProfile.id,
      action: "DONOR_PROFILE_CREATED",
      targetTable: "donor_profiles",
      targetId: savedDonorId,
      previousState: null,
      newState: payload,
    });
  } else {
    savedDonorId = existingDonor.id;
    const { error: updateErr } = await admin
      .from("donor_profiles")
      .update(payload)
      .eq("id", existingDonor.id);

    if (updateErr) {
      return { success: false, error: `Failed to update donor profile: ${updateErr.message}` };
    }

    // 6. Audit log for update
    await logAuditEvent({
      actorProfileId: userProfile.id,
      action: "DONOR_PROFILE_UPDATED",
      targetTable: "donor_profiles",
      targetId: savedDonorId,
      previousState: existingDonor,
      newState: payload,
    });
  }

  const updatedDonor = await getDonorProfile(clerkUserId);
  return { success: true, donor: updatedDonor ?? undefined };
}

/**
 * Toggles donor operational availability with audit logging.
 */
export async function toggleDonorAvailability(
  clerkUserId: string,
  rawStatus: unknown
): Promise<{ success: boolean; error?: string; isAvailable?: boolean }> {
  const parsed = availabilityToggleSchema.safeParse(rawStatus);
  if (!parsed.success) {
    return { success: false, error: "Invalid availability value." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { success: false, error: "Database unreachable." };

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!profile) return { success: false, error: "User profile not found." };

  const { data: existingDonor } = await admin
    .from("donor_profiles")
    .select("id, is_available")
    .eq("profile_id", profile.id)
    .single();

  if (!existingDonor) {
    return { success: false, error: "Donor profile does not exist yet. Please complete onboarding." };
  }

  const newAvailability = parsed.data.is_available;

  const { error: updateErr } = await admin
    .from("donor_profiles")
    .update({
      is_available: newAvailability,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingDonor.id);

  if (updateErr) {
    return { success: false, error: `Failed to update availability: ${updateErr.message}` };
  }

  // Audit log
  await logAuditEvent({
    actorProfileId: profile.id,
    action: "DONOR_AVAILABILITY_CHANGED",
    targetTable: "donor_profiles",
    targetId: existingDonor.id,
    previousState: { is_available: existingDonor.is_available },
    newState: { is_available: newAvailability },
  });

  return { success: true, isAvailable: newAvailability };
}

/**
 * Updates donor contact consent with audit logging.
 */
export async function toggleDonorContactConsent(
  clerkUserId: string,
  rawConsent: unknown
): Promise<{ success: boolean; error?: string; consentToContact?: boolean }> {
  const parsed = consentToggleSchema.safeParse(rawConsent);
  if (!parsed.success) {
    return { success: false, error: "Invalid consent value." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { success: false, error: "Database unreachable." };

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .single();

  if (!profile) return { success: false, error: "User profile not found." };

  const { data: existingDonor } = await admin
    .from("donor_profiles")
    .select("id, consent_to_contact")
    .eq("profile_id", profile.id)
    .single();

  if (!existingDonor) {
    return { success: false, error: "Donor profile does not exist yet. Please complete onboarding." };
  }

  const newConsent = parsed.data.consent_to_contact;

  const { error: updateErr } = await admin
    .from("donor_profiles")
    .update({
      consent_to_contact: newConsent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingDonor.id);

  if (updateErr) {
    return { success: false, error: `Failed to update contact consent: ${updateErr.message}` };
  }

  // Audit log
  await logAuditEvent({
    actorProfileId: profile.id,
    action: "DONOR_CONTACT_CONSENT_CHANGED",
    targetTable: "donor_profiles",
    targetId: existingDonor.id,
    previousState: { consent_to_contact: existingDonor.consent_to_contact },
    newState: { consent_to_contact: newConsent },
  });

  return { success: true, consentToContact: newConsent };
}

export interface DonorFilterParams {
  bloodGroup?: string;
  city?: string;
  isAvailable?: boolean;
  minReliability?: number;
  search?: string;
}

export interface DonorDirectoryEntry {
  id: string;
  donorCode: string;
  displayName: string;
  bloodGroup: string;
  city: string;
  province: string;
  isAvailable: boolean;
  reliabilityScore: number;
  totalDonationsCount: number;
  totalPoints: number;
  recognitionTier: string;
  badgeColor: string;
  createdAt: string;
}

/**
 * Searches and lists donors with privacy protections.
 * Never outputs sensitive contact or personal details (phone, street address, or email).
 */
export async function listAndFilterDonors(
  filters: DonorFilterParams = {}
): Promise<{ success: boolean; donors: DonorDirectoryEntry[]; error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { success: false, donors: [], error: "Database client unavailable." };
    }

    let query = admin.from("donor_profiles").select(`
      id,
      profile_id,
      blood_group,
      rh_factor,
      city,
      province,
      is_available,
      reliability_score,
      total_donations_count,
      created_at
    `);

    if (filters.bloodGroup && filters.bloodGroup !== "ALL") {
      const { bloodGroup, rhFactor } = parseBloodGroup(filters.bloodGroup as BloodGroup);
      query = query.eq("blood_group", bloodGroup).eq("rh_factor", rhFactor);
    }

    if (filters.city) {
      query = query.ilike("city", `%${filters.city}%`);
    }

    if (typeof filters.isAvailable === "boolean") {
      query = query.eq("is_available", filters.isAvailable);
    }

    if (typeof filters.minReliability === "number") {
      query = query.gte("reliability_score", filters.minReliability);
    }

    query = query.order("created_at", { ascending: false });

    const { data: donorRows, error: donorErr } = await query;
    if (donorErr) throw donorErr;

    const donorList = donorRows || [];
    if (donorList.length === 0) {
      return { success: true, donors: [] };
    }

    const profileIds = donorList.map((d) => d.profile_id);

    // Fetch user profiles for privacy-masked names
    const { data: userProfiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds);

    const nameMap = new Map(userProfiles?.map((u) => [u.id, u.full_name]) || []);

    // Fetch points transactions for these donors
    const { data: pointsTxs } = await admin
      .from("donor_points_transactions")
      .select("donor_id, points")
      .in("donor_id", profileIds);

    const pointsMap = new Map<string, number>();
    for (const tx of pointsTxs || []) {
      pointsMap.set(tx.donor_id, (pointsMap.get(tx.donor_id) || 0) + (tx.points || 0));
    }

    const { formatPrivacyConsciousName, calculateTier } = await import("@/lib/donations/points");

    const result: DonorDirectoryEntry[] = donorList.map((d, index) => {
      const rawName = nameMap.get(d.profile_id);
      const points = pointsMap.get(d.profile_id) || 0;
      const tierInfo = calculateTier(points);
      const bg = `${d.blood_group}${d.rh_factor === "POSITIVE" ? "+" : "-"}`;

      return {
        id: d.id,
        donorCode: `DONOR-${d.id.slice(0, 8).toUpperCase()}`,
        displayName: formatPrivacyConsciousName(rawName, index),
        bloodGroup: bg,
        city: d.city,
        province: d.province || "N/A",
        isAvailable: d.is_available,
        reliabilityScore: d.reliability_score || 100,
        totalDonationsCount: d.total_donations_count || 0,
        totalPoints: points,
        recognitionTier: tierInfo.name,
        badgeColor: tierInfo.badgeColor,
        createdAt: d.created_at,
      };
    });

    // If text search filter applied on masked name or city
    let filteredResult = result;
    if (filters.search) {
      const term = filters.search.toLowerCase();
      filteredResult = result.filter(
        (r) =>
          r.displayName.toLowerCase().includes(term) ||
          r.city.toLowerCase().includes(term) ||
          r.donorCode.toLowerCase().includes(term) ||
          r.bloodGroup.toLowerCase().includes(term)
      );
    }

    return { success: true, donors: filteredResult };
  } catch (err: unknown) {
    return {
      success: false,
      donors: [],
      error: err instanceof Error ? err.message : "Error listing donors.",
    };
  }
}

