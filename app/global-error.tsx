"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertCircle, RotateCcw, Home } from "lucide-react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error caught:", error?.message || "Unknown error", error?.digest ? `(digest: ${error.digest})` : "");
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground antialiased">
        <Card className="max-w-md w-full border-border/80 shadow-xl">
          <CardHeader className="text-center pb-4">
            <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="size-6" />
            </div>
            <CardTitle className="text-xl font-bold">System Unavailable</CardTitle>
            <CardDescription className="text-sm">
              An unexpected system error occurred. Medical request data and user records are secure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/50 border border-border/60 text-xs text-muted-foreground text-center">
              {error?.digest ? (
                <span>Error Reference: <code className="font-mono text-foreground">{error.digest}</code></span>
              ) : (
                <span>Please try reloading or check your network connection.</span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                onClick={() => reset()}
                className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                <RotateCcw className="size-4" />
                Reload Application
              </Button>
              <Link href="/" className="flex-1">
                <Button variant="outline" className="w-full gap-2 font-medium">
                  <Home className="size-4" />
                  Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </body>
    </html>
  );
}
