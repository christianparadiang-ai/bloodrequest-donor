"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  HeartHandshake,
  ShieldAlert,
  ShieldCheck,
  MapPin,
  Compass,
  Edit3,
  Calendar,
  CheckCircle2,
  Loader2,
  BellRing,
} from "lucide-react";
import { FormattedDonorData, ProfileCompletionStatus } from "@/lib/donor/service";
import { toggleAvailabilityAction, toggleConsentAction } from "@/lib/donor/actions";

interface DonorDashboardClientProps {
  donor: FormattedDonorData;
  completion: ProfileCompletionStatus;
}

export function DonorDashboardClient({
  donor,
  completion,
}: DonorDashboardClientProps) {
  const [isAvailable, setIsAvailable] = useState<boolean>(donor.isAvailable);
  const [consentToContact, setConsentToContact] = useState<boolean>(
    donor.consentToContact
  );
  const [isUpdatingAvail, startAvailTransition] = useTransition();
  const [isUpdatingConsent, startConsentTransition] = useTransition();
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const handleToggleAvailability = (newVal: boolean) => {
    setIsAvailable(newVal);
    startAvailTransition(async () => {
      const res = await toggleAvailabilityAction(newVal);
      if (!res.success) {
        setIsAvailable(!newVal); // rollback
        setFeedbackMessage(res.error || "Failed to update availability.");
      } else {
        setFeedbackMessage(
          newVal
            ? "Status updated: You are now marked as AVAILABLE for matching discovery."
            : "Status updated: You are now UNAVAILABLE. Alert broadcasts paused."
        );
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    });
  };

  const handleToggleConsent = (newVal: boolean) => {
    setConsentToContact(newVal);
    startConsentTransition(async () => {
      const res = await toggleConsentAction(newVal);
      if (!res.success) {
        setConsentToContact(!newVal); // rollback
        setFeedbackMessage(res.error || "Failed to update contact consent.");
      } else {
        setFeedbackMessage(
          newVal
            ? "Contact consent granted: Emergency requests within your radius will reach you."
            : "Contact consent withheld: You will not receive donor contact notifications."
        );
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Medical Boundary Alert */}
      <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
          Clinical Safety Invariant
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
          Availability does not constitute clinical eligibility. All donors undergo laboratory screening and physical medical qualification at the collection facility prior to any blood draw.
        </AlertDescription>
      </Alert>

      {/* Action Feedback Banner */}
      {feedbackMessage && (
        <Alert className="border-border bg-muted/60 text-foreground transition-all">
          <CheckCircle2 className="size-4 text-primary" />
          <AlertTitle className="text-xs font-semibold">Settings Updated</AlertTitle>
          <AlertDescription className="text-xs">{feedbackMessage}</AlertDescription>
        </Alert>
      )}

      {/* Top Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Completion Card */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1">
              <HeartHandshake className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Profile Status
              <Badge
                variant={completion.isComplete ? "outline" : "secondary"}
                className={
                  completion.isComplete
                    ? "text-emerald-600 border-emerald-300 dark:border-emerald-800 text-[11px]"
                    : "text-amber-600 border-amber-300 text-[11px]"
                }
              >
                {completion.percentage}% Complete
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              {completion.statusLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Progress indicator */}
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${completion.percentage}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground flex items-center justify-between pt-1">
              <span>{completion.isComplete ? "All required details logged" : "Incomplete sections"}</span>
              <Link href="/donor/onboarding">
                <Button variant="ghost" size="xs" className="gap-1 text-primary hover:text-primary/80">
                  <Edit3 className="size-3" />
                  Edit
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Operational Availability Toggle Card */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="size-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-1">
              <BellRing className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Operational Status
              <Badge
                variant={isAvailable ? "default" : "secondary"}
                className={
                  isAvailable
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white text-[10px]"
                    : "text-muted-foreground text-[10px]"
                }
              >
                {isAvailable ? "AVAILABLE" : "UNAVAILABLE"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Controls receipt of emergency donor match alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-foreground">
                {isAvailable ? "Active for alerts" : "Alerts paused"}
              </span>
              <div className="flex items-center gap-2">
                {isUpdatingAvail && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                <Switch
                  checked={isAvailable}
                  onCheckedChange={handleToggleAvailability}
                  disabled={isUpdatingAvail}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Operational toggle only; does not claim clinical eligibility.
            </p>
          </CardContent>
        </Card>

        {/* Contact Consent Card */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="size-9 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center mb-1">
              <ShieldCheck className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Contact Consent
              <Badge
                variant={consentToContact ? "outline" : "destructive"}
                className={
                  consentToContact
                    ? "text-blue-600 border-blue-300 dark:border-blue-800 text-[10px]"
                    : "text-[10px]"
                }
              >
                {consentToContact ? "CONSENT ACTIVE" : "WITHHELD"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Permission for emergency requisition contact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-foreground">
                {consentToContact ? "Contact permitted" : "Contact disabled"}
              </span>
              <div className="flex items-center gap-2">
                {isUpdatingConsent && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                <Switch
                  checked={consentToContact}
                  onCheckedChange={handleToggleConsent}
                  disabled={isUpdatingConsent}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Your contact info remains private and is never shown publicly.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Profile Details Card */}
      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">Donor Profile Details</CardTitle>
            <CardDescription className="text-xs">
              Configured information for potential match discovery.
            </CardDescription>
          </div>
          <Link href="/donor/onboarding">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Edit3 className="size-3.5" />
              Edit Profile
            </Button>
          </Link>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {/* Blood Group */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Blood Group (ABO+Rh)</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-primary tracking-tight">
                  {donor.bloodGroup}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  Potential Match Type
                </Badge>
              </div>
            </div>

            {/* Service Radius */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Compass className="size-3 text-primary" /> Service Radius
              </span>
              <p className="text-xl font-bold text-foreground">
                {donor.serviceRadiusKm} km
              </p>
              <p className="text-[11px] text-muted-foreground">Notification alert radius</p>
            </div>

            {/* Location */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <MapPin className="size-3 text-primary" /> Municipality & Province
              </span>
              <p className="text-base font-semibold text-foreground">
                {donor.city}
              </p>
              <p className="text-xs text-muted-foreground">
                {donor.province || "Province unspecified"}
              </p>
            </div>

            {/* Donation Records */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Calendar className="size-3 text-primary" /> Verified Donations
              </span>
              <p className="text-xl font-bold text-foreground">
                {donor.totalDonationsCount}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {donor.lastDonationDate
                  ? `Last draw: ${donor.lastDonationDate}`
                  : "No clinical donations recorded"}
              </p>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Safety & Operational Summary */}
          <div className="rounded-xl bg-muted/30 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" />
                <span>Deterministic Match Eligibility Ready</span>
              </div>
              <p className="text-muted-foreground">
                Matching algorithms in Milestone 2 will evaluate ABO/Rh compatibility, current operational availability, and {donor.serviceRadiusKm} km coverage.
              </p>
            </div>

            <Link href="/requests">
              <Button size="sm" variant="secondary" className="whitespace-nowrap">
                Browse Blood Requests
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
