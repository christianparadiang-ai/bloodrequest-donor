import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;
import { listReviewQueueBloodRequests } from "@/lib/requests/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { RequestCard } from "@/components/requests/request-card";
import { OutboxOperationsCard } from "@/components/admin/outbox-operations-card";
import { PointsConfigCard, PointsConfigItem } from "@/components/admin/points-config-card";
import { getOutboxMetrics, getRecentOutboxEvents } from "@/lib/outbox/service";
import { Button } from "@/components/ui/button";
import {
  Building2,
  FileCheck,
  History,
  Lock,
  ArrowLeft,
  ShieldCheck,
  ClipboardList,
  FileSpreadsheet,
  HeartHandshake,
  Droplet,
  Users,
  Award,
  Radio,
} from "lucide-react";

import { resolveUserRole, extractUserEmail, INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_CLERK_ID } from "@/lib/auth";

export default async function AdminPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const email = extractUserEmail(user) || "";
  const userRole = await resolveUserRole(user.id, email);

  const isAdmin =
    (email === INITIAL_ADMIN_EMAIL.toLowerCase() || user.id === INITIAL_ADMIN_CLERK_ID) &&
    (userRole === "ADMIN" || userRole === "SUPER_ADMIN");

  const isPrivileged =
    isAdmin ||
    ["MODERATOR", "HOSPITAL_STAFF"].includes(userRole);

  if (!isPrivileged) {
    return (
      <div className="flex-1 py-16 px-4 max-w-md mx-auto w-full text-center space-y-6">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <Lock className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Access Restricted</h1>
          <p className="text-sm text-muted-foreground">
            System governance and administrative operations require authorized administrative credentials.
          </p>
        </div>
        <div>
          <Link href="/dashboard">
            <Button variant="outline" className="gap-2 font-medium">
              <ArrowLeft className="size-4" />
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // 1. Fetch live review queue
  const reviewQueueRes = await listReviewQueueBloodRequests(user.id, email);
  const reviewQueue = reviewQueueRes.requests || [];

  // 2. Fetch platform overview metrics
  let activeRequestsCount = 0;
  let totalDonorsCount = 0;
  let completedDonationsCount = 0;
  let pointsPerDonation = 100;
  let pointsConfigItems: PointsConfigItem[] = [];

  try {
    const adminClient = createSupabaseAdminClient();
    if (adminClient) {
      const [reqCount, donorCount, donCount, ptsConfigRes] = await Promise.all([
        adminClient.from("blood_requests").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
        adminClient.from("donor_profiles").select("id", { count: "exact", head: true }),
        adminClient.from("donations").select("id", { count: "exact", head: true }).eq("status", "COMPLETED"),
        adminClient.from("points_config").select("key, value, description").order("key"),
      ]);
      activeRequestsCount = reqCount.count || 0;
      totalDonorsCount = donorCount.count || 0;
      completedDonationsCount = donCount.count || 0;
      if (ptsConfigRes.data) {
        pointsConfigItems = ptsConfigRes.data as PointsConfigItem[];
        const ppd = pointsConfigItems.find((p) => p.key === "points_per_donation");
        if (ppd && typeof ppd.value === "number") {
          pointsPerDonation = ppd.value;
        }
      }
    }
  } catch (err) {
    console.error("Failed to load admin overview metrics:", err);
  }

  // 3. Fetch outbox metrics for platform admin
  const outboxMetrics = isPrivileged
    ? await getOutboxMetrics()
    : {
        pendingCount: 0,
        processingCount: 0,
        deliveredCount: 0,
        retryableCount: 0,
        permanentFailureCount: 0,
        totalEventsCount: 0,
        lastWorkerRunAt: null,
        lastReconciliationRunAt: null,
      };

  const recentOutboxEvents = isPrivileged ? await getRecentOutboxEvents(10) : [];

  return (
    <div className="flex-1 py-10 px-4 max-w-5xl mx-auto w-full space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/dashboard?view=user"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Switch to Personal User View
          </Link>
          <span className="text-muted-foreground/40 text-xs">&bull;</span>
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Radio className="size-3.5" />
            Public Blood Directory
          </Link>
          <span className="text-muted-foreground/40 text-xs">&bull;</span>
          <Link
            href="/donor"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <HeartHandshake className="size-3.5" />
            Donor Network
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">System Governance & Administration</h1>
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold">
                Role: {userRole}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Authorized Administrator: <span className="font-semibold text-foreground">{email}</span>. Requisition review, donor points, hospital governance, and immutable audit logs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/reports">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 text-xs font-semibold shadow-xs">
                <FileSpreadsheet className="size-3.5" />
                Reports & Analytics
              </Button>
            </Link>
            <Link href="/admin/donors">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs font-semibold">
                <Users className="size-3.5" />
                Donor Oversight
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Operational & Medical Guardrail Notice */}
      <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
        <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
          Operational Boundary & Non-Clinical Disclaimer
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
          Platform governance encompasses administrative intake verification, hospital accreditation records, points policy, and delivery infrastructure. All clinical suitability, medical eligibility determinations, blood typing cross-matches, and transfusion authorizations are performed strictly on-site by certified blood bank and hospital clinical staff.
        </AlertDescription>
      </Alert>

      {/* Live System Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Verification Queue
              <ClipboardList className="size-3.5 text-amber-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-black tracking-tight text-amber-600 dark:text-amber-400">
              {reviewQueue.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground pt-0">
            Requisitions awaiting clinical review
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Active Requests
              <Droplet className="size-3.5 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-black tracking-tight text-primary">
              {activeRequestsCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground pt-0">
            Active patient requisitions in directory
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Registered Donors
              <Users className="size-3.5 text-emerald-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
              {totalDonorsCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground pt-0">
            Volunteer donors across network
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center justify-between">
              Points Policy
              <Award className="size-3.5 text-purple-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-black tracking-tight text-purple-600 dark:text-purple-400">
              {pointsPerDonation} <span className="text-xs font-normal text-muted-foreground">pts</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[11px] text-muted-foreground pt-0">
            {completedDonationsCount} verified completed donations
          </CardContent>
        </Card>
      </div>

      <Alert className="border-border/60 bg-muted/30">
        <Lock className="size-4 text-primary" />
        <AlertTitle className="font-semibold text-sm">
          Server-Side Role Enforcement & Initial Admin Policy
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Administrative features enforce verified server-side claims with exclusive initial authorization for <strong>christian.paradiang@urios.edu.ph</strong>. Client-provided roles or parameters are strictly untrusted and stripped at runtime.
        </AlertDescription>
      </Alert>

      {/* Requisition Review Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Requisition Verification Queue</h2>
          </div>
          <Badge variant="secondary" className="text-xs">
            {reviewQueue.length} Pending Review
          </Badge>
        </div>

        {isPrivileged ? (
          reviewQueue.length === 0 ? (
            <Card className="border-dashed border-border/80">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                <ShieldCheck className="size-10 text-muted-foreground/60" />
                <h3 className="font-semibold text-sm">Verification Queue Clear</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  There are currently no blood requisitions waiting in SUBMITTED or UNDER_REVIEW status.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {reviewQueue.map((req) => (
                <RequestCard key={req.id} request={req} />
              ))}
            </div>
          )
        ) : (
          <Card className="border-border/60 bg-muted/20">
            <CardContent className="py-6 text-center text-xs text-muted-foreground">
              Your account currently has role <strong>{userRole}</strong>. Requisition verification operations require <code>HOSPITAL_STAFF</code>, <code>MODERATOR</code>, or <code>ADMIN</code> permissions.
            </CardContent>
          </Card>
        )}
      </div>
      {/* Points Configuration Policy & Outbox Operations: Strictly for Platform Administrators */}
      {isAdmin && (
        <>
          <PointsConfigCard initialConfig={pointsConfigItems} />
          <OutboxOperationsCard
            initialMetrics={outboxMetrics}
            initialEvents={recentOutboxEvents}
          />
        </>
      )}

       {/* Governance Sections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-border/60">
        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1">
              <Building2 className="size-4" />
            </div>
            <CardTitle className="text-base">Hospital Partners</CardTitle>
            <CardDescription className="text-xs">
              Manage licensed hospital organizations and verified blood banks.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Target schema: <code>organizations</code>, <code>organization_members</code>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center mb-1">
              <FileCheck className="size-4" />
            </div>
            <CardTitle className="text-base">Requisition Review</CardTitle>
            <CardDescription className="text-xs">
              Medical review queue for prescription validation.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Target schema: <code>blood_requests</code> status transition to <code>ACTIVE</code>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center mb-1">
              <History className="size-4" />
            </div>
            <CardTitle className="text-base">Immutable Audit Log</CardTitle>
            <CardDescription className="text-xs">
              Append-only tamper-proof ledger of clinical operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Target schema: <code>audit_logs</code> (Deletions & updates prohibited)
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
