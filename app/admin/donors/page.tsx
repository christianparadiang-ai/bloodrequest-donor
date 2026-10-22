import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { listAndFilterDonors } from "@/lib/donor/service";
import { DonorManagementClient } from "@/components/admin/donor-management-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, ArrowLeft } from "lucide-react";

export const instant = false;

import { resolveUserRole } from "@/lib/auth";

export default async function AdminDonorsPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
  const userRole = await resolveUserRole(user.id, primaryEmail);

  const isPrivileged =
    primaryEmail === "christian.paradiang@urios.edu.ph" ||
    ["HOSPITAL_STAFF", "MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(userRole);

  if (!isPrivileged) {
    return (
      <div className="flex-1 py-12 px-4 max-w-2xl mx-auto w-full text-center space-y-6">
        <div className="size-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
          <Lock className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Access Restricted</h1>
          <p className="text-sm text-muted-foreground">
            Donor network management and points governance require authorized clinical hospital staff, moderator, or administrator credentials.
          </p>
        </div>
        <div>
          <Link href="/dashboard">
            <Button variant="outline" className="gap-1.5">
              <ArrowLeft className="size-4" />
              Return to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Fetch initial donors list
  const donorsRes = await listAndFilterDonors({});
  const initialDonors = donorsRes.donors || [];

  return (
    <div className="flex-1 py-10 px-4 max-w-6xl mx-auto w-full space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Admin Hub
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-extrabold tracking-tight">
                Donor Management & Oversight
              </h1>
              <Badge variant="outline" className="text-xs">
                Role: {userRole}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Search voluntary donor network records, monitor points balance and recognition tiers, and perform authorized adjustments.
            </p>
          </div>
        </div>
      </div>

      {/* Main Donor Management Client Component */}
      <DonorManagementClient
        initialDonors={initialDonors}
        userRole={userRole}
      />
    </div>
  );
}
