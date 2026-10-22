"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertCircle, RotateCcw, Home, HeartHandshake } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log sanitized error without leaking sensitive tokens or stack to the client UI
    console.error("Application error boundary triggered:", error?.message || "Unknown error", error?.digest ? `(digest: ${error.digest})` : "");
  }, [error]);

  return (
    <div className="flex-1 min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-border/80 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="size-6" />
          </div>
          <CardTitle className="text-xl font-bold">Temporary Operational Issue</CardTitle>
          <CardDescription className="text-sm">
            Life Drop encountered an unexpected situation while processing this request. Our medical coordination services remain safely protected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/50 border border-border/60 text-xs text-muted-foreground text-center">
            {error?.digest ? (
              <span>Error Reference ID: <code className="font-mono text-foreground">{error.digest}</code></span>
            ) : (
              <span>Please refresh your connection or return to the main dashboard.</span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button
              onClick={() => reset()}
              variant="default"
              className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              <RotateCcw className="size-4" />
              Try Again
            </Button>
            <Link href="/" className="flex-1">
              <Button variant="outline" className="w-full gap-2 font-medium">
                <Home className="size-4" />
                Return Home
              </Button>
            </Link>
          </div>
          <div className="text-center pt-2">
            <Link href="/requests" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <HeartHandshake className="size-3 text-primary" />
              View Active Blood Requests
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
