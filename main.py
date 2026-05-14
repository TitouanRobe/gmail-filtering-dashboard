import os.path
import re
import time
from collections import Counter
from datetime import datetime

import polars as pl

# Bibliothèques Google
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Définition des permissions (Scope) : accès en lecture seule au profil et messages
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']


def main():
    creds = None

    # 1. Gestion du jeton d'accès (Token)
    # Le fichier token.json stocke les privilèges une fois la première connexion faite.
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    # 2. Si aucun jeton valide n'existe, on lance la connexion
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Utilisation de ton fichier secrets.json
            flow = InstalledAppFlow.from_client_secrets_file(
                'secrets.json', SCOPES)
            creds = flow.run_local_server(port=0)

        # Sauvegarde du jeton pour la prochaine exécution
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    try:
        # 3. Création du service Gmail
        service = build('gmail', 'v1', credentials=creds)

        # 4. Appel de la méthode getProfile (userId='me' désigne l'utilisateur connecté)
        profile = service.users().getProfile(userId='me').execute()

        print("\n--- Informations du compte Gmail ---")
        print(f"Adresse Email : {profile.get('emailAddress')}")
        print(f"Nombre de messages : {profile.get('messagesTotal')}")
        print(f"Nombre de fils (threads) : {profile.get('threadsTotal')}")
        print(f" Profile : {profile}")
        print("------------------------------------\n")

        # 5. Compter les mails de l'expéditeur "Linkedin"
        count_emails_from_sender(service, "Pinterest")

        # 6. DataFrame Polars de tous les mails (cache CSV)
        df = fetch_all_emails_df(service, csv_path='emails.csv')

        # 7. Classement des expéditeurs depuis le CSV
        top_senders_from_csv('emails.csv', top_n=10)

        # 8. Compter les mails d'un expéditeur spécifique
        count_emails_by_address('no-reply@cds.newsletter-cdiscount.com', 'emails.csv')


    except Exception as error:
        print(f"Une erreur est survenue lors de l'appel à l'API : {error}")


def count_emails_from_sender(service, sender: str):
    """
    Compte et affiche le nombre total de mails reçus d'un expéditeur donné.

    Args:
        service: Le service Gmail authentifié.
        sender:  Le nom ou l'adresse de l'expéditeur à rechercher.
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

        print(f"\n--- Mails de '{sender}' ---")
        print(f"Nombre de mails reçus de '{sender}' : {total}")
        print("----------------------------\n")

    except Exception as error:
        print(f"Erreur lors du comptage des mails de '{sender}' : {error}")


def _extract_name(from_header: str) -> str:
    """
    Extrait le nom d'affichage du header 'From'.
    Ex: '"John Doe" <john@example.com>' → 'John Doe'
    """
    match = re.match(r'^"?([^"<]+?)"?\s*<', from_header)
    if match:
        return match.group(1).strip()
    return from_header.strip()


def fetch_all_emails_df(service, csv_path: str = None) -> pl.DataFrame:
    """
    Récupère les métadonnées de tous les mails et retourne un DataFrame Polars.
    Si csv_path est fourni et que le fichier existe, charge le CSV directement.
    Sinon, récupère les données via l'API et sauvegarde le CSV.

    Colonnes : id, from_email, from_name, subject, date

    Args:
        service:  Le service Gmail authentifié.
        csv_path: Chemin du fichier CSV pour le cache (optionnel).

    Returns:
        pl.DataFrame contenant les métadonnées de tous les mails.
    """
    # Charger depuis le cache CSV si disponible
    if csv_path and os.path.exists(csv_path):
        df = pl.read_csv(csv_path)
        print(f"\n📂 DataFrame chargé depuis '{csv_path}' : {df.shape[0]} lignes × {df.shape[1]} colonnes\n")
        return df

    print("\n⏳ Construction du DataFrame — récupération des messages...")

    # 1. Récupérer tous les IDs de messages
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
    print(f"📬 {total_messages} messages trouvés. Extraction des métadonnées...")

    # 2. Récupérer les headers par batch (avec retries)
    rows = []
    failed_ids = []
    batch_size = 50

    def _process_batch(ids_to_fetch):
        """Envoie un batch et retourne les IDs qui ont échoué."""
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

    # Premier passage
    for i in range(0, total_messages, batch_size):
        batch_ids = message_ids[i:i + batch_size]
        fails = _process_batch(batch_ids)
        failed_ids.extend(fails)

        progress = min(i + batch_size, total_messages)
        print(f"  Progression : {progress}/{total_messages} ({len(failed_ids)} erreurs)", end='\r')
        time.sleep(0.1)  # Pause pour éviter le rate limiting

    # Retries pour les messages échoués (max 3 tentatives)
    for attempt in range(1, 4):
        if not failed_ids:
            break
        print(f"\n  🔄 Retry {attempt}/3 — {len(failed_ids)} messages à récupérer...")
        time.sleep(2 ** attempt)  # Backoff exponentiel : 2s, 4s, 8s
        retry_ids = failed_ids[:]
        failed_ids = []
        for i in range(0, len(retry_ids), batch_size):
            batch_ids = retry_ids[i:i + batch_size]
            fails = _process_batch(batch_ids)
            failed_ids.extend(fails)
            time.sleep(0.2)

    if failed_ids:
        print(f"\n  ⚠️  {len(failed_ids)} messages n'ont pas pu être récupérés.")

    # 3. Construire le DataFrame Polars
    df = pl.DataFrame(rows)

    # 4. Sauvegarder en CSV si un chemin est fourni
    if csv_path:
        df.write_csv(csv_path)
        print(f"\n💾 CSV sauvegardé dans '{csv_path}'")

    print(f"✅ DataFrame créé : {df.shape[0]} lignes × {df.shape[1]} colonnes\n")
    return df


def _extract_email(from_header: str) -> str:
    """
    Extrait l'adresse email du header 'From'.
    Ex: '"John Doe" <john@example.com>' → 'john@example.com'
    """
    match = re.search(r'<(.+?)>', from_header)
    if match:
        return match.group(1).lower()
    return from_header.strip().lower()

def top_senders_from_csv(csv_path: str = 'emails.csv', top_n: int = 10) -> pl.DataFrame:
    """
    Charge le CSV des mails et retourne le classement des expéditeurs
    les plus fréquents via un group_by sur from_email.

    Args:
        csv_path: Chemin du fichier CSV.
        top_n:    Nombre d'expéditeurs à afficher.

    Returns:
        pl.DataFrame avec les colonnes from_email et count, trié par count desc.
    """
    df = pl.read_csv(csv_path)

    ranking = (
        df.group_by('from_email')
        .agg(pl.col('from_email').count().alias('count'))
        .sort('count', descending=True)
    )

    top = ranking.head(top_n)
    max_count = top.row(0)[1]  # count du 1er expéditeur
    bar_max = 30  # longueur max de la barre

    print(f"\n{'='*65}")
    print(f"  🏆 Top {top_n} des expéditeurs — {df.shape[0]} mails / {ranking.shape[0]} expéditeurs uniques")
    print(f"{'='*65}")
    for rank, row in enumerate(top.iter_rows(named=True), 1):
        bar_len = int((row['count'] / max_count) * bar_max)
        bar = '█' * bar_len
        print(f"  {rank:>2}. {row['from_email']:<45} {row['count']:>5}  {bar}")
    print(f"{'='*65}\n")

    return ranking


def count_emails_by_address(email: str, csv_path: str = 'emails.csv') -> int:
    """
    Retourne le nombre de mails envoyés par un émetteur donné.

    Args:
        email:    Adresse email de l'émetteur à rechercher.
        csv_path: Chemin du fichier CSV.

    Returns:
        Nombre de mails envoyés par cet émetteur.
    """
    df = pl.read_csv(csv_path)
    count = df.filter(pl.col('from_email') == email.lower()).shape[0]

    print(f"\n📧 {email} → {count} mails")
    return count


if __name__ == '__main__':
    main()

