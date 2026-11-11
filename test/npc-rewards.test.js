import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, shoot, startMatch, tickRoom, publicState } from "../server/game.js";
import { flushNpcRewards, flushNpcRewardsAsync } from "../server/npc-rewards.js";
import { TOKENS_PER_KILL, tokensForMatch } from "../shared/weapons.js";

function killFixture() {
  const room = createRoom("ABC123", "foundry");
  const player = addPlayer(room, { id: "one" }, "identity", { level: 1, equippedWeaponId: "shotgun" }, "Tester");
  startMatch(room, 1000);
  player.position = { x: 0, y: 1.7, z: 10 };
  room.enemies.clear();
  room.enemies.set("target", { id: "target", type: "drone", health: 1, maxHealth: 1,
    position: { x: 0, y: 1, z: 7 }, radius: .48, speed: 1, attack: 1 });
  return { room, player };
}

test("one NPC death earns six tokens once despite multiple shotgun pellets and repeated packets", () => {
  const { room, player } = killFixture();
  assert.equal(shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 1000).kills, 1);
  assert.equal(player.kills, 1);
  assert.equal(room.pendingNpcTokens.get("identity").tokens, TOKENS_PER_KILL);
  shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 1000);
  shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 2000);
  assert.equal(room.pendingNpcTokens.get("identity").tokens, TOKENS_PER_KILL);
  assert.ok(!JSON.stringify(publicState(room)).includes("pendingNpcTokens"));
});

test("NPC token saves retry without dropping disconnected identities or double-crediting", () => {
  const { room } = killFixture();
  shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 1000);
  room.players.delete("one");
  let balance = 0, attempts = 0, errors = 0, updates = 0;
  const handlers = {
    credit(identity, tokens) {
      assert.equal(identity, "identity"); attempts++;
      if (attempts === 1) throw new Error("Disk unavailable");
      balance += tokens; return { tokens: balance };
    },
    saved(identity, profile, tokens) { updates++; assert.equal(profile.tokens, tokens); },
    failed(identity, error) { errors++; assert.match(error.message, /Disk unavailable/); }
  };
  flushNpcRewards(room, handlers, 1000);
  assert.equal(room.pendingNpcTokens.size, 1);
  assert.equal(balance, 0);
  assert.equal(errors, 1);
  flushNpcRewards(room, handlers, 5999);
  assert.equal(attempts, 1);
  flushNpcRewards(room, handlers, 6000);
  flushNpcRewards(room, handlers, 7000);
  assert.equal(balance, 6);
  assert.equal(updates, 1);
  assert.equal(room.pendingNpcTokens.size, 0);
});

test("co-op final rewards omit already-paid kills and block replay while token writes are pending", () => {
  const { room, player } = killFixture();
  shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 1000);
  player.kills = 1;
  room.wave = 5;
  const result = tickRoom(room, 0, 2000);
  assert.equal(result.won, true);
  const reward = result.rewards[0];
  assert.equal(reward.tokens, 135);
  assert.equal(reward.killTokens, 6);
  assert.equal(reward.tokens + reward.killTokens, tokensForMatch(5, 1, true));
  assert.equal(startMatch(room, 3000), false);
  room.pendingNpcTokens.clear();
  assert.equal(startMatch(room, 3000), true);
});

test("asynchronous NPC credits preserve kills arriving during a commit and use distinct stable retry IDs", async () => {
  const room = { pendingNpcTokens: new Map([["fixture", { tokens: 6, retryAt: 0 }]]) };
  let release, total = 0;
  const intents = [];
  const handlers = {
    credit(intent) {
      intents.push({ ...intent });
      return new Promise((resolve) => { release = () => { total += intent.tokens; resolve({ tokens: total }); }; });
    },
    saved() {},
    failed(error) { assert.fail(String(error)); }
  };
  flushNpcRewardsAsync(room, handlers, 1);
  await new Promise((resolve) => setImmediate(resolve));
  room.pendingNpcTokens.get("fixture").tokens += 6;
  flushNpcRewardsAsync(room, handlers, 2);
  assert.equal(intents.length, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.pendingNpcTokens.get("fixture").tokens, 6);
  flushNpcRewardsAsync(room, handlers, 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(intents[0].id, intents[1].id);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(total, 12);
  assert.equal(room.pendingNpcTokens.size, 0);
});
