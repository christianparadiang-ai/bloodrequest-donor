import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { getAnalyticsReport } from "@/lib/reports/service";
import { ReportsClient } from "@/components/admin/reports-client";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";

export const instant = false;

import { resolveUserRole } from "@/lib/auth";

export default async function AdminReportsPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  const userRole = await resolveUserRole(user.id, primaryEmail);

  const isPrivileged =
    primaryEmail === "christian.paradiang@urios.edu.ph" ||
    ["HOSPITAL_STAFF", "MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(userRole);

  if (!isPrivileged) {
    return (
      <div className="flex-1 py-12 px-4 max-w-2xl mx-auto w-full text-center space-y-6">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <Lock className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Access Restricted</h1>
          <p className="text-sm text-muted-foreground">
            Operational analytics and raw CSV reports require authorized clinical hospital staff, moderator, or administrator credentials.
          </p>
        </div>
        <div>
          <Link href="/dashboard">
            <Button variant="outline" className="gap-1.5">
              <ArrowLeft className="size-4" />
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Fetch initial summary for the current month
  const reportRes = await getAnalyticsReport({
    clerkUserId: user.id,
    periodType: "month",
    year: new Date().getUTCFullYear(),
    month: new Date().getUTCMonth() + 1,
  });

  if (!reportRes.success || !reportRes.data) {
    return (
      <div className="flex-1 py-10 px-4 max-w-6xl mx-auto w-full space-y-6">
        <Alert className="border-destructive/50 text-destructive bg-destructive/10">
          <AlertTitle className="font-semibold">Unable to Load Operational Reports</AlertTitle>
          <AlertDescription className="text-xs">
            {reportRes.error || "Database query failed. Please verify credentials."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex-1 py-10 px-4 max-w-6xl mx-auto w-full space-y-8">
      {/* Top Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Admin Hub
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-extrabold tracking-tight">Operational Reports & Analytics</h1>
              <Badge variant="outline" className="text-xs">
                Role: {userRole}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Real-time database analytics on requisitions, voluntary donor participation, verified collections, and points recognition.
            </p>
          </div>
        </div>
      </div>

      {/* Safety Notice */}
      <Alert className="border-border/60 bg-muted/30">
        <ShieldCheck className="size-4 text-primary" />
        <AlertTitle className="font-semibold text-sm">
          Auditable Database Aggregation & Privacy Guardrails
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          All summaries and exported files reflect authorized database records. Exported files strictly exclude sensitive donor phone numbers, full addresses, and identity documents.
        </AlertDescription>
      </Alert>

      {/* Client Reports Component with Date Range Controls & CSV Export */}
      <ReportsClient initialSummary={reportRes.data} />
    </div>
  );
}
