import test from "node:test";
import assert from "node:assert/strict";
import { maintenanceEnabled, maintenanceTemplate } from "../server/maintenance.js";

test("maintenance defaults open, accepts only explicit boolean settings and fails closed on configuration mistakes", () => {
  for (const value of ["", "false"]) assert.equal(maintenanceEnabled(value), false);
  assert.equal(maintenanceEnabled("true"), true);
  for (const value of ["yes", "1", "TRUE", "off", null, 0, true]) {
    assert.throws(() => maintenanceEnabled(value), /MAINTENANCE_MODE must be true or false/);
  }
});

test("Azure maintenance changes only its own flag and revision suffix without mutating credentials or hosting", () => {
  const template = { revisionSuffix: "prior", containers: [{ name: "game", image: "registry/game@sha256:abc",
    env: [{ name: "IDENTITY_SECRET", secretRef: "identity" }, { name: "ADMIN_SIGN_IN", value: "password" },
      { name: "MAINTENANCE_MODE", value: "false" }],
    resources: { cpu: .5, memory: "1Gi" }, probes: [{ type: "Readiness" }] }],
  scale: { minReplicas: 0, maxReplicas: 1 }, volumes: [{ name: "player-data" }] };
  const before = structuredClone(template);
  const enabled = maintenanceTemplate(template, true);
  assert.deepEqual(template, before);
  assert.equal(enabled.revisionSuffix, undefined);
  assert.deepEqual(enabled.containers[0].env, [...template.containers[0].env.slice(0, 2),
    { name: "MAINTENANCE_MODE", value: "true" }]);
  const disabled = maintenanceTemplate(enabled, false);
  const { revisionSuffix, ...expected } = template;
  assert.deepEqual(disabled, expected);
  for (const invalid of [{}, { containers: [] }, { containers: [{ name: "proxy" }] }]) {
    assert.throws(() => maintenanceTemplate(invalid, true), /Expected one game container/);
  }
  assert.throws(() => maintenanceTemplate(template, "true"), /boolean/);
});
