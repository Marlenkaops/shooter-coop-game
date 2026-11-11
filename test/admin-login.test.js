import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ADMIN_SESSION_MS, createAdminLogin, hashAdminPassword, hasAdminSession, loadAdminCredentials,
  validateAdminCredentials
} from "../server/admin-login.js";

const username = "local-admin";
const password = "fixture-admin-password";
const passwordHash = await hashAdminPassword(password);
const credentials = { username, passwordHash };

test("admin password hashes are salted and do not expose the configured password", async () => {
  assert.match(passwordHash, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(await hashAdminPassword(password), passwordHash);
  assert.ok(!passwordHash.includes(password));
  await assert.rejects(hashAdminPassword("short"), /8 to 128/);
});

test("credentials load privately from data or explicit environment, never a default account", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-admin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(loadAdminCredentials(directory, {}), null);
  fs.writeFileSync(path.join(directory, "admin-login.json"), JSON.stringify(credentials), { mode: 0o600 });
  assert.deepEqual(loadAdminCredentials(directory, {}), credentials);
  assert.deepEqual(loadAdminCredentials(directory, {
    ADMIN_LOGIN_USER: "host-admin", ADMIN_LOGIN_PASSWORD_HASH: passwordHash
  }), { username: "host-admin", passwordHash });
  assert.deepEqual(loadAdminCredentials(directory, {
    ADMIN_LOGIN_CREDENTIALS: JSON.stringify([credentials, { username: "second-admin", passwordHash }])
  }), [credentials, { username: "second-admin", passwordHash }]);
  assert.throws(() => loadAdminCredentials(directory, { ADMIN_LOGIN_USER: username }), /Invalid administrator/);
  fs.writeFileSync(path.join(directory, "admin-login.json"), "{broken");
  assert.throws(() => loadAdminCredentials(directory, {}), /Invalid administrator credential file/);
  assert.throws(() => validateAdminCredentials({ username, passwordHash: password }), /Invalid administrator/);
});

test("multiple configured administrator accounts can authenticate with any valid pair", async () => {
  const accounts = [
    { username: "KikiCat", passwordHash: await hashAdminPassword("KikiCat7?") },
    { username: "marlenka", passwordHash: await hashAdminPassword("marlenkaisbest") },
    { username: "TomiFat", passwordHash: await hashAdminPassword("Tomik.1234") }
  ];
  const login = createAdminLogin(accounts);
  assert.equal((await login.authenticate({ username: "KikiCat", password: "KikiCat7?" }, "kiki")).ok, true);
  assert.equal((await login.authenticate({ username: "marlenka", password: "marlenkaisbest" }, "mar")).ok, true);
  assert.equal((await login.authenticate({ username: "TomiFat", password: "Tomik.1234" }, "tomi")).ok, true);
  assert.equal((await login.authenticate({ username: "KikiCat", password: "wrong" }, "wrong")).ok, false);
});

test("only an exact username and password can authenticate, and malformed input is rejected", async () => {
  const login = createAdminLogin(credentials);
  assert.equal(login.enabled, true);
  assert.deepEqual(await login.authenticate({ username, password }, "correct"), { ok: true });
  const wrongName = await login.authenticate({ username: username.toUpperCase(), password }, "wrong-name");
  const wrongPassword = await login.authenticate({ username, password: "wrong-password" }, "wrong-password");
  assert.equal(wrongName.ok, false);
  assert.deepEqual(wrongName, wrongPassword);
  for (const input of [null, [], { username, password: {} }, { username, password: "x".repeat(129) }]) {
    assert.equal((await login.authenticate(input, "malformed")).ok, false);
  }
  assert.equal((await createAdminLogin(null).authenticate({ username, password }, "disabled")).ok, false);
});

test("failed attempts are limited across connections by address and expire after a minute", async () => {
  let time = 1000;
  const login = createAdminLogin(credentials, { now: () => time });
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await login.authenticate(null, "shared-address")).ok, false);
  }
  assert.match((await login.authenticate({ username, password }, "shared-address")).error, /Too many/);
  assert.equal((await login.authenticate({ username, password }, "other-address")).ok, true);
  time += 60_000;
  assert.equal((await login.authenticate({ username, password }, "shared-address")).ok, true);
});

test("password sessions expire and cannot be forged with non-finite or string timestamps", () => {
  const socket = { data: { adminSessionUntil: 1000 + ADMIN_SESSION_MS } };
  assert.equal(hasAdminSession(socket, 1000), true);
  assert.equal(hasAdminSession(socket, 1000 + ADMIN_SESSION_MS), false);
  socket.data.adminSessionUntil = Infinity;
  assert.equal(hasAdminSession(socket, 1000), false);
  socket.data.adminSessionUntil = "99999999999";
  assert.equal(hasAdminSession(socket, 1000), false);
  socket.data.adminSessionUntil = 0;
  assert.equal(hasAdminSession(socket, 1000), false);
});

test("concurrent password verification is bounded independently of attempt throttling", async () => {
  const login = createAdminLogin(credentials);
  const requests = [1, 2, 3].map((index) => login.authenticate({ username, password }, `address-${index}`));
  const replies = await Promise.all(requests);
  assert.equal(replies.filter((reply) => reply.ok).length, 2);
  assert.match(replies.find((reply) => !reply.ok).error, /busy/);
});

test("local account setup writes only a private hash and refuses to overwrite an existing account", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-admin-setup-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = {
    encoding: "utf8", env: { ...process.env, DATA_DIR: directory, ADMIN_SETUP_USER: username, ADMIN_SETUP_PASSWORD: password }
  };
  const setup = spawnSync(process.execPath, ["scripts/setup-admin.mjs"], options);
  assert.equal(setup.status, 0, setup.stderr);
  const filename = path.join(directory, "admin-login.json");
  const content = fs.readFileSync(filename, "utf8");
  assert.equal(JSON.parse(content).username, username);
  assert.ok(!content.includes(password));
  assert.ok(!setup.stdout.includes(password));
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const repeated = spawnSync(process.execPath, ["scripts/setup-admin.mjs"], options);
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /already exist/);
  assert.equal(fs.readFileSync(filename, "utf8"), content);
  const replacement = spawnSync(process.execPath, ["scripts/setup-admin.mjs", "--replace"], {
    ...options, env: { ...options.env, ADMIN_SETUP_USER: "new-admin", ADMIN_SETUP_PASSWORD: "replacement-fixture-password" }
  });
  assert.equal(replacement.status, 0, replacement.stderr);
  const replaced = loadAdminCredentials(directory, {});
  assert.equal(replaced.username, "new-admin");
  assert.notEqual(replaced.passwordHash, JSON.parse(content).passwordHash);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});
