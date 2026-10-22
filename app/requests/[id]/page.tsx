import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export const instant = false;
import { getBloodRequestById } from "@/lib/requests/service";
import { getPotentialMatchesForRequest } from "@/lib/matching/service";
import { getRequestCommitments } from "@/lib/commitments/service";
import { getRequestFulfillmentSummary } from "@/lib/donations/service";
import { UserRole, PotentialDonorMatch, FormattedDonorCommitment } from "@/lib/supabase/types";
import { getStatusBadge, getUrgencyBadge } from "@/components/requests/request-card";
import { RequestActionsClient } from "@/components/requests/request-actions-client";
import { PotentialMatchesCard } from "@/components/matching/potential-matches-card";
import { RequestCommitmentsCard } from "@/components/requests/request-commitments-card";
import { RequestFulfillmentCard } from "@/components/requests/request-fulfillment-card";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  Droplet,
  Building2,
  Clock,
  Phone,
  FileText,
  AlertTriangle,
  ShieldCheck,
  Calendar,
} from "lucide-react";
import { resolveUserRole } from "@/lib/auth";

interface RequestDetailsPageProps {
  params: Promise<{ id: string }>;
}

export default async function RequestDetailsPage({ params }: RequestDetailsPageProps) {
  const { id } = await params;
  const user = await currentUser();

  let viewerRole: UserRole = "USER";
  if (user) {
    const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
    viewerRole = await resolveUserRole(user.id, primaryEmail);
  }

  const { request, authorized, error } = await getBloodRequestById(id, user?.id);

  if (!authorized || !request) {
    return (
      <div className="flex-1 py-12 px-4 max-w-2xl mx-auto w-full text-center space-y-6">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <AlertTriangle className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Requisition Inaccessible</h1>
          <p className="text-sm text-muted-foreground">
            {error || "The requested requisition does not exist or you do not have permission to view it."}
          </p>
        </div>
        <div>
          <Link href="/requests">
            <Button variant="outline" className="gap-1.5">
              <ArrowLeft className="size-4" />
              Return to Requisitions
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(request.isOwner);

  const neededByDate = new Date(request.requiredBy).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const createdDate = new Date(request.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let initialMatches: PotentialDonorMatch[] = [];
  if (request.status === "ACTIVE") {
    try {
      const matchRes = await getPotentialMatchesForRequest(request.id, user?.id || null);
      initialMatches = matchRes.matches || [];
    } catch {
      initialMatches = [];
    }
  }

  const isPrivileged = [
    "MODERATOR",
    "ADMIN",
    "SUPER_ADMIN",
    "HOSPITAL_STAFF",
  ].includes(viewerRole);

  let commitments: FormattedDonorCommitment[] = [];
  let fulfillmentSummary = null;
  if (user && (isOwner || isPrivileged)) {
    try {
      const commitRes = await getRequestCommitments(request.id, user.id);
      if (commitRes.success) {
        commitments = commitRes.commitments;
      }
    } catch {
      commitments = [];
    }

    try {
      fulfillmentSummary = await getRequestFulfillmentSummary(request.id, user.id);
    } catch {
      fulfillmentSummary = null;
    }
  }

  return (
    <div className="flex-1 py-10 px-4 max-w-4xl mx-auto w-full space-y-8">
      {/* Navigation */}
      <div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Requisitions Directory
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Requisition #{request.id.slice(0, 8).toUpperCase()}
              </h1>
              {getStatusBadge(request.status)}
              {getUrgencyBadge(request.urgencyLevel)}
            </div>
            <p className="text-sm text-muted-foreground">
              Patient: <span className="font-semibold text-foreground">{request.patientName}</span> &bull; Created on {createdDate}
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Droplet className="size-5 fill-primary" />
            <span className="text-xl font-bold">{request.bloodGroup}</span>
            <span className="text-xs font-medium text-foreground/80">
              ({request.unitsRequested} {request.unitsRequested === 1 ? "unit" : "units"} needed)
            </span>
          </div>
        </div>
      </div>

      {/* Medical Safety Boundary Advisory */}
      <Alert className="border-border/60 bg-muted/30">
        <ShieldCheck className="size-4 text-primary" />
        <AlertTitle className="text-xs font-semibold">
          Medical Safety & Operational Verification
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Life Drop coordinates volunteer donor contact. Requisitions undergo administrative verification before volunteer notification. This service does not replace hospital blood bank testing or crossmatching.
        </AlertDescription>
      </Alert>

      {/* Cancellation or Rejection Alerts */}
      {request.status === "CANCELLED" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs font-semibold">Requisition Cancelled</AlertTitle>
          <AlertDescription className="text-xs">
            Reason: {request.cancellationReason || "Cancelled by requester."}
          </AlertDescription>
        </Alert>
      )}

      {request.status === "REJECTED" && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs font-semibold">Requisition Verification Rejected</AlertTitle>
          <AlertDescription className="text-xs">
            Reason: {request.rejectionReason || "Verification criteria not satisfied."}
          </AlertDescription>
        </Alert>
      )}

      {/* Lifecycle Progress Bar */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Requisition Lifecycle</CardTitle>
          <CardDescription className="text-xs">
            Workflow stages from initial intake to volunteer donor matching
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div
              className={`p-2.5 rounded-lg border ${
                request.status === "DRAFT"
                  ? "border-primary bg-primary/10 font-bold text-primary"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              1. Draft
            </div>
            <div
              className={`p-2.5 rounded-lg border ${
                request.status === "SUBMITTED"
                  ? "border-amber-500 bg-amber-500/10 font-bold text-amber-700 dark:text-amber-400"
                  : ["UNDER_REVIEW", "ACTIVE", "FULFILLED"].includes(request.status)
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              2. Submitted
            </div>
            <div
              className={`p-2.5 rounded-lg border ${
                request.status === "UNDER_REVIEW"
                  ? "border-blue-500 bg-blue-500/10 font-bold text-blue-700 dark:text-blue-400"
                  : ["ACTIVE", "FULFILLED"].includes(request.status)
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              3. Under Review
            </div>
            <div
              className={`p-2.5 rounded-lg border ${
                request.status === "ACTIVE"
                  ? "border-emerald-600 bg-emerald-600/10 font-bold text-emerald-700 dark:text-emerald-400"
                  : request.status === "FULFILLED"
                  ? "border-emerald-600 bg-emerald-600 text-white font-bold"
                  : "border-border/60 bg-muted/20 text-muted-foreground"
              }`}
            >
              4. Active Broadcast
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Hospital & Destination */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Hospital & Facility Destination</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Healthcare Facility</p>
              <p className="font-semibold text-foreground">{request.hospitalName}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">City / Municipality</p>
                <p className="font-medium text-foreground">{request.hospitalCity}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Province / Region</p>
                <p className="font-medium text-foreground">{request.province || "N/A"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Contact & Timeline */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Schedule & Contact</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="size-3" /> Needed By
              </p>
              <p className="font-semibold text-foreground">{neededByDate}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Contact Person</p>
                <p className="font-medium text-foreground">{request.contactName || "Attending Coordinator"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="size-3" /> Contact Phone
                </p>
                <p className="font-medium text-foreground">{request.contactNumber}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Blood Component Specifications */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Droplet className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Blood Component Requirements</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Component Type</p>
                <p className="font-semibold text-foreground">{request.bloodComponent.replace("_", " ")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Units Requested</p>
                <p className="font-semibold text-foreground">{request.unitsRequested}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
              <div>
                <p className="text-xs text-muted-foreground">Units Committed</p>
                <p className="font-medium text-foreground">{request.unitsCommitted}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Units Fulfilled</p>
                <p className="font-medium text-foreground">{request.unitsDonated}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Clinical Reason & Notes */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Clinical Reason & Notes</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Requisition Reason / Context</p>
              <p className="font-medium text-foreground">
                {request.requestReason || "Clinical emergency requisition."}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Additional Notes</p>
              <p className="text-muted-foreground italic text-xs">
                {request.medicalNotes || "No additional instructions provided."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Actions Card */}
      <Card className="border-border/60 bg-muted/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Requisition Management Actions</CardTitle>
              <CardDescription className="text-xs">
                {isOwner
                  ? "Manage draft submission or cancellation for your requisition"
                  : "Authorized review operations"}
              </CardDescription>
            </div>
            {isOwner && (
              <Badge variant="outline" className="text-[10px]">
                Owner Controls
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <RequestActionsClient
            request={request}
            viewerRole={viewerRole}
            isOwner={isOwner}
          />
        </CardContent>
      </Card>

      {/* Donor Responses & Operational Commitments */}
      {(isOwner || isPrivileged) && (
        <>
          <RequestCommitmentsCard
            commitments={commitments}
            unitsRequested={request.unitsRequested}
            unitsCommitted={request.unitsCommitted}
          />
          <RequestFulfillmentCard
            requestId={request.id}
            unitsRequested={request.unitsRequested}
            unitsCommitted={request.unitsCommitted}
            unitsDonated={fulfillmentSummary?.unitsDonated || request.unitsDonated || 0}
            requestStatus={fulfillmentSummary?.requestStatus || request.status}
            donations={fulfillmentSummary?.donations || []}
            commitments={commitments}
            viewerRole={viewerRole}
            isOwner={isOwner}
          />
        </>
      )}

      {/* Potential Donor Matches (Discovery Engine) */}
      <PotentialMatchesCard
        requestId={request.id}
        initialMatches={initialMatches}
        isRequestActive={request.status === "ACTIVE"}
        canTriggerDiscovery={isOwner || isPrivileged}
      />
    </div>
  );
}
