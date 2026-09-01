import os.path
import re
import time
from collections import Counter
from datetime import datetime

import polars as pl

# Google libraries
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Permission definition (Scope): read-only access to profile and messages
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']


def main():
    creds = None

    # 1. Access token handling
    # The token.json file stores the credentials once the first login is done.
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    # 2. If no valid token exists, launch the login flow
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Using your secrets.json file
            flow = InstalledAppFlow.from_client_secrets_file(
                'secrets.json', SCOPES)
            creds = flow.run_local_server(port=0)

        # Save the token for the next run
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    try:
        # 3. Create the Gmail service
        service = build('gmail', 'v1', credentials=creds)

        # 4. Call getProfile (userId='me' refers to the connected user)
        profile = service.users().getProfile(userId='me').execute()

        print("\n--- Gmail account info ---")
        print(f"Email address: {profile.get('emailAddress')}")
        print(f"Number of messages: {profile.get('messagesTotal')}")
        print(f"Number of threads: {profile.get('threadsTotal')}")
        print(f" Profile: {profile}")
        print("------------------------------------\n")

        # 5. Count emails from the "Linkedin" sender
        count_emails_from_sender(service, "Pinterest")

        # 6. Polars DataFrame of all emails (CSV cache)
        df = fetch_all_emails_df(service, csv_path='emails.csv')

        # 7. Sender ranking from the CSV
        top_senders_from_csv('emails.csv', top_n=10)

        # 8. Count emails from a specific sender
        count_emails_by_address('no-reply@cds.newsletter-cdiscount.com', 'emails.csv')


    except Exception as error:
        print(f"An error occurred while calling the API: {error}")


def count_emails_from_sender(service, sender: str):
    """
    Counts and prints the total number of emails received from a given sender.

    Args:
        service: The authenticated Gmail service.
        sender:  The name or address of the sender to search for.
    """
    try:
        query = f"from:{sender}"
        total = 0
        page_token = None

        while True:
            results = service.users().messages().list(
                userId='me',
                q=query,
                pageToken=page_token,
                maxResults=500
            ).execute()

            messages = results.get('messages', [])
            total += len(messages)

            page_token = results.get('nextPageToken')
            if not page_token:
                break

        print(f"\n--- Emails from '{sender}' ---")
        print(f"Number of emails received from '{sender}': {total}")
        print("----------------------------\n")

    except Exception as error:
        print(f"Error while counting emails from '{sender}': {error}")


def _extract_name(from_header: str) -> str:
    """
    Extracts the display name from the 'From' header.
    Ex: '"John Doe" <john@example.com>' → 'John Doe'
    """
    match = re.match(r'^"?([^"<]+?)"?\s*<', from_header)
    if match:
        return match.group(1).strip()
    return from_header.strip()


def fetch_all_emails_df(service, csv_path: str = None) -> pl.DataFrame:
    """
    Fetches the metadata of all emails and returns a Polars DataFrame.
    If csv_path is provided and the file exists, loads the CSV directly.
    Otherwise, fetches the data via the API and saves the CSV.

    Columns: id, from_email, from_name, subject, date

    Args:
        service:  The authenticated Gmail service.
        csv_path: Path to the CSV file for caching (optional).

    Returns:
        pl.DataFrame containing the metadata of all emails.
    """
    # Load from the CSV cache if available
    if csv_path and os.path.exists(csv_path):
        df = pl.read_csv(csv_path)
        print(f"\n📂 DataFrame loaded from '{csv_path}': {df.shape[0]} rows × {df.shape[1]} columns\n")
        return df

    print("\n⏳ Building the DataFrame — fetching messages...")

    # 1. Retrieve all message IDs
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

    total_messages = len(message_ids)
    print(f"📬 {total_messages} messages found. Extracting metadata...")

    # 2. Fetch headers by batch (with retries)
    rows = []
    failed_ids = []
    batch_size = 50

    def _process_batch(ids_to_fetch):
        """Sends a batch and returns the IDs that failed."""
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

    # First pass
    for i in range(0, total_messages, batch_size):
        batch_ids = message_ids[i:i + batch_size]
        fails = _process_batch(batch_ids)
        failed_ids.extend(fails)

        progress = min(i + batch_size, total_messages)
        print(f"  Progress: {progress}/{total_messages} ({len(failed_ids)} errors)", end='\r')
        time.sleep(0.1)  # Pause to avoid rate limiting

    # Retries for failed messages (max 3 attempts)
    for attempt in range(1, 4):
        if not failed_ids:
            break
        print(f"\n  🔄 Retry {attempt}/3 — {len(failed_ids)} messages to retrieve...")
        time.sleep(2 ** attempt)  # Exponential backoff: 2s, 4s, 8s
        retry_ids = failed_ids[:]
        failed_ids = []
        for i in range(0, len(retry_ids), batch_size):
            batch_ids = retry_ids[i:i + batch_size]
            fails = _process_batch(batch_ids)
            failed_ids.extend(fails)
            time.sleep(0.2)

    if failed_ids:
        print(f"\n  ⚠️  {len(failed_ids)} messages could not be retrieved.")

    # 3. Build the Polars DataFrame
    df = pl.DataFrame(rows)

    # 4. Save to CSV if a path is provided
    if csv_path:
        df.write_csv(csv_path)
        print(f"\n💾 CSV saved to '{csv_path}'")

    print(f"✅ DataFrame created: {df.shape[0]} rows × {df.shape[1]} columns\n")
    return df


def _extract_email(from_header: str) -> str:
    """
    Extracts the email address from the 'From' header.
    Ex: '"John Doe" <john@example.com>' → 'john@example.com'
    """
    match = re.search(r'<(.+?)>', from_header)
    if match:
        return match.group(1).lower()
    return from_header.strip().lower()

def top_senders_from_csv(csv_path: str = 'emails.csv', top_n: int = 10) -> pl.DataFrame:
    """
    Loads the emails CSV and returns the ranking of the most frequent
    senders via a group_by on from_email.

    Args:
        csv_path: Path to the CSV file.
        top_n:    Number of senders to display.

    Returns:
        pl.DataFrame with the from_email and count columns, sorted by count desc.
    """
    df = pl.read_csv(csv_path)

    ranking = (
        df.group_by('from_email')
        .agg(pl.col('from_email').count().alias('count'))
        .sort('count', descending=True)
    )

    top = ranking.head(top_n)
    max_count = top.row(0)[1]  # count of the top sender
    bar_max = 30  # max bar length

    print(f"\n{'='*65}")
    print(f"  🏆 Top {top_n} senders — {df.shape[0]} emails / {ranking.shape[0]} unique senders")
    print(f"{'='*65}")
    for rank, row in enumerate(top.iter_rows(named=True), 1):
        bar_len = int((row['count'] / max_count) * bar_max)
        bar = '█' * bar_len
        print(f"  {rank:>2}. {row['from_email']:<45} {row['count']:>5}  {bar}")
    print(f"{'='*65}\n")

    return ranking


def count_emails_by_address(email: str, csv_path: str = 'emails.csv') -> int:
    """
    Returns the number of emails sent by a given sender.

    Args:
        email:    Email address of the sender to search for.
        csv_path: Path to the CSV file.

    Returns:
        Number of emails sent by that sender.
    """
    df = pl.read_csv(csv_path)
    count = df.filter(pl.col('from_email') == email.lower()).shape[0]

    print(f"\n📧 {email} → {count} emails")
    return count


if __name__ == '__main__':
    main()

