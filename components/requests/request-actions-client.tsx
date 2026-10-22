"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  submitDraftBloodRequestAction,
  cancelBloodRequestAction,
  reviewBloodRequestAction,
} from "@/lib/requests/actions";
import { FormattedBloodRequest, UserRole } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Send,
  XCircle,
  CheckCircle,
  FileSearch,
  CheckCheck,
  RotateCcw,
  Loader2,
  AlertTriangle,
} from "lucide-react";

interface RequestActionsClientProps {
  request: FormattedBloodRequest;
  viewerRole?: UserRole;
  isOwner: boolean;
}

export function RequestActionsClient({
  request,
  viewerRole = "USER",
  isOwner,
}: RequestActionsClientProps) {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cancel Dialog State
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");

  // Reject Dialog State
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const isPrivileged = [
    "MODERATOR",
    "ADMIN",
    "SUPER_ADMIN",
    "HOSPITAL_STAFF",
  ].includes(viewerRole);

  // 1. Submit Draft
  const handleSubmitDraft = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await submitDraftBloodRequestAction(request.id);
      if (!res.success) {
        setErrorMessage(res.error || "Failed to submit draft.");
      } else {
        router.refresh();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error submitting draft.");
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Cancel Requisition
  const handleConfirmCancel = async () => {
    if (!cancellationReason.trim()) {
      setErrorMessage("Please specify a cancellation reason.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await cancelBloodRequestAction(request.id, {
        cancellation_reason: cancellationReason,
      });
      if (!res.success) {
        setErrorMessage(res.error || "Failed to cancel request.");
      } else {
        setIsCancelOpen(false);
        router.refresh();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error cancelling requisition.");
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Review Operations
  const handleReviewTransition = async (
    targetStatus: "UNDER_REVIEW" | "ACTIVE" | "REJECTED" | "SUBMITTED" | "FULFILLED",
    notes?: string
  ) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await reviewBloodRequestAction(request.id, {
        target_status: targetStatus,
        reviewer_notes: notes || undefined,
        rejection_reason: targetStatus === "REJECTED" ? rejectionReason : undefined,
      });

      if (!res.success) {
        setErrorMessage(res.error || "Review operation failed.");
      } else {
        if (targetStatus === "REJECTED") setIsRejectOpen(false);
        router.refresh();
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error performing review transition.");
    } finally {
      setIsLoading(false);
    }
  };

  const canCancel =
    (isOwner || isPrivileged) &&
    ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE"].includes(request.status);

  return (
    <div className="space-y-4">
      {errorMessage && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs font-semibold">Action Failed</AlertTitle>
          <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {/* OWNER DRAFT ACTION: SUBMIT */}
        {isOwner && request.status === "DRAFT" && (
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-1.5"
            disabled={isLoading}
            onClick={handleSubmitDraft}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Submit for Verification
          </Button>
        )}

        {/* CANCEL ACTION (Owner or Privileged) */}
        {canCancel && (
          <>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 gap-1.5"
              onClick={() => setIsCancelOpen(true)}
            >
              <XCircle className="size-4" />
              Cancel Requisition
            </Button>
            <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
              <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Cancel Blood Requisition</DialogTitle>
                <DialogDescription>
                  Are you sure you want to cancel this request? This action transitions the request to a terminal CANCELLED state.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="cancel-reason">Cancellation Reason</Label>
                <Textarea
                  id="cancel-reason"
                  placeholder="e.g. Patient condition resolved / units fulfilled externally"
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setIsCancelOpen(false)}
                  disabled={isLoading}
                >
                  Keep Request
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmCancel}
                  disabled={isLoading || !cancellationReason.trim()}
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                  Confirm Cancellation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

        {/* PRIVILEGED REVIEW ACTIONS */}
        {isPrivileged && (
          <>
            {/* SUBMITTED -> UNDER_REVIEW */}
            {request.status === "SUBMITTED" && (
              <Button
                variant="secondary"
                className="gap-1.5"
                disabled={isLoading}
                onClick={() => handleReviewTransition("UNDER_REVIEW")}
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileSearch className="size-4" />
                )}
                Begin Verification Review
              </Button>
            )}

            {/* UNDER_REVIEW -> ACTIVE */}
            {request.status === "UNDER_REVIEW" && (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 font-semibold"
                disabled={isLoading}
                onClick={() => handleReviewTransition("ACTIVE")}
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle className="size-4" />
                )}
                Approve & Activate Requisition
              </Button>
            )}

            {/* UNDER_REVIEW -> RETURN TO SUBMITTED */}
            {request.status === "UNDER_REVIEW" && (
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={isLoading}
                onClick={() => handleReviewTransition("SUBMITTED")}
              >
                <RotateCcw className="size-3.5" />
                Return to Submitted
              </Button>
            )}

            {/* REJECT DIALOG */}
            {["SUBMITTED", "UNDER_REVIEW"].includes(request.status) && (
              <>
                <Button
                  variant="outline"
                  className="text-amber-600 dark:text-amber-400 gap-1.5"
                  onClick={() => setIsRejectOpen(true)}
                >
                  <XCircle className="size-4" />
                  Reject Requisition
                </Button>
                <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
                  <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Reject Blood Requisition</DialogTitle>
                    <DialogDescription>
                      Specify the clinical or administrative reason for rejecting this requisition.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="reject-reason">Rejection Reason</Label>
                    <Textarea
                      id="reject-reason"
                      placeholder="e.g. Unverified hospital affiliation / Incomplete physician requisition"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsRejectOpen(false)}
                      disabled={isLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={isLoading || !rejectionReason.trim()}
                      onClick={() => handleReviewTransition("REJECTED")}
                    >
                      {isLoading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                      Confirm Rejection
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}

            {/* ACTIVE -> FULFILLED */}
            {request.status === "ACTIVE" && (
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 font-semibold"
                disabled={isLoading}
                onClick={() => handleReviewTransition("FULFILLED")}
              >
                <CheckCheck className="size-4" />
                Mark as Fulfilled
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
