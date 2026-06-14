"""
bugbot.py  —  Drop this file anywhere in your Django project.

Usage
-----
from bugbot import report_bug

# Manual call
report_bug(
    title="Payment failed silently",
    level="error",
    service="payments",
    url=request.build_absolute_uri(),
    method=request.method,
    user=request.user,
    traceback_str=traceback.format_exc(),
    extra={"order_id": order.id},
)

# Or use the decorator  ↓  (catches + re-raises unhandled exceptions)
@report_on_exception(service="payments", level="critical")
def process_payment(order):
    ...
"""

import traceback as _tb
import functools
import logging
import os
import threading

import requests  # pip install requests  (already in every Django project)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Config  (put these in your Django settings or .env)
# ─────────────────────────────────────────────────────────────────────────────
BUGBOT_URL    = os.getenv("BUGBOT_URL", "")          # https://your-bot.vercel.app/api/report
BUGBOT_SECRET = os.getenv("BUGBOT_SECRET", "")       # matches BOT_SECRET on Vercel
BUGBOT_ENV    = os.getenv("BUGBOT_ENV") or os.getenv("DJANGO_ENV", "production")  # production | development
BUGBOT_ASYNC  = os.getenv("BUGBOT_ASYNC", "true").lower() == "true"  # fire-and-forget


def report_bug(
    title: str,
    level: str = "error",
    service: str = "django",
    url: str | None = None,
    method: str = "GET",
    user=None,          # Django User object or dict with id/email/name
    traceback_str: str | None = None,
    extra: dict | None = None,
    environment: str | None = None,
):
    """Send a bug report to the BugBot Vercel endpoint."""
    if not BUGBOT_URL:
        logger.warning("BUGBOT_URL is not set — skipping bug report.")
        return

    # Normalise user
    user_payload = None
    if user is not None:
        if isinstance(user, dict):
            user_payload = user
        else:
            # Django User model
            user_payload = {}
            if hasattr(user, "pk"):
                user_payload["id"] = str(user.pk)
            if hasattr(user, "email") and user.email:
                user_payload["email"] = user.email
            if hasattr(user, "get_full_name"):
                name = user.get_full_name()
                if name:
                    user_payload["name"] = name

    payload = {
        "title":       title,
        "level":       level,
        "service":     service,
        "environment": environment or BUGBOT_ENV,
        "url":         url,
        "method":      method,
        "user":        user_payload,
        "traceback":   traceback_str,
        "extra":       extra,
    }
    # Strip None values so the bot uses its own defaults
    payload = {k: v for k, v in payload.items() if v is not None}

    headers = {"Content-Type": "application/json"}
    if BUGBOT_SECRET:
        headers["X-Bot-Secret"] = BUGBOT_SECRET

    def _send():
        try:
            resp = requests.post(BUGBOT_URL, json=payload, headers=headers, timeout=5)
            if not resp.ok:
                logger.error("BugBot: failed to send report — %s %s", resp.status_code, resp.text)
        except Exception as exc:
            logger.error("BugBot: exception while sending report — %s", exc)

    if BUGBOT_ASYNC:
        threading.Thread(target=_send, daemon=True).start()
    else:
        _send()


# ─────────────────────────────────────────────────────────────────────────────
# Decorator
# ─────────────────────────────────────────────────────────────────────────────
def report_on_exception(service="django", level="error", extra_fn=None):
    """
    Decorator that catches any exception, fires a bug report, then re-raises.

    @report_on_exception(service="checkout", level="critical")
    def my_view(request):
        ...
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as exc:
                tb_str = _tb.format_exc()

                # Try to extract a Django request from args
                request = None
                for arg in args:
                    if hasattr(arg, "method") and hasattr(arg, "build_absolute_uri"):
                        request = arg
                        break

                extra = extra_fn(*args, **kwargs) if extra_fn else None

                report_bug(
                    title=f"{type(exc).__name__}: {exc}",
                    level=level,
                    service=service,
                    url=request.build_absolute_uri() if request else None,
                    method=request.method if request else "N/A",
                    user=getattr(request, "user", None) if request else None,
                    traceback_str=tb_str,
                    extra=extra,
                )
                raise
        return wrapper
    return decorator


# ─────────────────────────────────────────────────────────────────────────────
# Django signal integration (optional)
# ─────────────────────────────────────────────────────────────────────────────
def install_got_request_exception_handler():
    """
    Call this in your AppConfig.ready() to auto-report every unhandled
    Django request exception to Discord.

    Example in apps.py:
        class MyAppConfig(AppConfig):
            def ready(self):
                from bugbot import install_got_request_exception_handler
                install_got_request_exception_handler()
    """
    from django.core.signals import got_request_exception

    def _handler(sender, request=None, **kwargs):
        tb_str = _tb.format_exc()
        title_line = tb_str.strip().splitlines()[-1] if tb_str.strip() else "Unknown error"
        report_bug(
            title=title_line,
            level="error",
            service="django",
            url=request.build_absolute_uri() if request else None,
            method=request.method if request else None,
            user=getattr(request, "user", None) if request else None,
            traceback_str=tb_str,
        )

    got_request_exception.connect(_handler)
