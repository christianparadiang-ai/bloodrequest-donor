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
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  FileSpreadsheet,
  Calendar,
  Activity,
  CheckCircle2,
  Award,
  Download,
  AlertTriangle,
  Loader2,
  TrendingUp,
  Droplet,
  PieChart,
} from "lucide-react";
import {
  PeriodType,
} from "@/lib/reports/dates";
import {
  AnalyticsSummary,
  ReportCategory,
} from "@/lib/reports/service";
import {
  fetchAnalyticsReportAction,
  exportCsvReportAction,
} from "@/lib/reports/actions";

interface ReportsClientProps {
  initialSummary: AnalyticsSummary;
}

export function ReportsClient({ initialSummary }: ReportsClientProps) {
  const [periodType, setPeriodType] = useState<PeriodType>(initialSummary.period.periodType);
  const [selectedDate, setSelectedDate] = useState<string>(initialSummary.period.formattedStart);
  const [customStart, setCustomStart] = useState<string>(initialSummary.period.formattedStart);
  const [customEnd, setCustomEnd] = useState<string>(initialSummary.period.formattedEnd);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getUTCFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getUTCMonth() + 1);

  const [summary, setSummary] = useState<AnalyticsSummary>(initialSummary);
  const [isLoading, startTransition] = useTransition();
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportCategory, setExportCategory] = useState<ReportCategory>("blood-requests");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleApplyFilter = () => {
    setStatusMessage(null);
    startTransition(async () => {
      const res = await fetchAnalyticsReportAction({
        periodType,
        date: selectedDate,
        year: selectedYear,
        month: selectedMonth,
        customStart,
        customEnd,
      });

      if (res.success && res.data) {
        setSummary(res.data);
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to load reports for selected date range.",
        });
      }
    });
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    setStatusMessage(null);

    try {
      const res = await exportCsvReportAction({
        category: exportCategory,
        periodType,
        date: selectedDate,
        year: selectedYear,
        month: selectedMonth,
        customStart,
        customEnd,
      });

      if (!res.success || !res.csvContent || !res.filename) {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to generate CSV export.",
        });
        setIsExporting(false);
        return;
      }

      // Trigger browser download
      const blob = new Blob([res.csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", res.filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatusMessage({
        type: "success",
        text: `Successfully exported ${res.recordCount} record(s) to ${res.filename}.`,
      });
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Error exporting CSV.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Date Period Controls Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="size-5 text-primary" />
                Reporting Period & Date Filter
              </CardTitle>
              <CardDescription className="text-xs">
                Select calendar aggregation interval. Week boundaries strictly follow ISO convention (Monday 00:00:00 to Sunday 23:59:59 UTC).
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs w-fit">
              UTC Timezone
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
            {/* Period Type Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Period Interval
              </label>
              <Select
                value={periodType}
                onValueChange={(val) => val && setPeriodType(val as PeriodType)}
              >
                <SelectTrigger id="period-type-selector">
                  <SelectValue placeholder="Select Interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day (Specific Date)</SelectItem>
                  <SelectItem value="week">Week (Monday - Sunday)</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Calendar Year</SelectItem>
                  <SelectItem value="custom">Custom Date Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Interval Specific Inputs */}
            {periodType === "day" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  Select Calendar Date
                </label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-xs"
                />
              </div>
            )}

            {periodType === "week" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  Date within Desired Week
                </label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="text-xs"
                />
              </div>
            )}

            {periodType === "month" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Month
                  </label>
                  <Select
                    value={selectedMonth.toString()}
                    onValueChange={(val) => val && setSelectedMonth(parseInt(val, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">January</SelectItem>
                      <SelectItem value="2">February</SelectItem>
                      <SelectItem value="3">March</SelectItem>
                      <SelectItem value="4">April</SelectItem>
                      <SelectItem value="5">May</SelectItem>
                      <SelectItem value="6">June</SelectItem>
                      <SelectItem value="7">July</SelectItem>
                      <SelectItem value="8">August</SelectItem>
                      <SelectItem value="9">September</SelectItem>
                      <SelectItem value="10">October</SelectItem>
                      <SelectItem value="11">November</SelectItem>
                      <SelectItem value="12">December</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Year
                  </label>
                  <Input
                    type="number"
                    min="2020"
                    max="2035"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                    className="text-xs"
                  />
                </div>
              </>
            )}

            {periodType === "year" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  Calendar Year
                </label>
                <Input
                  type="number"
                  min="2020"
                  max="2035"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="text-xs"
                />
              </div>
            )}

            {periodType === "custom" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Start Date
                  </label>
                  <Input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    End Date
                  </label>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </>
            )}

            {/* Apply Filter Button */}
            <div className="flex gap-2">
              <Button
                onClick={handleApplyFilter}
                disabled={isLoading}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 text-xs font-semibold"
              >
                {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
                Apply Filter
              </Button>
            </div>
          </div>

          {/* Active Period Display Banner */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border/40 text-xs text-muted-foreground">
            <div>
              Active Range:{" "}
              <strong className="text-foreground">{summary.period.label}</strong> (
              <span className="font-mono text-[11px]">
                {summary.period.startDate.slice(0, 10)} to {summary.period.endDate.slice(0, 10)}
              </span>
              )
            </div>
            <div className="text-[11px] italic">
              Showing authentic database records. Mock statistics strictly excluded.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status feedback message */}
      {statusMessage && (
        <Alert
          className={
            statusMessage.type === "error"
              ? "border-destructive/50 text-destructive bg-destructive/10"
              : "border-primary/50 text-primary bg-primary/10"
          }
        >
          {statusMessage.type === "error" ? (
            <AlertTriangle className="size-4" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          <AlertTitle className="text-sm font-semibold">
            {statusMessage.type === "error" ? "Reporting Notice" : "Export Success"}
          </AlertTitle>
          <AlertDescription className="text-xs">
            {statusMessage.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Top Summary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Blood Requisitions */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
              Requisitions in Period
              <Droplet className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-3xl font-extrabold tracking-tight">
              {summary.totalRequests}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Open / Review:</span>
              <span className="font-semibold text-foreground">{summary.requestsByStatus.open}</span>
            </div>
            <div className="flex justify-between">
              <span>In-Progress Commitments:</span>
              <span className="font-semibold text-foreground">{summary.requestsByStatus.inProgress}</span>
            </div>
            <div className="flex justify-between">
              <span>Fulfilled:</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {summary.requestsByStatus.fulfilled}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cancelled / Expired:</span>
              <span>
                {summary.requestsByStatus.cancelled + summary.requestsByStatus.expired}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Metric 2: Verified Completed Donations */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
              Verified Donations
              <CheckCircle2 className="size-4 text-emerald-500" />
            </CardDescription>
            <CardTitle className="text-3xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
              {summary.totalDonationsCompleted}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Units Collected:</span>
              <span className="font-semibold text-foreground">{summary.totalUnitsDonated} unit(s)</span>
            </div>
            <div className="flex justify-between">
              <span>Units Requested:</span>
              <span className="font-semibold text-foreground">{summary.totalUnitsRequested} unit(s)</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border/40 font-medium">
              <span>Status:</span>
              <span className="text-emerald-600 dark:text-emerald-400">Clinical Verification</span>
            </div>
          </CardContent>
        </Card>

        {/* Metric 3: Fulfillment Rate */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
              Fulfillment Rate
              <TrendingUp className="size-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-3xl font-extrabold tracking-tight">
              {summary.fulfillmentRatePercent}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p className="text-[11px] leading-relaxed">
              Calculation Rule: <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">(Units Donated / Units Requested) &times; 100</code>
            </p>
            <div className="w-full bg-muted rounded-full h-2 mt-2 overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, summary.fulfillmentRatePercent)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Metric 4: Non-Monetary Donor Recognition */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center justify-between">
              Points Awarded
              <Award className="size-4 text-purple-500" />
            </CardDescription>
            <CardTitle className="text-3xl font-extrabold tracking-tight text-purple-600 dark:text-purple-400">
              {summary.totalPointsAwarded}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Ledger Transactions:</span>
              <span className="font-semibold text-foreground">{summary.pointsTransactionsCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Policy Rule:</span>
              <span>100 pts / Verified Donation</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border/40 text-[11px] text-muted-foreground/80">
              <span>Type:</span>
              <span>Non-monetary solidarity</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CSV Export Bar Card */}
      <Card className="border-border/60 bg-muted/20 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="size-4.5 text-primary" />
                CSV Data Export
              </CardTitle>
              <CardDescription className="text-xs">
                Export sanitized database records for the selected period ({summary.period.formattedStart} to {summary.period.formattedEnd}).
                Protected against CSV formula injection.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="w-full sm:w-72">
              <Select
                value={exportCategory}
                onValueChange={(val) => val && setExportCategory(val as ReportCategory)}
              >
                <SelectTrigger id="export-category-selector" className="text-xs">
                  <SelectValue placeholder="Select Report Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blood-requests">Blood Requests Report</SelectItem>
                  <SelectItem value="donors">Donor Summary Report (PII Masked)</SelectItem>
                  <SelectItem value="completed-donations">Verified Completed Donations</SelectItem>
                  <SelectItem value="points-transactions">Points Transaction Ledger</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleExportCsv}
              disabled={isExporting}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 text-xs font-semibold shrink-0"
            >
              {isExporting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Export CSV ({summary.period.formattedStart} to {summary.period.formattedEnd})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Grouping Details: Blood Group & Components Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Blood Groups Distribution */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Droplet className="size-4 text-primary" />
              Requisitions by Blood Group
            </CardTitle>
            <CardDescription className="text-xs">
              Distribution of patient blood group needs during this period.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {Object.keys(summary.requestsByBloodGroup).length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-md">
                No blood requests recorded for the selected period.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(summary.requestsByBloodGroup).map(([bg, count]) => (
                  <div
                    key={bg}
                    className="p-3 rounded-lg border border-border/60 bg-muted/30 text-center space-y-1"
                  >
                    <Badge variant="outline" className="font-bold text-sm bg-background">
                      {bg}
                    </Badge>
                    <div className="text-xs font-semibold text-foreground">
                      {count} {count === 1 ? "request" : "requests"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Blood Components Distribution */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="size-4 text-primary" />
              Requisitions by Blood Component
            </CardTitle>
            <CardDescription className="text-xs">
              Clinical transfusion product requirements.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {Object.keys(summary.requestsByComponent).length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-md">
                No component requests recorded for the selected period.
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(summary.requestsByComponent).map(([comp, count]) => (
                  <div
                    key={comp}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/20 text-xs"
                  >
                    <span className="font-semibold text-foreground">{comp.replace(/_/g, " ")}</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {count} units / requests
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recognition Tiers Breakdown */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="size-4 text-amber-500" />
            Donor Recognition Tier Distribution
          </CardTitle>
          <CardDescription className="text-xs">
            Summary of donors across non-monetary solidarity milestones based on accumulated points.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20 text-center space-y-1">
              <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs">
                Platinum (1000+)
              </Badge>
              <div className="text-2xl font-extrabold text-foreground">
                {summary.donorsByTier.Platinum || 0}
              </div>
              <p className="text-[10px] text-muted-foreground">10+ Verified Donations</p>
            </div>

            <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-center space-y-1">
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
                Gold (600+)
              </Badge>
              <div className="text-2xl font-extrabold text-foreground">
                {summary.donorsByTier.Gold || 0}
              </div>
              <p className="text-[10px] text-muted-foreground">6+ Verified Donations</p>
            </div>

            <div className="p-3 rounded-lg border border-slate-300 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/30 text-center space-y-1">
              <Badge className="bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 text-xs">
                Silver (300+)
              </Badge>
              <div className="text-2xl font-extrabold text-foreground">
                {summary.donorsByTier.Silver || 0}
              </div>
              <p className="text-[10px] text-muted-foreground">3+ Verified Donations</p>
            </div>

            <div className="p-3 rounded-lg border border-orange-200 dark:border-orange-900 bg-orange-50/50 dark:bg-orange-950/20 text-center space-y-1">
              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs">
                Bronze (100+)
              </Badge>
              <div className="text-2xl font-extrabold text-foreground">
                {summary.donorsByTier.Bronze || 0}
              </div>
              <p className="text-[10px] text-muted-foreground">1st Verified Donation</p>
            </div>

            <div className="p-3 rounded-lg border border-border/60 bg-muted/30 text-center space-y-1">
              <Badge variant="outline" className="text-xs">
                Member (&lt;100)
              </Badge>
              <div className="text-2xl font-extrabold text-foreground">
                {summary.donorsByTier.Member || 0}
              </div>
              <p className="text-[10px] text-muted-foreground">Awaiting 1st Donation</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
