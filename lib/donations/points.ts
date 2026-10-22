import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { UserRole } from "@/lib/supabase/types";
import { logAuditEvent } from "@/lib/audit";

export const DEFAULT_POINTS_PER_DONATION = 100;

export const RECOGNITION_TIERS = [
  {
    tier: "Platinum",
    name: "Platinum Life Donor",
    minPoints: 1000,
    badgeColor: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    description: "Distinguished voluntary donor milestone (10+ verified donations). Proposed recognition: Life Drop Commendation.",
  },
  {
    tier: "Gold",
    name: "Gold Life Donor",
    minPoints: 600,
    badgeColor: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    description: "Dedicated voluntary donor milestone (6+ verified donations). Proposed recognition: Community Certificate of Appreciation.",
  },
  {
    tier: "Silver",
    name: "Silver Life Donor",
    minPoints: 300,
    badgeColor: "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
    description: "Committed voluntary donor milestone (3+ verified donations). Proposed recognition: Silver Donor Badge.",
  },
  {
    tier: "Bronze",
    name: "Bronze Life Donor",
    minPoints: 100,
    badgeColor: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
    description: "First verified donation milestone (100 points). Proposed recognition: Bronze Welcome Pin.",
  },
] as const;

export const POINTS_SAFETY_DISCLAIMER =
  "NON-MONETARY RECOGNITION NOTICE: Points and recognition tiers in Life Drop are strictly non-monetary and intended exclusively to recognize voluntary community solidarity. Points do NOT constitute financial compensation, carry no cash value, imply no commercial exchange, and confer no priority clinical access, health clearance, transfusion safety validation, or any commercial entitlement. Life Drop strictly upholds voluntary, unpaid blood donation standards.";

export interface PointsTransactionRecord {
  id: string;
  donor_id: string;
  donor_profile_id: string | null;
  donation_id: string | null;
  points: number;
  transaction_type: "DONATION_COMPLETED" | "MANUAL_ADJUSTMENT" | "REVERSAL";
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface DonorPointsSummary {
  totalPoints: number;
  currentTier: string;
  currentTierName: string;
  badgeColor: string;
  tierDescription: string;
  nextTier: {
    tier: string;
    name: string;
    minPoints: number;
    pointsNeeded: number;
  } | null;
  totalDonationsCompleted: number;
  transactions: PointsTransactionRecord[];
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  bloodGroup: string;
  totalPoints: number;
  tier: string;
  totalDonations: number;
}

/**
 * Reads configurable point values from points_config table, with safe fallback.
 */
export async function getConfiguredPoints(key = "points_per_donation"): Promise<number> {
  const admin = createSupabaseAdminClient();
  if (!admin) return DEFAULT_POINTS_PER_DONATION;

  try {
    const { data } = await admin
      .from("points_config")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (data && typeof data.value === "number") {
      return data.value;
    }
  } catch {
    // Fall back to default
  }
  return DEFAULT_POINTS_PER_DONATION;
}

/**
 * Determines recognition tier based on cumulative points.
 */
export function calculateTier(points: number) {
  for (const tier of RECOGNITION_TIERS) {
    if (points >= tier.minPoints) {
      return tier;
    }
  }
  return {
    tier: "Member",
    name: "Life Drop Member",
    minPoints: 0,
    badgeColor: "bg-muted text-muted-foreground border-border",
    description: "Registered donor advancing toward their first verified donation milestone (100 points).",
  };
}

/**
 * Calculates next milestone tier.
 */
export function getNextTier(points: number) {
  const reversed = [...RECOGNITION_TIERS].reverse();
  for (const tier of reversed) {
    if (points < tier.minPoints) {
      return {
        tier: tier.tier,
        name: tier.name,
        minPoints: tier.minPoints,
        pointsNeeded: tier.minPoints - points,
      };
    }
  }
  return null; // Top tier reached
}

/**
 * Masks a donor's name for privacy-conscious public display.
 * Never outputs full names, emails, phone numbers, or addresses.
 */
export function formatPrivacyConsciousName(fullName?: string | null, index = 0): string {
  if (!fullName || !fullName.trim()) {
    return `Anonymous Donor #${100 + index}`;
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return `${parts[0].slice(0, 3)}***`;
  }
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstName} ${lastInitial}.`;
}

/**
 * Awards non-monetary recognition points upon verified donation completion.
 * Enforces idempotency via unique database index on donation_id.
 */
export async function awardPointsForCompletedDonation(params: {
  donationId: string;
  donorId: string;
  donorProfileId?: string | null;
  verifiedByProfileId: string;
  unitsDonated?: number;
  componentType?: string;
}): Promise<{
  success: boolean;
  pointsAwarded: number;
  alreadyAwarded?: boolean;
  error?: string;
}> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, pointsAwarded: 0, error: "Database unavailable." };
  }

  // 1. Check if points have already been awarded for this donation
  const { data: existingAward } = await admin
    .from("donor_points_transactions")
    .select("id, points")
    .eq("donation_id", params.donationId)
    .eq("transaction_type", "DONATION_COMPLETED")
    .maybeSingle();

  if (existingAward) {
    return {
      success: true,
      pointsAwarded: existingAward.points,
      alreadyAwarded: true,
    };
  }

  // 2. Fetch configurable points rule
  const pointsToAward = await getConfiguredPoints("points_per_donation");

  // 3. Insert points ledger record
  const reason = `Verified completed blood donation (${params.unitsDonated || 1} unit(s) ${
    params.componentType || "WHOLE_BLOOD"
  }).`;

  const { data: inserted, error: insertErr } = await admin
    .from("donor_points_transactions")
    .insert({
      donor_id: params.donorId,
      donor_profile_id: params.donorProfileId || null,
      donation_id: params.donationId,
      points: pointsToAward,
      transaction_type: "DONATION_COMPLETED",
      reason,
      created_by: params.verifiedByProfileId,
    })
    .select("*")
    .single();

  if (insertErr) {
    // Unique violation check (concurrency race condition idempotency)
    if (insertErr.code === "23505") {
      return {
        success: true,
        pointsAwarded: pointsToAward,
        alreadyAwarded: true,
      };
    }
    return {
      success: false,
      pointsAwarded: 0,
      error: `Failed to award points: ${insertErr.message}`,
    };
  }

  // 4. Audit log
  await logAuditEvent({
    actorProfileId: params.verifiedByProfileId,
    action: "DONOR_POINTS_AWARDED",
    targetTable: "donor_points_transactions",
    targetId: inserted.id,
    newState: {
      donor_id: params.donorId,
      donation_id: params.donationId,
      points: pointsToAward,
      transaction_type: "DONATION_COMPLETED",
    },
  });

  return {
    success: true,
    pointsAwarded: pointsToAward,
    alreadyAwarded: false,
  };
}

/**
 * Retrieves the full points summary and ledger for a donor.
 */
export async function getDonorPointsSummary(
  clerkUserIdOrProfileId: string
): Promise<DonorPointsSummary> {
  const admin = createSupabaseAdminClient();
  const defaultResponse: DonorPointsSummary = {
    totalPoints: 0,
    currentTier: "Member",
    currentTierName: "Life Drop Member",
    badgeColor: "bg-muted text-muted-foreground border-border",
    tierDescription: "No points recorded yet.",
    nextTier: {
      tier: "Bronze",
      name: "Bronze Life Donor",
      minPoints: 100,
      pointsNeeded: 100,
    },
    totalDonationsCompleted: 0,
    transactions: [],
  };

  if (!admin) return defaultResponse;

  // Resolve profile
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .or(`id.eq.${clerkUserIdOrProfileId},clerk_user_id.eq.${clerkUserIdOrProfileId}`)
    .maybeSingle();

  if (!profile) return defaultResponse;

  // Query transactions ledger
  const { data: txs, error: txErr } = await admin
    .from("donor_points_transactions")
    .select("*")
    .eq("donor_id", profile.id)
    .order("created_at", { ascending: false });

  if (txErr || !txs) return defaultResponse;

  const transactions = txs as PointsTransactionRecord[];
  const totalPoints = transactions.reduce((acc, t) => acc + (t.points || 0), 0);
  const completedDonationCount = transactions.filter(
    (t) => t.transaction_type === "DONATION_COMPLETED"
  ).length;

  const currentTierInfo = calculateTier(totalPoints);
  const nextTierInfo = getNextTier(totalPoints);

  return {
    totalPoints,
    currentTier: currentTierInfo.tier,
    currentTierName: currentTierInfo.name,
    badgeColor: currentTierInfo.badgeColor,
    tierDescription: currentTierInfo.description,
    nextTier: nextTierInfo,
    totalDonationsCompleted: completedDonationCount,
    transactions,
  };
}

/**
 * Retrieves donor leaderboard with strictly privacy-masked identities.
 */
export async function getDonorLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const admin = createSupabaseAdminClient();
  if (!admin) return [];

  // Fetch transactions aggregated by donor
  const { data: txs } = await admin
    .from("donor_points_transactions")
    .select("donor_id, points, transaction_type");

  if (!txs || txs.length === 0) return [];

  const donorPointsMap = new Map<string, { total: number; donations: number }>();
  for (const tx of txs) {
    const cur = donorPointsMap.get(tx.donor_id) || { total: 0, donations: 0 };
    cur.total += tx.points || 0;
    if (tx.transaction_type === "DONATION_COMPLETED") {
      cur.donations += 1;
    }
    donorPointsMap.set(tx.donor_id, cur);
  }

  // Sort by points descending
  const sortedDonorIds = Array.from(donorPointsMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit);

  if (sortedDonorIds.length === 0) return [];

  const ids = sortedDonorIds.map(([id]) => id);

  // Fetch donor profiles and user profiles for privacy display
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const { data: donorProfiles } = await admin
    .from("donor_profiles")
    .select("profile_id, blood_group, rh_factor")
    .in("profile_id", ids);

  const profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || []);
  const bgMap = new Map(
    donorProfiles?.map((dp) => [
      dp.profile_id,
      `${dp.blood_group}${dp.rh_factor === "POSITIVE" ? "+" : "-"}`,
    ]) || []
  );

  return sortedDonorIds.map(([id, stats], index) => {
    const rawName = profileMap.get(id);
    const bg = bgMap.get(id) || "Donor";
    const tier = calculateTier(stats.total);

    return {
      rank: index + 1,
      displayName: formatPrivacyConsciousName(rawName, index),
      bloodGroup: bg,
      totalPoints: stats.total,
      tier: tier.name,
      totalDonations: stats.donations,
    };
  });
}

/**
 * Privileged administrator manual points adjustment with audit trail.
 */
export async function adjustDonorPoints(params: {
  donorProfileIdOrUserId: string;
  points: number;
  reason: string;
  adminClerkUserId: string;
  transactionType?: "MANUAL_ADJUSTMENT" | "REVERSAL";
}): Promise<{
  success: boolean;
  transaction?: PointsTransactionRecord;
  error?: string;
}> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database connection unavailable." };
  }

  // 1. Check admin caller
  const { data: caller } = await admin
    .from("profiles")
    .select("id, role")
    .eq("clerk_user_id", params.adminClerkUserId)
    .single();

  if (!caller || !["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(caller.role as UserRole)) {
    return { success: false, error: "UNAUTHORIZED: Only administrators can adjust donor points." };
  }

  // 2. Resolve target donor profile
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id")
    .or(`id.eq.${params.donorProfileIdOrUserId},clerk_user_id.eq.${params.donorProfileIdOrUserId}`)
    .maybeSingle();

  if (!targetProfile) {
    return { success: false, error: "Donor record not found." };
  }

  const { data: dp } = await admin
    .from("donor_profiles")
    .select("id")
    .eq("profile_id", targetProfile.id)
    .maybeSingle();

  const txType = params.transactionType || "MANUAL_ADJUSTMENT";
  const signedPoints =
    txType === "REVERSAL" ? -Math.abs(params.points) : Math.abs(params.points);

  const { data: inserted, error: insertErr } = await admin
    .from("donor_points_transactions")
    .insert({
      donor_id: targetProfile.id,
      donor_profile_id: dp?.id || null,
      points: signedPoints,
      transaction_type: txType,
      reason: params.reason,
      created_by: caller.id,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    return { success: false, error: insertErr?.message || "Failed to record adjustment." };
  }

  await logAuditEvent({
    actorProfileId: caller.id,
    action: "DONOR_POINTS_ADJUSTED",
    targetTable: "donor_points_transactions",
    targetId: inserted.id,
    newState: {
      donor_id: targetProfile.id,
      points: params.points,
      reason: params.reason,
      transaction_type: txType,
    },
  });

  return {
    success: true,
    transaction: inserted as PointsTransactionRecord,
  };
}
