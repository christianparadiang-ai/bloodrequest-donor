export type BloodGroup =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "AB+"
  | "AB-"
  | "O+"
  | "O-";

export type BloodGroupLetter = "A" | "B" | "AB" | "O";
export type RhFactor = "POSITIVE" | "NEGATIVE";

export type UserRole =
  | "USER"
  | "DONOR"
  | "HOSPITAL_STAFF"
  | "MODERATOR"
  | "ADMIN"
  | "SUPER_ADMIN";

export type RequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACTIVE"
  | "PARTIALLY_COMMITTED"
  | "FULLY_COMMITTED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "EXPIRED"
  | "CANCELLED"
  | "REJECTED";

export type UrgencyLevel = "ROUTINE" | "URGENT" | "CRITICAL_STAT";

export interface Profile {
  id: string; // UUID in database
  clerk_user_id: string; // references Clerk identity
  email: string;
  phone_number: string | null;
  full_name: string;
  role: UserRole;
  is_phone_verified: boolean;
  hospital_affiliation?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DonorProfile {
  id: string;
  profile_id: string; // references profiles.id
  blood_group: BloodGroupLetter;
  rh_factor: RhFactor;
  is_available: boolean;
  consent_to_contact: boolean;
  notification_radius_km: number;
  city: string;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  cooldown_until: string | null;
  total_donations_count: number;
  last_donation_date: string | null;
  reliability_score: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  target_table: string;
  target_id: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  ip_address_hash?: string | null;
  user_agent?: string | null;
  created_at: string;
}

/**
 * Converts blood group string like "A+" into database enums
 */
export function parseBloodGroup(bg: BloodGroup): {
  bloodGroup: BloodGroupLetter;
  rhFactor: RhFactor;
} {
  const isPositive = bg.endsWith("+");
  const letter = bg.slice(0, -1) as BloodGroupLetter;
  return {
    bloodGroup: letter,
    rhFactor: isPositive ? "POSITIVE" : "NEGATIVE",
  };
}

/**
 * Combines database enums into standard blood group string like "A+"
 */
export function formatBloodGroup(letter: BloodGroupLetter, rh: RhFactor): BloodGroup {
  return `${letter}${rh === "POSITIVE" ? "+" : "-"}` as BloodGroup;
}

export type BloodComponentType =
  | "WHOLE_BLOOD"
  | "PRBC"
  | "PLATELETS"
  | "FFP"
  | "CRYOPRECIPITATE";

export interface BloodRequest {
  id: string;
  requester_id: string;
  patient_name_masked: string;
  hospital_name: string;
  hospital_city: string;
  province?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  blood_group: BloodGroupLetter;
  rh_factor: RhFactor;
  blood_component: BloodComponentType;
  units_requested: number;
  units_committed: number;
  units_reserved: number;
  units_donated: number;
  urgency_level: UrgencyLevel;
  status: RequestStatus;
  contact_number_masked: string;
  contact_name?: string | null;
  request_reason?: string | null;
  medical_notes?: string | null;
  document_verification_status: string;
  required_by: string;
  reviewer_id?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormattedBloodRequest {
  id: string;
  requesterId: string;
  isOwner?: boolean;
  patientName: string;
  bloodGroup: BloodGroup;
  bloodComponent: BloodComponentType;
  unitsRequested: number;
  unitsCommitted: number;
  unitsReserved: number;
  unitsDonated: number;
  urgencyLevel: UrgencyLevel;
  status: RequestStatus;
  hospitalName: string;
  hospitalCity: string;
  province: string;
  contactName: string;
  contactNumber: string;
  requiredBy: string;
  requestReason?: string;
  medicalNotes?: string;
  documentVerificationStatus: string;
  reviewerId?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MatchStatus =
  | "POTENTIAL_CANDIDATE"
  | "NOTIFIED"
  | "ACCEPTED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "SUPERSEDED";

export interface RequestMatch {
  id: string;
  request_id: string;
  donor_id: string;
  status: MatchStatus;
  discovery_score: number;
  distance_km: number | null;
  is_exact_location: boolean;
  reasons: string[];
  created_at: string;
  updated_at: string;
}

export type DonorResponseType = "NOT_RESPONDED" | "INTERESTED" | "DECLINED";

export type CommitmentStatus =
  | "PENDING"
  | "ACCEPTED"
  | "SCHEDULED"
  | "CHECKED_IN"
  | "DONATION_RECORDED"
  | "COMPLETED"
  | "WITHDRAWN"
  | "NO_SHOW"
  | "EXPIRED"
  | "CANCELLED";

export interface DonorCommitmentRecord {
  id: string;
  request_id: string;
  match_id?: string | null;
  donor_id: string;
  donor_profile_id?: string | null;
  response: DonorResponseType;
  status: CommitmentStatus;
  responded_at?: string | null;
  committed_at: string;
  withdrawn_at?: string | null;
  expires_at?: string | null;
  cancellation_reason?: string | null;
  scheduled_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormattedDonorCommitment {
  id: string;
  requestId: string;
  matchId?: string | null;
  donorId: string;
  donorProfileId?: string | null;
  safeDonorCode: string;
  response: DonorResponseType;
  status: CommitmentStatus;
  respondedAt?: string | null;
  committedAt: string;
  withdrawnAt?: string | null;
  expiresAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DonationStatus =
  | "SCHEDULED"
  | "ATTENDED"
  | "RECORDED"
  | "CANCELLED"
  | "NO_SHOW";

export interface DonationRecord {
  id: string;
  request_id: string;
  commitment_id: string;
  donor_id: string;
  donor_profile_id?: string | null;
  status: DonationStatus;
  scheduled_at: string;
  attended_at?: string | null;
  recorded_at?: string | null;
  cancelled_at?: string | null;
  no_show_at?: string | null;
  units_donated: number;
  blood_group?: BloodGroup | null;
  component_type: BloodComponentType;
  facility_name?: string | null;
  recorded_by?: string | null;
  notes?: string | null;
  cancellation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormattedDonation {
  id: string;
  requestId: string;
  commitmentId: string;
  donorId: string;
  donorProfileId?: string | null;
  donorPseudonym: string;
  status: DonationStatus;
  scheduledAt: string;
  attendedAt?: string | null;
  recordedAt?: string | null;
  cancelledAt?: string | null;
  noShowAt?: string | null;
  unitsDonated: number;
  bloodGroup?: BloodGroup | null;
  componentType: BloodComponentType;
  facilityName?: string | null;
  recordedBy?: string | null;
  notes?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestFulfillmentSummary {
  requestId: string;
  unitsRequested: number;
  unitsCommitted: number;
  unitsDonated: number;
  remainingUnits: number;
  isFulfilled: boolean;
  requestStatus: RequestStatus;
  donations: FormattedDonation[];
}

export interface PotentialDonorMatch {
  matchId?: string;
  donorId: string;
  status?: string;
  safeDonorCode: string;
  bloodGroup: BloodGroup;
  isAvailable: boolean;
  hasConsent: boolean;
  city: string;
  province?: string | null;
  geographicMatch: boolean;
  distanceKm: number | null;
  isExactLocation: boolean;
  discoveryScore: number;
  reasons: string[];
  medicalSafetyDisclaimer: string;
  matchedAt?: string;
}

export type NotificationType =
  | "POTENTIAL_DONOR_ALERT"
  | "DONOR_INTEREST_RECEIVED"
  | "COMMITMENT_CONFIRMED"
  | "COMMITMENT_DECLINED"
  | "COMMITMENT_CANCELLED"
  | "DONATION_SCHEDULED"
  | "DONATION_REMINDER"
  | "DONATION_RECORDED"
  | "DONATION_COMPLETED"
  | "REQUEST_PARTIALLY_FULFILLED"
  | "REQUEST_FULFILLED"
  | "REQUEST_EXPIRING"
  | "VERIFICATION_APPROVED"
  | "VERIFICATION_REJECTED"
  | "DOCUMENT_AMENDMENT_REQUIRED"
  | string;

export type NotificationDeliveryStatus =
  | "PENDING"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "READ";

export interface NotificationRecord {
  id: string;
  recipient_user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  request_id?: string | null;
  match_id?: string | null;
  commitment_id?: string | null;
  status: NotificationDeliveryStatus;
  read_at?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  error_details?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormattedNotification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  requestId?: string | null;
  matchId?: string | null;
  status: NotificationDeliveryStatus;
  isRead: boolean;
  readAt?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
