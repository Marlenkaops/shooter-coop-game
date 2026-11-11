export const ROUND_MS = 30000;

export function newRound(now) {
  return { endsAt: now + ROUND_MS, score: 0, hits: 0, shots: 0, streak: 0, active: true };
}

export function registerShot(round, hit, now) {
  if (!round.active) return round;
  if (now >= round.endsAt) return { ...round, active: false };
  const streak = hit ? round.streak + 1 : 0;
  return { ...round, shots: round.shots + 1, hits: round.hits + Number(hit), streak,
    score: round.score + (hit ? 100 + Math.min(streak - 1, 9) * 10 : 0) };
}

export function targetCell(previous, random = Math.random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Invalid target randomness.");
  const available = Array.from({ length: 9 }, (_, index) => index).filter((index) => index !== previous);
  return available[Math.floor(value * available.length)];
}

export function mountMaintenanceRange(root) {
  const $ = (selector) => root.querySelector(selector);
  const start = $("#rangeStart"), board = $("#rangeBoard"), target = $("#rangeTarget");
  let round = null, cell = -1, targetUntil = 0, timer, best = 0;
  function paint(now) {
    $("#rangeScore").textContent = String(round?.score || 0);
    $("#rangeTime").textContent = round ? `${Math.max(0, Math.ceil((round.endsAt - now) / 1000))}s` : "30s";
    $("#rangeAccuracy").textContent = round?.shots ? `${Math.round(round.hits / round.shots * 100)}%` : "--";
    $("#rangeCombo").textContent = `${round?.streak || 0}x`;
    $("#rangeBest").textContent = String(best);
  }
  function place(now) {
    cell = targetCell(cell);
    const kinds = ["ornament", "gift", "snowflake"];
    const kind = kinds[round.hits % kinds.length];
    target.dataset.kind = kind;
    target.setAttribute("aria-label", `Shoot Christmas ${kind}`);
    target.style.left = `${(cell % 3 + .5) / 3 * 100}%`;
    target.style.top = `${(Math.floor(cell / 3) + .5) / 3 * 100}%`;
    targetUntil = now + Math.max(650, 1700 - round.hits * 25);
    target.hidden = false;
  }
  function finish(now) {
    clearTimeout(timer);
    round = { ...round, active: false };
    best = Math.max(best, round.score);
    target.hidden = true;
    start.textContent = "Play again";
    board.classList.remove("running");
    $("#rangeMessage").textContent = `Round complete! ${round.score} points, ${round.hits} hits. Try to beat your best.`;
    paint(now);
  }
  function tick() {
    const now = performance.now();
    if (!round?.active) return;
    if (now >= round.endsAt) return finish(now);
    if (now >= targetUntil) {
      round = { ...round, streak: 0 };
      $("#rangeMessage").textContent = "Target escaped. Line up the next shot!";
      place(now);
    }
    paint(now);
    timer = setTimeout(tick, 100);
  }
  start.addEventListener("click", () => {
    clearTimeout(timer);
    const now = performance.now();
    round = newRound(now);
    start.textContent = "Restart round";
    board.classList.add("running");
    $("#rangeMessage").textContent = "Hit the Christmas ornaments, gifts and snowflakes. Keep your combo glowing!";
    place(now);
    paint(now);
    target.focus({ preventScroll: true });
    tick();
  });
  board.addEventListener("click", (event) => {
    if (!round?.active) return;
    const now = performance.now();
    if (now >= round.endsAt) return finish(now);
    const hit = target.contains(event.target) && now < targetUntil;
    round = registerShot(round, hit, now);
    $("#rangeMessage").textContent = hit ? `Hit! ${round.streak} in a row.` : "Miss! Reset your aim and try again.";
    if (hit || now >= targetUntil) place(now);
    paint(now);
  });
}
