# Gmail filtering dashboard

Dashboard d'analyse de ta boîte Gmail : classement des expéditeurs, stats globales, suppression en masse, etc.

**Stack** : FastAPI (Python) + React (Vite) + Cloudscape Design System

---

## Prérequis

| Outil | Version recommandée |
|-------|-------------------|
| **Python** | 3.11+ |
| **Node.js** | 18+ |
| **npm** | 9+ (inclus avec Node.js) |
| **pip** | dernière version |

---

## 1. Cloner le projet

```bash
git clone <url-du-repo>
cd Gmail_Dashboard
```

---

## 2. Configuration Google Cloud (API Gmail)

Le projet utilise l'API Gmail pour récupérer et gérer tes emails. Tu dois créer un projet Google Cloud et obtenir les identifiants OAuth 2.0.

### Étapes :

1. Va sur [Google Cloud Console](https://console.cloud.google.com/)
2. Crée un nouveau projet (ou utilise un existant)
3. Active l'API **Gmail API** dans *APIs & Services > Library*
4. Configure l'écran de consentement OAuth (*OAuth consent screen*) :
   - Type : **Externe**
   - Ajoute ton email comme utilisateur de test
5. Crée des identifiants OAuth 2.0 :
   - Va dans *APIs & Services > Credentials*
   - Clique sur **Create Credentials > OAuth client ID**
   - Type d'application : **Application de bureau (Desktop app)**
   - Télécharge le JSON
6. Renomme le fichier téléchargé en **`secrets.json`** et place-le **à la racine** du projet

>**Ne commite jamais `secrets.json`** — il est déjà dans le `.gitignore`.

---

## 3. Configurer le fichier `.env`

Crée un fichier `.env` à la racine du projet :

```bash
touch .env
```

Ajoute-y ta clé API Gmail :

```env
GMAIL_API=<ta-clé-api-google>
```

> Tu peux obtenir cette clé dans *Google Cloud Console > APIs & Services > Credentials > API Keys*.

---

## 4. Backend (FastAPI)

### 4.1 Créer l'environnement virtuel Python

```bash
python3 -m venv .venv
source .venv/bin/activate    # macOS / Linux
# .venv\Scripts\activate     # Windows
```

### 4.2 Installer les dépendances

```bash
pip install -r backend/requirements.txt
```

> Le fichier `backend/requirements.txt` contient : `fastapi`, `uvicorn[standard]`, `polars`.

Tu auras aussi besoin des dépendances Google (utilisées par `main.py` et `refresh_csv.py`) :

```bash
pip install google-auth google-auth-oauthlib google-api-python-client loguru
```

### 4.3 Générer le fichier `emails.csv` (première fois)

Avant de lancer le dashboard, il faut récupérer les métadonnées de tes emails :

```bash
python main.py
```

> Lors de la première exécution, une fenêtre de navigateur s'ouvrira pour l'authentification OAuth.  
> Accepte les permissions demandées. Un fichier `token.json` sera créé automatiquement.  
> Le script génère le fichier `emails.csv` à la racine du projet.

Pour mettre à jour le CSV par la suite :

```bash
python refresh_csv.py
```

### 4.4 Lancer le serveur backend

```bash
uvicorn backend.main:app --reload
```

Le serveur tourne par défaut sur **http://localhost:8000**.

Endpoints disponibles :

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/stats` | Stats globales (total mails, expéditeurs uniques, top sender) |
| `GET` | `/api/senders?limit=50` | Classement des expéditeurs |
| `GET` | `/api/senders/{email}/emails` | Liste des mails d'un expéditeur |
| `POST` | `/api/emails/trash` | Mettre des mails à la corbeille |
| `GET` | `/api/reload` | Recharger le CSV en mémoire |

---

## 5. Frontend (React + Vite)

### 5.1 Installer les dépendances

```bash
cd frontend
npm install
```

### 5.2 Lancer le serveur de développement

```bash
npm run dev
```

---

## 6. Lancer le projet complet

Ouvre **deux terminaux** :

**Terminal 1 — Backend :**
```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

**Terminal 2 — Frontend :**
```bash
cd frontend
npm run dev
```

Puis ouvre **http://localhost:5173** dans ton navigateur.

---

## Structure du projet

```
Gmail_Dashboard/
├── backend/
│   ├── main.py              # API FastAPI
│   └── requirements.txt     # Dépendances Python
├── frontend/
│   ├── src/                  # Code source React
│   ├── public/               # Assets statiques
│   ├── package.json          # Dépendances Node.js
│   └── vite.config.js        # Configuration Vite
├── main.py                   # Script d'init (OAuth + génération CSV)
├── refresh_csv.py            # Script de mise à jour du CSV
├── .env                      # Variables d'environnement (non commité)
├── secrets.json              # Identifiants OAuth Google (non commité)
├── token.json                # Token d'auth Gmail (non commité)
├── emails.csv                # Cache des métadonnées emails (non commité)
└── .gitignore
```

---
