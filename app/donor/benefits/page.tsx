import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDonorPointsSummary, getDonorLeaderboard } from "@/lib/donations/points";
import { PointsAndBenefitsCard } from "@/components/donor/points-and-benefits-card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

export const instant = false;

export default async function DonorBenefitsPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const [summary, leaderboard] = await Promise.all([
    getDonorPointsSummary(user.id),
    getDonorLeaderboard(10),
  ]);

  return (
    <div className="flex-1 py-10 px-4 max-w-5xl mx-auto w-full space-y-8">
      {/* Top Breadcrumb & Header */}
      <div>
        <Link
          href="/donor"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Donor Hub
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-extrabold tracking-tight">
                Donor Benefits & Recognition
              </h1>
              <Badge variant="outline" className="text-xs">
                Solidarity Honors
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Understanding your earned donor points, milestone recognition levels, and community solidarity impact.
            </p>
          </div>
        </div>
      </div>

      {/* Main Points and Benefits Interactive Card */}
      <PointsAndBenefitsCard
        summary={summary}
        leaderboard={leaderboard}
        showFullDetails={true}
      />
    </div>
  );
}
