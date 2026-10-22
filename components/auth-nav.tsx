"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { HeartPulse, User, Bell, Shield } from "lucide-react";
import { getCurrentUserRoleAction } from "@/lib/auth/actions";

export function AuthNav() {
  const { isSignedIn, isLoaded, user } = useUser();
  const [serverIsAdmin, setServerIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    if (isSignedIn && user?.id) {
      getCurrentUserRoleAction()
        .then((res) => {
          if (active) {
            setServerIsAdmin(res.isAdmin);
          }
        })
        .catch(() => {
          if (active) {
            setServerIsAdmin(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [isSignedIn, user?.id]);

  // When Clerk is loaded and user is authenticated
  if (isLoaded && isSignedIn && user) {
    const adminEmailPresent = user.emailAddresses?.some(
      (e) => e.emailAddress.toLowerCase().trim() === "christian.paradiang@urios.edu.ph"
    );
    const primaryEmail = (
      user.primaryEmailAddress?.emailAddress ||
      user.emailAddresses?.[0]?.emailAddress ||
      ""
    ).toLowerCase().trim();
    // Strictly check verified administrator identity to prevent ordinary users from seeing the Admin link
    const isClientAdminIdentity =
      (primaryEmail === "christian.paradiang@urios.edu.ph" || adminEmailPresent || user.id === "user_3KTw3DOq4dsbAKiqeQ50fiwOZZU");

    const isAuthorizedAdmin = serverIsAdmin !== null ? serverIsAdmin : isClientAdminIdentity;

    return (
      <div className="flex items-center gap-2.5">
        <Link href="/donor/notifications" title="Candidate Alerts & Notifications">
          <Button variant="ghost" size="sm" className="size-8 p-0 text-muted-foreground hover:text-foreground">
            <Bell className="size-4" />
          </Button>
        </Link>

        {isAuthorizedAdmin && (
          <Link href="/admin">
            <Button
              variant="outline"
              size="sm"
              className="inline-flex gap-1.5 text-xs font-semibold border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500 shadow-xs"
            >
              <Shield className="size-3.5" />
              Admin
            </Button>
          </Link>
        )}

        <Link href="/dashboard">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex gap-1.5 text-xs font-medium">
            <HeartPulse className="size-3.5 text-primary" />
            Dashboard
          </Button>
        </Link>

        {/* Clerk UserButton provides user profile details and Sign Out action */}
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

  // Signed-out or initial pre-hydration SSR state:
  // Render clear, immediate Sign In and Sign Up buttons linking to the dedicated Clerk routes.
  // This guarantees Sign Up and Sign In are ALWAYS visible to visitors without waiting on client JS.
  return (
    <div className="flex items-center gap-2">
      <Link href="/sign-in">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground text-xs font-medium">
          <User className="size-3.5" />
          Sign In
        </Button>
      </Link>
      <Link href="/sign-up">
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4 text-xs shadow-sm">
          Sign Up
        </Button>
      </Link>
    </div>
  );
}
