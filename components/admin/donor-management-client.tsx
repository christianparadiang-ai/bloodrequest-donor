"use client";

import React, { useState, useTransition } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  HeartHandshake,
  Search,
  ShieldCheck,
  ShieldAlert,
  Award,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";
import { DonorDirectoryEntry, DonorFilterParams } from "@/lib/donor/service";
import { filterDonorsAction } from "@/lib/donor/actions";
import { adjustDonorPointsAction } from "@/lib/donations/actions";

interface DonorManagementProps {
  initialDonors: DonorDirectoryEntry[];
  userRole: string;
}

export function DonorManagementClient({
  initialDonors,
  userRole,
}: DonorManagementProps) {
  const [donors, setDonors] = useState<DonorDirectoryEntry[]>(initialDonors);
  const [searchTerm, setSearchTerm] = useState("");
  const [bloodGroupFilter, setBloodGroupFilter] = useState("ALL");
  const [availabilityFilter, setAvailabilityFilter] = useState("ALL");
  const [cityFilter, setCityFilter] = useState("");
  const [isLoading, startTransition] = useTransition();

  // Adjustment Modal State
  const [adjustTarget, setAdjustTarget] = useState<DonorDirectoryEntry | null>(null);
  const [adjustPoints, setAdjustPoints] = useState<number>(50);
  const [adjustReason, setAdjustReason] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"MANUAL_ADJUSTMENT" | "REVERSAL">("MANUAL_ADJUSTMENT");
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isPrivilegedAdmin = ["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(userRole);

  const handleFilter = () => {
    setFeedback(null);
    startTransition(async () => {
      const filters: DonorFilterParams = {
        search: searchTerm || undefined,
        bloodGroup: bloodGroupFilter !== "ALL" ? bloodGroupFilter : undefined,
        city: cityFilter || undefined,
        isAvailable:
          availabilityFilter === "AVAILABLE"
            ? true
            : availabilityFilter === "UNAVAILABLE"
            ? false
            : undefined,
      };

      const res = await filterDonorsAction(filters);
      if (res.success && res.data) {
        setDonors(res.data);
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to search donors.",
        });
      }
    });
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setBloodGroupFilter("ALL");
    setAvailabilityFilter("ALL");
    setCityFilter("");
    startTransition(async () => {
      const res = await filterDonorsAction({});
      if (res.success && res.data) {
        setDonors(res.data);
      }
    });
  };

  const handleExecuteAdjustment = async () => {
    if (!adjustTarget) return;
    if (!adjustReason.trim()) {
      setFeedback({ type: "error", text: "A detailed reason for points adjustment is mandatory for the audit ledger." });
      return;
    }

    setIsAdjusting(true);
    setFeedback(null);

    try {
      const res = await adjustDonorPointsAction({
        donorProfileIdOrUserId: adjustTarget.id,
        points: adjustType === "REVERSAL" ? -Math.abs(adjustPoints) : Math.abs(adjustPoints),
        reason: adjustReason.trim(),
        transactionType: adjustType,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: `Successfully recorded ${adjustType} of ${adjustType === "REVERSAL" ? -Math.abs(adjustPoints) : Math.abs(adjustPoints)} pts for ${adjustTarget.displayName}.`,
        });
        setAdjustTarget(null);
        setAdjustReason("");
        // Refresh donors list
        handleFilter();
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to execute points adjustment.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error executing adjustment.",
      });
    } finally {
      setIsAdjusting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Privacy Notice */}
      <Alert className="border-border/60 bg-muted/30">
        <ShieldCheck className="size-4 text-primary shrink-0" />
        <AlertTitle className="text-xs font-semibold">
          Donor Privacy Invariant
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Volunteer donor personal contact info (phone, full street address, and identity documents) is strictly guarded and never exposed in directory lists.
        </AlertDescription>
      </Alert>

      {/* Action feedback */}
      {feedback && (
        <Alert
          className={
            feedback.type === "error"
              ? "border-destructive/50 text-destructive bg-destructive/10"
              : "border-primary/50 text-primary bg-primary/10"
          }
        >
          {feedback.type === "error" ? (
            <AlertTriangle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          <AlertTitle className="text-sm font-semibold">
            {feedback.type === "error" ? "Notice" : "Success"}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {feedback.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Filter Toolbar Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              Donor Search & Filters
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {donors.length} matching donor(s)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Search Donor Code / Name
              </label>
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-3 text-muted-foreground" />
                <Input
                  placeholder="e.g. DONOR-AB12 or Alex"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Blood Group
              </label>
              <Select value={bloodGroupFilter} onValueChange={(val) => setBloodGroupFilter(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Blood Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Blood Groups</SelectItem>
                  <SelectItem value="A+">A+ (Positive)</SelectItem>
                  <SelectItem value="A-">A- (Negative)</SelectItem>
                  <SelectItem value="B+">B+ (Positive)</SelectItem>
                  <SelectItem value="B-">B- (Negative)</SelectItem>
                  <SelectItem value="AB+">AB+ (Positive)</SelectItem>
                  <SelectItem value="AB-">AB- (Negative)</SelectItem>
                  <SelectItem value="O+">O+ (Positive)</SelectItem>
                  <SelectItem value="O-">O- (Negative)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Availability Status
              </label>
              <Select value={availabilityFilter} onValueChange={(val) => setAvailabilityFilter(val || "ALL")}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="All Availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="AVAILABLE">Available for Discovery</SelectItem>
                  <SelectItem value="UNAVAILABLE">Unavailable / Resting</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Municipality / City
              </label>
              <Input
                placeholder="e.g. Quezon City, Manila"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              disabled={isLoading}
              className="text-xs gap-1"
            >
              <RefreshCw className="size-3" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleFilter}
              disabled={isLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5 font-semibold"
            >
              {isLoading ? <Loader2 className="size-3 animate-spin" /> : <Filter className="size-3" />}
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Donors List Table */}
      <Card className="border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <HeartHandshake className="size-4.5 text-primary" />
              Volunteer Donor Network Directory
            </span>
            <Badge variant="outline" className="text-xs font-mono">
              Role: {userRole}
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Authorized oversight directory showing verified donation counts, points balances, and recognition tiers.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {donors.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
              <p className="font-semibold text-sm">No donors found</p>
              <p className="text-xs">
                No donor records match the current filter criteria.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border/40 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Donor Code</th>
                    <th className="px-4 py-3">Display Name</th>
                    <th className="px-4 py-3">Blood Group</th>
                    <th className="px-4 py-3">City / Area</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Donations</th>
                    <th className="px-4 py-3">Points & Tier</th>
                    {isPrivilegedAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {donors.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-foreground">
                        {d.donorCode}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {d.displayName}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-bold font-mono">
                          {d.bloodGroup}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {d.city}, {d.province}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={d.isAvailable ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {d.isAvailable ? "Available" : "Unavailable"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {d.totalDonationsCount} verified
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold font-mono text-purple-600 dark:text-purple-400">
                            {d.totalPoints} pts
                          </span>
                          <Badge className={`${d.badgeColor} text-[10px] py-0`}>
                            {d.recognitionTier}
                          </Badge>
                        </div>
                      </td>
                      {isPrivilegedAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setAdjustTarget(d);
                              setAdjustPoints(50);
                              setAdjustReason("");
                            }}
                            className="text-xs h-7 px-2"
                          >
                            <Award className="size-3 mr-1" />
                            Adjust Points
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Points Adjustment Dialog */}
      {adjustTarget && (
        <Dialog open={Boolean(adjustTarget)} onOpenChange={(open) => !open && setAdjustTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Award className="size-5 text-amber-500" />
                Auditable Points Adjustment
              </DialogTitle>
              <DialogDescription className="text-xs">
                Record an authorized non-monetary points correction for donor{" "}
                <strong>{adjustTarget.displayName}</strong> ({adjustTarget.donorCode}).
                Current balance: <strong>{adjustTarget.totalPoints} pts</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-muted-foreground">
                  Adjustment Type
                </label>
                <Select
                  value={adjustType}
                  onValueChange={(val) => {
                    if (val === "MANUAL_ADJUSTMENT" || val === "REVERSAL") {
                      setAdjustType(val);
                    }
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL_ADJUSTMENT">
                      Manual Addition (+ Points)
                    </SelectItem>
                    <SelectItem value="REVERSAL">
                      Correction / Reversal (- Points)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-muted-foreground">
                  Points Amount
                </label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(parseInt(e.target.value, 10) || 0)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-muted-foreground">
                  Mandatory Audit Reason / Resolution Details
                </label>
                <Input
                  placeholder="e.g. Verified retroactively from facility donation slip #1042"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs"
                />
              </div>

              <Alert className="border-border/60 bg-muted/40 text-[11px]">
                <ShieldAlert className="size-3.5 text-amber-600 shrink-0" />
                <AlertDescription>
                  This adjustment will be permanently logged in the audit trail with your administrator identity. Points remain non-monetary and confer no commercial value.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdjustTarget(null)}
                disabled={isAdjusting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecuteAdjustment}
                disabled={isAdjusting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isAdjusting ? (
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="size-3.5 mr-1" />
                )}
                Confirm Adjustment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
