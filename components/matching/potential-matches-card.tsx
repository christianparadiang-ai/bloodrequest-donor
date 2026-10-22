"use client";

import { useState } from "react";
import { PotentialDonorMatch } from "@/lib/supabase/types";
import { triggerDonorDiscoveryAction } from "@/lib/matching/actions";
import { dispatchDonorNotificationAction } from "@/lib/notifications/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Droplet,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Info,
  Send,
  BellRing,
} from "lucide-react";

interface PotentialMatchesCardProps {
  requestId: string;
  initialMatches: PotentialDonorMatch[];
  isRequestActive: boolean;
  canTriggerDiscovery: boolean;
}

export function PotentialMatchesCard({
  requestId,
  initialMatches,
  isRequestActive,
  canTriggerDiscovery,
}: PotentialMatchesCardProps) {
  const [matches, setMatches] = useState<PotentialDonorMatch[]>(initialMatches);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedCandidateForDispatch, setSelectedCandidateForDispatch] =
    useState<PotentialDonorMatch | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleRunDiscovery = async () => {
    setIsRefreshing(true);
    setErrorMessage(null);
    setDispatchFeedback(null);

    try {
      const res = await triggerDonorDiscoveryAction(requestId);
      if (!res.success || !res.result) {
        setErrorMessage(res.error || "Failed to discover potential donors.");
      } else {
        setMatches(res.result.matches || []);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "Error executing donor discovery."
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleConfirmDispatch = async () => {
    if (!selectedCandidateForDispatch?.matchId) {
      setDispatchFeedback({
        type: "error",
        message: "Candidate match reference not found. Please refresh discovery first.",
      });
      setSelectedCandidateForDispatch(null);
      return;
    }

    setIsDispatching(true);
    setDispatchFeedback(null);

    try {
      const res = await dispatchDonorNotificationAction(
        requestId,
        selectedCandidateForDispatch.matchId
      );

      if (!res.success) {
        setDispatchFeedback({
          type: "error",
          message: res.error || "Failed to dispatch notification.",
        });
      } else {
        setMatches((prev) =>
          prev.map((c) =>
            c.matchId === selectedCandidateForDispatch.matchId
              ? { ...c, status: "NOTIFIED" }
              : c
          )
        );
        setDispatchFeedback({
          type: "success",
          message: res.alreadyDispatched
            ? `Candidate ${selectedCandidateForDispatch.safeDonorCode} was already notified previously.`
            : `Notification successfully dispatched to potential candidate ${selectedCandidateForDispatch.safeDonorCode}.`,
        });
        setSelectedCandidateForDispatch(null);
      }
    } catch (err: unknown) {
      setDispatchFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Error dispatching notification.",
      });
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Users className="size-4" />
              </div>
              <CardTitle className="text-lg">Potential Donor Matches</CardTitle>
              <Badge variant="outline" className="text-xs">
                {matches.length} Discovered
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Deterministic, explainable candidate discovery based on ABO/Rh compatibility, availability, and service radius.
            </CardDescription>
          </div>

          {isRequestActive && canTriggerDiscovery && (
            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshing}
              onClick={handleRunDiscovery}
              className="gap-1.5 text-xs font-semibold h-8"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh Discovery
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Medical Safety Disclaimer Alert */}
        <Alert className="border-border/60 bg-muted/40">
          <ShieldCheck className="size-4 text-primary shrink-0" />
          <AlertTitle className="text-xs font-semibold">
            Non-Clinical Candidate Discovery Policy
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            This list reflects operational suitability and ABO/Rh discovery criteria. It does NOT constitute medical eligibility, clinical clearance, or guaranteed compatibility. Hospital staff must perform all clinical testing and cross-matching.
          </AlertDescription>
        </Alert>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle className="text-xs font-semibold">Discovery Error</AlertTitle>
            <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
          </Alert>
        )}

        {dispatchFeedback && (
          <Alert
            variant={dispatchFeedback.type === "success" ? "default" : "destructive"}
            className={
              dispatchFeedback.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300"
                : ""
            }
          >
            {dispatchFeedback.type === "success" ? (
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="size-4" />
            )}
            <AlertTitle className="text-xs font-semibold">
              {dispatchFeedback.type === "success" ? "Dispatch Completed" : "Dispatch Failed"}
            </AlertTitle>
            <AlertDescription className="text-xs">{dispatchFeedback.message}</AlertDescription>
          </Alert>
        )}

        {/* State: Request is NOT Active */}
        {!isRequestActive && (
          <div className="p-6 rounded-lg border border-dashed border-border/80 text-center space-y-2">
            <div className="size-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
              <Info className="size-5" />
            </div>
            <h4 className="text-sm font-semibold">Requisition Under Verification</h4>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Potential donor matching is only active for <strong>ACTIVE</strong> requisitions. Once the requisition completes clinical verification review, compatible volunteer candidates will be discovered automatically.
            </p>
          </div>
        )}

        {/* State: Request IS Active but No Candidates */}
        {isRequestActive && matches.length === 0 && (
          <div className="p-8 rounded-lg border border-dashed border-border/80 text-center space-y-3">
            <div className="size-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
              <Users className="size-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">No Potential Candidates Discovered</h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                No currently registered donors match the compatibility, active availability, contact consent, and service radius requirements for this requisition.
              </p>
            </div>
            {canTriggerDiscovery && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunDiscovery}
                disabled={isRefreshing}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className={`size-3 ${isRefreshing ? "animate-spin" : ""}`} />
                Re-scan Donor Registry
              </Button>
            )}
          </div>
        )}

        {/* State: Request IS Active and Candidates Found */}
        {isRequestActive && matches.length > 0 && (
          <div className="space-y-3">
            {matches.map((candidate, idx) => {
              const isNotified = candidate.status === "NOTIFIED";

              return (
                <div
                  key={candidate.donorId || idx}
                  className="p-4 rounded-xl border border-border/70 hover:border-primary/40 bg-card transition-colors space-y-3 shadow-2xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center font-mono text-xs font-bold">
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            {candidate.safeDonorCode}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                          >
                            <CheckCircle2 className="size-3 mr-1" />
                            Potential Candidate
                          </Badge>
                          {isNotified && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            >
                              <Send className="size-3 mr-1" />
                              Alert Dispatched
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="size-3" />
                          {candidate.isExactLocation && candidate.distanceKm !== null
                            ? `~${candidate.distanceKm} km away`
                            : `${candidate.city}${candidate.province ? `, ${candidate.province}` : ""} (Regional Area)`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-sm">
                          <Droplet className="size-3.5 fill-primary" />
                          {candidate.bloodGroup}
                        </div>
                      </div>

                      <div className="text-right pl-2 border-l border-border/50">
                        <div className="text-xs font-bold text-foreground">
                          {candidate.discoveryScore} / 100
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Match Score
                        </div>
                      </div>

                      <div className="pl-2 border-l border-border/50">
                        {isNotified ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled
                            className="h-8 text-xs gap-1 opacity-75 font-medium"
                          >
                            <Send className="size-3" />
                            Notified
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1 font-semibold hover:bg-primary hover:text-primary-foreground"
                            disabled={!isRequestActive || !candidate.matchId}
                            onClick={() => setSelectedCandidateForDispatch(candidate)}
                          >
                            <Send className="size-3" />
                            Notify Donor
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Explainable Reasons */}
                  <div className="pt-2 border-t border-border/40 text-xs space-y-1">
                    <p className="font-medium text-foreground text-[11px]">Match Factors:</p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      {candidate.reasons.map((reason, rIdx) => (
                        <li key={rIdx} className="flex items-center gap-1.5">
                          <span className="size-1 rounded-full bg-primary/70 shrink-0" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Confirmation Dialog for Notification Dispatch */}
        <Dialog
          open={!!selectedCandidateForDispatch}
          onOpenChange={(open) => {
            if (!open && !isDispatching) {
              setSelectedCandidateForDispatch(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-4 text-primary" />
                Dispatch Potential Donor Alert
              </DialogTitle>
              <DialogDescription className="text-xs">
                Send an in-app operational notification to candidate{" "}
                <strong>{selectedCandidateForDispatch?.safeDonorCode}</strong> (
                {selectedCandidateForDispatch?.bloodGroup}).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <Alert className="border-border/60 bg-muted/40">
                <ShieldCheck className="size-4 text-primary shrink-0" />
                <AlertTitle className="text-xs font-semibold">
                  Privacy & Operational Notice
                </AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground mt-0.5">
                  The donor will receive a non-clinical alert stating that an active requisition
                  matches their blood group in this region. No patient identity or donor contact
                  details will be exposed.
                </AlertDescription>
              </Alert>

              <p className="text-muted-foreground">
                Do you want to proceed with dispatching this notification? Accidental duplicate
                alerts are automatically prevented.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCandidateForDispatch(null)}
                disabled={isDispatching}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmDispatch}
                disabled={isDispatching}
                className="gap-1.5"
              >
                {isDispatching ? (
                  <>
                    <RefreshCw className="size-3.5 animate-spin" />
                    Dispatching...
                  </>
                ) : (
                  <>
                    <Send className="size-3.5" />
                    Confirm & Dispatch Alert
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
