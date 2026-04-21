const PUMPED_TOKENS = ["RIVER", "SIREN", "RAVE", "SOON", "POWER", "MYX", "ARIA"];
const SEED_CANDIDATES = ["IRYS", "XAN", "ON", "Q", "TA", "IDOL", "TUT", "GWEI", "TAC", "TAG"];

function splitEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function getConfig() {
  return {
    pumpedTokens: PUMPED_TOKENS,
    seedCandidates: SEED_CANDIDATES,
    extraTokens: splitEnvList(process.env.EXTRA_TOKENS),
    scanAlphaUniverse: boolEnv("SCAN_ALPHA_UNIVERSE", true),
    maxScanTokens: intEnv("MAX_SCAN_TOKENS", 90),
    alertScoreThreshold: intEnv("ALERT_SCORE_THRESHOLD", 75),
    alertCooldownSeconds: intEnv("ALERT_COOLDOWN_SECONDS", 6 * 60 * 60),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.VERCEL_URL || "",
  };
}

module.exports = {
  PUMPED_TOKENS,
  SEED_CANDIDATES,
  getConfig,
};
