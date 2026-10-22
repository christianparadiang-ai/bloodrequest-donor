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

export default async function BloodRequestsPage() {
  const user = await currentUser();

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
          </div>
          <p className="text-sm text-muted-foreground">
            Emergency and routine hospital blood requests verified for volunteer donor matching.
          </p>
        </div>

        <Link href="/requests/new">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 shadow-sm font-semibold">
            <PlusCircle className="size-4" />
            Create Request
          </Button>
        </Link>
      </div>

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
      <Tabs defaultValue={user ? "my-requests" : "active-directory"} className="space-y-6">
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
                    <h3 className="font-semibold text-base">No Requisitions Yet</h3>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      You haven’t initiated any blood requests. Create your first requisition for hospital verification and volunteer donor coordination.
                    </p>
                  </div>
                  <Link href="/requests/new" className="pt-2">
                    <Button size="sm" className="bg-primary text-primary-foreground gap-1.5 font-semibold">
                      <PlusCircle className="size-4" />
                      Create First Requisition
                    </Button>
                  </Link>
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
