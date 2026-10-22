import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDonorNotifications } from "@/lib/notifications/service";
import { getDonorCommitments } from "@/lib/commitments/service";
import { DonorNotificationList } from "@/components/notifications/donor-notification-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BellRing } from "lucide-react";

export const instant = false;

export const metadata = {
  title: "Donor Notifications | Life Drop",
  description: "View candidate alerts and potential match notifications for active blood requests.",
};

export default async function DonorNotificationsPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const [notifications, commitments] = await Promise.all([
    getDonorNotifications(user.id),
    getDonorCommitments(user.id),
  ]);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex-1 py-10 px-4 max-w-4xl mx-auto w-full space-y-6">
      {/* Breadcrumb / Back button */}
      <div>
        <Link href="/donor">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
            <ArrowLeft className="size-3.5" />
            Back to Donor Hub
          </Button>
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <BellRing className="size-4" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Candidate Alerts & Notifications</h1>
            {unreadCount > 0 && (
              <Badge variant="default" className="text-xs bg-primary">
                {unreadCount} New
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Operational match alerts received when an active requisition matches your donor profile criteria.
          </p>
        </div>
      </div>

      {/* Main Notifications Experience */}
      <DonorNotificationList
        initialNotifications={notifications}
        initialCommitments={commitments}
      />
    </div>
  );
}
