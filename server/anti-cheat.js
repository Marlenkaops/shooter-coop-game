import { MAPS, MAX_ADMIN_LEVEL } from "../shared/progression.js";
import { WEAPONS } from "../shared/weapons.js";
import { MODES } from "../shared/modes.js";
import { SKINS } from "../shared/skins.js";
import { PRACTICE_MAP } from "../shared/practice.js";
import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY } from "../shared/enemy-ai.js";
import { SQUAD_CLASSES } from "../shared/teamwork.js";
import { ATTACHMENTS, CHALLENGES, MUTATORS, PERKS, validMutators, WEAPON_FINISHES } from "../shared/career.js";
import { ACHIEVEMENTS } from "../shared/career.js";
import { validRankingQuery, validTag } from "../shared/rankings.js";

const noPayload = new Set(["startMatch", "advanceCampaign", "reload", "useMedkit", "classAbility", "careerStatus", "socialStatus", "adminOverview", "adminSignOut", "adminStorageStatus"]);
const commands = new Set([...noPayload, "createRoom", "quickMatch", "joinRoom", "move", "shoot", "useAmmoSupply",
  "buyWeapon", "equipWeapon", "equipProgression", "claimProgression", "selectClass", "teamInteract", "teamPing", "adminSignIn", "adminKickPlayer", "adminCloseRoom",
  "adminSearchProfiles", "adminProfile", "adminSetProgression", "adminAuditLogs", "collectLoot",
  "adminGrantWeapon", "adminPlayerSupport", "adminRestockChests", "leaderboard", "rankings", "publicProfile", "profileShowcase", "socialAction",
  "lobbyChat", "leaderKick", "transferLeader", "reportPlayer", "adminReports", "adminReviewReport",
  "adminBanReport", "adminBans", "adminUnban", "adminAppeals", "adminReviewAppeal", "adminCommand", "buySkin", "equipSkin", "practiceWeapon", "raidInteract"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
const keys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const vector = (value) => keys(value, ["x", "y", "z"]) &&
  ["x", "y", "z"].every((axis) => Number.isFinite(value[axis]));
const operations = new Set(["setLevel", "unlockWeapons", "unlockMaps", "unlockAll"]);

function validInput(event, input) {
  switch (event) {
    case "rankings": return validRankingQuery(input);
    case "publicProfile": return keys(input, ["tag"]) && (input.tag === undefined || validTag(input.tag));
    case "profileShowcase": return keys(input, ["badges"]) && Array.isArray(input.badges) && input.badges.length <= 3 &&
      new Set(input.badges).size === input.badges.length && input.badges.every((id) => Object.hasOwn(ACHIEVEMENTS, id));
    case "socialAction": return keys(input, ["action", "tag", "name"]) &&
      (input.action === "squadCreate" ? input.tag === undefined && typeof input.name === "string" && /^[\p{L}\p{N}][\p{L}\p{N} _-]{2,23}$/u.test(input.name) :
        input.name === undefined && (input.action === "squadLeave" ? input.tag === undefined :
          ["friendRequest", "friendAccept", "friendDecline", "friendCancel", "friendRemove", "squadInvite", "squadAccept", "squadDecline", "squadRemove"].includes(input.action) && validTag(input.tag)));
    case "equipProgression": return keys(input, ["kind", "id", "weaponId"]) &&
      (input.kind === "perk" ? Object.hasOwn(PERKS, input.id) && input.weaponId === undefined :
        Object.hasOwn(WEAPONS, input.weaponId) && (input.kind === "attachment" ? Object.hasOwn(ATTACHMENTS, input.id) :
          input.kind === "finish" && Object.hasOwn(WEAPON_FINISHES, input.id)));
    case "claimProgression": return keys(input, ["type", "key", "period"]) && string(input.key, 32) && string(input.period, 32) &&
      (input.type === "challenge" ? Object.hasOwn(CHALLENGES, input.key) && /^[dw]-?\d{1,8}$/.test(input.period) :
        input.type === "season" ? /^(?:[1-9]|1\d|20)$/.test(input.key) && /^s\d{1,6}$/.test(input.period) :
          input.type === "prestige" && /^[1-9]\d{0,6}$/.test(input.key) && input.period === "lifetime");
    case "selectClass": return typeof input === "string" && Object.hasOwn(SQUAD_CLASSES, input);
    case "teamInteract": return input === null || string(input, 64);
    case "teamPing": return keys(input, ["kind", "targetId", "position"]) &&
      (input.kind === "route" ? input.targetId === undefined && vector(input.position) :
        ["enemy", "ammo"].includes(input.kind) && string(input.targetId, 64) && input.position === undefined);
    case "leaderboard": return keys(input, ["sort", "offset"]) &&
      (input.sort === undefined || ["xp", "kills", "season"].includes(input.sort)) &&
      (input.offset === undefined || Number.isSafeInteger(input.offset) && input.offset >= 0);
    case "quickMatch":
    case "createRoom": return keys(input, ["mapId", "name", "mode", "difficulty", "mutators"]) &&
      (input.mutators === undefined || validMutators(input.mutators) && (!["practice", "ffa"].includes(input.mode) || !input.mutators.length)) &&
      (input.mode === undefined || (typeof input.mode === "string" && Object.hasOwn(MODES, input.mode))) &&
      (input.difficulty === undefined || typeof input.difficulty === "string" && Object.hasOwn(AI_DIFFICULTIES, input.difficulty) &&
        (!["practice", "ffa"].includes(input.mode) || input.difficulty === DEFAULT_DIFFICULTY)) &&
      (input.mode === "practice" ? input.mapId === PRACTICE_MAP.id : MAPS.some((map) => map.id === input.mapId)) &&
      (input.name === undefined || string(input.name, 64));
    case "lobbyChat": return string(input, 240);
    case "raidInteract": return input === "raid-cache";
    case "leaderKick":
    case "transferLeader": return string(input, 64);
    case "reportPlayer": return keys(input, ["playerId", "reason"]) && string(input.playerId, 64) && string(input.reason, 500);
    case "adminReports": return keys(input, ["status", "offset"]) &&
      (input.status === undefined || ["open", "reviewed", "dismissed"].includes(input.status)) &&
      (input.offset === undefined || (Number.isSafeInteger(input.offset) && input.offset >= 0));
    case "adminReviewReport": return keys(input, ["id", "status"]) && string(input.id, 64) &&
      ["open", "reviewed", "dismissed"].includes(input.status);
    case "adminBanReport": return keys(input, ["reportId", "kind", "duration", "reason"]) && string(input.reportId, 64) &&
      ["player", "ip"].includes(input.kind) && (input.duration === undefined || string(input.duration, 12)) &&
      (input.reason === undefined || typeof input.reason === "string" && input.reason.length <= 300);
    case "adminBans": return keys(input, ["offset"]) &&
      (input.offset === undefined || Number.isSafeInteger(input.offset) && input.offset >= 0);
    case "adminUnban": return string(input, 64);
    case "adminAppeals": return keys(input, ["status", "offset"]) &&
      (input.status === undefined || ["open", "approved", "rejected"].includes(input.status)) &&
      (input.offset === undefined || Number.isSafeInteger(input.offset) && input.offset >= 0);
    case "adminReviewAppeal": return keys(input, ["id", "status"]) && string(input.id, 64) &&
      ["approved", "rejected"].includes(input.status);
    case "joinRoom": return keys(input, ["code", "name"]) && string(input.code, 16) &&
      (input.name === undefined || string(input.name, 64));
    case "move": return keys(input, ["position", "yaw", "pitch", "crouching"]) && vector(input.position) &&
      Number.isFinite(input.yaw) && Number.isFinite(input.pitch) &&
      (input.crouching === undefined || typeof input.crouching === "boolean");
    case "shoot": return keys(input, ["direction"]) && vector(input.direction);
    case "useAmmoSupply":
    case "collectLoot": return string(input, 64);
    case "buyWeapon":
    case "practiceWeapon":
    case "equipWeapon": return typeof input === "string" && Object.hasOwn(WEAPONS, input);
    case "buySkin":
    case "equipSkin": return typeof input === "string" && Object.hasOwn(SKINS, input);
    case "adminSignIn": return keys(input, ["username", "password", "code"]) &&
      (input.username === undefined || string(input.username, 64)) &&
      (input.password === undefined || string(input.password, 128)) &&
      (input.code === undefined || typeof input.code === "string" && /^[0-9]{6}$/.test(input.code));
    case "adminCommand": return string(input, 500) && !/[\u0000-\u001f\u007f]/.test(input);
    case "adminCloseRoom": return string(input, 6) && /^[A-F0-9]{6}$/.test(input);
    case "adminRestockChests": return string(input, 6) && /^[A-F0-9]{6}$/.test(input);
    case "adminGrantWeapon": return keys(input, ["playerId", "weaponId"]) && string(input.playerId, 64) &&
      typeof input.weaponId === "string" && Object.hasOwn(WEAPONS, input.weaponId);
    case "adminPlayerSupport": return keys(input, ["playerId", "operation"]) && string(input.playerId, 64) &&
      ["heal", "ammo"].includes(input.operation);
    case "adminKickPlayer": return keys(input, ["code", "playerId"]) &&
      string(input.code, 6) && string(input.playerId, 64);
    case "adminSearchProfiles": return keys(input, ["query", "offset"]) &&
      typeof input.query === "string" && input.query.length <= 64 &&
      (input.offset === undefined || (Number.isSafeInteger(input.offset) && input.offset >= 0));
    case "adminProfile": return string(input, 64);
    case "adminSetProgression": return keys(input, ["playerId", "operation", "level"]) &&
      string(input.playerId, 64) && operations.has(input.operation) &&
      (input.operation !== "setLevel" || (Number.isSafeInteger(input.level) && input.level >= 1 && input.level <= MAX_ADMIN_LEVEL));
    case "adminAuditLogs": return keys(input, ["kind", "before", "limit"]) &&
      (input.kind === undefined || ["admin", "auth", "anti-cheat"].includes(input.kind)) &&
      (input.before === undefined || (Number.isSafeInteger(input.before) && input.before > 0)) &&
      (input.limit === undefined || (Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100));
    default: return false;
  }
}

export function createCommandGuard({ now = Date.now } = {}) {
  const buckets = new Map();
  function take(key, capacity, rate) {
    const at = now();
    const bucket = buckets.get(key) || { tokens: capacity, at };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, at - bucket.at) * rate / 1000);
    bucket.at = at;
    buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  }
  return {
    check(packet, admin) {
      const event = packet[0];
      const reject = (reason, error) => ({ ok: false, action: commands.has(event) ? event : "unknown_command", reason, error });
      if (!take("total", 150, 90)) return reject("message_rate", "Too many commands. Slow down.");
      if (!commands.has(event)) return reject("unknown_command", "Unknown command.");
      if (event.startsWith("admin") && event !== "adminSignIn" && event !== "adminSignOut" && !admin) {
        return reject("permission_denied", "Admin access denied.");
      }
      const [capacity, rate] = event === "move" ? [60, 30] : event === "shoot" ? [30, 18] :
        ["rankings", "publicProfile", "socialStatus", "socialAction", "profileShowcase"].includes(event) ? [8, 2] :
        ["leaderboard", "claimProgression", "careerStatus"].includes(event) ? [6, 1] :
        event.startsWith("admin") ? [30, 6] : [25, 10];
      const group = ["move", "shoot", "leaderboard", "claimProgression", "careerStatus", "rankings", "publicProfile", "socialStatus", "socialAction", "profileShowcase"].includes(event) ? event : event.startsWith("admin") ? "admin" : "commands";
      if (!take(group, capacity, rate)) return reject("command_rate", "Too many commands. Slow down.");
      const args = packet.slice(1);
      if (typeof args.at(-1) === "function") args.pop();
      if (noPayload.has(event) ? args.length !== 0 : args.length !== 1 || !validInput(event, args[0])) {
        return reject("invalid_payload", "Invalid command data.");
      }
      return { ok: true };
    }
  };
}
