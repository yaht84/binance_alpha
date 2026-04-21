const fs = require("node:fs");
const path = require("node:path");
const { getConfig } = require("../api/_lib/config");
const { runScan } = require("../api/_lib/scanner");
const { formatAlert, sendTelegram } = require("../api/_lib/telegram");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const stateFile = path.join(root, process.env.ALERT_STATE_FILE || ".alert-state.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyStatic() {
  ensureDir(publicDir);
  fs.copyFileSync(path.join(root, "index.html"), path.join(publicDir, "index.html"));
  fs.rmSync(path.join(publicDir, "assets"), { recursive: true, force: true });
  fs.cpSync(path.join(root, "assets"), path.join(publicDir, "assets"), { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function sendAlerts(scan, config) {
  const state = readState();
  const now = Date.now();
  const cooldownMs = config.alertCooldownSeconds * 1000;
  const signals = scan.records.filter((item) => item.signal && item.cohort !== "pumped");
  const sent = [];
  const skipped = [];

  for (const item of signals) {
    const previous = state[item.token];
    if (previous && now - previous.sentAt < cooldownMs) {
      skipped.push({ token: item.token, reason: "cooldown" });
      continue;
    }

    const result = await sendTelegram(formatAlert(item, config.publicBaseUrl));
    if (result.skipped) {
      skipped.push({ token: item.token, reason: result.reason });
      continue;
    }

    state[item.token] = {
      sentAt: now,
      score: item.score,
      reasons: item.reasons.slice(0, 5),
    };
    sent.push({ token: item.token, score: item.score });
  }

  Object.keys(state).forEach((token) => {
    if (now - state[token].sentAt > cooldownMs * 6) delete state[token];
  });
  writeState(state);
  return { signals: signals.length, sent, skipped };
}

async function main() {
  const config = getConfig();
  const scan = await runScan(config);
  copyStatic();
  ensureDir(path.join(publicDir, "data"));
  fs.writeFileSync(path.join(publicDir, "data", "live.json"), JSON.stringify(scan, null, 2));
  const alerts = await sendAlerts(scan, config);
  console.log(
    JSON.stringify(
      {
        generatedAt: scan.generatedAt,
        coverage: scan.coverage,
        signals: alerts.signals,
        sent: alerts.sent,
        skipped: alerts.skipped,
        top: scan.summary.top.slice(0, 5).map((item) => ({
          token: item.token,
          score: item.score,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
