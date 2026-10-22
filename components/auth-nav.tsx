"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { HeartPulse, User, Bell, Shield } from "lucide-react";

const INITIAL_ADMIN_EMAIL = "christian.paradiang@urios.edu.ph";

export function AuthNav() {
  const { isSignedIn, isLoaded, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (isSignedIn && user) {
    const primaryEmail = (user.primaryEmailAddress?.emailAddress || "").toLowerCase();
    const role = (user.publicMetadata?.role as string) || "USER";

    // Strictly authorize admin navigation visibility only for christian.paradiang@urios.edu.ph or verified ADMIN role
    const isAuthorizedAdmin =
      primaryEmail === INITIAL_ADMIN_EMAIL ||
      role === "ADMIN" ||
      role === "SUPER_ADMIN";

    return (
      <div className="flex items-center gap-2.5">
        {/* Admin Navigation Option: Strictly hidden from unauthorized users */}
        {isAuthorizedAdmin && (
          <Link href="/admin">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-semibold border-primary/40 text-primary hover:bg-primary/10"
            >
              <Shield className="size-3.5 text-primary" />
              Admin
            </Button>
          </Link>
        )}

        <Link href="/donor/notifications" title="Candidate Alerts & Notifications">
          <Button variant="ghost" size="sm" className="size-8 p-0 text-muted-foreground hover:text-foreground">
            <Bell className="size-4" />
          </Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex gap-1.5">
            <HeartPulse className="size-3.5 text-primary" />
            Dashboard
          </Button>
        </Link>
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-8",
            },
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <SignInButton mode="modal">
        <Button variant="ghost" size="sm" className="gap-1.5">
          <User className="size-3.5" />
          Sign In
        </Button>
      </SignInButton>
      <SignUpButton mode="modal">
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
          Sign Up
        </Button>
      </SignUpButton>
    </div>
  );
}
