/**
 * POST /api/report
 *
 * Receives a bug report from your Django server and sends
 * a richly formatted embed to your Discord channel via webhook.
 *
 * Expected payload (all fields optional except `title`):
 * {
 *   "title":       "NullPointerException in checkout flow",
 *   "level":       "critical" | "error" | "warning" | "info",
 *   "environment": "production" | "staging",
 *   "service":     "payments-service",
 *   "url":         "https://yourapp.com/checkout",
 *   "method":      "POST",
 *   "user":        { "id": "42", "email": "user@example.com" },
 *   "traceback":   "Traceback (most recent call last):\n  ...",
 *   "extra":       { "order_id": "ORD-9921", "cart_total": "$129.00" },
 *   "timestamp":   "2026-06-14T12:00:00Z"   // ISO8601, optional
 * }
 */

const LEVEL_CONFIG = {
  critical: { color: 0xff0000, emoji: "🔴", label: "CRITICAL" },
  error:    { color: 0xff4500, emoji: "🟠", label: "ERROR"    },
  warning:  { color: 0xffa500, emoji: "🟡", label: "WARNING"  },
  info:     { color: 0x3498db, emoji: "🔵", label: "INFO"     },
};

function buildEmbed(body) {
  const {
    title      = "Untitled Error",
    level      = "error",
    environment= "production",
    service    = "unknown",
    url        = null,
    method     = "GET",
    user       = null,
    traceback  = null,
    extra      = null,
    timestamp  = new Date().toISOString(),
  } = body;

  const cfg = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.error;
  const ts  = new Date(timestamp).toISOString();

  // ── Core fields ──────────────────────────────────────────────
  const fields = [
    {
      name:   "🌍 Environment",
      value:  `\`${environment}\``,
      inline: true,
    },
    {
      name:   "⚙️ Service",
      value:  `\`${service}\``,
      inline: true,
    },
    {
      name:   "⚠️ Level",
      value:  `${cfg.emoji} \`${cfg.label}\``,
      inline: true,
    },
  ];

  // ── Request info ─────────────────────────────────────────────
  if (url) {
    fields.push({
      name:   "🔗 Request",
      value:  `\`${method}\` ${url}`,
      inline: false,
    });
  }

  // ── Affected user ─────────────────────────────────────────────
  if (user) {
    const userStr = [
      user.id    && `**ID:** \`${user.id}\``,
      user.email && `**Email:** \`${user.email}\``,
      user.name  && `**Name:** ${user.name}`,
    ]
      .filter(Boolean)
      .join("  ·  ");

    fields.push({ name: "👤 User", value: userStr, inline: false });
  }

  // ── Extra metadata ────────────────────────────────────────────
  if (extra && Object.keys(extra).length > 0) {
    const extraStr = Object.entries(extra)
      .map(([k, v]) => `**${k}:** \`${v}\``)
      .join("\n");

    fields.push({ name: "📦 Extra Context", value: extraStr, inline: false });
  }

  // ── Traceback (truncated to Discord's 1024-char field limit) ──
  if (traceback) {
    const MAX = 1000;
    const trimmed =
      traceback.length > MAX
        ? traceback.slice(0, MAX) + "\n…(truncated)"
        : traceback;

    fields.push({
      name:  "📋 Traceback",
      value: "```python\n" + trimmed + "\n```",
      inline: false,
    });
  }

  // ── Suggested fix hint ────────────────────────────────────────
  if (traceback) {
    const hint = buildFixHint(traceback, level);
    if (hint) {
      fields.push({ name: "💡 Suggested Fix", value: hint, inline: false });
    }
  }

  return {
    username:   environment === "production" ? "BugBot 🐛 [PROD]" : "BugBot 🐛 [DEV]",
    avatar_url: "https://cdn-icons-png.flaticon.com/512/1046/1046784.png",
    embeds: [
      {
        title:       `${cfg.emoji}  ${title}`,
        color:       cfg.color,
        fields,
        footer: {
          text: `${environment === "production" ? "🔴 PRODUCTION" : "🟢 DEVELOPMENT"} · Reported at ${ts}`,
        },
        timestamp: ts,
      },
    ],
  };
}

/**
 * Very lightweight heuristic to suggest a fix based on the traceback text.
 * Extend this as needed — or swap in an LLM call later.
 */
function buildFixHint(traceback, level) {
  const tb = traceback.toLowerCase();

  if (tb.includes("does not exist") || tb.includes("matching query"))
    return "🔍 A database object was not found. Wrap the query in a `try/except ObjectDoesNotExist` block and handle the missing case gracefully.";

  if (tb.includes("operationalerror") && tb.includes("no such table"))
    return "🗄️ A database table is missing. Run `python manage.py migrate` and check that all apps are in `INSTALLED_APPS`.";

  if (tb.includes("integrityerror"))
    return "🔒 A database constraint was violated (unique/not-null). Validate the data before saving, or use `get_or_create`.";

  if (tb.includes("typeerror: 'nonetype'") || tb.includes("attributeerror: 'nonetype'"))
    return "🚫 A `None` value is being used where an object is expected. Add a `None` / `null` check before accessing the attribute.";

  if (tb.includes("keyerror"))
    return "🗝️ A dictionary key does not exist. Use `.get(key, default)` instead of direct indexing.";

  if (tb.includes("indexerror"))
    return "📐 A list index is out of range. Check that the list is non-empty before indexing, or use a safe slice.";

  if (tb.includes("timeout") || tb.includes("timed out"))
    return "⏱️ A timeout occurred. Review external HTTP call timeouts, add retries with exponential back-off, or move the call to a Celery task.";

  if (tb.includes("connectionrefusederror") || tb.includes("connection refused"))
    return "🔌 A connection was refused. Verify the target service is running and the host/port config is correct.";

  if (tb.includes("permissiondenied") || tb.includes("permission denied"))
    return "🔐 A permission check failed. Ensure the user has the required role/permission before reaching this code path.";

  if (tb.includes("validationerror"))
    return "✅ Validation failed. Review the serializer or form field rules and tighten client-side validation to prevent invalid data from reaching the server.";

  if (level === "critical")
    return "🚨 This is a critical issue. Prioritise an immediate hotfix and consider rolling back the last deploy if the error rate is high.";

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel serverless handler
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS — allow your Django origin (set ALLOWED_ORIGIN in env for production)
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bot-Secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  // ── Auth: shared secret header ────────────────────────────────
  const secret = process.env.BOT_SECRET;
  if (secret) {
    const provided = req.headers["x-bot-secret"];
    if (provided !== secret)
      return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Validate body ─────────────────────────────────────────────
  const body = req.body;
  if (!body || typeof body !== "object")
    return res.status(400).json({ error: "Invalid JSON body" });

  if (!body.title)
    return res.status(400).json({ error: "`title` field is required" });

  // ── Webhook URL — route by environment ─────────────────────────
  const env = (body.environment ?? "production").toLowerCase();
  const isProd = env === "production";

  const webhookUrl = isProd
    ? process.env.DISCORD_WEBHOOK_URL_PROD
    : process.env.DISCORD_WEBHOOK_URL_DEV;

  if (!webhookUrl) {
    const missing = isProd ? "DISCORD_WEBHOOK_URL_PROD" : "DISCORD_WEBHOOK_URL_DEV";
    return res.status(500).json({ error: `${missing} is not configured` });
  }

  // ── Build & send embed ────────────────────────────────────────
  const embed = buildEmbed(body);

  const discordRes = await fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(embed),
  });

  if (!discordRes.ok) {
    const errText = await discordRes.text();
    console.error("Discord webhook error:", errText);
    return res
      .status(502)
      .json({ error: "Failed to send to Discord", details: errText });
  }

  return res.status(200).json({ ok: true, message: "Bug report sent to Discord" });
}
