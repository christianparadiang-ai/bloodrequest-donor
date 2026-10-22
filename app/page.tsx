import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  HeartHandshake,
  Activity,
  ShieldCheck,
  Lock,
  ArrowRight,
  Database,
  CheckCircle2,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      {/* Hero Section */}
      <section className="w-full py-16 md:py-24 px-4 bg-gradient-to-b from-primary/5 via-background to-background border-b border-border/40">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            Milestone 0: Foundation Initialized
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground max-w-4xl mx-auto">
            Urgent Blood Coordination, <span className="text-primary">Minutes Count</span>.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Life Drop connects emergency patient requisitions with verified voluntary donors and licensed hospital blood banks in a secure, explainable network.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <Link href="/requests">
              <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                <Activity className="size-4" />
                Find Blood Requests
              </Button>
            </Link>
            <Link href="/donor">
              <Button size="lg" variant="outline" className="gap-2">
                <HeartHandshake className="size-4 text-primary" />
                Donor Network
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="lg" variant="secondary" className="gap-2">
                Dashboard
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Foundation Verification Status */}
      <section className="w-full max-w-5xl mx-auto py-12 px-4 space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Foundation & Quality Gate</h2>
          <p className="text-muted-foreground text-sm">
            Core infrastructure components established and verified in Milestone 0.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="size-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-2">
                <Lock className="size-5" />
              </div>
              <CardTitle className="text-base flex items-center justify-between">
                Clerk Authentication
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 dark:border-emerald-800 text-[11px]">
                  Verified
                </Badge>
              </CardTitle>
              <CardDescription>
                Server-side identity protection, official Clerk middleware, and RBAC primitives.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                <span>Protected routing (/dashboard, /donor)</span>
              </div>
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0" />
                <span>Zero client-side credential leakage</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="size-10 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center mb-2">
                <Database className="size-5" />
              </div>
              <CardTitle className="text-base flex items-center justify-between">
                Supabase PostgreSQL
                <Badge variant="outline" className="text-blue-600 border-blue-300 dark:border-blue-800 text-[11px]">
                  Configured
                </Badge>
              </CardTitle>
              <CardDescription>
                @supabase/ssr utilities, privileged service client guards, and schema migrations.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-blue-600 shrink-0" />
                <span>Browser & server client utilities</span>
              </div>
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-blue-600 shrink-0" />
                <span>PostgreSQL RLS ready tables</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="size-10 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center mb-2">
                <ShieldCheck className="size-5" />
              </div>
              <CardTitle className="text-base flex items-center justify-between">
                Medical Boundary
                <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-800 text-[11px]">
                  Enforced
                </Badge>
              </CardTitle>
              <CardDescription>
                Strict demarcation between potential match discovery and clinical medical clearance.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-amber-600 shrink-0" />
                <span>Potential donor matches only</span>
              </div>
              <div className="flex items-center gap-1.5 text-foreground/80">
                <CheckCircle2 className="size-3.5 text-amber-600 shrink-0" />
                <span>Never claims clinical eligibility</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Medical Notice Alert */}
        <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
          <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
            Clinical Safety Invariant
          </AlertTitle>
          <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
            Life Drop coordinates voluntary blood donors with urgent patient requisitions. All actual compatibility cross-matching, donor eligibility physicals, blood draws, and transfusions are conducted exclusively under licensed medical supervision.
          </AlertDescription>
        </Alert>

        {/* Workflow Overview */}
        <div className="pt-6 space-y-4">
          <h3 className="text-lg font-bold">Planned Workflow Ecosystem</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2">
              <div className="size-8 rounded bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                01
              </div>
              <h4 className="font-semibold text-sm">Requester</h4>
              <p className="text-xs text-muted-foreground">
                Submit emergency request, specify blood group, units, hospital, and upload medical requisition.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2">
              <div className="size-8 rounded bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                02
              </div>
              <h4 className="font-semibold text-sm">Donor</h4>
              <p className="text-xs text-muted-foreground">
                Set availability, ABO/Rh blood group, service area radius, receive alerts, and accept commitments.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2">
              <div className="size-8 rounded bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                03
              </div>
              <h4 className="font-semibold text-sm">Hospital Staff</h4>
              <p className="text-xs text-muted-foreground">
                Review prescriptions, verify patient requisitions, check in scheduled donors, and record donations.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/60 bg-card space-y-2">
              <div className="size-8 rounded bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                04
              </div>
              <h4 className="font-semibold text-sm">Admin & Audit</h4>
              <p className="text-xs text-muted-foreground">
                Platform governance, hospital organization onboarding, immutable clinical audit logs.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
