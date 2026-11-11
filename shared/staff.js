export const STAFF_ROLES = Object.freeze({
  admin: "Admin",
  owner: "Owner",
  developer: "Developer",
  "co-owner": "Co-owner",
  "co-dev": "Co-dev"
});

export function staffLabel(role) {
  return Object.hasOwn(STAFF_ROLES, role) ? STAFF_ROLES[role] : "";
}
