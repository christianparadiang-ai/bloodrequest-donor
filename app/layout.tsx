import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { Badge } from "@/components/ui/badge";
import { Droplet, ShieldAlert } from "lucide-react";
import { AuthNav } from "@/components/auth-nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Life Drop — Blood Request & Donor Coordination System",
  description:
    "Mission-critical blood request coordination network connecting urgent patient needs with voluntary donors.",
};

const clerkPublishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  "pk_test_Y2xvc2Utc3RhZy00OTEwLmNsZXJrLmFjY291bnRzLmRldiQ";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <html lang="en" className={`${inter.className} h-full antialiased`}>
        <body className="min-h-full flex flex-col bg-background text-foreground">
          {/* Top Medical Disclaimer Notification Bar */}
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-center gap-2 text-center">
            <ShieldAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Medical Safety Notice:</strong> Life Drop is a voluntary discovery network. Clinical eligibility, laboratory cross-matching, and blood draws are strictly performed by licensed medical facilities.
            </span>
          </div>

          {/* Main Application Shell Navigation */}
          <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              {/* Brand Logo */}
              <div className="flex items-center gap-6">
                <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Droplet className="size-5 fill-primary" />
                  </div>
                  <span>Life Drop</span>
                  <Badge variant="outline" className="text-[10px] uppercase font-semibold tracking-wider">
                    Foundation
                  </Badge>
                </Link>

                {/* Primary Nav Links */}
                <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground">
                  <Link href="/requests" className="hover:text-foreground transition-colors">
                    Blood Requests
                  </Link>
                  <Link href="/donor" className="hover:text-foreground transition-colors">
                    Donor Network
                  </Link>
                  <Link href="/donor/benefits" className="hover:text-foreground transition-colors">
                    Recognition & Honors
                  </Link>
                  <Link href="/admin/reports" className="hover:text-foreground transition-colors">
                    Reports
                  </Link>
                  <Link href="/dashboard" className="hover:text-foreground transition-colors">
                    Dashboard
                  </Link>
                  <Link href="/admin" className="hover:text-foreground transition-colors">
                    Admin
                  </Link>
                </nav>
              </div>

              {/* Authentication & User Controls */}
              <Suspense fallback={<div className="size-8 rounded-full bg-muted animate-pulse" />}>
                <AuthNav />
              </Suspense>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 flex flex-col">{children}</main>

          {/* Footer */}
          <footer className="border-t border-border/60 bg-muted/30 py-8 px-4 text-center text-xs text-muted-foreground">
            <div className="max-w-7xl mx-auto space-y-2">
              <p className="font-medium text-foreground/80">
                Life Drop Voluntary Blood Coordination Network
              </p>
              <p className="max-w-2xl mx-auto">
                Coordination platform only. Does not provide medical diagnoses or authorization for transfusion procedures. All donations are collected and verified under accredited clinical oversight.
              </p>
              <p className="text-[11px] pt-2 text-muted-foreground/70">
                &copy; 2026 Life Drop. All rights reserved.
              </p>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
