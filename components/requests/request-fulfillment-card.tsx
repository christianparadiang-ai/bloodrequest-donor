"use client";

import { useState } from "react";
import {
  FormattedDonation,
  FormattedDonorCommitment,
  UserRole,
} from "@/lib/supabase/types";
import { DONATION_SAFETY_DISCLAIMER } from "@/lib/donations/types";
import {
  scheduleDonationAction,
  markDonationAttendedAction,
  recordDonationAction,
  cancelDonationAppointmentAction,
  markDonationNoShowAction,
} from "@/lib/donations/actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ShieldCheck,
  Calendar,
  AlertTriangle,
  Droplet,
  UserCheck,
} from "lucide-react";

interface RequestFulfillmentCardProps {
  requestId?: string;
  unitsRequested: number;
  unitsCommitted: number;
  unitsDonated: number;
  requestStatus?: string;
  donations: FormattedDonation[];
  commitments: FormattedDonorCommitment[];
  viewerRole: UserRole;
  isOwner?: boolean;
}

export function RequestFulfillmentCard({
  unitsRequested,
  unitsCommitted,
  unitsDonated,
  donations,
  commitments,
  viewerRole,
}: RequestFulfillmentCardProps) {
  const isPrivileged = [
    "HOSPITAL_STAFF",
    "MODERATOR",
    "ADMIN",
    "SUPER_ADMIN",
  ].includes(viewerRole);

  const [localDonations, setLocalDonations] = useState<FormattedDonation[]>(donations);
  const [localUnitsDonated, setLocalUnitsDonated] = useState<number>(unitsDonated);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Dialog states
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedCommitmentId, setSelectedCommitmentId] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [facilityName, setFacilityName] = useState<string>("");
  const [scheduleNotes, setScheduleNotes] = useState<string>("");

  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [selectedDonationId, setSelectedDonationId] = useState<string>("");
  const [unitsToRecord, setUnitsToRecord] = useState<number>(1);
  const [componentType, setComponentType] = useState<string>("WHOLE_BLOOD");
  const [recordNotes, setRecordNotes] = useState<string>("");

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelDonationId, setCancelDonationId] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");

  const remainingUnits = Math.max(0, unitsRequested - localUnitsDonated);
  const fulfillmentPercentage = unitsRequested > 0
    ? Math.min(100, Math.round((localUnitsDonated / unitsRequested) * 100))
    : 0;
  const isFulfilled = localUnitsDonated >= unitsRequested && unitsRequested > 0;

  // Filter commitments that don't have an active donation
  const activeDonationCommitmentIds = new Set(
    localDonations
      .filter((d) => d.status !== "CANCELLED" && d.status !== "NO_SHOW")
      .map((d) => d.commitmentId)
  );

  const schedulableCommitments = commitments.filter(
    (c) =>
      (c.status === "ACCEPTED" || c.status === "PENDING") &&
      !activeDonationCommitmentIds.has(c.id)
  );

  // Handlers
  async function handleScheduleSubmit() {
    if (!selectedCommitmentId) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await scheduleDonationAction({
        commitmentId: selectedCommitmentId,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        facilityName: facilityName || undefined,
        notes: scheduleNotes || undefined,
      });
      if (!res.success) {
        setActionError(res.error || "Failed to schedule donation.");
      } else if (res.donation) {
        setLocalDonations((prev) => [res.donation!, ...prev.filter((d) => d.id !== res.donation!.id)]);
        setScheduleDialogOpen(false);
        setSelectedCommitmentId("");
      }
    } catch {
      setActionError("Unexpected network error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkAttended(donationId: string) {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await markDonationAttendedAction({ donationId });
      if (!res.success) {
        setActionError(res.error || "Failed to mark attendance.");
      } else if (res.donation) {
        setLocalDonations((prev) =>
          prev.map((d) => (d.id === donationId ? res.donation! : d))
        );
      }
    } catch {
      setActionError("Unexpected network error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordSubmit() {
    if (!selectedDonationId) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await recordDonationAction({
        donationId: selectedDonationId,
        unitsDonated: unitsToRecord,
        componentType,
        notes: recordNotes || undefined,
      });
      if (!res.success) {
        setActionError(res.error || "Failed to record donation.");
      } else if (res.donation) {
        setLocalDonations((prev) =>
          prev.map((d) => (d.id === selectedDonationId ? res.donation! : d))
        );
        if (res.fulfillmentSummary) {
          setLocalUnitsDonated(res.fulfillmentSummary.unitsDonated);
        }
        setRecordDialogOpen(false);
        setSelectedDonationId("");
      }
    } catch {
      setActionError("Unexpected network error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelSubmit() {
    if (!cancelDonationId || !cancelReason.trim()) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await cancelDonationAppointmentAction({
        donationId: cancelDonationId,
        reason: cancelReason,
      });
      if (!res.success) {
        setActionError(res.error || "Failed to cancel donation.");
      } else if (res.donation) {
        setLocalDonations((prev) =>
          prev.map((d) => (d.id === cancelDonationId ? res.donation! : d))
        );
        setCancelDialogOpen(false);
        setCancelDonationId("");
        setCancelReason("");
      }
    } catch {
      setActionError("Unexpected network error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkNoShow(donationId: string) {
    setIsSubmitting(true);
    setActionError(null);
    try {
      const res = await markDonationNoShowAction({ donationId });
      if (!res.success) {
        setActionError(res.error || "Failed to record no-show.");
      } else if (res.donation) {
        setLocalDonations((prev) =>
          prev.map((d) => (d.id === donationId ? res.donation! : d))
        );
      }
    } catch {
      setActionError("Unexpected network error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Droplet className="size-4 text-primary" />
              <CardTitle className="text-base font-bold tracking-tight">
                Requisition Fulfillment &amp; Donation Tracking
              </CardTitle>
              {isFulfilled ? (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-700 text-[10px]">
                  FULFILLED
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {fulfillmentPercentage}% Fulfilled
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Operational recording of donor appointments, attendance, and blood units collected.
            </CardDescription>
          </div>

          {isPrivileged && schedulableCommitments.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8"
              onClick={() => {
                setSelectedCommitmentId(schedulableCommitments[0].id);
                setScheduleDialogOpen(true);
              }}
            >
              <Calendar className="size-3.5" />
              Schedule Appointment
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-muted/40 border border-border/50">
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Requested
            </span>
            <p className="text-2xl font-bold tracking-tight">{unitsRequested} <span className="text-xs font-normal text-muted-foreground">units</span></p>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Committed
            </span>
            <p className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {unitsCommitted} <span className="text-xs font-normal text-muted-foreground">units</span>
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Donated / Recorded
            </span>
            <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {localUnitsDonated} <span className="text-xs font-normal text-muted-foreground">units</span>
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Remaining Need
            </span>
            <p className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {remainingUnits} <span className="text-xs font-normal text-muted-foreground">units</span>
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Fulfillment Progress</span>
            <span className="font-semibold text-foreground">
              {localUnitsDonated} of {unitsRequested} units recorded ({fulfillmentPercentage}%)
            </span>
          </div>
          <Progress value={fulfillmentPercentage} className="h-2" />
        </div>

        {/* Action Error Alert */}
        {actionError && (
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle className="size-4" />
            <AlertTitle className="text-xs font-semibold">Operation Error</AlertTitle>
            <AlertDescription className="text-xs">{actionError}</AlertDescription>
          </Alert>
        )}

        {/* Donations Table */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Operational Donation Records ({localDonations.length})
          </h4>

          {localDonations.length === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed rounded-lg bg-muted/20 text-muted-foreground text-xs space-y-1">
              <p className="font-medium text-foreground">No donation appointments scheduled yet.</p>
              <p>When interested donors commit, clinical staff can schedule donation appointments and record collected units.</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">Donor</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Units</TableHead>
                    <TableHead className="text-xs">Component</TableHead>
                    <TableHead className="text-xs">Scheduled / Attended</TableHead>
                    {isPrivileged && <TableHead className="text-xs text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localDonations.map((d) => (
                    <TableRow key={d.id} className="text-xs">
                      <TableCell className="font-mono font-medium">
                        {d.donorPseudonym}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            d.status === "RECORDED"
                              ? "default"
                              : d.status === "ATTENDED"
                              ? "secondary"
                              : d.status === "SCHEDULED"
                              ? "outline"
                              : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {d.status === "RECORDED" ? `${d.unitsDonated} unit(s)` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {d.componentType.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {d.status === "RECORDED" && d.recordedAt ? (
                          <span>Recorded {new Date(d.recordedAt).toLocaleDateString()}</span>
                        ) : d.status === "ATTENDED" && d.attendedAt ? (
                          <span>Attended {new Date(d.attendedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        ) : d.scheduledAt ? (
                          <span>{new Date(d.scheduledAt).toLocaleDateString()}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      {isPrivileged && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {d.status === "SCHEDULED" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px] gap-1"
                                  disabled={isSubmitting}
                                  onClick={() => handleMarkAttended(d.id)}
                                >
                                  <UserCheck className="size-3" />
                                  Mark Attended
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[11px] text-destructive hover:text-destructive"
                                  disabled={isSubmitting}
                                  onClick={() => handleMarkNoShow(d.id)}
                                >
                                  No-Show
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[11px]"
                                  disabled={isSubmitting}
                                  onClick={() => {
                                    setCancelDonationId(d.id);
                                    setCancelDialogOpen(true);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}

                            {d.status === "ATTENDED" && (
                              <Button
                                size="sm"
                                className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                disabled={isSubmitting}
                                onClick={() => {
                                  setSelectedDonationId(d.id);
                                  setRecordDialogOpen(true);
                                }}
                              >
                                <Droplet className="size-3" />
                                Record Donation
                              </Button>
                            )}

                            {d.status === "RECORDED" && (
                              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 justify-end">
                                <CheckCircle2 className="size-3" />
                                Completed
                              </span>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Non-Clinical Operational Safety Notice */}
        <Alert className="bg-muted/30 border-border/60 py-3">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <AlertTitle className="text-xs font-semibold">Operational Recordkeeping Notice</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
            {DONATION_SAFETY_DISCLAIMER}
          </AlertDescription>
        </Alert>
      </CardContent>

      {/* SCHEDULE APPOINTMENT DIALOG */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Schedule Donation Appointment</DialogTitle>
            <DialogDescription className="text-xs">
              Set the operational date and facility for an accepted donor commitment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Committed Donor</Label>
              <Select value={selectedCommitmentId} onValueChange={(val) => setSelectedCommitmentId(val || "")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select committed donor" />
                </SelectTrigger>
                <SelectContent>
                  {schedulableCommitments.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs font-mono">
                      {c.safeDonorCode} (Committed {new Date(c.committedAt).toLocaleDateString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Appointment Date &amp; Time</Label>
              <Input
                type="datetime-local"
                className="text-xs"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Facility / Blood Center</Label>
              <Input
                placeholder="Hospital Blood Bank"
                className="text-xs"
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Operational Notes (Optional)</Label>
              <Textarea
                placeholder="Instructions for arrival or room assignment"
                className="text-xs resize-none"
                rows={2}
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScheduleDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleScheduleSubmit}
              disabled={isSubmitting || !selectedCommitmentId}
            >
              {isSubmitting ? "Scheduling..." : "Confirm Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECORD DONATION DIALOG */}
      <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Record Blood Donation</DialogTitle>
            <DialogDescription className="text-xs">
              Record collected blood units. This will advance the requisition fulfillment total.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Units Collected</Label>
              <Input
                type="number"
                min={1}
                max={4}
                className="text-xs"
                value={unitsToRecord}
                onChange={(e) => setUnitsToRecord(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Component Type</Label>
              <Select value={componentType} onValueChange={(val) => setComponentType(val || "WHOLE_BLOOD")}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHOLE_BLOOD" className="text-xs">Whole Blood</SelectItem>
                  <SelectItem value="PRBC" className="text-xs">Packed Red Blood Cells (PRBC)</SelectItem>
                  <SelectItem value="PLATELETS" className="text-xs">Platelets</SelectItem>
                  <SelectItem value="FFP" className="text-xs">Fresh Frozen Plasma (FFP)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Operational Notes</Label>
              <Textarea
                placeholder="Operational collection details"
                className="text-xs resize-none"
                rows={2}
                value={recordNotes}
                onChange={(e) => setRecordNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecordDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleRecordSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Recording..." : "Record Donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL APPOINTMENT DIALOG */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Cancel Donation Appointment</DialogTitle>
            <DialogDescription className="text-xs">
              Provide an operational reason for cancelling this appointment. The commitment will return to accepted status for rescheduling.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Cancellation Reason</Label>
              <Textarea
                placeholder="Reason for cancellation (e.g. donor rescheduling, facility conflict)"
                className="text-xs resize-none"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelDialogOpen(false)}
              disabled={isSubmitting}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelSubmit}
              disabled={isSubmitting || cancelReason.trim().length < 3}
            >
              {isSubmitting ? "Cancelling..." : "Confirm Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
