export function mountRoomSocial(socket, { beforeReport }) {
  const $ = (selector) => document.querySelector(selector);
  let state = null, chatKey = "", targetKey = "";
  let reportVersion = 0, pending = false, returnFocus = null;
  const hasPeers = () => Boolean(state?.players.some((player) => player.socketId !== socket.id));
  function closeReport() {
    reportVersion++;
    pending = false;
    $("#reportPanel").classList.add("hidden");
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  function request(event, input, node, callback) {
    const code = state?.code;
    node.textContent = "";
    socket.timeout(6000).emit(event, input, (error, reply) => {
      if (state?.code !== code) return;
      if (error || !reply?.ok) {
        node.textContent = error ? "Room command timed out. Try again." : reply?.error || "Room command failed.";
        return;
      }
      callback?.(reply);
    });
  }
  function report(targetId) {
    if (!hasPeers()) return;
    returnFocus = document.activeElement;
    reportVersion++;
    pending = false;
    beforeReport();
    $("#reportPanel").classList.remove("hidden");
    $("#reportError").textContent = "";
    if (targetId) $("#reportTarget").value = targetId;
    $("#reportSubmit").disabled = false;
    $("#reportReason").focus();
  }
  $("#roster").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-peer]");
    if (!button) return;
    const targetId = button.dataset.peer, action = button.dataset.action;
    if (action === "report") return report(targetId);
    if (!window.confirm(action === "leaderKick" ? "Remove this player from this lobby? They cannot rejoin this room." :
      "Give this player control of deployment and the lobby?")) return;
    request(action, targetId, $("#lobbyError"), () => {
      $("#socialNotice").textContent = action === "leaderKick" ? "Player removed." : "Leadership transferred.";
    });
  });
  $("#chatForm").onsubmit = (event) => {
    event.preventDefault();
    const text = $("#chatInput").value;
    request("lobbyChat", text, $("#chatError"), () => {
      if ($("#chatInput").value === text) $("#chatInput").value = "";
    });
  };
  $("#fieldReport").onclick = () => report();
  $("#reportClose").onclick = closeReport;
  document.addEventListener("keydown", (event) => {
    if ($("#reportPanel").classList.contains("hidden")) return;
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeReport();
    } else if (event.key === "Tab") {
      const controls = [...$("#reportPanel").querySelectorAll("button:not(:disabled), select, textarea")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  $("#reportForm").onsubmit = (event) => {
    event.preventDefault();
    if (pending || !hasPeers()) return;
    pending = true;
    const version = reportVersion, code = state.code;
    $("#reportError").textContent = "";
    $("#reportSubmit").disabled = true;
    socket.timeout(6000).emit("reportPlayer",
      { playerId: $("#reportTarget").value, reason: $("#reportReason").value }, (error, reply) => {
        if (version !== reportVersion || state?.code !== code) return;
        pending = false;
        $("#reportSubmit").disabled = !hasPeers();
        if (error || !reply?.ok) {
          $("#reportError").textContent = error ? "Report timed out. Check before retrying." : reply?.error || "Report could not be saved.";
          return;
        }
        $("#reportReason").value = "";
        $("#reportError").textContent = "Report saved for private administrator review. No automatic punishment.";
      });
  };
  return {
    render(next) {
      if (state && state.code !== next.code) {
        closeReport();
        $("#reportReason").value = "";
        $("#socialNotice").textContent = "";
      }
      state = next;
      const chat = next.chat || [], key = `${next.code}:${chat.at(-1)?.id ?? 0}`;
      if (key !== chatKey) {
        const list = $("#chatMessages"), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
        list.replaceChildren();
        for (const message of chat) {
          const row = document.createElement("p"), name = document.createElement("strong"), text = document.createElement("span");
          name.textContent = `${message.name}: `;
          text.textContent = message.text;
          row.append(name, text);
          list.append(row);
        }
        if (!chat.length) list.textContent = "Lobby messages appear here. Do not share personal information.";
        if (nearBottom) list.scrollTop = list.scrollHeight;
        chatKey = key;
      }
      const peers = next.players.filter((player) => player.socketId !== socket.id);
      const peerKey = `${next.code}:${peers.map((peer) => `${peer.socketId}:${peer.name}`).join("|")}`;
      if (peerKey !== targetKey) {
        const select = $("#reportTarget"), selected = select.value;
        select.replaceChildren();
        for (const peer of peers) {
          const option = document.createElement("option");
          option.value = peer.socketId;
          option.textContent = `${peer.name} · ${peer.playerTag}`;
          select.append(option);
        }
        if (peers.some((peer) => peer.socketId === selected)) select.value = selected;
        $("#reportSubmit").disabled = pending || !peers.length;
        $("#fieldReport").disabled = !peers.length;
        targetKey = peerKey;
      }
    }
  };
}
