"use client";

import { FormattedDonorCommitment } from "@/lib/supabase/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  HeartHandshake,
  ShieldCheck,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";

interface RequestCommitmentsCardProps {
  commitments: FormattedDonorCommitment[];
  unitsRequested: number;
  unitsCommitted: number;
}

export function RequestCommitmentsCard({
  commitments,
  unitsRequested,
  unitsCommitted,
}: RequestCommitmentsCardProps) {
  const activeCommitments = commitments.filter(
    (c) => c.status === "PENDING" || c.status === "ACCEPTED"
  );

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <HeartHandshake className="size-4" />
              </div>
              <CardTitle className="text-base font-semibold">
                Donor Responses & Operational Commitments
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {activeCommitments.length} Active Commitment{activeCommitments.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Voluntary commitments from contacted potential donor candidates. (Target: {unitsCommitted} / {unitsRequested} units)
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Medical Safety Boundary Disclaimer */}
        <Alert className="border-border/60 bg-muted/40">
          <ShieldCheck className="size-4 text-primary shrink-0" />
          <AlertTitle className="text-xs font-semibold">
            Non-Clinical Coordination Boundary
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground mt-0.5">
            Donor commitments reflect voluntary operational intent only. They do NOT guarantee
            clinical qualification, medical eligibility, or donation completion. Accredited blood
            center professionals conduct all physical screenings, hemoglobin tests, and laboratory
            cross-matching.
          </AlertDescription>
        </Alert>

        {commitments.length === 0 ? (
          <div className="p-8 rounded-lg border border-dashed border-border/80 text-center space-y-2">
            <div className="size-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
              <Clock className="size-5" />
            </div>
            <h4 className="text-sm font-semibold">No Commitments Recorded Yet</h4>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              When notified potential candidates respond to their alerts and indicate willingness
              to help, their operational commitments will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Candidate Code</TableHead>
                  <TableHead className="text-xs font-semibold">Response</TableHead>
                  <TableHead className="text-xs font-semibold">Commitment Status</TableHead>
                  <TableHead className="text-xs font-semibold">Committed At</TableHead>
                  <TableHead className="text-xs font-semibold">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitments.map((commitment) => {
                  const isActive =
                    commitment.status === "PENDING" || commitment.status === "ACCEPTED";
                  const isWithdrawn = commitment.status === "WITHDRAWN";

                  return (
                    <TableRow key={commitment.id} className="text-xs">
                      <TableCell className="font-semibold font-mono">
                        {commitment.safeDonorCode}
                      </TableCell>

                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-primary/10 text-primary border-primary/20"
                        >
                          {commitment.response}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {isActive ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                          >
                            <CheckCircle2 className="size-3 mr-1" />
                            {commitment.status}
                          </Badge>
                        ) : isWithdrawn ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-muted text-muted-foreground"
                          >
                            <XCircle className="size-3 mr-1" />
                            WITHDRAWN
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            {commitment.status}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {new Date(commitment.committedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {isWithdrawn && commitment.cancellationReason ? (
                          <span className="italic">
                            Withdrawn: {commitment.cancellationReason}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
