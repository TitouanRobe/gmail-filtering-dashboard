# Frontend — Gmail Filtering Dashboard

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Cloudscape](https://img.shields.io/badge/Cloudscape-232F3E?style=flat-square)](https://cloudscape.design/)
[![i18n](https://img.shields.io/badge/i18n-EN%20%7C%20FR-4C9A2A?style=flat-square&logo=googletranslate&logoColor=white)](#text-and-translations)

The React single-page app of the [Gmail Filtering Dashboard](../README.md).

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build into dist/
npm run lint     # ESLint
npm run preview  # serve the production build
```

The backend is expected on `http://localhost:8000/api`. Override it with a `.env` file:

```env
VITE_API_BASE=http://localhost:8000/api
```

## Layout

```
src/
├── api.js            # API client — every call goes through it
├── components/       # SendersTable, EmailsPanel, EmailPreview, SenderChart, ...
├── context/          # AppDataContext (shared Gmail data), ToastContext
├── i18n/             # Message catalogs (en/fr), language provider, formatters
├── layouts/          # RootLayout: top bar, side navigation, modal
└── pages/            # DashboardPage, SendersPage, UnsubscribePage
```

## Text and translations

No user-facing string is written in a component. Everything goes through the catalogs in
`src/i18n/locales/` and the `t()` function of the `useI18n()` hook:

```jsx
const { t, formatNumber, formatDate, formatRelative, formatPercent } = useI18n();

t("senders.title");
t("common.emailCount", { count: 1250 });
```

`en.json` is the source of truth: add a key there first, then to `fr.json`. See the
*Internationalization* section of the [root README](../README.md) for plurals, backend messages and
how to add a language.
