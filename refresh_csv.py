"""
Script indépendant pour mettre à jour le fichier emails.csv
à partir de l'API Gmail.

Usage :
    python refresh_csv.py
"""

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
LOG_DIR = 'logs'

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
    """Récupère ou renouvelle les credentials Gmail."""
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
        logger.debug("Token chargé depuis token.json")

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            logger.info("Token expiré, rafraîchissement...")
            creds.refresh(Request())
        else:
            logger.info("Aucun token valide, lancement de l'authentification OAuth...")
            flow = InstalledAppFlow.from_client_secrets_file(SECRETS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())
        logger.success("Token sauvegardé")

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
    logger.info("=== Début du refresh CSV ===")

    logger.info("Authentification Gmail...")
    creds = _get_credentials()
    service = build('gmail', 'v1', credentials=creds)
    logger.success("Service Gmail initialisé")

    # 1. Récupérer tous les IDs
    logger.info("Récupération de la liste des messages...")
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
    logger.info(f"{total} messages trouvés. Extraction des métadonnées...")

    # 2. Fetch par batch avec retries
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
        print(f"  Progression : {progress}/{total} ({len(failed_ids)} erreurs)", end='\r')
        time.sleep(0.1)

    # Retries
    for attempt in range(1, 4):
        if not failed_ids:
            break
        logger.warning(f"Retry {attempt}/3 — {len(failed_ids)} messages échoués")
        time.sleep(2 ** attempt)
        retry_ids = failed_ids[:]
        failed_ids = []
        for i in range(0, len(retry_ids), batch_size):
            batch_ids = retry_ids[i:i + batch_size]
            fails = _process_batch(batch_ids)
            failed_ids.extend(fails)
            time.sleep(0.2)

    if failed_ids:
        logger.warning(f"{len(failed_ids)} messages non récupérés après 3 retries")

    # 3. Sauvegarder
    df = pl.DataFrame(rows)
    df.write_csv(CSV_PATH)

    logger.success(f"CSV mis à jour : {df.shape[0]} lignes sauvegardées dans '{CSV_PATH}'")
    logger.info(f"Résumé : {total - len(failed_ids)} récupérés / {total} total")
    logger.info("=== Fin du refresh CSV ===")

    print(f"\n✅ CSV mis à jour : {df.shape[0]} lignes sauvegardées dans '{CSV_PATH}'")
    print(f"   ({total - len(failed_ids)} récupérés / {total} total)")


if __name__ == '__main__':
    refresh_csv()
