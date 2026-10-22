import {
  DonorResponseType,
  CommitmentStatus,
  DonorCommitmentRecord,
  FormattedDonorCommitment,
  MatchStatus,
} from "@/lib/supabase/types";

export type {
  DonorResponseType,
  CommitmentStatus,
  DonorCommitmentRecord,
  FormattedDonorCommitment,
  MatchStatus,
};

export const COMMITMENT_SAFETY_DISCLAIMER =
  "OPERATIONAL NOTICE: A donor response or commitment represents voluntary willingness to participate in coordination for an active blood requisition. It is NOT a clinical determination of medical eligibility, donor health clearance, or guaranteed transfusion compatibility. Hospital blood bank staff must perform all clinical testing and cross-matching.";

/**
 * Valid response state machine transitions.
 */
export const VALID_RESPONSE_TRANSITIONS: Record<DonorResponseType, DonorResponseType[]> = {
  NOT_RESPONDED: ["INTERESTED", "DECLINED"],
  INTERESTED: [],
  DECLINED: [],
};

export function isValidResponseTransition(
  current: DonorResponseType,
  next: DonorResponseType
): boolean {
  if (current === next) return true;
  const allowed = VALID_RESPONSE_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

/**
 * Valid commitment lifecycle transitions.
 */
export const VALID_COMMITMENT_TRANSITIONS: Record<CommitmentStatus, CommitmentStatus[]> = {
  PENDING: ["ACCEPTED", "WITHDRAWN", "EXPIRED"],
  ACCEPTED: ["SCHEDULED", "WITHDRAWN", "EXPIRED", "CANCELLED"],
  SCHEDULED: ["CHECKED_IN", "COMPLETED", "DONATION_RECORDED", "NO_SHOW", "ACCEPTED", "CANCELLED", "WITHDRAWN"],
  CHECKED_IN: ["COMPLETED", "DONATION_RECORDED", "CANCELLED"],
  DONATION_RECORDED: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
  WITHDRAWN: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function isValidCommitmentTransition(
  current: CommitmentStatus,
  next: CommitmentStatus
): boolean {
  if (current === next) return true;
  const allowed = VALID_COMMITMENT_TRANSITIONS[current] || [];
  return allowed.includes(next);
}

export interface SubmitDonorResponseInput {
  notificationId?: string;
  matchId?: string;
  requestId?: string;
  response: "INTERESTED" | "DECLINED";
  clerkUserId: string;
  reason?: string;
}

export interface SubmitDonorResponseResult {
  success: boolean;
  response: DonorResponseType;
  commitment?: FormattedDonorCommitment;
  alreadyResponded?: boolean;
  matchStatus: string;
  error?: string;
}

export interface WithdrawCommitmentInput {
  commitmentId: string;
  clerkUserId: string;
  reason?: string;
}

export interface WithdrawCommitmentResult {
  success: boolean;
  commitment?: FormattedDonorCommitment;
  error?: string;
}
