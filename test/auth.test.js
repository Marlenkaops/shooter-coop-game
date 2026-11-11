import test from "node:test";
import assert from "node:assert/strict";
import { issueToken, verifyToken } from "../server/auth.js";

test("signed identities round-trip and reject spoofing", () => {
  const token = issueToken("player-123");
  assert.equal(verifyToken(token), "player-123");
  assert.equal(verifyToken(`${token.slice(0, -1)}x`), null);
  assert.equal(verifyToken("player-123"), null);
});
