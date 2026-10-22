"use client";

import { useState } from "react";
import Link from "next/link";
import { FormattedNotification, FormattedDonorCommitment } from "@/lib/supabase/types";
import { markNotificationAsReadAction } from "@/lib/notifications/actions";
import {
  submitDonorResponseAction,
  withdrawDonorCommitmentAction,
} from "@/lib/commitments/actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bell,
  BellRing,
  CheckCheck,
  Droplet,
  MapPin,
  ShieldCheck,
  Clock,
  ExternalLink,
  Calendar,
  AlertCircle,
  Inbox,
  Heart,
  XCircle,
  CheckCircle2,
  RefreshCw,
  Undo2,
} from "lucide-react";

interface DonorNotificationListProps {
  initialNotifications: FormattedNotification[];
  initialCommitments?: FormattedDonorCommitment[];
}

export function DonorNotificationList({
  initialNotifications,
  initialCommitments = [],
}: DonorNotificationListProps) {
  const [notifications, setNotifications] =
    useState<FormattedNotification[]>(initialNotifications);
  const [commitments, setCommitments] =
    useState<FormattedDonorCommitment[]>(initialCommitments);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);

  const [selectedResponsePrompt, setSelectedResponsePrompt] = useState<{
    notification: FormattedNotification;
    response: "INTERESTED" | "DECLINED";
  } | null>(null);
  const [selectedWithdrawCommitment, setSelectedWithdrawCommitment] =
    useState<FormattedDonorCommitment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const displayedNotifications =
    activeTab === "unread"
      ? notifications.filter((n) => !n.isRead)
      : notifications;

  const getCommitmentForNotif = (notif: FormattedNotification) => {
    return commitments.find(
      (c) =>
        (notif.matchId && c.matchId === notif.matchId) ||
        (notif.requestId && c.requestId === notif.requestId)
    );
  };

  const handleMarkAsRead = async (id: string) => {
    setMarkingReadId(id);
    try {
      const res = await markNotificationAsReadAction(id);
      if (res.success && res.notification) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, isRead: true, status: "READ" } : n))
        );
      }
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    } finally {
      setMarkingReadId(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
    for (const id of unreadIds) {
      await markNotificationAsReadAction(id);
    }
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true, status: "READ" }))
    );
  };

  const handleConfirmResponse = async () => {
    if (!selectedResponsePrompt) return;
    const { notification, response } = selectedResponsePrompt;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await submitDonorResponseAction({
        notificationId: notification.id,
        matchId: notification.matchId || undefined,
        requestId: notification.requestId || undefined,
        response,
      });

      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Failed to submit response.",
        });
      } else {
        if (res.commitment) {
          setCommitments((prev) => [
            ...prev.filter((c) => c.id !== res.commitment!.id),
            res.commitment!,
          ]);
        }
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: true, status: "READ" } : n))
        );
        setFeedback({
          type: "success",
          message:
            response === "INTERESTED"
              ? "Thank you! Your operational willingness has been confirmed and voluntary commitment registered."
              : "Requisition declined. You will not be contacted further regarding this specific request.",
        });
        setSelectedResponsePrompt(null);
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error processing response.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmWithdrawal = async () => {
    if (!selectedWithdrawCommitment) return;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await withdrawDonorCommitmentAction(
        selectedWithdrawCommitment.id,
        withdrawalReason || "Donor voluntary withdrawal"
      );

      if (!res.success) {
        setFeedback({
          type: "error",
          message: res.error || "Failed to withdraw commitment.",
        });
      } else {
        if (res.commitment) {
          setCommitments((prev) =>
            prev.map((c) => (c.id === res.commitment!.id ? res.commitment! : c))
          );
        }
        setFeedback({
          type: "success",
          message: "Commitment successfully withdrawn. Requisition units have been updated.",
        });
        setSelectedWithdrawCommitment(null);
        setWithdrawalReason("");
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Error processing withdrawal.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Medical Safety Disclaimer Alert */}
      <Alert className="border-border/60 bg-muted/40">
        <ShieldCheck className="size-4 text-primary shrink-0" />
        <AlertTitle className="text-xs font-semibold">
          Operational Notification & Voluntary Response Notice
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-0.5">
          These notifications coordinate voluntary blood donation availability for active
          requisitions. An expression of interest indicates operational willingness to help only.
          It does NOT constitute medical clearance, clinical eligibility, or a guaranteed donation.
          Hospital staff perform all physical health assessments and cross-matching.
        </AlertDescription>
      </Alert>

      {/* Global Feedback Alert */}
      {feedback && (
        <Alert
          variant={feedback.type === "success" ? "default" : "destructive"}
          className={
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-300"
              : ""
          }
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="size-4" />
          )}
          <AlertTitle className="text-xs font-semibold">
            {feedback.type === "success" ? "Action Recorded" : "Action Failed"}
          </AlertTitle>
          <AlertDescription className="text-xs">{feedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Tabs and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "all" | "unread")}
          className="w-auto"
        >
          <TabsList className="grid grid-cols-2 w-56">
            <TabsTrigger value="all" className="text-xs">
              All ({notifications.length})
            </TabsTrigger>
            <TabsTrigger value="unread" className="text-xs">
              Unread ({unreadCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllAsRead}
            className="text-xs h-8 gap-1.5"
          >
            <CheckCheck className="size-3.5" />
            Mark All as Read
          </Button>
        )}
      </div>

      {/* Notifications List */}
      {displayedNotifications.length === 0 ? (
        <Card className="border-dashed border-border/80 text-center py-12 px-4">
          <div className="size-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto mb-3">
            <Inbox className="size-6" />
          </div>
          <CardTitle className="text-base font-semibold">
            {activeTab === "unread"
              ? "No Unread Notifications"
              : "No Notifications Yet"}
          </CardTitle>
          <CardDescription className="text-xs max-w-sm mx-auto mt-1">
            {activeTab === "unread"
              ? "You are caught up on all potential candidate alerts and platform notifications."
              : "When an active blood requisition matches your blood group and service radius, operational alerts will appear here."}
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayedNotifications.map((notification) => {
            const meta = (notification.metadata as Record<string, unknown>) || {};
            const bloodGroup = (meta.blood_group as string) || null;
            const bloodComponent = (meta.blood_component as string) || null;
            const hospitalName = (meta.hospital_name as string) || null;
            const hospitalCity = (meta.hospital_city as string) || null;
            const urgencyLevel = (meta.urgency_level as string) || null;
            const neededBy = (meta.needed_by as string) || null;

            const commitment = getCommitmentForNotif(notification);
            const isCommittedActive =
              commitment &&
              (commitment.status === "PENDING" || commitment.status === "ACCEPTED");
            const isCommittedWithdrawn =
              commitment && commitment.status === "WITHDRAWN";

            return (
              <Card
                key={notification.id}
                className={`border transition-colors ${
                  !notification.isRead
                    ? "border-primary/40 bg-card shadow-sm border-l-4 border-l-primary"
                    : "border-border/60 bg-muted/20 opacity-90"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          !notification.isRead
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {!notification.isRead ? (
                          <BellRing className="size-4 animate-pulse" />
                        ) : (
                          <Bell className="size-4" />
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-sm font-semibold">
                            {notification.title}
                          </CardTitle>
                          {!notification.isRead ? (
                            <Badge
                              variant="default"
                              className="text-[10px] h-5 bg-primary font-bold"
                            >
                              New Alert
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 text-muted-foreground"
                            >
                              Read
                            </Badge>
                          )}
                          {urgencyLevel && (
                            <Badge
                              variant="secondary"
                              className={`text-[10px] h-5 ${
                                urgencyLevel === "CRITICAL" || urgencyLevel === "CRITICAL_STAT"
                                  ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                              }`}
                            >
                              {urgencyLevel}
                            </Badge>
                          )}
                          {commitment?.status === "SCHEDULED" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 font-semibold"
                            >
                              <Calendar className="size-3 mr-1" />
                              Appointment Scheduled
                            </Badge>
                          )}
                          {commitment?.status === "COMPLETED" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold"
                            >
                              <CheckCircle2 className="size-3 mr-1" />
                              Donation Recorded
                            </Badge>
                          )}
                          {isCommittedActive && commitment?.status !== "SCHEDULED" && commitment?.status !== "COMPLETED" && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-semibold"
                            >
                              <CheckCircle2 className="size-3 mr-1" />
                              Commitment Active
                            </Badge>
                          )}
                          {isCommittedWithdrawn && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-5 bg-muted text-muted-foreground"
                            >
                              Withdrawn
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {new Date(notification.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span>•</span>
                          <span>Potential Donor Match</span>
                        </div>
                      </div>
                    </div>

                    {/* Operational Requisition Details Pills */}
                    {bloodGroup && (
                      <div className="flex items-center gap-2 self-start">
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-xs">
                          <Droplet className="size-3 fill-primary" />
                          {bloodGroup}
                        </div>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0 pb-4">
                  <p className="text-xs text-foreground/90 leading-relaxed">
                    {notification.body}
                  </p>

                  {/* Operationally Safe Metadata Grid */}
                  {(hospitalName || hospitalCity || bloodComponent || neededBy) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                      {hospitalName && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <MapPin className="size-3.5 text-primary shrink-0" />
                          <span className="truncate">
                            {hospitalName}
                            {hospitalCity ? `, ${hospitalCity}` : ""}
                          </span>
                        </div>
                      )}

                      {bloodComponent && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Droplet className="size-3.5 text-primary shrink-0" />
                          <span>Component: {bloodComponent.replace(/_/g, " ")}</span>
                        </div>
                      )}

                      {neededBy && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Calendar className="size-3.5 text-primary shrink-0" />
                          <span>
                            Needed By: {new Date(neededBy).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Primary Operational Action Row: Response & Commitment Choices */}
                  {notification.type === "POTENTIAL_DONOR_ALERT" && (
                    <div className="p-3 rounded-lg border border-border/70 bg-card space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-foreground">
                          Donor Response & Willingness:
                        </p>
                        {isCommittedActive ? (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Operational Commitment Registered
                          </span>
                        ) : isCommittedWithdrawn ? (
                          <span className="text-[11px] text-muted-foreground">
                            Commitment Previously Withdrawn
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            Awaiting voluntary response
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!isCommittedActive && !isCommittedWithdrawn && (
                          <>
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1.5 bg-primary font-semibold"
                              onClick={() =>
                                setSelectedResponsePrompt({
                                  notification,
                                  response: "INTERESTED",
                                })
                              }
                            >
                              <Heart className="size-3.5 fill-primary-foreground/30" />
                              I&apos;m Interested
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs gap-1.5"
                              onClick={() =>
                                setSelectedResponsePrompt({
                                  notification,
                                  response: "DECLINED",
                                })
                              }
                            >
                              <XCircle className="size-3.5 text-muted-foreground" />
                              Decline
                            </Button>
                          </>
                        )}

                        {isCommittedActive && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1.5 text-destructive hover:bg-destructive/10 border-destructive/30"
                            onClick={() => setSelectedWithdrawCommitment(commitment)}
                          >
                            <Undo2 className="size-3.5" />
                            Withdraw Commitment
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Secondary Action Row: Navigation & Read State */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
                    <div className="flex items-center gap-2">
                      {notification.requestId && (
                        <Link href={`/requests/${notification.requestId}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs gap-1.5 font-semibold"
                          >
                            <ExternalLink className="size-3.5" />
                            Review Blood Requisition
                          </Button>
                        </Link>
                      )}

                      {!notification.isRead && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkAsRead(notification.id)}
                          disabled={markingReadId === notification.id}
                          className="h-8 text-xs gap-1.5"
                        >
                          <CheckCheck className="size-3.5" />
                          Mark as Read
                        </Button>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      <span>Voluntary candidate response only</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirmation Dialog for Donor Response (Interested vs Decline) */}
      <Dialog
        open={!!selectedResponsePrompt}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setSelectedResponsePrompt(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {selectedResponsePrompt?.response === "INTERESTED" ? (
                <>
                  <Heart className="size-4 text-primary" />
                  Express Voluntary Interest & Commit
                </>
              ) : (
                <>
                  <XCircle className="size-4 text-muted-foreground" />
                  Decline Potential Match Alert
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedResponsePrompt?.response === "INTERESTED"
                ? "Confirm your operational willingness to assist with this blood requisition."
                : "You are choosing to decline this potential donor match request."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            {selectedResponsePrompt?.response === "INTERESTED" ? (
              <Alert className="border-border/60 bg-muted/40">
                <ShieldCheck className="size-4 text-primary shrink-0" />
                <AlertTitle className="text-xs font-semibold">
                  Non-Clinical Operational Boundary
                </AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground mt-0.5">
                  Selecting <strong>I&apos;m Interested</strong> indicates voluntary availability
                  only. It does NOT represent medical clearance or guaranteed clinical donation
                  suitability. Blood center staff perform all physical health assessments and
                  cross-matching on-site.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground">
                Declining indicates that you are currently unable or choose not to participate in this
                specific requisition. You will not receive further notifications for this request.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedResponsePrompt(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmResponse}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  Submitting...
                </>
              ) : selectedResponsePrompt?.response === "INTERESTED" ? (
                <>
                  <Heart className="size-3.5" />
                  Confirm Commitment
                </>
              ) : (
                <>
                  <XCircle className="size-3.5" />
                  Confirm Decline
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Commitment Withdrawal */}
      <Dialog
        open={!!selectedWithdrawCommitment}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setSelectedWithdrawCommitment(null);
            setWithdrawalReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Undo2 className="size-4 text-destructive" />
              Withdraw Active Commitment
            </DialogTitle>
            <DialogDescription className="text-xs">
              If your availability has changed, you may withdraw your operational commitment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Withdrawing releases your operational reservation so the hospital coordination team
              can discover or notify other candidate volunteers.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedWithdrawCommitment(null);
                setWithdrawalReason("");
              }}
              disabled={isSubmitting}
            >
              Keep Commitment
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleConfirmWithdrawal}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  Withdrawing...
                </>
              ) : (
                <>
                  <Undo2 className="size-3.5" />
                  Confirm Withdrawal
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
