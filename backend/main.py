import base64
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import List, Optional

import polars as pl
import requests
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ---------- Config ----------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = PROJECT_ROOT / "emails.csv"
TOKEN_PATH = PROJECT_ROOT / "token.json"
SYNC_SCRIPT_PATH = PROJECT_ROOT / "refresh_csv.py"
SYNC_STATUS_PATH = PROJECT_ROOT / "sync_status.json"
UNSUB_CACHE_PATH = PROJECT_ROOT / "unsubscribe_cache.json"
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Size of batches sent to the Gmail API (Google limit: 100 requests/batch).
# Kept low for writes (trash): beyond about twenty concurrent requests,
# Gmail responds "Too many concurrent requests for
# user" (429) on part of the batch.
TRASH_BATCH_SIZE = 15
UNSUB_BATCH_SIZE = 50
UNSUB_HTTP_TIMEOUT = 10
UNSUB_USER_AGENT = "gmail-filtering-dashboard/1.0 (+unsubscribe-scan)"

# ---------- Logger ----------
logger.add(
    LOG_DIR / "backend_{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="7 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}",
    level="INFO",
)

app = FastAPI(title="Gmail Filtering API")


def _http_error(status_code: int, code: str, message: str, params: dict | None = None) -> HTTPException:
    """
    Error the frontend can display in the user's language.

    `code` is a stable identifier translated by the frontend catalog, `params`
    fills its placeholders, and `message` is the English text used as-is when
    the catalog does not know the code (older frontend, unexpected failure).
    """
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "params": params},
    )


# CORS — allow the Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- CSV loading ----------
_df: pl.DataFrame | None = None


def _get_df() -> pl.DataFrame:
    """Load the CSV into memory (lazy singleton)."""
    global _df
    if _df is None:
        if not CSV_PATH.exists():
            logger.error(f"CSV not found: {CSV_PATH}")
            raise RuntimeError(f"CSV not found: {CSV_PATH}")
        _df = pl.read_csv(str(CSV_PATH))
        logger.info(f"CSV loaded: {_df.shape[0]} rows × {_df.shape[1]} columns")
    return _df


def _reload_df() -> pl.DataFrame:
    """Force a reload of the CSV."""
    global _df
    _df = None
    logger.info("CSV reload requested")
    return _get_df()


def _received_df() -> pl.DataFrame:
    """
    Received emails only: excludes emails where the sender is the user
    themselves (sent emails, drafts, notes to self).
    """
    df = _get_df()
    me = _get_user_email()
    if not me:
        return df
    return df.filter(pl.col("from_email") != me)


def _remove_from_df(ids: list[str]):
    """Removes rows from the in-memory DataFrame and from the CSV."""
    global _df
    df = _get_df()
    before = df.shape[0]
    _df = df.filter(~pl.col("id").is_in(ids))
    _df.write_csv(str(CSV_PATH))
    logger.info(f"CSV updated: {before} → {_df.shape[0]} rows ({before - _df.shape[0]} removed)")


# ---------- Unsubscribe cache ----------
def _load_unsub_cache() -> dict:
    """entry per sender address: {status, url, mailto, checked_at}."""
    if not UNSUB_CACHE_PATH.exists():
        return {}
    try:
        return json.loads(UNSUB_CACHE_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        logger.warning("Unsubscribe cache unreadable, starting fresh")
        return {}


def _save_unsub_cache(cache: dict) -> None:
    UNSUB_CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


# ---------- Gmail Service ----------
_gmail_service = None
_user_email: str | None = None
_user_email_resolved = False


def _reset_gmail_service():
    """
    Forces the service (and thus its underlying HTTP connection) to be
    rebuilt on the next call. Useful after a raw transport error
    (SSL, dropped connection...) where the connection reused by httplib2 is
    likely in a corrupted state.
    """
    global _gmail_service
    _gmail_service = None


def _get_gmail_service():
    """Creates/reuses the authenticated Gmail service."""
    global _gmail_service
    if _gmail_service is not None:
        return _gmail_service

    if not TOKEN_PATH.exists():
        logger.error("token.json not found")
        raise _http_error(500, "token_missing", "token.json not found. Run main.py first.")

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        logger.info("Token expired, refreshing...")
        creds.refresh(Request())
        with open(str(TOKEN_PATH), 'w') as f:
            f.write(creds.to_json())
        logger.info("Token refreshed successfully")

    if not creds or not creds.valid:
        logger.error("Invalid Gmail token")
        raise _http_error(
            500, "token_invalid", "Invalid Gmail token. Run main.py again to re-authenticate."
        )

    _gmail_service = build('gmail', 'v1', credentials=creds)
    logger.info("Gmail service initialized")
    return _gmail_service


def _get_user_email() -> str | None:
    """
    Address of the connected account, resolved once and then cached.
    Priority is given to the GMAIL_USER_EMAIL env var to avoid an API call,
    otherwise the Gmail profile is read. Returns None if nothing is
    available (the endpoints stay functional, without exclusion) — but only
    a success is cached: a one-off failure (token mid-rotation,
    network hiccup...) must not disable the exclusion for the rest of the
    process's life, so it's retried on the next request.
    """
    global _user_email, _user_email_resolved
    if _user_email_resolved:
        return _user_email

    env_email = os.getenv("GMAIL_USER_EMAIL")
    if env_email:
        _user_email = env_email.strip().lower()
        _user_email_resolved = True
        logger.info(f"User account (env): {_user_email}")
        return _user_email

    try:
        profile = _get_gmail_service().users().getProfile(userId='me').execute()
        _user_email = (profile.get("emailAddress") or "").lower() or None
        _user_email_resolved = True
        logger.info(f"User account (Gmail profile): {_user_email}")
    except Exception as e:
        logger.warning(f"Could not resolve the account address, will retry on the next request: {e}")

    return _user_email


_label_map: dict[str, str] | None = None


def _get_label_map() -> dict[str, str]:
    """
    Gmail label id → readable name, resolved once.
    Without this the API returns opaque ids like 'Label_6484935407583693853'.
    """
    global _label_map
    if _label_map is not None:
        return _label_map

    try:
        labels = _get_gmail_service().users().labels().list(userId='me').execute()
        _label_map = {l["id"]: l["name"] for l in labels.get("labels", [])}
    except Exception as e:
        logger.warning(f"Could not load labels: {e}")
        _label_map = {}
    return _label_map


def _pretty_labels(label_ids: list[str]) -> list[str]:
    """Readable label names, without the technical noise."""
    hidden = {"UNREAD", "IMPORTANT", "STARRED", "CATEGORY_PERSONAL"}
    mapping = _get_label_map()
    names = []
    for label_id in label_ids:
        if label_id in hidden:
            continue
        name = mapping.get(label_id, label_id)
        if name.startswith("CATEGORY_"):
            name = name.removeprefix("CATEGORY_").capitalize()
        names.append(name)
    return names


# ---------- Email helpers ----------

def _parse_date(raw: str | None) -> str | None:
    """RFC 2822 ('Tue, 01 Sep 2026 04:30:19 +0000') → ISO 8601, or None."""
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw).isoformat()
    except (TypeError, ValueError):
        return None


def _last_email_dates(df: pl.DataFrame) -> dict[str, str | None]:
    """
    ISO date of the most recent email per sender. We compare datetime
    objects (not the raw ISO strings) because the original timezones
    vary from one email to another and would break a lexical sort.
    """
    latest: dict[str, tuple[datetime, str]] = {}
    for row in df.select(["from_email", "date"]).to_dicts():
        raw = row.get("date")
        if not raw:
            continue
        try:
            dt = parsedate_to_datetime(raw)
        except (TypeError, ValueError):
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        email = row["from_email"]
        if email not in latest or dt > latest[email][0]:
            latest[email] = (dt, dt.isoformat())
    return {email: iso for email, (_, iso) in latest.items()}


def _decode_body(data: str | None) -> str:
    """Decodes a Gmail message body (base64url)."""
    if not data:
        return ""
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")


def _extract_bodies(payload: dict) -> tuple[str, str]:
    """
    Recursively walks a message's parts and returns (html, text).
    Keeps the first occurrence of each MIME type.
    """
    html, text = "", ""

    def walk(part: dict):
        nonlocal html, text
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        if mime == "text/html" and not html:
            html = _decode_body(body.get("data"))
        elif mime == "text/plain" and not text:
            text = _decode_body(body.get("data"))
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)
    return html, text


def _is_rate_limited(exception) -> bool:
    """True for a Gmail 429 ("Too many concurrent requests for user")."""
    if isinstance(exception, HttpError):
        status = getattr(getattr(exception, "resp", None), "status", None)
        return status == 429
    return False


def _trash_ids(ids: list[str]) -> dict:
    """
    Trashes a list of emails in Gmail via HTTP batches, then syncs the CSV.
    Returns a summary of the operation.

    Two ways an id can fail to complete on the first try, both retried
    before giving up:
    - rate limit (429 "Too many concurrent requests for user"): Gmail
      limits the number of concurrent writes per user, and an overly large
      batch gets partially rejected.
    - no response at all (callback never called): an HTTP batch that loses
      a sub-request along the way (network outage...).
    """
    if not ids:
        return {"trashed": 0, "errors": 0, "error_details": []}

    trashed: list[str] = []
    errors: list[dict] = []
    responded: set[str] = set()
    rate_limited: set[str] = set()

    def callback(request_id, response, exception):
        responded.add(request_id)
        if exception:
            if _is_rate_limited(exception):
                rate_limited.add(request_id)
                logger.warning(f"Rate limit trash {request_id}, will retry")
            else:
                logger.error(f"Trash error {request_id}: {exception}")
                errors.append({"id": request_id, "error": str(exception)})
        else:
            trashed.append(request_id)

    def run_batch(batch_ids: list[str]):
        for i in range(0, len(batch_ids), TRASH_BATCH_SIZE):
            chunk = batch_ids[i:i + TRASH_BATCH_SIZE]
            service = _get_gmail_service()
            batch = service.new_batch_http_request()
            for msg_id in chunk:
                batch.add(
                    service.users().messages().trash(userId='me', id=msg_id),
                    callback=callback,
                    request_id=msg_id,
                )
            try:
                batch.execute()
            except Exception as e:
                # Transport error (SSL, dropped connection...), not a
                # per-message error: no callback could therefore be called
                # for this batch. We log it, force a fresh connection for
                # what follows, and these ids will be retried as
                # "no response" by the retry loop below.
                logger.error(f"Network error during the delete batch ({len(chunk)} email(s)): {e}")
                _reset_gmail_service()
            # Let the rate of concurrent writes settle between two batches
            # instead of chaining them immediately.
            if i + TRASH_BATCH_SIZE < len(batch_ids):
                time.sleep(0.5)

    run_batch(ids)

    for attempt in range(1, 5):
        retry_ids = list(dict.fromkeys([msg_id for msg_id in ids if msg_id not in responded] + list(rate_limited)))
        if not retry_ids:
            break
        rate_limited.clear()
        logger.warning(f"Delete retry {attempt}/4 — {len(retry_ids)} email(s) (rate limit / no response)")
        time.sleep(2 * attempt)
        run_batch(retry_ids)

    missing = [msg_id for msg_id in ids if msg_id not in responded]
    for msg_id in missing:
        errors.append({"id": msg_id, "error": "No response from the Gmail API after several attempts"})
    for msg_id in rate_limited:
        errors.append({"id": msg_id, "error": "Too many concurrent requests (rate limit) after several attempts"})

    if trashed:
        _remove_from_df(trashed)

    logger.success(f"Delete complete: {len(trashed)} OK, {len(errors)} error(s)")
    return {
        "trashed": len(trashed),
        "errors": len(errors),
        "error_details": errors[:20],
    }


# ---------- Unsubscribe (List-Unsubscribe) ----------

def _parse_list_unsubscribe(header: str | None, post_header: str | None) -> dict:
    """
    Decodes the List-Unsubscribe / List-Unsubscribe-Post headers (RFC 2369 / 8058).

    - "one_click" : http(s) link + List-Unsubscribe-Post present → a simple
      POST is enough, no confirmation needed (the case targeted by Gmail's
      native unsubscribe button).
    - "link"      : http(s) link without the Post header → requires opening
      the page (the sender often asks for confirmation there).
    - "mailto"    : only a mailto address → we can only open the user's
      mail client, never send an email on their behalf.
    - "none"      : no List-Unsubscribe header.
    """
    if not header:
        return {"status": "none", "url": None, "mailto": None}

    uris = re.findall(r"<([^>]+)>", header)
    url = next((u for u in uris if u.lower().startswith(("http://", "https://"))), None)
    mailto = next((u[7:] for u in uris if u.lower().startswith("mailto:")), None)

    is_one_click = bool(post_header) and "one-click" in post_header.lower()

    if url and is_one_click:
        status = "one_click"
    elif url:
        status = "link"
    elif mailto:
        status = "mailto"
    else:
        status = "none"

    return {"status": status, "url": url, "mailto": mailto}


def _pick_representative_ids(emails: list[str]) -> dict[str, str]:
    """One message id per address (the most recent), to probe its headers."""
    df = _get_df().filter(pl.col("from_email").is_in(emails))
    if df.is_empty():
        return {}

    rows = df.select(["id", "from_email", "date"]).to_dicts()
    latest: dict[str, tuple[str, str]] = {}  # from_email -> (date_iso, id)
    for row in rows:
        email = row["from_email"]
        date_iso = _parse_date(row.get("date")) or ""
        if email not in latest or date_iso > latest[email][0]:
            latest[email] = (date_iso, row["id"])

    return {email: msg_id for email, (_, msg_id) in latest.items()}


def _scan_unsubscribe(emails: list[str], force: bool = False) -> dict:
    """
    Probes the List-Unsubscribe header of one representative message per
    sender, updates the on-disk cache and returns the full cache.
    """
    cache = _load_unsub_cache()
    targets = [e for e in dict.fromkeys(emails) if force or e not in cache]

    if not targets:
        return cache

    id_by_email = _pick_representative_ids(targets)
    email_by_id = {msg_id: email for email, msg_id in id_by_email.items()}

    if not email_by_id:
        return cache

    headers_by_id: dict[str, dict] = {}

    def callback(request_id, response, exception):
        if exception:
            logger.warning(f"Error reading headers {request_id}: {exception}")
            return
        raw = {h["name"].lower(): h["value"] for h in response.get("payload", {}).get("headers", [])}
        headers_by_id[request_id] = raw

    def fetch(ids_to_fetch: list[str]):
        for i in range(0, len(ids_to_fetch), UNSUB_BATCH_SIZE):
            chunk = ids_to_fetch[i:i + UNSUB_BATCH_SIZE]
            service = _get_gmail_service()
            batch = service.new_batch_http_request()
            for msg_id in chunk:
                batch.add(
                    service.users().messages().get(
                        userId="me",
                        id=msg_id,
                        format="metadata",
                        metadataHeaders=["List-Unsubscribe", "List-Unsubscribe-Post"],
                    ),
                    callback=callback,
                    request_id=msg_id,
                )
            try:
                batch.execute()
            except Exception as e:
                # Same logic as in _trash_ids: transport error, not a
                # per-message error. This batch's ids will be retried
                # via the "missing" mechanism already in place.
                logger.error(f"Network error during the unsubscribe scan ({len(chunk)} email(s)): {e}")
                _reset_gmail_service()

    ids = list(email_by_id.keys())
    fetch(ids)

    # A batch can fail partially (rate limit, network hiccup...):
    # we retry the missing ids before giving up, to avoid having to
    # relaunch the scan by hand every time.
    for attempt in range(1, 4):
        missing = [msg_id for msg_id in ids if msg_id not in headers_by_id]
        if not missing:
            break
        logger.warning(f"Retry ({attempt}/3) for {len(missing)} failed message(s)")
        time.sleep(2 * attempt)
        fetch(missing)

    checked_at = datetime.now(timezone.utc).isoformat()

    # A batch failure (rate limit, network hiccup...) must never be cached
    # as "none": the sender would stay "unknown" and get retried on the
    # next scan, instead of being frozen on a false negative.
    scanned = 0
    for msg_id, email in email_by_id.items():
        if msg_id not in headers_by_id:
            continue
        raw = headers_by_id[msg_id]
        parsed = _parse_list_unsubscribe(raw.get("list-unsubscribe"), raw.get("list-unsubscribe-post"))
        # We keep `last_run` (a trace of any past request): a rescan must
        # not erase the unsubscribe history.
        cache[email] = {**cache.get(email, {}), **parsed, "checked_at": checked_at}
        scanned += 1

    _save_unsub_cache(cache)
    failed = len(email_by_id) - scanned
    logger.info(f"Unsubscribe scan: {scanned} sender(s) probed, {failed} failure(s)")
    return cache


def _run_unsubscribe(emails: list[str]) -> dict:
    """
    Runs the unsubscribe action for each already-scanned address:
    POST for RFC 8058 one-click, GET for a plain link. Mailtos (or senders
    never scanned) are returned as-is: we never send an email on the
    user's behalf.

    An HTTP 200 doesn't guarantee the remote server actually processed the
    request — so it's recorded as "request sent", not as "unsubscribe
    confirmed", and the trace (`last_run`) is persisted in the cache so the
    page keeps the history.
    """
    cache = _load_unsub_cache()
    results = {}

    for email in dict.fromkeys(emails):
        entry = cache.get(email)
        if not entry:
            results[email] = {
                "ok": False,
                "status": "unknown",
                "detail_key": "not_scanned",
                "detail": "Not scanned yet",
            }
            continue

        status = entry.get("status")
        url = entry.get("url")

        if status not in ("one_click", "link") or not url:
            manual = status == "mailto"
            results[email] = {
                "ok": False,
                "status": status or "none",
                "detail_key": "manual_action_required" if manual else "no_unsubscribe_link",
                "detail": "Requires a manual action" if manual else "No unsubscribe link",
            }
            continue

        headers = {"User-Agent": UNSUB_USER_AGENT}
        try:
            if status == "one_click":
                resp = requests.post(
                    url,
                    data={"List-Unsubscribe": "One-Click"},
                    headers=headers,
                    timeout=UNSUB_HTTP_TIMEOUT,
                )
            else:
                resp = requests.get(url, headers=headers, timeout=UNSUB_HTTP_TIMEOUT)

            ok = resp.ok
            results[email] = {
                "ok": ok,
                "status": status,
                "detail_key": "http_status",
                "detail_params": {"status": resp.status_code},
                "detail": f"HTTP {resp.status_code}",
            }
            if ok:
                logger.success(f"Unsubscribe succeeded for {email} ({status})")
            else:
                logger.warning(f"Unsubscribe failed for {email}: HTTP {resp.status_code}")
        except requests.RequestException as e:
            logger.error(f"Unsubscribe error {email}: {e}")
            results[email] = {"ok": False, "status": status, "detail": str(e)}  # no key: raw error

    now = datetime.now(timezone.utc).isoformat()
    for email, result in results.items():
        if email in cache:
            cache[email] = {
                **cache[email],
                "last_run": {"at": now, "ok": result["ok"], "detail": result["detail"]},
            }
    _save_unsub_cache(cache)

    return results


# ---------- Gmail sync (refresh_csv.py) ----------
_sync_process: subprocess.Popen | None = None


def _start_sync_process() -> None:
    """Launches refresh_csv.py in the background, without blocking the FastAPI event loop."""
    global _sync_process
    if _sync_process is not None and _sync_process.poll() is None:
        raise _http_error(409, "sync_already_running", "A sync is already running.")

    # We reset the status even before the script starts, so the frontend's
    # first poll sees "running" right away.
    SYNC_STATUS_PATH.write_text(json.dumps({
        "status": "running",
        "current": 0,
        "total": 0,
        "message_key": "starting",
        "message_params": None,
        "message": "Starting the sync...",
    }))
    _sync_process = subprocess.Popen(
        [sys.executable, str(SYNC_SCRIPT_PATH)],
        cwd=str(PROJECT_ROOT),
    )
    logger.info(f"Gmail sync started (PID {_sync_process.pid})")


def _read_sync_status() -> dict:
    if not SYNC_STATUS_PATH.exists():
        return {"status": "idle"}
    try:
        data = json.loads(SYNC_STATUS_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {"status": "idle"}

    # The process may have died without having time to write a final status
    # (crash, kill...): we detect this to avoid leaving the frontend stuck.
    if data.get("status") == "running" and _sync_process is not None and _sync_process.poll() is not None:
        data["status"] = "error"
        data["message_key"] = "process_died"
        data["message_params"] = None
        data["message"] = "The sync process stopped unexpectedly."
        logger.error("Gmail sync: process terminated unexpectedly")

    return data


# ---------- Models ----------
class DeleteRequest(BaseModel):
    ids: List[str]


class DeleteSendersRequest(BaseModel):
    emails: List[str]


class ScanUnsubscribeRequest(BaseModel):
    emails: Optional[List[str]] = None
    force: bool = False


class RunUnsubscribeRequest(BaseModel):
    emails: List[str]


class ScanUnsubscribeRequest(BaseModel):
    emails: Optional[List[str]] = None
    force: bool = False


class RunUnsubscribeRequest(BaseModel):
    emails: List[str]


# ---------- Endpoints ----------

@app.get("/api/me")
def get_me():
    """Address of the connected Gmail account (excluded from rankings)."""
    return {"email": _get_user_email()}


@app.get("/api/stats")
def get_stats():
    """Global stats: total emails received, unique senders, top sender."""
    df = _received_df()
    ranking = (
        df.group_by("from_email")
        .agg(pl.col("from_email").count().alias("count"))
        .sort("count", descending=True)
    )

    if ranking.is_empty():
        return {"total_emails": 0, "unique_senders": 0, "top_sender": None}

    top = ranking.row(0, named=True)
    logger.debug(f"Stats requested — {df.shape[0]} emails, {ranking.shape[0]} senders")
    return {
        "total_emails": df.shape[0],
        "unique_senders": ranking.shape[0],
        "top_sender": {
            "email": top["from_email"],
            "count": top["count"],
        },
    }


@app.get("/api/senders")
def get_senders(limit: int = Query(default=1000, ge=1, le=5000)):
    """
    Ranking of senders by number of emails received.
    Returns: [{from_email, from_name, count, last_email_date}, ...]
    """
    df = _received_df()

    if df.is_empty():
        return []

    # Get the first from_name associated with each from_email
    names = (
        df.group_by("from_email")
        .agg(pl.col("from_name").first().alias("from_name"))
    )

    ranking = (
        df.group_by("from_email")
        .agg(pl.col("from_email").count().alias("count"))
        .sort("count", descending=True)
        .head(limit)
        .join(names, on="from_email", how="left")
    )

    last_dates = _last_email_dates(df)
    rows = ranking.select(["from_email", "from_name", "count"]).to_dicts()
    for row in rows:
        row["last_email_date"] = last_dates.get(row["from_email"])

    logger.debug(f"Senders requested — limit={limit}, returned={len(rows)}")
    return rows


@app.get("/api/senders/{email}/emails")
def get_sender_emails(email: str):
    """Lists all emails from a given sender, from most recent to oldest."""
    df = _get_df()
    filtered = df.filter(pl.col("from_email") == email.lower())

    if filtered.is_empty():
        logger.info(f"No emails left for {email}")
        return []

    rows = filtered.select(["id", "subject", "date"]).to_dicts()
    for row in rows:
        # `date` is an RFC 2822 header: we expose a sortable ISO version for the frontend
        row["date_iso"] = _parse_date(row.get("date"))

    rows.sort(key=lambda r: r["date_iso"] or "", reverse=True)
    logger.info(f"Emails from {email}: {len(rows)} results")
    return rows


@app.get("/api/emails/{msg_id}")
def get_email_detail(msg_id: str):
    """Full content of an email (headers + HTML/text body) for the preview."""
    service = _get_gmail_service()
    try:
        msg = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
    except Exception as e:
        logger.error(f"Error fetching email {msg_id}: {e}")
        raise _http_error(404, "email_not_found", f"Email not found: {msg_id}", {"id": msg_id})

    payload = msg.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    html, text = _extract_bodies(payload)

    return {
        "id": msg_id,
        "thread_id": msg.get("threadId"),
        "subject": headers.get("subject", ""),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "date": headers.get("date", ""),
        "date_iso": _parse_date(headers.get("date")),
        "snippet": msg.get("snippet", ""),
        "labels": _pretty_labels(msg.get("labelIds", [])),
        "body_html": html,
        "body_text": text,
    }


@app.post("/api/emails/trash")
def trash_emails(req: DeleteRequest):
    """Trashes the selected emails in Gmail."""
    logger.info(f"Delete request: {len(req.ids)} email(s)")
    return _trash_ids(req.ids)


@app.post("/api/senders/trash")
def trash_senders(req: DeleteSendersRequest):
    """Trashes ALL emails from the given senders."""
    emails = [e.lower() for e in req.emails]
    ids = _get_df().filter(pl.col("from_email").is_in(emails))["id"].to_list()
    logger.info(f"Delete request for {len(emails)} sender(s) — {len(ids)} email(s)")
    return _trash_ids(ids)


@app.get("/api/reload")
def reload_csv():
    """Reloads the CSV from disk."""
    df = _reload_df()
    logger.info(f"CSV reloaded: {df.shape[0]} emails")
    return {"message": "CSV reloaded", "total_emails": df.shape[0]}


@app.post("/api/sync/start")
def start_sync():
    """Starts refresh_csv.py in the background (re-sync with Gmail)."""
    _start_sync_process()
    return {"status": "running"}


@app.get("/api/sync/status")
def get_sync_status():
    """Current sync status, to be polled from the frontend."""
    return _read_sync_status()


@app.get("/api/unsubscribe/senders")
def get_unsubscribe_senders():
    """
    Sender ranking (like /api/senders) enriched with the known unsubscribe
    status: "unknown" as long as /api/unsubscribe/scan hasn't probed that
    address yet.
    """
    senders = get_senders(limit=5000)
    cache = _load_unsub_cache()

    for sender in senders:
        entry = cache.get(sender["from_email"])
        if entry:
            sender["unsubscribe"] = {
                "status": entry.get("status", "unknown"),
                "url": entry.get("url"),
                "mailto": entry.get("mailto"),
                "last_run": entry.get("last_run"),
            }
        else:
            sender["unsubscribe"] = {"status": "unknown", "url": None, "mailto": None, "last_run": None}

    return senders


@app.post("/api/unsubscribe/scan")
def scan_unsubscribe(req: ScanUnsubscribeRequest):
    """
    Probes the List-Unsubscribe header of the given senders (or of all
    known senders if `emails` is omitted) and updates the cache.
    """
    emails = [e.lower() for e in req.emails] if req.emails else [
        s["from_email"] for s in get_senders(limit=5000)
    ]
    logger.info(f"Unsubscribe scan requested for {len(emails)} sender(s), force={req.force}")
    cache = _scan_unsubscribe(emails, force=req.force)
    return {email: cache[email] for email in emails if email in cache}


@app.post("/api/unsubscribe/run")
def run_unsubscribe(req: RunUnsubscribeRequest):
    """Runs the unsubscribe action (one-click or link) for the chosen senders."""
    emails = [e.lower() for e in req.emails]
    logger.info(f"Unsubscribe requested for {len(emails)} sender(s)")
    return _run_unsubscribe(emails)
