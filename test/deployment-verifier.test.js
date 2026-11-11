import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("deployment verification rejects unsafe origins without leaking URL credentials", () => {
  const credential = "do-not-log-this-value";
  const invalidOrigins = [
    [],
    ["not a URL"],
    ["http://example.invalid"],
    [`https://user:${credential}@example.invalid`],
    [`https://example.invalid/?token=${credential}`],
    [`https://example.invalid/#${credential}`],
    ["https://example.invalid/path"]
  ];
  for (const args of invalidOrigins) {
    const result = spawnSync(process.execPath, ["scripts/verify-azure-deployment.mjs", ...args], {
      encoding: "utf8", timeout: 5000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AssertionError/);
    assert.ok(!result.stderr.includes(credential), "Error output leaked URL credentials");
    assert.ok(!result.stdout.includes("PASS"), "Invalid input produced success-shaped output");
  }
});
