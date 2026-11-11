import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStaffAccess, encodeStaffSeed } from "../server/staff-access.js";
import { STAFF_ROLES } from "../shared/staff.js";

const usage = "Stop the server, then use: npm run setup:staff -- --player-id <Operator UUID> --role <owner|admin|developer|co-owner|co-dev> [--seed-file <path>]";

try {
  const args = process.argv.slice(2);
  if (![4, 6].includes(args.length) || args[0] !== "--player-id" || args[2] !== "--role" ||
    args.length === 6 && (args[4] !== "--seed-file" || !args[5])) {
    throw new Error(usage);
  }
  if (!Object.hasOwn(STAFF_ROLES, args[3])) {
    throw new Error("Choose owner, admin, developer, co-owner or co-dev. Staff setup cannot remove roles.");
  }
  const seedFile = args[5];
  if (seedFile && fs.existsSync(seedFile)) throw new Error("The seed file already exists; choose a new path.");
  // Seed mode builds a fresh staff file in a private temporary directory instead of DATA_DIR.
  const directory = seedFile ? fs.mkdtempSync(path.join(os.tmpdir(), "last-light-staff-"))
    : (await import("../server/data.js")).dataDir;
  try {
    const staff = createStaffAccess(directory);
    const assigned = staff.setRole(args[1], args[3]);
    if (!assigned.ok) throw new Error(assigned.error);
    const result = staff.issue(args[1]);
    if (!result.ok) throw new Error(result.error);
    if (seedFile) fs.writeFileSync(seedFile, encodeStaffSeed(directory), { mode: 0o600, flag: "wx" });
    console.log(`Private ${args[3]} access for Operator ${args[1]}. Store these codes securely; each works once:`);
    for (const code of result.codes) console.log(code);
    console.log(seedFile
      ? `Wrote the private STAFF_ACCESS_SEED value to ${seedFile}. Store it only as a host secret.`
      : "Old codes and sessions are revoked. Restart the server. Password sign-in remains required when configured.");
  } finally {
    if (seedFile) fs.rmSync(directory, { recursive: true, force: true });
  }
} catch (error) {
  console.error(`Staff setup failed: ${error.message}`);
  process.exitCode = 1;
}
