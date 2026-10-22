"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBloodRequestAction } from "@/lib/requests/actions";
import { BloodGroup } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Droplet,
  Clock,
  Building2,
  Phone,
  FileText,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";

export function CreateRequestForm() {
  const router = useRouter();

  // Form State
  const [patientName, setPatientName] = useState("");
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | "">("");
  const [bloodComponent, setBloodComponent] = useState("WHOLE_BLOOD");
  const [unitsRequested, setUnitsRequested] = useState("2");
  const [urgencyLevel, setUrgencyLevel] = useState("URGENT");
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalCity, setHospitalCity] = useState("");
  const [province, setProvince] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [medicalNotes, setMedicalNotes] = useState("");

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (isDraft: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!bloodGroup) {
      setErrorMessage("Please select a required blood group.");
      return;
    }

    if (!requiredBy) {
      setErrorMessage("Please specify the date and time when blood units are required.");
      return;
    }

    const targetDate = new Date(requiredBy);
    if (isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
      setErrorMessage("The needed-by date and time must be in the future.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        patient_name: patientName,
        blood_group: bloodGroup,
        blood_component: bloodComponent,
        units_requested: parseInt(unitsRequested, 10),
        urgency_level: urgencyLevel,
        hospital_name: hospitalName,
        hospital_city: hospitalCity,
        province,
        contact_name: contactName,
        contact_number: contactNumber,
        required_by: targetDate.toISOString(),
        request_reason: requestReason,
        medical_notes: medicalNotes,
        is_draft: isDraft,
      };

      const result = await createBloodRequestAction(payload);

      if (!result.success || !result.data) {
        setErrorMessage(result.error || "Failed to create blood request.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(
        isDraft
          ? "Requisition draft saved successfully!"
          : "Blood requisition submitted for verification!"
      );

      setTimeout(() => {
        router.push(`/requests/${result.data?.id}`);
      }, 1000);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected submission error occurred."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Droplet className="size-4" />
          </div>
          <CardTitle className="text-xl">Requisition Details</CardTitle>
        </div>
        <CardDescription>
          Provide verified clinical requisitions and hospital destination details.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Medical Safety Notice */}
        <Alert className="border-border/60 bg-muted/40">
          <ShieldCheck className="size-4 text-primary" />
          <AlertTitle className="text-xs font-semibold">
            Operational Verification Policy
          </AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            This platform facilitates operational blood requests and potential volunteer donor matching. It does not provide medical treatment, diagnosis, or clinical certification.
          </AlertDescription>
        </Alert>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle className="text-xs font-semibold">Submission Error</AlertTitle>
            <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertTitle className="text-xs font-semibold">Success</AlertTitle>
            <AlertDescription className="text-xs">{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* Section 1: Patient & Blood Requirement */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b border-border/50 pb-2">
            <Droplet className="size-4 text-primary" />
            1. Blood Component & Patient Identifier
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="patient-name">Patient Name / Identifier</Label>
              <Input
                id="patient-name"
                placeholder="e.g. John Doe / Room 302"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Masked in public broadcast listings for patient privacy.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="blood-group">Required Blood Group (ABO + Rh)</Label>
              <Select
                value={bloodGroup}
                onValueChange={(val) => setBloodGroup((val as BloodGroup) || "")}
              >
                <SelectTrigger id="blood-group">
                  <SelectValue placeholder="Select ABO & Rh" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+ (A Positive)</SelectItem>
                  <SelectItem value="A-">A- (A Negative)</SelectItem>
                  <SelectItem value="B+">B+ (B Positive)</SelectItem>
                  <SelectItem value="B-">B- (B Negative)</SelectItem>
                  <SelectItem value="AB+">AB+ (AB Positive)</SelectItem>
                  <SelectItem value="AB-">AB- (AB Negative)</SelectItem>
                  <SelectItem value="O+">O+ (O Positive)</SelectItem>
                  <SelectItem value="O-">O- (O Negative)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="blood-component">Component Type</Label>
              <Select
                value={bloodComponent}
                onValueChange={(val) => setBloodComponent(val || "WHOLE_BLOOD")}
              >
                <SelectTrigger id="blood-component">
                  <SelectValue placeholder="Component" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHOLE_BLOOD">Whole Blood</SelectItem>
                  <SelectItem value="PRBC">Packed Red Blood Cells (PRBC)</SelectItem>
                  <SelectItem value="PLATELETS">Platelets (Apheresis/Random)</SelectItem>
                  <SelectItem value="FFP">Fresh Frozen Plasma (FFP)</SelectItem>
                  <SelectItem value="CRYOPRECIPITATE">Cryoprecipitate</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="units-requested">Units Requested (1–20)</Label>
              <Input
                id="units-requested"
                type="number"
                min="1"
                max="20"
                value={unitsRequested}
                onChange={(e) => setUnitsRequested(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="urgency-tier">Urgency Tier</Label>
              <Select
                value={urgencyLevel}
                onValueChange={(val) => setUrgencyLevel(val || "URGENT")}
              >
                <SelectTrigger id="urgency-tier">
                  <SelectValue placeholder="Urgency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROUTINE">Routine (Elective / Advance)</SelectItem>
                  <SelectItem value="URGENT">Urgent (Within 12–24 Hours)</SelectItem>
                  <SelectItem value="CRITICAL_STAT">Critical STAT (Immediate Emergency)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Section 2: Hospital & Location */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b border-border/50 pb-2">
            <Building2 className="size-4 text-primary" />
            2. Hospital & Healthcare Facility
          </h3>

          <div className="space-y-1.5">
            <Label htmlFor="hospital-name">Hospital / Medical Center Name</Label>
            <Input
              id="hospital-name"
              placeholder="e.g. St. Luke's Medical Center - Global City"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hospital-city">City / Municipality</Label>
              <Input
                id="hospital-city"
                placeholder="e.g. Taguig"
                value={hospitalCity}
                onChange={(e) => setHospitalCity(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="province">Province / Region</Label>
              <Input
                id="province"
                placeholder="e.g. Metro Manila"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Section 3: Contact & Timeline */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b border-border/50 pb-2">
            <Clock className="size-4 text-primary" />
            3. Contact & Schedule
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Contact Person (Optional)</Label>
              <Input
                id="contact-name"
                placeholder="e.g. Maria Santos (Nurse / Relative)"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-number">Contact Telephone / Mobile</Label>
              <Input
                id="contact-number"
                placeholder="e.g. +63 917 123 4567"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="required-by">Needed By (Date & Time)</Label>
              <Input
                id="required-by"
                type="datetime-local"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
                required
              />
            </div>
          </div>
        </div>

        {/* Section 4: Context & Notes */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground border-b border-border/50 pb-2">
            <FileText className="size-4 text-primary" />
            4. Clinical Reason & Notes
          </h3>

          <div className="space-y-1.5">
            <Label htmlFor="request-reason">Request Reason / Clinical Context (Optional)</Label>
            <Input
              id="request-reason"
              placeholder="e.g. Scheduled cardiac bypass surgery / Postpartum hemorrhage"
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="medical-notes">Additional Notes / Instructions</Label>
            <Textarea
              id="medical-notes"
              placeholder="e.g. Please proceed to 3rd Floor Blood Bank and look for Dr. Cruz."
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Phone className="size-3.5" />
          Requisitions are verified before broadcast.
        </p>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={isSubmitting}
            onClick={() => handleSubmit(true)}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin mr-1.5" />
            ) : null}
            Save as Draft
          </Button>

          <Button
            type="button"
            className="flex-1 sm:flex-none bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            disabled={isSubmitting}
            onClick={() => handleSubmit(false)}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin mr-1.5" />
            ) : (
              <Droplet className="size-4 mr-1.5 fill-current" />
            )}
            Submit for Review
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
