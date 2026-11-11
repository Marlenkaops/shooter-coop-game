const adminIds = new Set((process.env.ADMIN_PLAYER_IDS || "").split(",")
  .map((id) => id.trim())
  .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)));

export function isAdmin(identity) {
  return typeof identity === "string" && adminIds.has(identity);
}
