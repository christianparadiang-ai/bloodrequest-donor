import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  HeartHandshake,
  ShieldAlert,
  ArrowRight,
  PlusCircle,
  FileCheck2,
  Bell,
  Award,
} from "lucide-react";
import { getDonorProfile, calculateProfileCompletion } from "@/lib/donor/service";
import { getUnreadNotificationCount } from "@/lib/notifications/service";
import { getDonorPointsSummary, getDonorLeaderboard } from "@/lib/donations/points";
import { PointsAndBenefitsCard } from "@/components/donor/points-and-benefits-card";
import { DonorDashboardClient } from "@/components/donor/dashboard-client";

export const instant = false;

export default async function DonorHubPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const [donor, unreadCount, pointsSummary, leaderboard] = await Promise.all([
    getDonorProfile(user.id),
    getUnreadNotificationCount(user.id),
    getDonorPointsSummary(user.id),
    getDonorLeaderboard(5),
  ]);
  const completion = calculateProfileCompletion(donor);

  return (
    <div className="flex-1 py-10 px-4 max-w-5xl mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-extrabold tracking-tight">Donor Hub</h1>
            <Badge variant="outline" className="text-xs">
              {donor ? "Registered Donor" : "Onboarding Pending"}
            </Badge>
            {donor && (
              <Badge className={pointsSummary.badgeColor}>
                {pointsSummary.currentTierName}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Manage your voluntary availability status, contact consent, and view non-monetary recognition points.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {donor && (
            <Link href="/donor/benefits">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Award className="size-4 text-amber-500" />
                Benefits & Honors
              </Button>
            </Link>
          )}

          {donor && (
            <Link href="/donor/notifications">
              <Button size="sm" variant="outline" className="gap-1.5 relative">
                <Bell className="size-4" />
                Notifications
                {unreadCount > 0 && (
                  <Badge variant="default" className="text-[10px] h-4.5 px-1.5 bg-primary">
                    {unreadCount}
                  </Badge>
                )}
              </Button>
            </Link>
          )}

          {donor ? (
            <Link href="/donor/onboarding">
              <Button size="sm" variant="outline" className="gap-1.5">
                Edit Profile
              </Button>
            </Link>
          ) : (
            <Link href="/donor/onboarding">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5">
                <PlusCircle className="size-4" />
                Register as Donor
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* When no donor profile exists yet: Incomplete / Onboarding Callout */}
      {!donor ? (
        <div className="space-y-6">
          <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
            <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
              Voluntary Donor Discovery
            </AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
              Registration in Life Drop indicates availability to receive urgent blood requests. Actual medical qualification, hemoglobin testing, and clinical collection are performed exclusively at accredited hospital blood banks.
            </AlertDescription>
          </Alert>

          <Card className="border-border/60 text-center py-12 px-4 space-y-4">
            <div className="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <HeartHandshake className="size-8" />
            </div>

            <div className="max-w-md mx-auto space-y-2">
              <CardTitle className="text-2xl font-bold">
                Complete Your Donor Profile
              </CardTitle>
              <CardDescription className="text-sm">
                You haven&apos;t registered your donor profile yet. Setup your ABO/Rh blood group, location municipality, and service radius to participate in emergency match discovery.
              </CardDescription>
            </div>

            <div className="pt-4">
              <Link href="/donor/onboarding">
                <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                  <FileCheck2 className="size-4" />
                  Start Donor Onboarding
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      ) : (
        /* When donor profile is present: Points Card and Full Donor Dashboard */
        <div className="space-y-8">
          <PointsAndBenefitsCard
            summary={pointsSummary}
            leaderboard={leaderboard}
          />
          <DonorDashboardClient donor={donor} completion={completion} />
        </div>
      )}
    </div>
  );
}
