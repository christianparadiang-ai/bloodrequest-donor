import { UserRole } from "@/lib/supabase/types";

export const ROLES: Record<UserRole, UserRole> = {
  USER: "USER",
  DONOR: "DONOR",
  HOSPITAL_STAFF: "HOSPITAL_STAFF",
  MODERATOR: "MODERATOR",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
};

export const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
  USER: ["create:request", "view:own_request", "view:own_profile"],
  DONOR: ["create:request", "view:own_request", "view:own_profile", "respond:match", "view:donation_history"],
  HOSPITAL_STAFF: ["create:request", "verify:request", "manage:donations", "view:hospital_queue"],
  MODERATOR: ["verify:request", "review:documents", "view:all_requests"],
  ADMIN: ["*"],
  SUPER_ADMIN: ["*"],
};

export function hasPermission(role: UserRole, permission: string): boolean {
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}
