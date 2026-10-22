"use client";

import React, { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Award,
  ShieldCheck,
  TrendingUp,
  History,
  Trophy,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  DonorPointsSummary,
  LeaderboardEntry,
  RECOGNITION_TIERS,
  POINTS_SAFETY_DISCLAIMER,
} from "@/lib/donations/points";

interface PointsAndBenefitsProps {
  summary: DonorPointsSummary;
  leaderboard?: LeaderboardEntry[];
  showFullDetails?: boolean;
}

export function PointsAndBenefitsCard({
  summary,
  leaderboard = [],
}: PointsAndBenefitsProps) {
  const [activeTab, setActiveTab] = useState<string>("summary");

  const progressPercent = summary.nextTier
    ? Math.min(
        100,
        Math.round(
          (summary.totalPoints / summary.nextTier.minPoints) * 100
        )
      )
    : 100;

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <CardHeader className="bg-gradient-to-r from-primary/10 via-background to-background border-b border-border/40 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Award className="size-5 text-amber-500" />
              <CardTitle className="text-xl font-bold">
                Donor Recognition & Points
              </CardTitle>
              <Badge className={summary.badgeColor}>
                {summary.currentTierName}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Non-monetary solidarity points earned exclusively for verified, completed blood donations.
            </CardDescription>
          </div>

          <div className="text-left sm:text-right">
            <div className="text-3xl font-extrabold text-foreground tracking-tight">
              {summary.totalPoints}{" "}
              <span className="text-sm font-semibold text-muted-foreground">pts</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {summary.totalDonationsCompleted} verified completed donation(s)
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Next Tier Progress Bar */}
        {summary.nextTier ? (
          <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border/60">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-primary" />
                Next Milestone: {summary.nextTier.name}
              </span>
              <span className="text-muted-foreground font-mono">
                {summary.nextTier.pointsNeeded} pts needed ({summary.totalPoints} / {summary.nextTier.minPoints})
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Each verified completed donation awards 100 recognition points upon authorized clinical confirmation.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-purple-600 dark:text-purple-400" />
              <span>
                <strong>Highest Tier Reached:</strong> Platinum Life Donor. Thank you for your exemplary commitment to voluntary life-saving!
              </span>
            </div>
          </div>
        )}

        {/* Tab Controls for Detailed View */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid grid-cols-3 w-full sm:w-auto">
            <TabsTrigger value="summary" className="text-xs gap-1.5">
              <Award className="size-3.5" />
              Recognition Tiers
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1.5">
              <History className="size-3.5" />
              Points Ledger ({summary.transactions.length})
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="text-xs gap-1.5">
              <Trophy className="size-3.5" />
              Leaderboard ({leaderboard.length})
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Recognition Tiers Explainer */}
          <TabsContent value="summary" className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {RECOGNITION_TIERS.map((tier) => {
                const isCurrent = summary.currentTier === tier.tier;
                return (
                  <div
                    key={tier.tier}
                    className={`p-3.5 rounded-lg border text-xs space-y-1.5 transition-colors ${
                      isCurrent
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border/60 bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge className={tier.badgeColor}>{tier.name}</Badge>
                      <span className="font-mono text-muted-foreground font-semibold">
                        {tier.minPoints}+ pts
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      {tier.description}
                    </p>
                    {isCurrent && (
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-primary pt-1">
                        <CheckCircle2 className="size-3.5" />
                        Current Milestone
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-3 rounded-lg border border-border/60 bg-muted/20 text-xs space-y-1">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Info className="size-3.5 text-primary" />
                Proposed Recognition Program
              </div>
              <p className="text-muted-foreground text-[11px]">
                Recognition levels and milestone badges are proposed community honors to acknowledge donors. Points are non-monetary and are awarded only after an authorized hospital staff member verifies that a donation has been completed.
              </p>
            </div>
          </TabsContent>

          {/* Tab 2: Points Ledger History */}
          <TabsContent value="history" className="space-y-3 pt-2">
            {summary.transactions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg space-y-1">
                <p>No points transactions recorded yet.</p>
                <p className="text-[11px]">
                  Points will appear here once an authorized facility records a verified completed donation.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {summary.transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-3 rounded-lg border border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {tx.reason}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {tx.transaction_type}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>

                    <div className="font-bold text-sm font-mono text-emerald-600 dark:text-emerald-400">
                      +{tx.points} pts
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Tab 3: Privacy-Conscious Leaderboard */}
          <TabsContent value="leaderboard" className="space-y-3 pt-2">
            {leaderboard.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                No public leaderboard entries available yet.
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry) => (
                  <div
                    key={entry.rank}
                    className="p-3 rounded-lg border border-border/60 bg-muted/20 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`size-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          entry.rank === 1
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
                            : entry.rank === 2
                            ? "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                            : entry.rank === 3
                            ? "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {entry.rank}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          <span>{entry.displayName}</span>
                          <Badge variant="outline" className="text-[10px] font-bold">
                            {entry.bloodGroup}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {entry.tier} &bull; {entry.totalDonations} verified donation(s)
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-bold font-mono text-foreground">
                        {entry.totalPoints} pts
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center italic">
              Donor privacy is strictly guarded. Identifiers are masked and contact data is never publicly exposed.
            </p>
          </TabsContent>
        </Tabs>

        {/* Non-Monetary Legal Disclaimer Notice */}
        <Alert className="border-border/60 bg-muted/30">
          <ShieldCheck className="size-4 text-primary shrink-0" />
          <AlertTitle className="text-xs font-semibold">
            Non-Monetary Recognition Notice
          </AlertTitle>
          <AlertDescription className="text-[11px] text-muted-foreground">
            {POINTS_SAFETY_DISCLAIMER}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
