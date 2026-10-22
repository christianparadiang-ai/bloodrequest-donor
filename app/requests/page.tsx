import { currentUser } from "@clerk/nextjs/server";
import Link from "next/link";

export const instant = false;
import {
  listUserBloodRequests,
  listActiveBloodRequests,
} from "@/lib/requests/service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RequestCard } from "@/components/requests/request-card";
import { RequestDirectoryClient } from "@/components/requests/request-directory-client";
import {
  PlusCircle,
  ShieldCheck,
  Droplet,
  FolderOpen,
  Radio,
} from "lucide-react";

import { resolveUserRole } from "@/lib/auth";
import { UserRole } from "@/lib/supabase/types";

export default async function BloodRequestsPage() {
  const user = await currentUser();

  let userRole: UserRole = "USER";
  if (user) {
    const primaryEmail = (user.emailAddresses?.[0]?.emailAddress || "").toLowerCase();
    userRole = await resolveUserRole(user.id, primaryEmail);
  }
  const isPrivileged = ["ADMIN", "SUPER_ADMIN", "MODERATOR", "HOSPITAL_STAFF"].includes(userRole);

  const [userRequestsRes, activeRequestsRes] = await Promise.all([
    user ? listUserBloodRequests(user.id) : Promise.resolve({ success: true, requests: [] }),
    listActiveBloodRequests(user?.id),
  ]);

  const userRequests = userRequestsRes.requests || [];
  const activeRequests = activeRequestsRes.requests || [];

  return (
    <div className="flex-1 py-10 px-4 max-w-5xl mx-auto w-full space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-extrabold tracking-tight">Blood Requisitions</h1>
            <Badge variant="outline" className="text-xs">
              Intake & Verification
            </Badge>
            {isPrivileged && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs">
                Role: {userRole}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Emergency and routine hospital blood requests verified for volunteer donor matching.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isPrivileged && (
            <Link href="/admin">
              <Button variant="outline" className="gap-1.5 font-semibold text-xs border-primary/30 text-primary hover:bg-primary/10">
                <ShieldCheck className="size-4" />
                Admin Queue
              </Button>
            </Link>
          )}
          <Link href="/requests/new">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 shadow-sm font-semibold">
              <PlusCircle className="size-4" />
              Create Request
            </Button>
          </Link>
        </div>
      </div>

      {/* Privileged Staff & Admin Notice */}
      {isPrivileged && (
        <Alert className="border-primary/30 bg-primary/5">
          <ShieldCheck className="size-4 text-primary" />
          <AlertTitle className="text-foreground font-semibold text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              {userRole === "ADMIN" ? "Platform Administrator Authorization" : "Clinical Staff Authorization"} Active
            </span>
            <Link href="/admin">
              <Button size="sm" className="bg-primary text-primary-foreground font-semibold gap-1 text-xs h-7">
                Open Admin Review Queue &rarr;
              </Button>
            </Link>
          </AlertTitle>
          <AlertDescription className="text-muted-foreground text-xs mt-1">
            You have verification privileges. Unverified patient requisitions waiting in SUBMITTED or UNDER_REVIEW status appear in the System Administration Review Queue.
          </AlertDescription>
        </Alert>
      )}

      {/* Medical Safety Notice */}
      <Alert className="border-border/60 bg-muted/30">
        <ShieldCheck className="size-4 text-primary" />
        <AlertTitle className="font-semibold text-sm">
          Operational Verification & Matching Protocol
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground">
          Requests progress through operational verification before volunteer donor activation. Requisition status and donor availability do not represent medical eligibility determinations.
        </AlertDescription>
      </Alert>

      {/* Tabs Layout */}
      <Tabs defaultValue={user && userRequests.length > 0 ? "my-requests" : "active-directory"} className="space-y-6">
        <TabsList className="grid w-full sm:w-auto grid-cols-2">
          {user && (
            <TabsTrigger value="my-requests" className="gap-2 text-xs">
              <FolderOpen className="size-3.5" />
              My Requisitions ({userRequests.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="active-directory" className="gap-2 text-xs">
            <Radio className="size-3.5" />
            Active Directory ({activeRequests.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: User's Requisitions */}
        {user && (
          <TabsContent value="my-requests" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Your Submitted & Draft Requisitions</h2>
              <span className="text-xs text-muted-foreground">
                {userRequests.length} total {userRequests.length === 1 ? "requisition" : "requisitions"}
              </span>
            </div>

            {userRequests.length === 0 ? (
              <Card className="border-dashed border-border/80">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                  <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    <Droplet className="size-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-base">
                      {isPrivileged ? "No Personal Requisitions" : "No Requisitions Yet"}
                    </h3>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      {isPrivileged
                        ? "You haven't initiated personal blood requests. To review, verify, and approve patient requisitions submitted by all users, use the Admin Review Queue."
                        : "You haven’t initiated any blood requests. Create your first requisition for hospital verification and volunteer donor coordination."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    {isPrivileged && (
                      <Link href="/admin">
                        <Button size="sm" className="bg-primary text-primary-foreground gap-1.5 font-semibold">
                          <ShieldCheck className="size-4" />
                          Open Admin Review Queue
                        </Button>
                      </Link>
                    )}
                    <Link href="/requests/new">
                      <Button size="sm" variant={isPrivileged ? "outline" : "default"} className={isPrivileged ? "" : "bg-primary text-primary-foreground gap-1.5 font-semibold"}>
                        <PlusCircle className="size-4" />
                        Create Requisition
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {userRequests.map((req) => (
                  <RequestCard key={req.id} request={req} />
                ))}
              </div>
            )}
          </TabsContent>
        )}

        {/* Tab 2: Active Directory */}
        <TabsContent value="active-directory" className="space-y-4">
          <RequestDirectoryClient initialRequests={activeRequests} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
