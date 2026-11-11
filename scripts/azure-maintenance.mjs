import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { maintenanceTemplate } from "../server/maintenance.js";

const execute = promisify(execFile);
const subscription = "7bc68c68-f434-49ad-ab3e-b883ec39da86";
const resource = `/subscriptions/${subscription}/resourceGroups/rg-ema/providers/Microsoft.App/containerApps/last-light`;
const endpoint = `https://management.azure.com${resource}?api-version=2026-03-02-preview`;
const operation = process.argv[2];
assert.ok(["on", "off", "status"].includes(operation), "Usage: node scripts/azure-maintenance.mjs on|off|status");
async function arm(method, extra = []) {
  try {
    const { stdout } = await execute("az", ["rest", "--subscription", subscription, "--method", method,
      "--url", endpoint, "--only-show-errors", "--output", "json", ...extra], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch {
    throw new Error("Azure maintenance request failed. Check your Azure CLI sign-in and access to rg-ema.");
  }
}
async function liveStatus(origin) {
  const response = await fetch(new URL("/api/maintenance", origin), { cache: "no-store",
    signal: AbortSignal.timeout(10000), redirect: "error" });
  assert.ok(response.ok && response.headers.get("content-type")?.includes("application/json"),
    "The live app does not expose maintenance status. Install maintenance support before using this command.");
  const status = await response.json();
  assert.equal(typeof status.enabled, "boolean", "Invalid live maintenance status.");
  return status;
}
const original = await arm("get");
const ingress = original.properties.configuration.ingress;
assert.ok(ingress.external && !ingress.allowInsecure && ingress.targetPort === 3000 && ingress.fqdn,
  "Expected the existing public HTTPS game ingress.");
const origin = `https://${ingress.fqdn}`;
const template = original.properties.template;
assert.equal(template.containers.length, 1, "Expected one game container.");
assert.equal(template.containers[0].name, "game");
const before = await liveStatus(origin);
if (operation === "status") {
  console.log(JSON.stringify({ origin, ...before }));
} else {
  const enabled = operation === "on";
  if (before.enabled === enabled && template.containers[0].env?.some((entry) =>
    entry.name === "MAINTENANCE_MODE" && entry.value === String(enabled))) {
    console.log(JSON.stringify({ origin, enabled, changed: false }));
  } else {
    const changed = maintenanceTemplate(template, enabled);
    const container = changed.containers[0];
    const current = await arm("get");
    assert.deepEqual(current.properties.template, template, "App changed concurrently; maintenance was not modified.");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "last-light-maintenance-"));
    try {
      const body = path.join(directory, "patch.json");
      await fs.writeFile(body, JSON.stringify({ properties: { template: changed } }), { mode: 0o600 });
      await arm("patch", ["--body", `@${body}`, ...(current.etag ? ["--headers", `If-Match=${current.etag}`] : [])]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
    const deadline = Date.now() + 10 * 60 * 1000;
    let lastFailure = "Waiting for live maintenance status.";
    while (Date.now() < deadline) {
      let status;
      try {
        status = await liveStatus(origin);
      } catch (error) { lastFailure = error.message; }
      if (status?.enabled === enabled) {
        const live = await arm("get");
        const actual = live.properties.template.containers[0];
        assert.equal(actual.image, container.image, "Image changed concurrently.");
        assert.deepEqual(actual.env, container.env, "Environment changed concurrently.");
        console.log(JSON.stringify({ origin, enabled, changed: true }));
        process.exit(0);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`Maintenance ${operation} was requested but live readiness was not confirmed. ${lastFailure}`);
  }
}
