export const MAX_CHAT_MESSAGES = 50;

export function leaderSocketId(room, now = Date.now()) {
  const leader = [...room.players.values()].find((player) => player.identity === room.leaderId);
  if (leader) return leader.socketId;
  if (room.advancingUntil > now && room.advancingIdentities?.has(room.leaderId)) return null;
  room.leaderId = room.players.values().next().value?.identity ?? null;
  return room.players.values().next().value?.socketId ?? null;
}

export function removeRoomPlayer(room, socketId) {
  const player = room.players.get(socketId);
  room.players.delete(socketId);
  if (player) room.campaignRejoined?.delete(player.identity);
  leaderSocketId(room);
}

export function transferLeader(room, socketId, targetId) {
  if (room.phase !== "lobby" || leaderSocketId(room) !== socketId) {
    return { ok: false, error: "Only the fireteam lead can transfer leadership in the lobby." };
  }
  const target = room.players.get(targetId);
  if (!target || targetId === socketId) return { ok: false, error: "Choose another room member." };
  room.leaderId = target.identity;
  return { ok: true };
}

export function lobbyChat(room, socketId, text, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player || room.phase !== "lobby") return { ok: false, error: "Chat is available in your lobby." };
  if (typeof text !== "string" || text.length > 240 || !text.trim() || /[\u0000-\u001f\u007f]/.test(text)) {
    return { ok: false, error: "Enter a message of 1–240 characters without control characters." };
  }
  const last = room.chatLastSent.get(player.identity);
  if (last !== undefined && now - last < 1500) return { ok: false, error: "Wait a moment before sending another message." };
  // This per-room identity cache survives reconnects, but remains bounded.
  if (!room.chatLastSent.has(player.identity) && room.chatLastSent.size >= 100) {
    room.chatLastSent.delete(room.chatLastSent.keys().next().value);
  }
  room.chatLastSent.set(player.identity, now);
  const message = { id: room.nextChatId++, name: player.name, playerTag: player.playerTag, text: text.trim(), at: now };
  room.chat.push(message);
  if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.shift();
  return { ok: true, message };
}
