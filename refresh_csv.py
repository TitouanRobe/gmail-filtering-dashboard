"""
Standalone script to update the emails.csv file
from the Gmail API.

Usage:
    python refresh_csv.py
"""

import json
import os
import re
import time

import polars as pl
from loguru import logger
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
CSV_PATH = 'emails.csv'
TOKEN_PATH = 'token.json'
SECRETS_PATH = 'secrets.json'
STATUS_PATH = 'sync_status.json'
LOG_DIR = 'logs'


def _write_status(message_key=None, message_params=None, **kwargs):
    """
    Updates sync_status.json, polled by the backend to
    forward progress to the frontend.

    A message travels as three fields so the dashboard can display it in the
    user's language: `message_key` identifies it in the frontend catalog,
    `message_params` fills its placeholders, and `message` is the English text
    shown as-is when no key is known (a raw exception, for instance). They are
    always written together — a stale key left over from a previous step would
    describe the wrong thing.
    """
    data = {"status": "running", "current": 0, "total": 0, "message": ""}
    if os.path.exists(STATUS_PATH):
        try:
            with open(STATUS_PATH) as f:
                data.update(json.load(f))
        except (json.JSONDecodeError, OSError):
            pass
    data.update(kwargs)
    if "message" in kwargs:
        data["message_key"] = message_key
        data["message_params"] = message_params
    with open(STATUS_PATH, 'w') as f:
        json.dump(data, f)

# ---------- Logger ----------
os.makedirs(LOG_DIR, exist_ok=True)
logger.add(
    os.path.join(LOG_DIR, "refresh_{time:YYYY-MM-DD}.log"),
    rotation="1 day",
    retention="7 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}",
    level="INFO",
)


def _get_credentials():
    """Retrieves or renews the Gmail credentials."""
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        logger.debug("Token loaded from token.json")

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logger.info("Token expired, refreshing...")
            creds.refresh(Request())
        else:
            logger.info("No valid token, launching OAuth authentication...")
            flow = InstalledAppFlow.from_client_secrets_file(SECRETS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())
        logger.success("Token saved")

    return creds


def _extract_email(from_header: str) -> str:
    match = re.search(r'<(.+?)>', from_header)
    if match:
        return match.group(1).lower()
    return from_header.strip().lower()


def _extract_name(from_header: str) -> str:
    match = re.match(r'^"?([^"<]+?)"?\s*<', from_header)
    if match:
        return match.group(1).strip()
    return from_header.strip()


def refresh_csv():
    logger.info("=== Starting CSV refresh ===")
    _write_status(
        status="running",
        current=0,
        total=0,
        message_key="authenticating",
        message="Authenticating with Gmail...",
    )

    logger.info("Gmail authentication...")
    creds = _get_credentials()
    service = build('gmail', 'v1', credentials=creds)
    logger.success("Gmail service initialized")

    # 1. Retrieve all IDs
    logger.info("Fetching the message list...")
    _write_status(message_key="listing", message="Fetching the message list...")
    message_ids = []
    page_token = None
    while True:
        results = service.users().messages().list(
            userId='me',
            pageToken=page_token,
            maxResults=500
        ).execute()
        messages = results.get('messages', [])
        message_ids.extend([msg['id'] for msg in messages])
        page_token = results.get('nextPageToken')
        if not page_token:
            break

    total = len(message_ids)
    logger.info(f"{total} messages found. Extracting metadata...")
    _write_status(
        total=total,
        message_key="found",
        message_params={"total": total},
        message=f"{total} messages found. Extracting metadata...",
    )

    # 2. Fetch by batch with retries
    rows = []
    failed_ids = []
    batch_size = 50

    def _process_batch(ids_to_fetch):
        local_failed = []

        def callback(request_id, response, exception):
            if exception:
                local_failed.append(request_id)
                return
            msg_id = response.get('id', '')
            headers = response.get('payload', {}).get('headers', [])

            from_val = ''
            subject = ''
            date_str = ''

            for header in headers:
                name = header['name'].lower()
                if name == 'from':
                    from_val = header['value']
                elif name == 'subject':
                    subject = header['value']
                elif name == 'date':
                    date_str = header['value']

            rows.append({
                'id': msg_id,
                'from_email': _extract_email(from_val),
                'from_name': _extract_name(from_val),
                'subject': subject,
                'date': date_str,
            })

        batch = service.new_batch_http_request()
        for msg_id in ids_to_fetch:
            batch.add(
                service.users().messages().get(
                    userId='me',
                    id=msg_id,
                    format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date']
                ),
                callback=callback,
                request_id=msg_id
            )
        batch.execute()
        return local_failed

    for i in range(0, total, batch_size):
        batch_ids = message_ids[i:i + batch_size]
        fails = _process_batch(batch_ids)
        failed_ids.extend(fails)
        progress = min(i + batch_size, total)
        print(f"  Progress: {progress}/{total} ({len(failed_ids)} errors)", end='\r')
        _write_status(
            current=progress,
            total=total,
            message_key="extracting",
            message_params={"current": progress, "total": total},
            message=f"Extracting metadata… {progress}/{total}",
        )
        time.sleep(0.1)

    # Retries
    for attempt in range(1, 4):
        if not failed_ids:
            break
        logger.warning(f"Retry {attempt}/3 — {len(failed_ids)} failed messages")
        time.sleep(2 ** attempt)
        retry_ids = failed_ids[:]
        failed_ids = []
        for i in range(0, len(retry_ids), batch_size):
            batch_ids = retry_ids[i:i + batch_size]
            fails = _process_batch(batch_ids)
            failed_ids.extend(fails)
            time.sleep(0.2)

    if failed_ids:
        logger.warning(f"{len(failed_ids)} messages not retrieved after 3 retries")

    # 3. Save
    df = pl.DataFrame(rows)
    df.write_csv(CSV_PATH)

    logger.success(f"CSV updated: {df.shape[0]} rows saved to '{CSV_PATH}'")
    logger.info(f"Summary: {total - len(failed_ids)} retrieved / {total} total")
    logger.info("=== CSV refresh finished ===")

    print(f"\n✅ CSV updated: {df.shape[0]} rows saved to '{CSV_PATH}'")
    print(f"   ({total - len(failed_ids)} retrieved / {total} total)")

    _write_status(
        status="done",
        current=total,
        total=total,
        message_key="done",
        message_params={"saved": df.shape[0], "fetched": total - len(failed_ids), "total": total},
        message=f"{df.shape[0]} emails synced ({total - len(failed_ids)} retrieved / {total} total).",
    )


if __name__ == '__main__':
    try:
        refresh_csv()
    except Exception as e:
        logger.exception("Error during refresh")
        _write_status(status="error", message=str(e))
        raise
