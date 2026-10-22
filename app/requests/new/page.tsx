import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const instant = false;
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { CreateRequestForm } from "@/components/requests/create-request-form";

export default async function NewBloodRequestPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="flex-1 py-10 px-4 max-w-3xl mx-auto w-full space-y-8">
      <div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Requests Directory
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">Create Blood Request</h1>
          <Badge variant="outline" className="text-xs">
            Protected
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Initiate an urgent blood request for hospital verification and voluntary donor matching.
        </p>
      </div>

      <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
        <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
          Medical Verification Requirement
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
          All requests must be backed by a verified clinical requisition or prescription. Requisitions are submitted for review by authorized hospital staff prior to active broadcast.
        </AlertDescription>
      </Alert>

      <CreateRequestForm />
    </div>
  );
}
