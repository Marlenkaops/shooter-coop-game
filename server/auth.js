import crypto from "node:crypto";
import { dataDir } from "./data.js";
import { persistentFile } from "./persistence.js";

function loadSecret() {
  if (process.env.IDENTITY_SECRET) return process.env.IDENTITY_SECRET;
  const secret = persistentFile(dataDir, "identity-secret", {
    initial: () => crypto.randomBytes(32).toString("hex"), parse: (value) => value.trim(), stringify: (value) => value
  });
  if (!secret.exists) secret.save(secret.value);
  return secret.value;
}

const SECRET = loadSecret();

const encode = (value) => Buffer.from(value).toString("base64url");

export function issueToken(playerId) {
  const payload = encode(JSON.stringify({ playerId, issuedAt: Date.now() }));
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = Buffer.from(crypto.createHmac("sha256", SECRET).update(payload).digest("base64url"));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof parsed.playerId === "string" ? parsed.playerId : null;
  } catch {
    return null;
  }
}
