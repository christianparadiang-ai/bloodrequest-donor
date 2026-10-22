"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  processOutboxAction,
  reconcilePlatformAction,
} from "@/lib/outbox/actions";
import {
  FormattedOutboxEvent,
  OutboxMetrics,
  ProcessOutboxBatchResult,
  ReconciliationResult,
} from "@/lib/outbox/types";
import {
  SendHorizontal,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Inbox,
  ShieldCheck,
} from "lucide-react";

interface OutboxOperationsCardProps {
  initialMetrics: OutboxMetrics;
  initialEvents: FormattedOutboxEvent[];
}

export function OutboxOperationsCard({
  initialMetrics,
  initialEvents,
}: OutboxOperationsCardProps) {
  const [metrics, setMetrics] = useState<OutboxMetrics>(initialMetrics);
  const [events] = useState<FormattedOutboxEvent[]>(initialEvents);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    title: string;
    description: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  const handleProcessBatch = () => {
    startTransition(async () => {
      setStatusMessage({
        type: "info",
        title: "Processing Outbox Batch...",
        description: "Claiming pending outbox jobs and dispatching to delivery providers.",
      });

      const res = await processOutboxAction(20);
      if (res.success && res.result) {
        const r: ProcessOutboxBatchResult = res.result;
        setStatusMessage({
          type: "success",
          title: "Outbox Batch Processed",
          description: `Processed ${r.processedCount} job(s): ${r.deliveredCount} delivered, ${r.retryableCount} retryable, ${r.permanentFailureCount} failed in ${r.executionDurationMs}ms.`,
        });
        // Optimistically update counts
        setMetrics((prev) => ({
          ...prev,
          pendingCount: Math.max(0, prev.pendingCount - r.deliveredCount - r.permanentFailureCount),
          deliveredCount: prev.deliveredCount + r.deliveredCount,
          retryableCount: r.retryableCount,
          permanentFailureCount: prev.permanentFailureCount + r.permanentFailureCount,
          lastWorkerRunAt: new Date().toISOString(),
        }));
      } else {
        setStatusMessage({
          type: "error",
          title: "Worker Processing Error",
          description: res.error || "Failed to process outbox batch.",
        });
      }
    });
  };

  const handleReconcile = () => {
    startTransition(async () => {
      setStatusMessage({
        type: "info",
        title: "Running Platform Reconciliation...",
        description: "Checking expired commitments, overdue requisitions, stale leases, and counters.",
      });

      const res = await reconcilePlatformAction();
      if (res.success && res.result) {
        const r: ReconciliationResult = res.result;
        setStatusMessage({
          type: "success",
          title: "Reconciliation Complete",
          description: `Expired ${r.expiredCommitmentsCount} commitment(s), ${r.expiredRequestsCount} requisition(s), recovered ${r.staleLeasesRecoveredCount} lease(s), and corrected ${r.counterDiscrepanciesCorrected} counter discrepancy(ies) in ${r.executionDurationMs}ms.`,
        });
        setMetrics((prev) => ({
          ...prev,
          lastReconciliationRunAt: new Date().toISOString(),
        }));
      } else {
        setStatusMessage({
          type: "error",
          title: "Reconciliation Error",
          description: res.error || "Failed to run platform reconciliation.",
        });
      }
    });
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <SendHorizontal className="size-4" />
            </div>
            <div>
              <CardTitle className="text-lg">Notification Outbox & Reconciliation</CardTitle>
              <CardDescription className="text-xs">
                Durable outbox delivery worker metrics and automated state reconciliation ledger.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleProcessBatch}
              disabled={isPending}
              className="text-xs"
            >
              <RefreshCw className={`size-3.5 mr-1.5 ${isPending ? "animate-spin" : ""}`} />
              Process Outbox
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleReconcile}
              disabled={isPending}
              className="text-xs"
            >
              <ShieldCheck className="size-3.5 mr-1.5" />
              Run Reconciliation
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Status Message Alert */}
        {statusMessage && (
          <Alert
            variant={statusMessage.type === "error" ? "destructive" : "default"}
            className="border-border/60"
          >
            {statusMessage.type === "success" && <CheckCircle2 className="size-4 text-emerald-600" />}
            {statusMessage.type === "error" && <XCircle className="size-4 text-destructive" />}
            {statusMessage.type === "info" && <Clock className="size-4 text-primary" />}
            <AlertTitle className="text-xs font-semibold">{statusMessage.title}</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {statusMessage.description}
            </AlertDescription>
          </Alert>
        )}

        {/* Operational Metrics Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Pending Queue</span>
              <Inbox className="size-3.5 text-muted-foreground" />
            </div>
            <div className="text-xl font-bold">{metrics.pendingCount}</div>
            <Badge variant="outline" className="text-[10px]">
              Ready for worker
            </Badge>
          </div>

          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Delivered</span>
              <CheckCircle2 className="size-3.5 text-emerald-600" />
            </div>
            <div className="text-xl font-bold text-emerald-600">{metrics.deliveredCount}</div>
            <Badge variant="secondary" className="text-[10px]">
              Confirmed
            </Badge>
          </div>

          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Retryable</span>
              <AlertTriangle className="size-3.5 text-amber-500" />
            </div>
            <div className="text-xl font-bold text-amber-600">{metrics.retryableCount}</div>
            <Badge variant="outline" className="text-[10px] text-amber-600">
              In backoff
            </Badge>
          </div>

          <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Terminal Failed</span>
              <XCircle className="size-3.5 text-destructive" />
            </div>
            <div className="text-xl font-bold text-destructive">{metrics.permanentFailureCount}</div>
            <Badge variant="destructive" className="text-[10px]">
              Max attempts
            </Badge>
          </div>
        </div>

        {/* Execution Metadata Timestamps */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-1 border-t border-border/40">
          <div>
            <strong>Last Delivery Run:</strong>{" "}
            {metrics.lastWorkerRunAt
              ? new Date(metrics.lastWorkerRunAt).toLocaleTimeString()
              : "Not executed yet"}
          </div>
          <div>
            <strong>Last Reconciliation:</strong>{" "}
            {metrics.lastReconciliationRunAt
              ? new Date(metrics.lastReconciliationRunAt).toLocaleTimeString()
              : "Not executed yet"}
          </div>
        </div>

        {/* Recent Outbox Ledger Table */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Recent Outbox Jobs (Sanitized)
          </div>

          {events.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg">
              No recent outbox events in queue.
            </div>
          ) : (
            <div className="border border-border/60 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-[100px]">Event ID</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs">
                  {events.map((ev) => (
                    <TableRow key={ev.id}>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {ev.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="font-medium">{ev.eventType}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {ev.channel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ev.status === "DELIVERED" || ev.status === "COMPLETED"
                              ? "default"
                              : ev.status === "RETRYABLE_FAILURE"
                              ? "outline"
                              : ev.status === "PERMANENT_FAILURE"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {ev.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{ev.attemptCount}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
