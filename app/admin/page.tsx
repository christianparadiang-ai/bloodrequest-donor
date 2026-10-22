import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listReviewQueueBloodRequests } from "@/lib/requests/service";
import { UserRole } from "@/lib/supabase/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { RequestCard } from "@/components/requests/request-card";
import { OutboxOperationsCard } from "@/components/admin/outbox-operations-card";
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
} from "lucide-react";

export default async function AdminPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const adminClient = createSupabaseAdminClient();
  let userRole: UserRole = "USER";
  if (adminClient) {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("clerk_user_id", user.id)
      .single();
    if (profile) userRole = profile.role as UserRole;
  }

  const isPrivileged = [
    "MODERATOR",
    "ADMIN",
    "SUPER_ADMIN",
    "HOSPITAL_STAFF",
  ].includes(userRole);

  const reviewQueueRes = isPrivileged
    ? await listReviewQueueBloodRequests(user.id)
    : { success: true, requests: [] };

  const reviewQueue = reviewQueueRes.requests || [];

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
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Dashboard
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">System Governance & Administration</h1>
              <Badge variant="outline" className="text-xs">
                Role: {userRole}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Hospital organization onboarding, requisition verification queue, and immutable audit logs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/admin/reports">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 text-xs font-semibold">
                <FileSpreadsheet className="size-3.5" />
                Reports & Analytics
              </Button>
            </Link>
            <Link href="/admin/donors">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs font-semibold">
                <HeartHandshake className="size-3.5" />
                Donor Oversight
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <Alert className="border-border/60 bg-muted/30">
        <Lock className="size-4 text-primary" />
        <AlertTitle className="font-semibold text-sm">
          Server-Side Role Enforcement
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Administrative routes require verified server-side claims. Client-provided roles or parameters are strictly untrusted and stripped at runtime.
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
 
       {/* Notification Outbox & Reconciliation Operations */}
       {isPrivileged && (
         <OutboxOperationsCard
           initialMetrics={outboxMetrics}
           initialEvents={recentOutboxEvents}
         />
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
