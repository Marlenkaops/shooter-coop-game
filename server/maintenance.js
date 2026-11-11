export function maintenanceEnabled(value = process.env.MAINTENANCE_MODE) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("MAINTENANCE_MODE must be true or false.");
}

export const MAINTENANCE_MESSAGE = "The game is being updated. Please come back soon.";

export function maintenanceTemplate(template, enabled) {
  if (typeof enabled !== "boolean" || template?.containers?.length !== 1 || template.containers[0].name !== "game") {
    throw new Error("Expected one game container and a boolean maintenance setting.");
  }
  const updated = structuredClone(template);
  const container = updated.containers[0];
  container.env = (container.env || []).filter((entry) => entry.name !== "MAINTENANCE_MODE");
  container.env.push({ name: "MAINTENANCE_MODE", value: String(enabled) });
  delete updated.revisionSuffix;
  return updated;
}
