import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { UserRole } from "@/lib/supabase/types";
import { calculateDateRange, PeriodType, DateRangeResult } from "./dates";
import { serializeToCsv } from "./csv";
import { calculateTier } from "@/lib/donations/points";

const PRIVILEGED_ROLES: UserRole[] = [
  "HOSPITAL_STAFF",
  "MODERATOR",
  "ADMIN",
  "SUPER_ADMIN",
];

export interface AnalyticsSummary {
  period: DateRangeResult;
  totalRequests: number;
  requestsByStatus: {
    open: number;         // DRAFT, SUBMITTED, UNDER_REVIEW, ACTIVE
    inProgress: number;   // PARTIALLY_COMMITTED, FULLY_COMMITTED, PARTIALLY_FULFILLED
    fulfilled: number;    // FULFILLED
    cancelled: number;    // CANCELLED
    expired: number;      // EXPIRED
    rejected: number;     // REJECTED
  };
  totalDonors: number;
  verifiedDonors: number;
  totalDonationsCompleted: number;
  totalUnitsDonated: number;
  totalUnitsRequested: number;
  fulfillmentRatePercent: number; // Formula: (totalUnitsDonated / totalUnitsRequested) * 100
  requestsByBloodGroup: Record<string, number>;
  requestsByComponent: Record<string, number>;
  donationsByDate: { date: string; count: number; units: number }[];
  totalPointsAwarded: number;
  pointsTransactionsCount: number;
  donorsByTier: Record<string, number>;
}

export type ReportCategory =
  | "blood-requests"
  | "donors"
  | "completed-donations"
  | "points-transactions";

/**
 * Validates whether the caller has permissions to view detailed operational reports.
 */
async function verifyReportAccess(clerkUserId: string, email?: string | null): Promise<{ authorized: boolean; error?: string }> {
  const { resolveUserRole } = await import("@/lib/auth");
  const role = await resolveUserRole(clerkUserId, email);

  if (!PRIVILEGED_ROLES.includes(role)) {
    return {
      authorized: false,
      error: "UNAUTHORIZED: Access to operational analytics requires hospital staff or administrator authorization.",
    };
  }

  return { authorized: true };
}

/**
 * Generates an aggregated analytics report over a selected calendar period.
 */
export async function getAnalyticsReport(options: {
  clerkUserId: string;
  email?: string | null;
  periodType: PeriodType;
  date?: string;
  year?: number;
  month?: number;
  customStart?: string;
  customEnd?: string;
}): Promise<{ success: boolean; data?: AnalyticsSummary; error?: string }> {
  const authCheck = await verifyReportAccess(options.clerkUserId, options.email);
  if (!authCheck.authorized) {
    return { success: false, error: authCheck.error };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database client unavailable." };
  }

  const range = calculateDateRange({
    periodType: options.periodType,
    date: options.date,
    year: options.year,
    month: options.month,
    customStart: options.customStart,
    customEnd: options.customEnd,
  });

  try {
    // 1. Blood requests in range
    const { data: requests, error: reqErr } = await admin
      .from("blood_requests")
      .select("id, status, blood_group, rh_factor, blood_component, units_requested, units_donated, created_at")
      .gte("created_at", range.startDate)
      .lte("created_at", range.endDate);

    if (reqErr) throw reqErr;

    const reqList = requests || [];
    const totalRequests = reqList.length;

    const requestsByStatus = {
      open: 0,
      inProgress: 0,
      fulfilled: 0,
      cancelled: 0,
      expired: 0,
      rejected: 0,
    };

    const requestsByBloodGroup: Record<string, number> = {};
    const requestsByComponent: Record<string, number> = {};
    let totalUnitsRequested = 0;
    let totalUnitsDonated = 0;

    for (const r of reqList) {
      // Status categorisation
      const status = r.status;
      if (["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE"].includes(status)) {
        requestsByStatus.open++;
      } else if (["PARTIALLY_COMMITTED", "FULLY_COMMITTED", "PARTIALLY_FULFILLED"].includes(status)) {
        requestsByStatus.inProgress++;
      } else if (status === "FULFILLED") {
        requestsByStatus.fulfilled++;
      } else if (status === "CANCELLED") {
        requestsByStatus.cancelled++;
      } else if (status === "EXPIRED") {
        requestsByStatus.expired++;
      } else if (status === "REJECTED") {
        requestsByStatus.rejected++;
      }

      // Groupings
      const bg = `${r.blood_group}${r.rh_factor === "POSITIVE" ? "+" : "-"}`;
      requestsByBloodGroup[bg] = (requestsByBloodGroup[bg] || 0) + 1;

      const comp = r.blood_component || "WHOLE_BLOOD";
      requestsByComponent[comp] = (requestsByComponent[comp] || 0) + 1;

      totalUnitsRequested += r.units_requested || 0;
      totalUnitsDonated += r.units_donated || 0;
    }

    // Documented formula: (totalUnitsDonated / totalUnitsRequested) * 100
    const fulfillmentRatePercent =
      totalUnitsRequested > 0
        ? Math.min(100, Math.round((totalUnitsDonated / totalUnitsRequested) * 1000) / 10)
        : 0;

    // 2. Donor profiles
    const { data: allDonors, error: donorErr } = await admin
      .from("donor_profiles")
      .select("id, profile_id, created_at, reliability_score");

    if (donorErr) throw donorErr;

    const donorList = allDonors || [];
    const totalDonors = donorList.length;
    // Verified donors are those with reliability_score >= 80 or who have profile verified
    const verifiedDonors = donorList.filter((d) => (d.reliability_score || 0) >= 80).length;

    // 3. Completed donations in range
    const { data: donations, error: donErr } = await admin
      .from("donations")
      .select("id, units_donated, recorded_at, component_type")
      .eq("status", "RECORDED")
      .gte("recorded_at", range.startDate)
      .lte("recorded_at", range.endDate);

    if (donErr) throw donErr;

    const completedDonationsList = donations || [];
    const totalDonationsCompleted = completedDonationsList.length;

    // Donations grouped by date (YYYY-MM-DD)
    const donationsDateMap = new Map<string, { count: number; units: number }>();
    for (const d of completedDonationsList) {
      const day = d.recorded_at ? d.recorded_at.split("T")[0] : "unknown";
      const cur = donationsDateMap.get(day) || { count: 0, units: 0 };
      cur.count++;
      cur.units += d.units_donated || 1;
      donationsDateMap.set(day, cur);
    }

    const donationsByDate = Array.from(donationsDateMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 4. Points awarded in range & recognition breakdown
    const { data: pointsTxs } = await admin
      .from("donor_points_transactions")
      .select("points, donor_id, transaction_type, created_at")
      .gte("created_at", range.startDate)
      .lte("created_at", range.endDate);

    const txList = pointsTxs || [];
    const totalPointsAwarded = txList.reduce((sum, t) => sum + (t.points || 0), 0);
    const pointsTransactionsCount = txList.length;

    // Aggregate lifetime points to determine current donor tiers
    const { data: allPointsTxs } = await admin
      .from("donor_points_transactions")
      .select("donor_id, points");

    const donorTotals = new Map<string, number>();
    for (const tx of allPointsTxs || []) {
      donorTotals.set(tx.donor_id, (donorTotals.get(tx.donor_id) || 0) + (tx.points || 0));
    }

    const donorsByTier: Record<string, number> = {
      Member: 0,
      Bronze: 0,
      Silver: 0,
      Gold: 0,
      Platinum: 0,
    };

    for (const [, pts] of donorTotals.entries()) {
      const tierInfo = calculateTier(pts);
      donorsByTier[tierInfo.tier] = (donorsByTier[tierInfo.tier] || 0) + 1;
    }

    return {
      success: true,
      data: {
        period: range,
        totalRequests,
        requestsByStatus,
        totalDonors,
        verifiedDonors,
        totalDonationsCompleted,
        totalUnitsDonated,
        totalUnitsRequested,
        fulfillmentRatePercent,
        requestsByBloodGroup,
        requestsByComponent,
        donationsByDate,
        totalPointsAwarded,
        pointsTransactionsCount,
        donorsByTier,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to calculate analytics summary.",
    };
  }
}

/**
 * Generates an authorized CSV export for a selected report category and date range.
 * Sanitizes all output against formula injection and strips sensitive PII.
 */
export async function generateCsvExport(options: {
  clerkUserId: string;
  email?: string | null;
  category: ReportCategory;
  periodType: PeriodType;
  date?: string;
  year?: number;
  month?: number;
  customStart?: string;
  customEnd?: string;
}): Promise<{
  success: boolean;
  filename?: string;
  csvContent?: string;
  recordCount?: number;
  error?: string;
}> {
  const authCheck = await verifyReportAccess(options.clerkUserId, options.email);
  if (!authCheck.authorized) {
    return { success: false, error: authCheck.error };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { success: false, error: "Database client unavailable." };
  }

  const range = calculateDateRange({
    periodType: options.periodType,
    date: options.date,
    year: options.year,
    month: options.month,
    customStart: options.customStart,
    customEnd: options.customEnd,
  });

  const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    switch (options.category) {
      case "blood-requests": {
        const { data: rows, error } = await admin
          .from("blood_requests")
          .select("id, patient_name_masked, hospital_name, hospital_city, blood_group, rh_factor, blood_component, units_requested, units_committed, units_donated, urgency_level, status, created_at")
          .gte("created_at", range.startDate)
          .lte("created_at", range.endDate)
          .order("created_at", { ascending: false });

        if (error) throw error;
        const list = (rows || []) as {
          id: string;
          patient_name_masked: string;
          hospital_name: string;
          hospital_city: string;
          blood_group: string;
          rh_factor: string;
          blood_component: string;
          units_requested: number;
          units_committed: number;
          units_donated: number;
          urgency_level: string;
          status: string;
          created_at: string;
        }[];

        const columns = [
          { header: "Request ID", accessor: (r: (typeof list)[0]) => r.id },
          { header: "Patient Identifier", accessor: (r: (typeof list)[0]) => r.patient_name_masked },
          { header: "Hospital Facility", accessor: (r: (typeof list)[0]) => r.hospital_name },
          { header: "City", accessor: (r: (typeof list)[0]) => r.hospital_city },
          { header: "Blood Group", accessor: (r: (typeof list)[0]) => `${r.blood_group}${r.rh_factor === "POSITIVE" ? "+" : "-"}` },
          { header: "Component", accessor: (r: (typeof list)[0]) => r.blood_component },
          { header: "Units Requested", accessor: (r: (typeof list)[0]) => r.units_requested },
          { header: "Units Committed", accessor: (r: (typeof list)[0]) => r.units_committed },
          { header: "Units Donated", accessor: (r: (typeof list)[0]) => r.units_donated },
          { header: "Urgency", accessor: (r: (typeof list)[0]) => r.urgency_level },
          { header: "Status", accessor: (r: (typeof list)[0]) => r.status },
          { header: "Date Created (UTC)", accessor: (r: (typeof list)[0]) => r.created_at },
        ];

        const csv = serializeToCsv(list, columns);
        return {
          success: true,
          filename: `blood-requests-report_${range.formattedStart}_to_${range.formattedEnd}_${timestampStr}.csv`,
          csvContent: csv,
          recordCount: list.length,
        };
      }

      case "donors": {
        // Query donor profiles and join privacy-masked profiles
        const { data: donors, error } = await admin
          .from("donor_profiles")
          .select("id, profile_id, blood_group, rh_factor, city, province, is_available, reliability_score, total_donations_count, created_at")
          .gte("created_at", range.startDate)
          .lte("created_at", range.endDate)
          .order("created_at", { ascending: false });

        if (error) throw error;
        const list = (donors || []) as {
          id: string;
          profile_id: string;
          blood_group: string;
          rh_factor: string;
          city: string;
          province: string | null;
          is_available: boolean;
          reliability_score: number;
          total_donations_count: number;
          created_at: string;
        }[];

        // Privacy protection: Never export phone, full address, email, or identity documents
        const columns = [
          { header: "Donor Code", accessor: (d: (typeof list)[0]) => `DONOR-${d.id.slice(0, 8).toUpperCase()}` },
          { header: "Blood Group", accessor: (d: (typeof list)[0]) => `${d.blood_group}${d.rh_factor === "POSITIVE" ? "+" : "-"}` },
          { header: "City", accessor: (d: (typeof list)[0]) => d.city },
          { header: "Province", accessor: (d: (typeof list)[0]) => d.province || "N/A" },
          { header: "Availability Status", accessor: (d: (typeof list)[0]) => (d.is_available ? "Available" : "Unavailable") },
          { header: "Reliability Score", accessor: (d: (typeof list)[0]) => d.reliability_score },
          { header: "Verified Donations Count", accessor: (d: (typeof list)[0]) => d.total_donations_count },
          { header: "Registered Date (UTC)", accessor: (d: (typeof list)[0]) => d.created_at },
        ];

        const csv = serializeToCsv(list, columns);
        return {
          success: true,
          filename: `donor-summary-report_${range.formattedStart}_to_${range.formattedEnd}_${timestampStr}.csv`,
          csvContent: csv,
          recordCount: list.length,
        };
      }

      case "completed-donations": {
        const { data: donations, error } = await admin
          .from("donations")
          .select("id, request_id, donor_id, units_donated, blood_group, component_type, facility_name, status, recorded_at, created_at")
          .eq("status", "RECORDED")
          .gte("recorded_at", range.startDate)
          .lte("recorded_at", range.endDate)
          .order("recorded_at", { ascending: false });

        if (error) throw error;
        const list = (donations || []) as {
          id: string;
          request_id: string;
          donor_id: string;
          units_donated: number;
          blood_group: string | null;
          component_type: string;
          facility_name: string | null;
          status: string;
          recorded_at: string | null;
          created_at: string;
        }[];

        const columns = [
          { header: "Donation ID", accessor: (d: (typeof list)[0]) => d.id },
          { header: "Requisition ID", accessor: (d: (typeof list)[0]) => d.request_id },
          { header: "Blood Group", accessor: (d: (typeof list)[0]) => d.blood_group || "N/A" },
          { header: "Component Type", accessor: (d: (typeof list)[0]) => d.component_type },
          { header: "Units Donated", accessor: (d: (typeof list)[0]) => d.units_donated },
          { header: "Collection Facility", accessor: (d: (typeof list)[0]) => d.facility_name || "N/A" },
          { header: "Verification Status", accessor: () => "VERIFIED_COMPLETED" },
          { header: "Recorded Timestamp (UTC)", accessor: (d: (typeof list)[0]) => d.recorded_at },
        ];

        const csv = serializeToCsv(list, columns);
        return {
          success: true,
          filename: `completed-donations-report_${range.formattedStart}_to_${range.formattedEnd}_${timestampStr}.csv`,
          csvContent: csv,
          recordCount: list.length,
        };
      }

      case "points-transactions": {
        const { data: txs, error } = await admin
          .from("donor_points_transactions")
          .select("id, donor_id, donation_id, points, transaction_type, reason, created_at")
          .gte("created_at", range.startDate)
          .lte("created_at", range.endDate)
          .order("created_at", { ascending: false });

        if (error) throw error;
        const list = (txs || []) as {
          id: string;
          donor_id: string;
          donation_id: string | null;
          points: number;
          transaction_type: string;
          reason: string;
          created_at: string;
        }[];

        const columns = [
          { header: "Transaction ID", accessor: (t: (typeof list)[0]) => t.id },
          { header: "Donor Code", accessor: (t: (typeof list)[0]) => `DONOR-${t.donor_id.slice(0, 8).toUpperCase()}` },
          { header: "Points", accessor: (t: (typeof list)[0]) => t.points },
          { header: "Transaction Type", accessor: (t: (typeof list)[0]) => t.transaction_type },
          { header: "Reason", accessor: (t: (typeof list)[0]) => t.reason },
          { header: "Related Donation ID", accessor: (t: (typeof list)[0]) => t.donation_id || "N/A" },
          { header: "Timestamp (UTC)", accessor: (t: (typeof list)[0]) => t.created_at },
        ];

        const csv = serializeToCsv(list, columns);
        return {
          success: true,
          filename: `points-ledger-report_${range.formattedStart}_to_${range.formattedEnd}_${timestampStr}.csv`,
          csvContent: csv,
          recordCount: list.length,
        };
      }

      default:
        return { success: false, error: "Invalid report category." };
    }
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate CSV report.",
    };
  }
}
