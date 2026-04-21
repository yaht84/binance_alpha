function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function compactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !number) return "-";
  if (Math.abs(number) >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(2)}M`;
  if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${number.toFixed(0)}`;
}

function pct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${number.toFixed(Math.abs(number) >= 100 ? 0 : 1)}%`;
}

function formatAlert(item, publicBaseUrl) {
  const alpha = item.alpha || {};
  const futures = item.futures || {};
  const link = publicBaseUrl ? `https://${String(publicBaseUrl).replace(/^https?:\/\//, "")}` : "";
  const lines = [
    `<b>Binance Alpha PND signal: ${htmlEscape(item.token)}</b>`,
    `Score: <b>${item.score}/100</b>`,
    futures.symbol ? `Perp: <code>${htmlEscape(futures.symbol)}</code> price ${futures.price}` : "Perp: no live futures data",
    `24h: ${pct(futures.ret24h)} | 4h: ${pct(futures.ret4h)} | OI: ${pct(futures.oi && futures.oi.changePct)}`,
    `Alpha vol/liq: ${alpha.volumeLiquidity === null || alpha.volumeLiquidity === undefined ? "-" : `${Number(alpha.volumeLiquidity).toFixed(2)}x`}`,
    `MCAP: ${compactMoney(alpha.marketCap)} | liq: ${compactMoney(alpha.liquidity)}`,
    `Reasons: ${htmlEscape((item.reasons || []).slice(0, 4).join(", "))}`,
  ];
  if (link) lines.push(`<a href="${link}">Open dashboard</a>`);
  return lines.join("\n");
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || `${response.status} ${response.statusText}`);
  }
  return payload;
}

module.exports = {
  formatAlert,
  sendTelegram,
};
