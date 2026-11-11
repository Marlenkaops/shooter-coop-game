import { RANK_DIFFICULTIES, RANK_METRICS, RANK_MODES, RANK_PERIODS } from "../shared/rankings.js";
import { MAPS } from "../shared/progression.js";
import { MODES } from "../shared/modes.js";

export function mountLeaderboard(socket, { openProfile = () => {} } = {}) {
  const $ = (selector) => document.querySelector(selector);
  const panel = $("#leaderboardPanel");
  const tabs = [...panel.querySelectorAll("[data-ranking]")];
  let sort = "xp", offset = 0, nextOffset = null, version = 0, pending = false;
  const filters = document.createElement("div");
  filters.id = "rankingFilters"; filters.className = "record-filters hidden";
  filters.innerHTML = `<label>Period<select id="rankingPeriod">${Object.entries(RANK_PERIODS).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label>
    <label>Statistic<select id="rankingMetric">${Object.entries(RANK_METRICS).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label>
    <label>Compare<select id="rankingScope"><option value="global">All operators</option><option value="friends">Mutual friends + me</option><option value="squads">Registered squads</option></select></label>
    <label id="rankingRouteLabel" class="hidden">Fastest-clear route<select id="rankingRoute">${MAPS.flatMap((map) => RANK_MODES.map((mode) =>
    `<option value="${map.id}:${mode}">${map.name} / ${MODES[mode].name}</option>`)).join("")}</select></label>
    <p>Verified PvE since tracking began. At least 30 seconds and a contribution; no training, FFA or admin assistance.
    Score = 100 per elimination + 50 per assist + 150 per revive + objective points + 250 per full victory.
    Accuracy needs 20 shots. Clear times compare one route without mutators; difficulty is shown.</p>`;
  panel.querySelector(".leaderboard-tabs").after(filters);
  const query = () => ({ period: $("#rankingPeriod").value, metric: $("#rankingMetric").value,
    scope: $("#rankingScope").value, route: $("#rankingRoute").value });
  $("#rankingRoute").value = "foundry:campaign";
  filters.onchange = () => load();
  function formatted(value) {
    const metric = query().metric;
    return metric === "accuracy" ? `${(value / 100).toFixed(2)}%` : metric === "fastest" ? `${(value / 1000).toFixed(2)}s` :
      metric === "difficulty" ? RANK_DIFFICULTIES[value] : value.toLocaleString();
  }

  function controls() {
    $("#leaderboardRefresh").disabled = pending || !socket.connected;
    $("#leaderboardPrevious").disabled = pending || !socket.connected || offset === 0;
    $("#leaderboardNext").disabled = pending || !socket.connected || nextOffset === null;
    panel.setAttribute("aria-busy", String(pending));
    for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.ranking === sort));
    filters.classList.toggle("hidden", sort !== "records");
    $("#rankingRouteLabel").classList.toggle("hidden", query().metric !== "fastest");
    $("#leaderboardScore").textContent = sort === "records" ? RANK_METRICS[query().metric] :
      sort === "season" ? "Season XP" : sort === "xp" ? "Level / XP" : "Eliminations";
  }

  function clear() {
    $("#leaderboardEntries").replaceChildren();
    $("#leaderboardOwn").textContent = "";
    $("#leaderboardCount").textContent = "";
    nextOffset = null;
  }

  function score(entry) {
    if (sort === "records") return formatted(entry.value);
    return sort === "season" ? `${entry.seasonXp.toLocaleString()} season XP` : sort === "xp" ? `Level ${entry.level} / ${entry.xp.toLocaleString()} XP` :
      `${entry.totalKills.toLocaleString()} eliminations`;
  }

  function render(reply) {
    offset = reply.offset;
    nextOffset = reply.nextOffset;
    const list = $("#leaderboardEntries");
    for (const entry of reply.entries) {
      const row = document.createElement("tr");
      if (entry.self) row.className = "leaderboard-self";
      const rank = document.createElement("td");
      rank.textContent = `#${entry.rank}`;
      const operator = document.createElement("td");
      const name = document.createElement("strong");
      name.textContent = `${entry.username}${entry.self ? " (You)" : ""}`;
      if (sort !== "records" || query().scope !== "squads") {
        const view = document.createElement("button");
        view.type = "button"; view.className = "secondary record-view";
        view.setAttribute("aria-label", `View ${entry.username}'s public profile`);
        view.onclick = () => openProfile(entry.playerTag.toUpperCase());
        view.append(name); operator.append(view);
      } else operator.append(name);
      const tag = document.createElement("small");
      tag.textContent = `#${entry.playerTag} / ${entry.matches.toLocaleString()} matches${entry.members !== undefined ? ` / ${entry.members} members${entry.archived ? " / archived" : ""}` : ""}`;
      operator.append(tag);
      const value = document.createElement("td");
      const primary = document.createElement("strong");
      primary.textContent = sort === "records" ? formatted(entry.value) : sort === "season" ? `${entry.seasonXp.toLocaleString()} XP` : sort === "xp" ? `Level ${entry.level}` : entry.totalKills.toLocaleString();
      const secondary = document.createElement("small");
      secondary.textContent = sort === "records" ? query().metric === "accuracy" ? `${entry.hits}/${entry.shots} shots` :
        query().metric === "fastest" ? RANK_DIFFICULTIES[entry.clearDifficulty] : "" : sort === "xp" ? `${entry.xp.toLocaleString()} XP` :
        `Level ${entry.level} / ${entry.xp.toLocaleString()} XP`;
      value.append(primary, secondary);
      row.append(rank, operator, value);
      list.append(row);
    }
    $("#leaderboardOwn").textContent = reply.self
      ? `Your rank: #${reply.self.rank} / ${score(reply.self)}`
      : "You are not ranked yet. Finish a rewarded match to enter.";
    $("#leaderboardCount").textContent = reply.total
      ? `${offset + 1}-${offset + reply.entries.length} of ${reply.total.toLocaleString()} ranked operators`
      : "No ranked operators yet.";
  }

  function load(start = 0) {
    const requestVersion = ++version;
    clear();
    offset = start;
    pending = socket.connected;
    $("#leaderboardError").textContent = socket.connected ? "" : "Connection lost. Reconnect to load the leaderboard.";
    $("#leaderboardCount").textContent = pending ? "Loading rankings..." : "";
    controls();
    if (!socket.connected) return;
    socket.timeout(6000).emit(sort === "records" ? "rankings" : "leaderboard", sort === "records" ? { ...query(), offset } : { sort, offset }, (error, reply) => {
      if (requestVersion !== version || !panel.open) return;
      pending = false;
      $("#leaderboardCount").textContent = "";
      if (error || !reply?.ok) {
        $("#leaderboardError").textContent = error ? "Leaderboard timed out. Try Refresh." :
          reply?.error || "Leaderboard could not be loaded. Try Refresh.";
      } else render(reply);
      controls();
    });
  }

  function close() {
    version++;
    pending = false;
    clear();
    if (panel.open) panel.close();
  }
  for (const button of document.querySelectorAll(".leaderboard-open")) button.onclick = () => {
    panel.showModal();
    load();
  };
  for (const tab of tabs) tab.onclick = () => {
    if (tab.dataset.ranking === sort) return;
    sort = tab.dataset.ranking;
    load();
  };
  $("#leaderboardClose").onclick = close;
  $("#leaderboardRefresh").onclick = () => load(offset);
  $("#leaderboardPrevious").onclick = () => load(Math.max(0, offset - 20));
  $("#leaderboardNext").onclick = () => { if (nextOffset !== null) load(nextOffset); };
  panel.addEventListener("close", () => { version++; pending = false; clear(); });
  socket.on("disconnect", () => {
    if (panel.open) load(offset);
  });
  socket.on("identity", () => {
    if (panel.open) load(offset);
  });
  for (const event of ["joined", "matchStarted", "banned"]) socket.on(event, close);
  return { close };
}
