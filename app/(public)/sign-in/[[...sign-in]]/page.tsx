import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignInPage() {
  return (
    <div className="flex-1 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<Skeleton className="w-full h-[450px] rounded-xl" />}>
          <SignIn />
        </Suspense>
      </div>
    </div>
  );
}
