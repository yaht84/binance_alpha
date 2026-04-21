const state = {
  data: null,
  filter: "all",
  query: "",
  selected: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);

function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pct(value) {
  if (value === undefined || value === null) return "-";
  const number = n(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(Math.abs(number) >= 100 ? 0 : 1)}%`;
}

function money(value) {
  const number = n(value);
  if (!number) return "-";
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(2)}M`;
  if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function x(value) {
  if (value === undefined || value === null) return "-";
  return `${n(value).toFixed(n(value) >= 10 ? 1 : 2)}x`;
}

function scoreClass(score) {
  if (score >= 75) return "high";
  if (score >= 50) return "mid";
  return "";
}

function trend(value) {
  return n(value) >= 0 ? "pos" : "neg";
}

function rows() {
  if (!state.data) return [];
  const query = state.query.trim().toUpperCase();
  return state.data.records
    .filter((item) => {
      if (state.filter === "signal") return item.signal;
      if (state.filter === "candidate") return item.cohort !== "pumped";
      if (state.filter === "pumped") return item.cohort === "pumped";
      return true;
    })
    .filter((item) => {
      if (!query) return true;
      return item.token.includes(query) || (item.futures && item.futures.symbol.includes(query));
    })
    .sort((a, b) => b.score - a.score);
}

async function loadLive() {
  if (state.busy) return;
  state.busy = true;
  $("statusText").textContent = "refreshing";
  $("liveDot").className = "";
  try {
    const response = await fetch(`/api/live?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    state.data = await response.json();
    if (!state.selected && state.data.records.length) {
      state.selected = state.data.summary.top[0]?.token || state.data.records[0].token;
    }
    $("statusText").textContent = "live";
    $("liveDot").className = "ok";
    render();
  } catch (error) {
    $("statusText").textContent = error.message;
    $("liveDot").className = "err";
  } finally {
    state.busy = false;
  }
}

function renderStats() {
  const data = state.data;
  $("signals").textContent = data.summary.signals;
  $("highRisk").textContent = data.summary.highRisk;
  $("coverage").textContent = `${data.coverage.withFutures}/${data.coverage.total}`;
  $("lastScan").textContent = new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("modePill").textContent = data.scanMode.scanAlphaUniverse ? "alpha universe" : "seed list";
}

function renderTable() {
  const visible = rows();
  if (!visible.some((item) => item.token === state.selected)) {
    state.selected = visible[0]?.token || null;
  }
  $("rowCount").textContent = `${visible.length} tokens`;
  $("rows").innerHTML = visible
    .map((item) => {
      const f = item.futures || {};
      const a = item.alpha || {};
      const cls = scoreClass(item.score);
      return `<tr data-token="${item.token}" class="${item.token === state.selected ? "selected" : ""} ${item.signal ? "signal-row" : ""}">
        <td><div class="token"><strong>${item.token}</strong><span>${f.symbol || "no perp"} · ${a.alphaId || "no alpha"}</span></div></td>
        <td><div class="score-cell"><strong>${item.score}</strong><span class="track"><span class="fill ${cls}" style="width:${item.score}%"></span></span></div></td>
        <td class="${trend(f.ret4h)}">${pct(f.ret4h)}</td>
        <td class="${trend(f.ret24h)}">${pct(f.ret24h)}</td>
        <td>${x(f.vol1hRatio)}</td>
        <td class="${trend(f.oi && f.oi.changePct)}">${pct(f.oi && f.oi.changePct)}</td>
        <td>${x(a.volumeLiquidity)}</td>
        <td>${money(a.liquidity)}</td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll("#rows tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.selected = tr.dataset.token;
      renderTable();
      renderDetail();
    });
  });
}

function renderDetail() {
  if (!state.data || !state.selected) return;
  const item = state.data.records.find((record) => record.token === state.selected);
  if (!item) return;
  const f = item.futures || {};
  const a = item.alpha || {};
  $("detailMeta").textContent = item.signal ? "active signal" : item.cohort;
  $("detailTitle").textContent = item.token;
  $("detailScore").textContent = item.score;
  $("detailScore").className = `score ${scoreClass(item.score)}`;
  $("perp").textContent = f.symbol || "-";
  $("price").textContent = f.price ? String(f.price) : a.price ? String(a.price) : "-";
  $("mcap").textContent = money(a.marketCap);
  $("liq").textContent = money(a.liquidity);
  $("reasons").innerHTML = (item.reasons.length ? item.reasons : ["no active trigger"])
    .map((reason) => `<span class="chip">${reason}</span>`)
    .join("");
  drawChart(item.chart || []);
}

function drawChart(points) {
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(240, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = "#68707d";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("No futures chart", 18, 28);
    return;
  }

  const pad = { l: 44, r: 14, t: 18, b: 38 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const prices = points.flatMap((p) => [n(p.h), n(p.l), n(p.c)]).filter(Boolean);
  const vols = points.map((p) => n(p.qv));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const maxV = Math.max(...vols, 1);
  const xFor = (i) => pad.l + (i / Math.max(points.length - 1, 1)) * innerW;
  const yFor = (price) => pad.t + (1 - (price - minP) / Math.max(maxP - minP, 1e-12)) * innerH * 0.72;

  ctx.strokeStyle = "#d8d0c0";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad.t + (innerH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(40, 103, 178, 0.16)";
  points.forEach((p, i) => {
    const barW = Math.max(1, innerW / points.length - 1);
    const barH = (n(p.qv) / maxV) * innerH * 0.22;
    ctx.fillRect(xFor(i), pad.t + innerH - barH, barW, barH);
  });

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#2867b2");
  grad.addColorStop(0.6, "#178263");
  grad.addColorStop(1, "#c44940");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  points.forEach((p, i) => {
    const xPos = xFor(i);
    const yPos = yFor(n(p.c));
    if (i === 0) ctx.moveTo(xPos, yPos);
    else ctx.lineTo(xPos, yPos);
  });
  ctx.stroke();

  ctx.fillStyle = "#68707d";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`high ${maxP.toPrecision(4)}`, 8, pad.t + 8);
  ctx.fillText(`low ${minP.toPrecision(4)}`, 8, pad.t + innerH * 0.72);
}

function render() {
  if (!state.data) return;
  renderStats();
  renderTable();
  renderDetail();
}

function bind() {
  $("refreshButton").addEventListener("click", loadLive);
  $("search").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTable();
    renderDetail();
  });
  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".segmented button").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      renderTable();
      renderDetail();
    });
  });
  window.addEventListener("resize", renderDetail);
}

bind();
loadLive();
setInterval(loadLive, 60_000);
