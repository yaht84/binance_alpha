const { getJson, hasDurableStore, setJson } = require("./store");
const { formatAlert, sendTelegram } = require("./telegram");

const STATE_TTL_SECONDS = 30 * 24 * 60 * 60;

function fingerprint(item) {
  return (item.reasons || []).slice(0, 4).join("|");
}

function hours(ms) {
  return ms / (60 * 60 * 1000);
}

function shouldBlockEphemeralAlerts() {
  return !hasDurableStore() && process.env.ALLOW_EPHEMERAL_ALERTS !== "true";
}

function classifyTransition(item, previous, config, now) {
  const score = Number(item.score || 0);
  const threshold = config.alertScoreThreshold;
  const reset = config.alertResetThreshold;
  const escalation = config.alertEscalationDelta;
  const cooldownMs = config.alertCooldownSeconds * 1000;
  const reminderMs = config.alertReminderHours > 0 ? config.alertReminderHours * 60 * 60 * 1000 : 0;

  if (score < threshold) {
    return {
      action: "state_update",
      reason: score <= reset ? "reset_below_threshold" : "below_trigger_threshold",
      active: score > reset && Boolean(previous && previous.active),
      send: false,
    };
  }

  if (!previous || !previous.active) {
    return {
      action: "enter",
      reason: "new_trigger",
      active: true,
      send: true,
    };
  }

  const lastSentAt = Number(previous.lastSentAt || 0);
  const cooldownOk = !lastSentAt || now - lastSentAt >= cooldownMs;
  const scoreDelta = score - Number(previous.score || 0);

  if (cooldownOk && scoreDelta >= escalation) {
    return {
      action: "escalation",
      reason: `score_up_${scoreDelta}`,
      active: true,
      send: true,
    };
  }

  if (cooldownOk && reminderMs > 0 && now - lastSentAt >= reminderMs) {
    return {
      action: "reminder",
      reason: `still_active_${Math.round(hours(now - lastSentAt))}h`,
      active: true,
      send: true,
    };
  }

  return {
    action: "hold",
    reason: cooldownOk ? "already_active" : "cooldown",
    active: true,
    send: false,
  };
}

async function processAlertScan(scan, config) {
  const now = Date.now();
  const sent = [];
  const skipped = [];
  const updated = [];
  const candidates = scan.records.filter((item) => item.cohort !== "pumped");

  if (shouldBlockEphemeralAlerts()) {
    return {
      sent,
      updated,
      skipped: [
        {
          reason: "durable_state_missing",
          detail: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before enabling Telegram alerts on Vercel.",
        },
      ],
    };
  }

  for (const item of candidates) {
    const key = `alert-state:${item.token}`;
    const previous = (await getJson(key)) || null;
    const transition = classifyTransition(item, previous, config, now);
    const state = {
      token: item.token,
      active: transition.active,
      score: item.score,
      lastSeenAt: now,
      lastReasonFingerprint: fingerprint(item),
      lastAction: transition.action,
      lastTransitionReason: transition.reason,
      lastSentAt: previous ? previous.lastSentAt || 0 : 0,
    };

    if (transition.send) {
      try {
        const result = await sendTelegram(formatAlert(item, config.publicBaseUrl, transition.action));
        if (result.skipped) {
          state.active = Boolean(previous && previous.active);
          state.lastAction = "delivery_skipped";
          state.lastTransitionReason = result.reason;
          skipped.push({ token: item.token, reason: result.reason });
        } else {
          state.lastSentAt = now;
          sent.push({
            token: item.token,
            score: item.score,
            action: transition.action,
            reason: transition.reason,
          });
        }
      } catch (error) {
        state.active = Boolean(previous && previous.active);
        state.lastAction = "delivery_failed";
        state.lastTransitionReason = error.message;
        skipped.push({ token: item.token, reason: "telegram_error", detail: error.message });
      }
    } else {
      skipped.push({
        token: item.token,
        score: item.score,
        action: transition.action,
        reason: transition.reason,
      });
    }

    await setJson(key, state, STATE_TTL_SECONDS);
    updated.push({
      token: item.token,
      active: state.active,
      score: state.score,
      action: transition.action,
      reason: transition.reason,
    });
  }

  return { sent, skipped, updated };
}

module.exports = {
  processAlertScan,
};
