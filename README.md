# 🐛 Discord Bug Bot

> A lightweight, self-hosted Sentry replacement.  
> Hit one endpoint from your Django server → get a rich, actionable bug report straight in Discord.

---

## How it works

```
Django server  ──POST /api/report──►  Vercel Serverless  ──webhook──►  Discord channel
```

---

## 1 · Get a Discord Webhook URL

1. Open your Discord server → **Server Settings → Integrations → Webhooks**
2. Click **New Webhook**, choose the `#bugs` channel, copy the URL

---

## 2 · Deploy to Vercel

```bash
# Install Vercel CLI once
npm i -g vercel

# Inside this repo
cd discord-bug-bot
npm install

# Deploy
vercel --prod
```

Set these **Environment Variables** in the Vercel dashboard (or via `vercel env add`):

| Variable              | Required | Description                                         |
|-----------------------|----------|-----------------------------------------------------|
| `DISCORD_WEBHOOK_URL` | ✅       | The webhook URL from step 1                         |
| `BOT_SECRET`          | ✅       | A long random secret shared with your Django server |
| `ALLOWED_ORIGIN`      | optional | Your Django origin for CORS (default `*`)           |

---

## 3 · Add `bugbot.py` to your Django project

Copy `django-client/bugbot.py` into your Django project root (or any package).

Add to your Django `.env`:

```env
BUGBOT_URL=https://your-bot.vercel.app/api/report
BUGBOT_SECRET=change-me-to-a-long-random-string
BUGBOT_ENV=production
```

---

## 4 · Use it in Django

### Option A — Manual call

```python
import traceback
from bugbot import report_bug

def checkout(request):
    try:
        process_payment(request)
    except Exception as exc:
        report_bug(
            title=f"{type(exc).__name__}: {exc}",
            level="critical",
            service="payments",
            url=request.build_absolute_uri(),
            method=request.method,
            user=request.user,
            traceback_str=traceback.format_exc(),
            extra={"order_id": order.id, "amount": "$49.99"},
        )
        raise
```

### Option B — Decorator (auto-catches & re-raises)

```python
from bugbot import report_on_exception

@report_on_exception(service="payments", level="critical")
def process_payment(request, order):
    # any uncaught exception here gets reported automatically
    ...
```

### Option C — Auto-report ALL Django exceptions (recommended)

In your `apps.py`:

```python
from django.apps import AppConfig

class MyAppConfig(AppConfig):
    name = "myapp"

    def ready(self):
        from bugbot import install_got_request_exception_handler
        install_got_request_exception_handler()
```

---

## API Payload Reference

`POST /api/report`

| Field         | Type   | Required | Description                                          |
|---------------|--------|----------|------------------------------------------------------|
| `title`       | string | ✅       | Short error summary                                  |
| `level`       | string |          | `critical` / `error` / `warning` / `info` (default `error`) |
| `environment` | string |          | `production`, `staging`, etc.                        |
| `service`     | string |          | Name of the service/app                              |
| `url`         | string |          | URL that triggered the error                         |
| `method`      | string |          | HTTP method                                          |
| `user`        | object |          | `{ id, email, name }`                                |
| `traceback`   | string |          | Full traceback string                                |
| `extra`       | object |          | Any extra key-value pairs                            |
| `timestamp`   | string |          | ISO8601 timestamp (default: now)                     |

**Headers:**

```
Content-Type: application/json
X-Bot-Secret: <your BOT_SECRET>
```

---

## Local development

```bash
vercel dev
# → http://localhost:3000/api/report
```

Test with curl:

```bash
curl -X POST http://localhost:3000/api/report \
  -H "Content-Type: application/json" \
  -H "X-Bot-Secret: change-me-to-a-long-random-string" \
  -d '{
    "title": "NullPointerException in checkout",
    "level": "critical",
    "service": "payments",
    "environment": "production",
    "url": "https://myapp.com/checkout",
    "method": "POST",
    "user": { "id": "42", "email": "user@example.com" },
    "traceback": "Traceback (most recent call last):\n  File \"views.py\", line 42, in checkout\n    order.process()\nAttributeError: NullPointerException",
    "extra": { "order_id": "ORD-9921", "cart_total": "$129.00" }
  }'
```

---

## What the Discord message looks like

```
🔴  NullPointerException in checkout
────────────────────────────────────
🌍 Environment   ⚙️ Service      ⚠️ Level
`production`     `payments`      🔴 `CRITICAL`

🔗 Request
`POST` https://myapp.com/checkout

👤 User
ID: `42`  ·  Email: `user@example.com`

📦 Extra Context
order_id: `ORD-9921`
cart_total: `$129.00`

📋 Traceback
```python
Traceback (most recent call last):
  File "views.py", line 42, in checkout
    order.process()
AttributeError: NullPointerException
```

💡 Suggested Fix
🚫 A `None` value is being used where an object is expected.
   Add a `None` / `null` check before accessing the attribute.

Reported at 2026-06-14T12:00:00.000Z
```
