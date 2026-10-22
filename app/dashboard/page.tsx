import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDonorProfile, calculateProfileCompletion } from "@/lib/donor/service";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  User,
  ShieldCheck,
  Database,
  Activity,
  HeartHandshake,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Compass,
} from "lucide-react";

export const instant = false;

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  // 1. Verify Supabase connection server-side
  let supabaseConnected = false;
  let supabaseMessage = "Initializing connection...";

  try {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const { error } = await admin
        .from("profiles")
        .select("count", { count: "exact", head: true });

      if (!error) {
        supabaseConnected = true;
        supabaseMessage = "Connected to Supabase PostgreSQL via PostgREST";
      } else {
        supabaseMessage = `Supabase query returned: ${error.message}`;
      }
    } else {
      supabaseMessage = "Supabase environment credentials not fully configured.";
    }
  } catch (err: unknown) {
    supabaseMessage = err instanceof Error ? err.message : "Unknown connection error";
  }

  // 2. Fetch current donor status
  const donor = await getDonorProfile(user.id);
  const completion = calculateProfileCompletion(donor);

  const primaryEmail = user.emailAddresses[0]?.emailAddress || "No email on record";
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";

  return (
    <div className="flex-1 py-10 px-4 max-w-6xl mx-auto w-full space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-3xl font-extrabold tracking-tight">System Dashboard</h1>
            <Badge variant="outline" className="text-xs">
              Protected Session
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Welcome back, {fullName}. All operations authenticated via Clerk identity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/requests">
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5">
              <Activity className="size-4" />
              Blood Requests
            </Button>
          </Link>
          <Link href="/donor">
            <Button size="sm" variant="outline" className="gap-1.5">
              <HeartHandshake className="size-4 text-primary" />
              Donor Portal
            </Button>
          </Link>
        </div>
      </div>

      {/* Medical Boundary Alert */}
      <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
        <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
          Operational Medical Guardrail
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
          Matches presented in this application are potential compatibility matches for discovery only. Licensed medical personnel must perform full clinical verification and laboratory testing prior to any transfusion.
        </AlertDescription>
      </Alert>

      {/* Top Cards: User Session, Donor Status & Database */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* User Identity Card */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1">
              <User className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Authenticated User
              <Badge variant="secondary" className="text-xs">
                Active
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Verified through Clerk Identity Provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <p className="text-muted-foreground">Full Name</p>
              <p className="font-semibold text-sm text-foreground">{fullName}</p>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium text-foreground">{primaryEmail}</p>
            </div>
          </CardContent>
        </Card>

        {/* Donor Status Card */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-1">
              <HeartHandshake className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Donor Status
              {donor ? (
                <Badge
                  variant={donor.isAvailable ? "default" : "secondary"}
                  className={donor.isAvailable ? "bg-emerald-600 text-white text-[10px]" : "text-[10px]"}
                >
                  {donor.isAvailable ? "AVAILABLE" : "UNAVAILABLE"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">
                  Unregistered
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {donor ? `${completion.percentage}% Profile Complete` : "No profile logged yet"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {donor ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Blood Group</span>
                  <span className="font-bold text-sm text-primary">{donor.bloodGroup}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Compass className="size-3 text-primary" /> Coverage
                  </span>
                  <span className="font-medium">{donor.serviceRadiusKm} km radius</span>
                </div>
                <div className="pt-1">
                  <Link href="/donor">
                    <Button variant="outline" size="xs" className="w-full text-xs">
                      Manage Donor Profile
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <div className="space-y-3 py-1">
                <p className="text-muted-foreground">
                  Register as a voluntary donor to configure blood group and availability.
                </p>
                <Link href="/donor/onboarding">
                  <Button size="xs" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
                    Start Onboarding
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supabase Connectivity Card */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="size-9 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center mb-1">
              <Database className="size-4" />
            </div>
            <CardTitle className="text-base flex items-center justify-between">
              Supabase Connection
              {supabaseConnected ? (
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 dark:border-emerald-800 text-[10px]">
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-800 text-[10px]">
                  Pending
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              PostgreSQL PostgREST health and schema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-start gap-2">
              {supabaseConnected ? (
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <p className="text-muted-foreground">{supabaseMessage}</p>
            </div>
            <Separator />
            <div className="text-[11px] text-muted-foreground">
              RLS policies active for <code>profiles</code> & <code>donor_profiles</code>.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Module Navigation */}
      <div className="pt-2">
        <h2 className="text-base font-semibold mb-3">Module Navigation (Milestone Roadmap)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/requests" className="group">
            <Card className="hover:border-primary/50 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Blood Requests
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardTitle>
                <CardDescription className="text-xs">
                  Create, track, and manage patient blood requisitions.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/donor" className="group">
            <Card className="hover:border-primary/50 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Donor Hub
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardTitle>
                <CardDescription className="text-xs">
                  Availability status, ABO/Rh registration, service radius.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin" className="group">
            <Card className="hover:border-primary/50 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Admin & Governance
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardTitle>
                <CardDescription className="text-xs">
                  Organization verification, audit logging, system metrics.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
