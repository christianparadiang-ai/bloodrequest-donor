import Link from "next/link";
import { FormattedBloodRequest, RequestStatus, UrgencyLevel } from "@/lib/supabase/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Droplet,
  Building2,
  Clock,
  MapPin,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

interface RequestCardProps {
  request: FormattedBloodRequest;
}

export function getStatusBadge(status: RequestStatus) {
  switch (status) {
    case "DRAFT":
      return (
        <Badge variant="outline" className="text-zinc-600 dark:text-zinc-400 border-zinc-400/50">
          Draft
        </Badge>
      );
    case "SUBMITTED":
      return (
        <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
          Submitted
        </Badge>
      );
    case "UNDER_REVIEW":
      return (
        <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
          Under Review
        </Badge>
      );
    case "ACTIVE":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
          Active
        </Badge>
      );
    case "PARTIALLY_COMMITTED":
    case "FULLY_COMMITTED":
      return (
        <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20">
          Committed
        </Badge>
      );
    case "FULFILLED":
      return (
        <Badge className="bg-emerald-600 text-white">
          Fulfilled
        </Badge>
      );
    case "CANCELLED":
      return (
        <Badge variant="outline" className="text-muted-foreground line-through">
          Cancelled
        </Badge>
      );
    case "EXPIRED":
      return (
        <Badge variant="destructive" className="opacity-75">
          Expired
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge variant="destructive">
          Rejected
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function getUrgencyBadge(urgency: UrgencyLevel) {
  switch (urgency) {
    case "CRITICAL_STAT":
      return (
        <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider">
          <ShieldAlert className="size-3 mr-1" />
          Critical STAT
        </Badge>
      );
    case "URGENT":
      return (
        <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-400 text-[10px] uppercase font-semibold">
          Urgent
        </Badge>
      );
    case "ROUTINE":
      return (
        <Badge variant="outline" className="text-muted-foreground text-[10px] uppercase">
          Routine
        </Badge>
      );
    default:
      return null;
  }
}

export function RequestCard({ request }: RequestCardProps) {
  const neededByDate = new Date(request.requiredBy).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card className="border-border/60 hover:border-primary/40 transition-colors shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {getUrgencyBadge(request.urgencyLevel)}
              {getStatusBadge(request.status)}
              {request.isOwner && (
                <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                  Your Requisition
                </Badge>
              )}
            </div>

            <CardTitle className="text-base pt-1">
              Patient: {request.patientName}
            </CardTitle>
            <CardDescription className="text-xs flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="size-3.5" />
              {request.hospitalName} &bull; {request.hospitalCity}
              {request.province ? `, ${request.province}` : ""}
            </CardDescription>
          </div>

          <div className="text-right">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary/10 text-primary font-bold text-base">
              <Droplet className="size-4 fill-primary" />
              {request.bloodGroup}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {request.unitsRequested} {request.unitsRequested === 1 ? "Unit" : "Units"} Needed
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground border-t border-border/50 pt-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5 text-muted-foreground" />
              Needed by: {neededByDate}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5 text-muted-foreground" />
              {request.hospitalCity}
            </span>
          </div>

          <Link href={`/requests/${request.id}`}>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs font-semibold text-primary hover:text-primary hover:bg-primary/10">
              View Details
              <ArrowRight className="size-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
