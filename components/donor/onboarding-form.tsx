"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HeartHandshake,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Compass,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { BLOOD_GROUPS, donorProfileFormSchema } from "@/lib/validations";
import { saveDonorProfileAction } from "@/lib/donor/actions";
import { FormattedDonorData } from "@/lib/donor/service";
import { BloodGroup } from "@/lib/supabase/types";

interface OnboardingFormProps {
  initialData?: FormattedDonorData | null;
}

export function OnboardingForm({ initialData }: OnboardingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form State
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>(
    initialData?.bloodGroup || "O+"
  );
  const [city, setCity] = useState(initialData?.city || "");
  const [province, setProvince] = useState(initialData?.province || "");
  const [serviceRadiusKm, setServiceRadiusKm] = useState<number>(
    initialData?.serviceRadiusKm || 25
  );
  const [isAvailable, setIsAvailable] = useState<boolean>(
    initialData ? initialData.isAvailable : true
  );
  const [consentToContact, setConsentToContact] = useState<boolean>(
    initialData ? initialData.consentToContact : false
  );

  // Status feedback
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Client-side pre-validation
    const clientValidation = donorProfileFormSchema.safeParse({
      blood_group: bloodGroup,
      city,
      province,
      service_radius_km: serviceRadiusKm,
      is_available: isAvailable,
      consent_to_contact: consentToContact,
    });

    if (!clientValidation.success) {
      const firstIssue = clientValidation.error.issues[0]?.message;
      setErrorMessage(firstIssue || "Please verify your input fields.");
      return;
    }

    startTransition(async () => {
      const res = await saveDonorProfileAction({
        blood_group: bloodGroup,
        city,
        province,
        service_radius_km: Number(serviceRadiusKm),
        is_available: isAvailable,
        consent_to_contact: consentToContact,
      });

      if (!res.success) {
        setErrorMessage(res.error || "Failed to save donor profile.");
      } else {
        setSuccessMessage(
          initialData
            ? "Donor profile updated successfully!"
            : "Welcome to Life Drop! Your voluntary donor profile is active."
        );
        setTimeout(() => {
          router.push("/donor");
          router.refresh();
        }, 1200);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Medical Boundary Alert */}
      <Alert className="border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-200 font-semibold text-sm">
          Operational Availability Notice
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300 text-xs">
          Registering availability on Life Drop indicates willingness to receive potential blood requests. Clinical eligibility (hemoglobin screen, infection markers, donation intervals) is evaluated exclusively by medical professionals at the hospital blood bank.
        </AlertDescription>
      </Alert>

      {/* Form Error Banner */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle className="font-semibold text-sm">Validation Error</AlertTitle>
          <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Form Success Banner */}
      {successMessage && (
        <Alert className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <AlertTitle className="font-semibold text-sm">Profile Saved</AlertTitle>
          <AlertDescription className="text-xs">{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Main Card */}
      <Card className="border-border/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-1">
              <HeartHandshake className="size-4" />
            </div>
            <Badge variant="outline" className="text-xs">
              {initialData ? "Update Profile" : "New Registration"}
            </Badge>
          </div>
          <CardTitle className="text-xl">
            {initialData ? "Edit Voluntary Donor Profile" : "Voluntary Donor Onboarding"}
          </CardTitle>
          <CardDescription>
            Configure your ABO/Rh blood group, service area, and alert preferences.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Section 1: Blood Group */}
          <div className="space-y-2">
            <Label htmlFor="blood-group" className="text-sm font-semibold">
              Blood Group (ABO + Rh Factor) <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Select your known blood group. Compatibility discovery will filter requests based on this type.
            </p>
            <div className="pt-1 max-w-xs">
              <Select
                value={bloodGroup}
                onValueChange={(val) => setBloodGroup(val as BloodGroup)}
                disabled={isPending}
              >
                <SelectTrigger id="blood-group" className="w-full">
                  <SelectValue placeholder="Select your blood group" />
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((bg) => (
                    <SelectItem key={bg} value={bg}>
                      <span className="font-semibold">{bg}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section 2: Operational Availability Toggle */}
          <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="availability-toggle" className="text-sm font-semibold cursor-pointer">
                    Operational Availability Status
                  </Label>
                  <Badge
                    variant={isAvailable ? "default" : "secondary"}
                    className={
                      isAvailable
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white text-[10px]"
                        : "text-muted-foreground text-[10px]"
                    }
                  >
                    {isAvailable ? "AVAILABLE" : "UNAVAILABLE"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Toggle whether you are currently active to receive emergency donation alerts.
                </p>
              </div>
              <Switch
                id="availability-toggle"
                checked={isAvailable}
                onCheckedChange={setIsAvailable}
                disabled={isPending}
              />
            </div>
          </div>

          {/* Section 3: Location / Service Area */}
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <MapPin className="size-4 text-primary" />
              <span>Location & Service Coverage Area</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city" className="text-xs font-medium">
                  City / Municipality <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="city"
                  placeholder="e.g. Quezon City, Cebu City, Makati"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="province" className="text-xs font-medium">
                  Province / State / Region <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="province"
                  placeholder="e.g. Metro Manila, Cebu, Laguna"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  disabled={isPending}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="radius" className="text-xs font-medium flex items-center gap-1.5">
                  <Compass className="size-3.5 text-primary" />
                  Service Radius (Kilometers) <span className="text-destructive">*</span>
                </Label>
                <span className="text-xs font-bold text-primary">{serviceRadiusKm} km</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum distance you are willing to travel for blood request fulfillment (1 to 150 km).
              </p>
              <div className="flex items-center gap-3 pt-1">
                <Input
                  id="radius"
                  type="number"
                  min={1}
                  max={150}
                  value={serviceRadiusKm}
                  onChange={(e) => setServiceRadiusKm(Number(e.target.value))}
                  disabled={isPending}
                  className="max-w-[120px]"
                />
                <span className="text-xs text-muted-foreground">kilometers radius</span>
              </div>
            </div>
          </div>

          {/* Section 4: Contact Consent */}
          <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" />
                  <Label htmlFor="contact-consent" className="text-sm font-semibold cursor-pointer">
                    Explicit Contact Consent <span className="text-destructive">*</span>
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  I give explicit permission for Life Drop to notify me of urgent compatible blood requests within my service radius.
                </p>
                <p className="text-[11px] text-muted-foreground/80">
                  Your phone number and private contact details remain protected and are never shared publicly.
                </p>
              </div>
              <Switch
                id="contact-consent"
                checked={consentToContact}
                onCheckedChange={setConsentToContact}
                disabled={isPending}
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>

          <Button
            type="submit"
            disabled={isPending || !consentToContact}
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving Profile...
              </>
            ) : (
              <>
                {initialData ? "Update Donor Profile" : "Complete Registration"}
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
