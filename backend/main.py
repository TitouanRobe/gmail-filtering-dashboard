import os
from pathlib import Path
from typing import List

import polars as pl
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# ---------- Config ----------
CSV_PATH = Path(__file__).resolve().parent.parent / "emails.csv"
TOKEN_PATH = Path(__file__).resolve().parent.parent / "token.json"
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# ---------- Logger ----------
logger.add(
    LOG_DIR / "backend_{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="7 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {message}",
    level="INFO",
)

app = FastAPI(title="Gmail Dashboard API")

# CORS — autoriser le frontend Vite
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Chargement du CSV ----------
_df: pl.DataFrame | None = None


def _get_df() -> pl.DataFrame:
    """Charge le CSV en mémoire (lazy singleton)."""
    global _df
    if _df is None:
        if not CSV_PATH.exists():
            logger.error(f"CSV introuvable : {CSV_PATH}")
            raise RuntimeError(f"CSV introuvable : {CSV_PATH}")
        _df = pl.read_csv(str(CSV_PATH))
        logger.info(f"CSV chargé : {_df.shape[0]} lignes × {_df.shape[1]} colonnes")
    return _df


def _reload_df() -> pl.DataFrame:
    """Force le rechargement du CSV."""
    global _df
    _df = None
    logger.info("Rechargement du CSV demandé")
    return _get_df()


def _remove_from_df(ids: list[str]):
    """Supprime des lignes du DataFrame en mémoire et du CSV."""
    global _df
    df = _get_df()
    before = df.shape[0]
    _df = df.filter(~pl.col("id").is_in(ids))
    _df.write_csv(str(CSV_PATH))
    logger.info(f"CSV mis à jour : {before} → {_df.shape[0]} lignes ({before - _df.shape[0]} supprimées)")


# ---------- Gmail Service ----------
_gmail_service = None


def _get_gmail_service():
    """Crée/réutilise le service Gmail authentifié."""
    global _gmail_service
    if _gmail_service is not None:
        return _gmail_service

    if not TOKEN_PATH.exists():
        logger.error("token.json introuvable")
        raise HTTPException(status_code=500, detail="token.json introuvable. Lancez main.py d'abord.")

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        logger.info("Token expiré, rafraîchissement...")
        creds.refresh(Request())
        with open(str(TOKEN_PATH), 'w') as f:
            f.write(creds.to_json())
        logger.info("Token rafraîchi avec succès")

    if not creds or not creds.valid:
        logger.error("Token Gmail invalide")
        raise HTTPException(status_code=500, detail="Token Gmail invalide. Relancez main.py pour re-auth.")

    _gmail_service = build('gmail', 'v1', credentials=creds)
    logger.info("Service Gmail initialisé")
    return _gmail_service


# ---------- Modèles ----------
class DeleteRequest(BaseModel):
    ids: List[str]


# ---------- Endpoints ----------

@app.get("/api/stats")
def get_stats():
    """Stats globales : total mails, total expéditeurs uniques, top sender."""
    df = _get_df()
    ranking = (
        df.group_by("from_email")
        .agg(pl.col("from_email").count().alias("count"))
        .sort("count", descending=True)
    )
    top = ranking.row(0, named=True)
    logger.debug(f"Stats demandées — {df.shape[0]} mails, {ranking.shape[0]} expéditeurs")
    return {
        "total_emails": df.shape[0],
        "unique_senders": ranking.shape[0],
        "top_sender": {
            "email": top["from_email"],
            "count": top["count"],
        },
    }


@app.get("/api/senders")
def get_senders(limit: int = Query(default=50, ge=1, le=1000)):
    """
    Classement des expéditeurs par nombre de mails.
    Retourne : [{from_email, from_name, count}, ...]
    """
    df = _get_df()

    # Récupérer le premier from_name associé à chaque from_email
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

    logger.debug(f"Senders demandés — limit={limit}, retourné={ranking.shape[0]}")
    return ranking.select(["from_email", "from_name", "count"]).to_dicts()


@app.get("/api/senders/{email}/emails")
def get_sender_emails(email: str):
    """Liste tous les mails d'un expéditeur donné."""
    df = _get_df()
    filtered = df.filter(pl.col("from_email") == email.lower())

    if filtered.is_empty():
        logger.warning(f"Aucun mail trouvé pour {email}")
        raise HTTPException(status_code=404, detail=f"Aucun mail trouvé pour {email}")

    logger.info(f"Mails de {email} : {filtered.shape[0]} résultats")
    return filtered.select(["id", "subject", "date"]).to_dicts()


@app.post("/api/emails/trash")
def trash_emails(req: DeleteRequest):
    """Met les mails sélectionnés à la corbeille Gmail."""
    logger.info(f"Demande de suppression : {len(req.ids)} mail(s)")
    service = _get_gmail_service()
    trashed = []
    errors = []

    for msg_id in req.ids:
        try:
            service.users().messages().trash(userId='me', id=msg_id).execute()
            trashed.append(msg_id)
        except Exception as e:
            logger.error(f"Erreur trash {msg_id} : {e}")
            errors.append({"id": msg_id, "error": str(e)})

    # Supprimer du CSV et du DataFrame en mémoire
    if trashed:
        _remove_from_df(trashed)

    logger.success(f"Suppression terminée : {len(trashed)} OK, {len(errors)} erreur(s)")
    return {
        "trashed": len(trashed),
        "errors": len(errors),
        "error_details": errors,
    }


@app.get("/api/reload")
def reload_csv():
    """Recharge le CSV depuis le disque."""
    df = _reload_df()
    logger.info(f"CSV rechargé : {df.shape[0]} mails")
    return {"message": "CSV rechargé", "total_emails": df.shape[0]}
