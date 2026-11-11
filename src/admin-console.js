import { MAPS, MAX_ADMIN_LEVEL } from "../shared/progression.js";
import { WEAPONS } from "../shared/weapons.js";
import { staffLabel } from "../shared/staff.js";
import { BAN_DURATION_PRESETS, BAN_REASON_MAX } from "../shared/bans.js";

export function mountAdminConsole(socket, { isAdmin, isOwner = () => false, currentProfile }) {
  const $ = (selector) => document.querySelector(selector);
  let generation = 0, searchVersion = 0, logVersion = 0, selected = null, nextOffset = null, nextBefore = null;
  let reportVersion = 0, reportOffset = 0;
  let banVersion = 0, banOffset = null;
  let appealVersion = 0, appealOffset = null;
  let commandPending = false;
  const text = (tag, value) => {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
  };
  function request(event, input, errorNode, callback, isCurrent = () => true, onFailure) {
    if (!isAdmin()) return;
    const version = generation;
    const response = (error, reply) => {
      if (!isAdmin() || version !== generation || !isCurrent()) return;
      if (error || !reply?.ok) {
        errorNode.textContent = error ? "Command link timed out. Try again." : reply?.error || "Administrator request failed.";
        onFailure?.();
        return;
      }
      callback(reply);
    };
    if (input === undefined) socket.timeout(6000).emit(event, response);
    else socket.timeout(6000).emit(event, input, response);
  }
  function showProfile(reply) {
    selected = reply.profile;
    const panel = $("#adminSelectedProfile");
    panel.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "admin-player-heading";
    const avatar = text("span", selected.username.slice(0, 2).toUpperCase());
    avatar.className = "admin-player-avatar";
    const identity = document.createElement("div");
    identity.className = "admin-player-identity";
    const name = text("strong", selected.username);
    name.className = "admin-player-name";
    const status = text("span", `${reply.online ? "Online" : "Offline"}${staffLabel(reply.staffRole) ? ` · ${staffLabel(reply.staffRole)}` : ""} · ${selected.id.slice(0, 8).toUpperCase()}`);
    status.className = `admin-player-status${reply.online ? " online" : ""}`;
    identity.append(name, status);
    const level = text("span", `Level ${selected.level}`);
    level.className = "admin-level-badge";
    heading.append(avatar, identity, level);
    const stats = document.createElement("div");
    stats.className = "admin-player-stats";
    for (const [label, value] of [["Guns", `${selected.ownedWeapons.length}/${Object.keys(WEAPONS).length}`],
      ["Maps", `${selected.unlockedMaps.length}/${MAPS.length}`], ["Tokens", selected.tokens.toLocaleString()]]) {
      const stat = document.createElement("div");
      stat.append(text("strong", value), text("small", label));
      stats.append(stat);
    }
    const details = document.createElement("details");
    details.className = "admin-profile-inspect";
    details.append(text("summary", "Full profile & player ID"), text("p", `Operator ID: ${selected.id}`),
      text("p", `${selected.xp.toLocaleString()} XP · ${selected.matches || 0} matches · ${selected.totalKills || 0} eliminations · Campaign ${selected.campaignCompleted.length}/3`),
      text("p", `Guns: ${selected.ownedWeapons.map((id) => WEAPONS[id].name).join(", ")}`),
      text("p", `Maps: ${selected.unlockedMaps.map((id) => MAPS.find((map) => map.id === id)?.name || id).join(", ")}`));
    panel.append(heading, stats, details);
    $("#adminLevel").value = selected.level;
    $("#adminProgression").classList.remove("hidden");
    $("#adminSupport").classList.remove("hidden");
    $("#adminGun").replaceChildren();
    for (const weapon of Object.values(WEAPONS)) {
      const option = text("option", `${weapon.name}${selected.ownedWeapons.includes(weapon.id) ? " (owned)" : ""}`);
      option.value = weapon.id;
      $("#adminGun").append(option);
    }
    $("#adminGun").value = Object.keys(WEAPONS).find((id) => !selected.ownedWeapons.includes(id)) || "rifle";
    $("#adminGrantGun").disabled = false;
    $("#adminHeal").disabled = $("#adminAmmo").disabled = !reply.online;
    $("#adminProfileNotice").textContent = "";
  }
  function select(id, notice = "") {
    $("#adminProfileError").textContent = "";
    $("#adminProfileNotice").textContent = "";
    selected = null;
    $("#adminProgression").classList.add("hidden");
    $("#adminSupport").classList.add("hidden");
    $("#adminSelectedProfile").textContent = "Loading player…";
    const version = ++searchVersion;
    request("adminProfile", id, $("#adminProfileError"), (reply) => {
      showProfile(reply);
      $("#adminProfileNotice").textContent = notice;
    }, () => version === searchVersion, () => {
      $("#adminSelectedProfile").textContent = "This player could not be loaded. Try selecting them again.";
    });
  }
  function search(offset = 0) {
    const version = ++searchVersion;
    $("#adminProfileError").textContent = "";
    $("#adminProfileResults").replaceChildren(text("p", "Searching players…"));
    $("#adminProfileNext").classList.add("hidden");
    $("#adminProfilePrevious").classList.add("hidden");
    nextOffset = null;
    request("adminSearchProfiles", { query: $("#adminProfileQuery").value.trim(), offset },
      $("#adminProfileError"), (reply) => {
        const list = $("#adminProfileResults");
        list.replaceChildren(text("p", `${reply.total} matching ${reply.total === 1 ? "player" : "players"}`));
        for (const profile of reply.profiles) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary admin-profile-result";
          button.title = `Operator ID: ${profile.id}`;
          button.append(text("strong", profile.username), text("span", `Level ${profile.level} · ${profile.id.slice(0, 8).toUpperCase()}`));
          button.onclick = () => select(profile.id);
          list.append(button);
        }
        nextOffset = reply.nextOffset;
        $("#adminProfileNext").classList.toggle("hidden", nextOffset === null);
        $("#adminProfilePrevious").classList.toggle("hidden", offset === 0);
        $("#adminProfilePrevious").onclick = () => search(Math.max(0, offset - 20));
      }, () => version === searchVersion, () => $("#adminProfileResults").replaceChildren());
  }
  function logs(before) {
    const version = ++logVersion;
    $("#adminLogError").textContent = "";
    const filter = $("#adminLogKind").value;
    request("adminAuditLogs", { ...(filter ? { kind: filter } : {}), ...(before ? { before } : {}), limit: 30 },
      $("#adminLogError"), (reply) => {
        const list = $("#adminLogEntries");
        list.replaceChildren();
        if (!reply.entries.length) list.append(text("p", "No matching log entries."));
        for (const entry of reply.entries) {
          const row = document.createElement("article");
          row.className = "admin-log-entry";
          row.append(text("strong", `${entry.kind} · ${entry.action} · ${entry.result || "recorded"}`),
            text("span", `${new Date(entry.at).toLocaleString()}${entry.count > 1 ? ` · ${entry.count} events` : ""}`),
            text("span", `Actor: ${entry.actorId || "server"}${entry.targetId ? ` · Target: ${entry.targetId}` : ""}`));
          if (entry.reason || entry.roomCode || entry.level) {
            row.append(text("span", [entry.reason, entry.roomCode && `Room ${entry.roomCode}`,
              entry.level && `Level ${entry.level}`].filter(Boolean).join(" · ")));
          }
          list.append(row);
        }
        nextBefore = reply.nextBefore;
        $("#adminLogOlder").classList.toggle("hidden", nextBefore === null);
      }, () => version === logVersion);
  }
  $("#adminLevel").max = MAX_ADMIN_LEVEL;
  $("#adminCommandForm").onsubmit = (event) => {
    event.preventDefault();
    if (commandPending || !isAdmin()) return;
    const command = $("#adminCommandInput").value.trim();
    if (!command) return;
    if (/^\?ban(?:\s|$)/i.test(command) && !window.confirm("Ban this account? Review the target and evidence. Staff bans are owner-only.")) return;
    commandPending = true;
    $("#adminCommandSubmit").disabled = true;
    $("#adminCommandError").textContent = "";
    $("#adminPrivateCodes").replaceChildren();
    $("#adminPrivateCodes").classList.add("hidden");
    request("adminCommand", command, $("#adminCommandError"), (reply) => {
      commandPending = false;
      $("#adminCommandSubmit").disabled = false;
      const output = $("#adminCommandOutput");
      output.replaceChildren(...(reply.lines || []).map((line) => text("p", line)));
      if (reply.codes) {
        $("#adminPrivateCodes").replaceChildren(text("strong", "Private verification codes - shown once"),
          ...reply.codes.map((code) => text("code", code)),
          text("p", "Each code works once, for this Operator ID only. Deliver privately, never through game chat."));
        $("#adminPrivateCodes").classList.remove("hidden");
      }
      $("#adminCommandInput").value = "";
    }, () => true, () => {
      commandPending = false;
      $("#adminCommandSubmit").disabled = false;
    });
  };
  $("#adminCommandHelp").onclick = () => {
    $("#adminCommandInput").value = "?help";
    $("#adminCommandForm").requestSubmit();
  };
  $("#adminClearCodes").onclick = () => {
    $("#adminPrivateCodes").replaceChildren();
    $("#adminPrivateCodes").classList.add("hidden");
  };
  $("#adminProfileSearch").onsubmit = (event) => { event.preventDefault(); search(); };
  $("#adminProfileSelf").onclick = () => { if (currentProfile()) select(currentProfile().id); };
  $("#adminProfileNext").onclick = () => { if (nextOffset !== null) search(nextOffset); };
  $("#adminLogRefresh").onclick = () => logs();
  $("#adminLogKind").onchange = () => logs();
  $("#adminLogOlder").onclick = () => { if (nextBefore !== null) logs(nextBefore); };
  $("#adminLogSection").ontoggle = () => { if ($("#adminLogSection").open && isAdmin()) logs(); };
  function reports(offset = 0) {
    const version = ++reportVersion;
    $("#adminReportError").textContent = "";
    request("adminReports", { status: $("#adminReportStatus").value, offset }, $("#adminReportError"), (reply) => {
      const list = $("#adminReportEntries");
      list.replaceChildren(text("p", `${reply.total} matching reports. Reports are claims, not proof of cheating.`));
      for (const report of reply.reports) {
        const row = document.createElement("article");
        row.className = "admin-log-entry";
        row.append(text("strong", `${report.targetName} · ${report.status}`),
          text("span", `From ${report.reporterName} · ${new Date(report.at).toLocaleString()} · Room ${report.roomCode}`),
          text("p", report.reason),
          text("small", `Reporter ID: ${report.reporterId} · Target ID: ${report.targetId}`));
        for (const [status, label] of [["reviewed", "Mark reviewed"], ["dismissed", "Dismiss"], ["open", "Reopen"]]) {
          if (status === report.status) continue;
          const button = text("button", label);
          button.type = "button";
          button.className = "secondary";
          button.onclick = () => {
            button.disabled = true;
            request("adminReviewReport", { id: report.id, status }, $("#adminReportError"), () => reports(offset),
              () => version === reportVersion, () => { button.disabled = false; });
          };
          row.append(button);
        }
        const actions = document.createElement("div");
        actions.className = "admin-ban-actions";
        const length = document.createElement("select");
        length.className = "admin-ban-length";
        length.setAttribute("aria-label", `Ban length for ${report.targetName}`);
        for (const [value, label] of BAN_DURATION_PRESETS) {
          const option = text("option", label);
          option.value = value;
          length.append(option);
        }
        length.value = "perm";
        const note = document.createElement("input");
        note.className = "admin-ban-reason";
        note.maxLength = BAN_REASON_MAX;
        note.placeholder = "Reason shown to the player (default: report reason)";
        note.setAttribute("aria-label", `Ban reason for ${report.targetName}`);
        actions.append(length, note);
        for (const [kind, label, active] of [["player", "Ban player", report.playerBanned], ["ip", "IP ban", report.ipBanned]]) {
          const button = text("button", active ? `${label} active` : label);
          button.type = "button";
          button.className = "secondary admin-ban-button";
          button.disabled = Boolean(active || kind === "ip" && !report.canBanIp || report.targetAdmin && !isOwner());
          if (report.targetAdmin && !isOwner()) button.title = "Only the server owner can ban an administrator.";
          if (kind === "ip" && !report.canBanIp) button.title = "No verified address was captured for this report.";
          button.onclick = () => {
            if (version !== reportVersion || button.disabled || !window.confirm(
              `${label} for ${report.targetName}? ${length.value === "perm" ? "This lasts until an administrator removes it."
                : `This lasts ${BAN_DURATION_PRESETS.find(([value]) => value === length.value)?.[1]}.`}${
                kind === "ip" ? " Everyone sharing this IP address may be blocked, including innocent players." : ""
              }${report.targetAdmin ? " This player is an administrator and will lose game and admin access." : ""
              } Reports are claims; review the evidence first.`)) return;
            const controls = [...row.querySelectorAll("button")];
            const disabled = controls.map((control) => control.disabled);
            controls.forEach((control) => { control.disabled = true; });
            $("#adminReportError").textContent = "";
            const reason = (note.value || "").trim();
            request("adminBanReport", { reportId: report.id, kind, duration: length.value, ...(reason ? { reason } : {}) }, $("#adminReportError"), () => {
              reports(offset);
              if ($("#adminBanSection").open) activeBans();
            }, () => version === reportVersion, () => {
              controls.forEach((control, index) => { control.disabled = disabled[index]; });
            });
          };
          actions.append(button);
        }
        row.append(actions);
        if (report.targetAdmin) row.append(text("small", "Administrator target: only the owner login can apply a ban."));
        if (!report.canBanIp) row.append(text("small", "IP ban unavailable: no verified address was captured. Player bans still work."));
        if (report.playerBanned || report.ipBanned) row.append(text("small", "Use Active bans to remove a ban."));
        list.append(row);
      }
      reportOffset = reply.nextOffset;
      $("#adminReportNext").classList.toggle("hidden", reportOffset === null);
    }, () => version === reportVersion);
  }
  $("#adminReportRefresh").onclick = () => reports();
  $("#adminReportStatus").onchange = () => reports();
  $("#adminReportNext").onclick = () => { if (reportOffset !== null) reports(reportOffset); };
  $("#adminReportSection").ontoggle = () => { if ($("#adminReportSection").open && isAdmin()) reports(); };
  function activeBans(offset = 0) {
    const version = ++banVersion;
    $("#adminBanError").textContent = "";
    request("adminBans", { offset }, $("#adminBanError"), (reply) => {
      const list = $("#adminBanEntries");
      list.replaceChildren(text("p", `${reply.total} active bans. Temporary bans end on their own.`));
      for (const ban of reply.bans) {
        const row = document.createElement("article");
        row.className = "admin-log-entry";
        row.append(text("strong", `${ban.targetName} · ${ban.kind === "ip" ? "IP ban" : "Player ban"}`),
          text("span", `${new Date(ban.at).toLocaleString()} · ${ban.until ? `Ends ${new Date(ban.until).toLocaleString()}` : "Permanent"} · By ${ban.actorId}`),
          ...(ban.reason ? [text("p", `Reason: ${ban.reason}`)] : []),
          text("small", `Target ID: ${ban.targetId} · Report: ${ban.reportId}`));
        const button = text("button", "Remove ban");
        button.type = "button";
        button.className = "secondary";
        button.onclick = () => {
          if (version !== banVersion || button.disabled || !window.confirm(
            `Remove this ${ban.kind === "ip" ? "IP" : "player"} ban for ${ban.targetName}? Other bans will remain active.`)) return;
          button.disabled = true;
          request("adminUnban", ban.id, $("#adminBanError"), () => {
            activeBans(offset > 0 && reply.bans.length === 1 ? Math.max(0, offset - 20) : offset);
            if ($("#adminReportSection").open) reports();
          }, () => version === banVersion, () => { button.disabled = false; });
        };
        row.append(button);
        list.append(row);
      }
      banOffset = reply.nextOffset;
      $("#adminBanNext").classList.toggle("hidden", banOffset === null);
    }, () => version === banVersion);
  }
  $("#adminBanRefresh").onclick = () => activeBans();
  $("#adminBanNext").onclick = () => { if (banOffset !== null) activeBans(banOffset); };
  $("#adminBanSection").ontoggle = () => { if ($("#adminBanSection").open && isAdmin()) activeBans(); };
  function appeals(offset = 0) {
    const version = ++appealVersion;
    $("#adminAppealError").textContent = "";
    $("#adminAppealEntries").replaceChildren(text("p", "Loading appeals..."));
    request("adminAppeals", { status: $("#adminAppealStatus").value, offset }, $("#adminAppealError"), (reply) => {
      const list = $("#adminAppealEntries");
      list.replaceChildren(text("p", `${reply.total} ${$("#adminAppealStatus").value} appeals.`));
      for (const appeal of reply.appeals) {
        const row = document.createElement("article");
        row.className = "admin-log-entry";
        row.append(text("strong", `${appeal.targetName} · ${appeal.kind === "ip" ? "IP" : "Player"} ban appeal`),
          text("span", `Submitted ${new Date(appeal.at).toLocaleString()} · ${appeal.status}`),
          text("p", `Ban reason: ${appeal.banReason || "No reason was given."}`),
          text("p", `Why I should be unbanned: ${appeal.reason}`),
          text("small", `Target ID: ${appeal.targetId} · ${appeal.banUntil ? `Ban ends ${new Date(appeal.banUntil).toLocaleString()}` : "Permanent ban"}`));
        if (appeal.kind === "ip") row.append(text("small", "This request concerns a shared network address, not proof of the sender's identity."));
        if (appeal.status === "open") {
          for (const [status, label] of [["approved", "Approve & unban"], ["rejected", "Reject appeal"]]) {
            const button = text("button", label);
            button.type = "button";
            button.className = "secondary";
            button.onclick = () => {
              if (version !== appealVersion || button.disabled || !window.confirm(status === "approved"
                ? `Approve this appeal for ${appeal.targetName} and remove this ${appeal.kind === "ip" ? "IP" : "player"} ban? Other bans remain active.`
                : `Reject this appeal for ${appeal.targetName}? The ban stays in place.`)) return;
              const controls = row.querySelectorAll("button");
              controls.forEach((control) => { control.disabled = true; });
              request("adminReviewAppeal", { id: appeal.id, status }, $("#adminAppealError"), () => {
                appeals(offset > 0 && reply.appeals.length === 1 ? Math.max(0, offset - 20) : offset);
                if ($("#adminBanSection").open) activeBans();
                if ($("#adminReportSection").open) reports();
              }, () => version === appealVersion, () => {
                controls.forEach((control) => { control.disabled = false; });
              });
            };
            row.append(button);
          }
        } else row.append(text("small", `Reviewed ${new Date(appeal.reviewedAt).toLocaleString()} · By ${appeal.reviewedBy}`));
        list.append(row);
      }
      appealOffset = reply.nextOffset;
      $("#adminAppealNext").classList.toggle("hidden", appealOffset === null);
    }, () => version === appealVersion, () => { $("#adminAppealEntries").replaceChildren(); });
  }
  $("#adminAppealRefresh").onclick = () => appeals();
  $("#adminAppealStatus").onchange = () => appeals();
  $("#adminAppealNext").onclick = () => { if (appealOffset !== null) appeals(appealOffset); };
  $("#adminAppealSection").ontoggle = () => { if ($("#adminAppealSection").open && isAdmin()) appeals(); };
  function storage() {
    $("#adminStorageError").textContent = "";
    $("#adminStorageStatus").textContent = "Checking saved progress...";
    request("adminStorageStatus", undefined, $("#adminStorageError"), (reply) => {
      const status = reply.storage;
      $("#adminStorageStatus").textContent = `${status.backend} · ${status.profiles} profiles · ${
        status.backupAvailable ? "Previous-save backup available" : "No backup yet"}. ${
        status.lastSavedAt ? `Last saved ${new Date(status.lastSavedAt).toLocaleString()}. ` : ""}${status.notice}`;
    }, () => true, () => { $("#adminStorageStatus").textContent = "Storage status could not be checked."; });
  }
  $("#adminStorageRefresh").onclick = storage;
  $("#adminStorageSection").ontoggle = () => { if ($("#adminStorageSection").open && isAdmin()) storage(); };
  function support(event, input, notice, persistent) {
    if (!selected || !window.confirm(`${notice} for ${selected.username}?${persistent ? " This changes saved inventory." : ""}`)) return;
    const id = selected.id, version = searchVersion;
    const buttons = [...$("#adminSupport").querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    $("#adminProfileError").textContent = "";
    $("#adminProfileNotice").textContent = "Applying...";
    const restore = () => {
      if (version !== searchVersion) return;
      buttons.forEach((button) => { button.disabled = false; });
    };
    request(event, { playerId: id, ...input }, $("#adminProfileError"), () => {
      if (version === searchVersion) select(id, `${notice}: applied.`);
      else $("#adminProfileNotice").textContent = `${notice}: saved for the previous selection.`;
    }, () => true, () => { restore(); $("#adminProfileNotice").textContent = ""; });
  }
  $("#adminGrantGun").onclick = () => support("adminGrantWeapon", { weaponId: $("#adminGun").value }, "Grant gun", true);
  $("#adminHeal").onclick = () => support("adminPlayerSupport", { operation: "heal" }, "Heal live player", false);
  $("#adminAmmo").onclick = () => support("adminPlayerSupport", { operation: "ammo" }, "Refill live ammo", false);
  $("#adminProgression").onsubmit = (event) => {
    event.preventDefault();
    const operation = event.submitter?.dataset.operation;
    if (!selected || !operation) return;
    const level = Number($("#adminLevel").value);
    if (operation === "setLevel" && (!Number.isSafeInteger(level) || level < 1 || level > MAX_ADMIN_LEVEL)) {
      $("#adminProfileError").textContent = "Enter a valid whole-number level.";
      return;
    }
    if (!window.confirm(`${operation === "setLevel" ? `Set level to ${level}` :
      operation === "unlockAll" ? "Unlock all guns and maps" :
        operation === "unlockWeapons" ? "Unlock all guns" : "Unlock all maps"} for ${selected.username}? This changes saved progression.`)) return;
    $("#adminProfileError").textContent = "";
    $("#adminProfileNotice").textContent = "Saving changes…";
    const controls = [...$("#adminProgression").querySelectorAll("button")];
    controls.forEach((button) => { button.disabled = true; });
    const playerId = selected.id;
    const version = generation;
    const profileVersion = searchVersion, targetName = selected.username;
    socket.timeout(6000).emit("adminSetProgression", { playerId, operation, ...(operation === "setLevel" ? { level } : {}) },
      (error, reply) => {
        if (!isAdmin() || version !== generation) return;
        controls.forEach((button) => { button.disabled = false; });
        if (error || !reply?.ok) {
          $("#adminProfileNotice").textContent = "";
          $("#adminProfileError").textContent = `Update for ${targetName}: ${error ?
            "Progression update timed out. Refresh the profile before retrying." :
            reply?.error || "Unable to update progression."}`;
          return;
        }
        if (profileVersion === searchVersion) {
          select(playerId, "Saved. Active-match loadouts remain unchanged; equip guns in the lobby.");
        } else {
          $("#adminProfileNotice").textContent = `Saved changes for ${targetName}. Refresh that profile to inspect them.`;
        }
      });
  };
  return {
    open() {
      if (!selected && currentProfile()) select(currentProfile().id);
    },
    reset() {
      generation++;
      searchVersion++;
      logVersion++;
      reportVersion++;
      banVersion++;
      appealVersion++;
      selected = null;
      commandPending = false;
      $("#adminCommandSubmit").disabled = false;
      $("#adminCommandInput").value = "";
      $("#adminCommandOutput").replaceChildren();
      $("#adminCommandError").textContent = "";
      $("#adminClearCodes").click();
      nextOffset = nextBefore = banOffset = appealOffset = null;
      for (const id of ["adminProfileResults", "adminSelectedProfile", "adminLogEntries",
        "adminProfileError", "adminLogError", "adminProfileNotice", "adminStorageError", "adminStorageStatus",
        "adminReportEntries", "adminReportError", "adminBanEntries", "adminBanError", "adminAppealEntries", "adminAppealError"]) $(`#${id}`).replaceChildren();
      for (const id of ["adminProgression", "adminSupport", "adminProfileNext", "adminProfilePrevious", "adminLogOlder",
        "adminReportNext", "adminBanNext", "adminAppealNext"]) {
        $(`#${id}`).classList.add("hidden");
      }
      $("#adminProfileQuery").value = "";
      $("#adminRoomSection").open = $("#adminLogSection").open = $("#adminStorageSection").open =
        $("#adminReportSection").open = $("#adminBanSection").open = $("#adminAppealSection").open = false;
      $("#adminSupport").querySelectorAll("button").forEach((button) => { button.disabled = false; });
      $("#adminProgression").querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  };
}
