import path from "node:path";
import { initializePersistence } from "./persistence.js";

export const dataDir = path.resolve(process.env.DATA_DIR || "data");
try { await initializePersistence(); }
catch {
  throw new Error("Persistence startup unavailable. Verify configuration, identity, network access and the expected private snapshot.");
}
