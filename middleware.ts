import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

// Fallback staging keys to ensure the public site never crashes with 500 MIDDLEWARE_INVOCATION_FAILED
const publishableKey =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  "pk_test_Y2xvc2Utc3RhZy00OTEwLmNsZXJrLmFjY291bnRzLmRldiQ";
const secretKey =
  process.env.CLERK_SECRET_KEY ||
  "sk_test_8fOGEDfW5dMfSJACu17WAXa4qR7pXDHuaiBsCG3vJA";

// Routes that strictly require authenticated sessions
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/donor(.*)",
  "/requests/new(.*)",
  "/admin(.*)",
]);

const clerkHandler = clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
    return NextResponse.next();
  },
  {
    publishableKey,
    secretKey,
  }
);

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  try {
    return await clerkHandler(req, ev);
  } catch (error) {
    console.error("Middleware bypass on error:", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
