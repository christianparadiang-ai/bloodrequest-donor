"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { HeartPulse, User, Bell } from "lucide-react";

export function AuthNav() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <div className="flex items-center gap-3">
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
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
          Join as Donor
        </Button>
      </SignUpButton>
    </div>
  );
}
