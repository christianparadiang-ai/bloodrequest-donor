import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OnboardingForm } from "@/components/donor/onboarding-form";
import { getDonorProfile } from "@/lib/donor/service";
import { ArrowLeft, HeartHandshake } from "lucide-react";

export const instant = false;

export default async function DonorOnboardingPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Fetch existing donor profile if already created (for editing)
  const existingDonor = await getDonorProfile(user.id);

  return (
    <div className="flex-1 py-10 px-4 max-w-3xl mx-auto w-full space-y-6">
      {/* Back button */}
      <div>
        <Link
          href="/donor"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Donor Hub
        </Link>
        <div className="flex items-center gap-2">
          <HeartHandshake className="size-6 text-primary" />
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {existingDonor ? "Update Donor Profile" : "Voluntary Donor Registration"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {existingDonor
            ? "Update your blood group, service area, availability, or contact preferences."
            : "Complete your donor profile to participate in local emergency blood request discovery."}
        </p>
      </div>

      {/* Onboarding Form */}
      <OnboardingForm initialData={existingDonor} />
    </div>
  );
}
