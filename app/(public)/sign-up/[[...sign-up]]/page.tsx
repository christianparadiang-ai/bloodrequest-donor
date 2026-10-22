import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { Skeleton } from "@/components/ui/skeleton";

export default function SignUpPage() {
  return (
    <div className="flex-1 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={<Skeleton className="w-full h-[520px] rounded-xl" />}>
          <SignUp />
        </Suspense>
      </div>
    </div>
  );
}
