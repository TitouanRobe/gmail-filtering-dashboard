import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nProvider as CloudscapeI18nProvider } from "@cloudscape-design/components/i18n";
import cloudscapeEn from "@cloudscape-design/components/i18n/messages/all.en.json";
import cloudscapeFr from "@cloudscape-design/components/i18n/messages/all.fr.json";

import en from "./locales/en.json";
import fr from "./locales/fr.json";

const STORAGE_KEY = "gmail-filtering:language";

/**
 * Supported languages. `intl` is the BCP 47 tag handed to `Intl.*` and to the
 * Cloudscape provider; `messages` is our own catalog.
 */
export const LANGUAGES = {
  en: { label: "English", intl: "en-US", messages: en, cloudscape: cloudscapeEn },
  fr: { label: "Français", intl: "fr-FR", messages: fr, cloudscape: cloudscapeFr },
};

const DEFAULT_LANGUAGE = "en";

const I18nContext = createContext(null);

/** Stored choice, else the browser language, else English. */
function detectLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in LANGUAGES) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = (tag || "").split("-")[0].toLowerCase();
    if (base in LANGUAGES) return base;
  }
  return DEFAULT_LANGUAGE;
}

/** "a.b.c" → nested lookup, undefined if any segment is missing. */
function lookup(messages, key) {
  return key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), messages);
}

/** Replaces every {name} in `template` by `params.name`. */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match
  );
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  // Screen readers and the browser itself rely on `lang` to pick the right
  // pronunciation and hyphenation rules.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next) => {
    if (!(next in LANGUAGES)) return;
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  const value = useMemo(() => {
    const { intl, messages } = LANGUAGES[language];
    const pluralRules = new Intl.PluralRules(intl);
    const numberFormat = new Intl.NumberFormat(intl);
    const dateFormat = new Intl.DateTimeFormat(intl, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const relativeFormat = new Intl.RelativeTimeFormat(intl, { numeric: "auto" });
    const percentFormat = new Intl.NumberFormat(intl, {
      style: "percent",
      maximumFractionDigits: 1,
    });

    /**
     * Translates `key`, interpolating `params`.
     *
     * A catalog entry may be a plain string, or an object of plural forms
     * ({one, other, ...}) picked with `params.count` — French and English do
     * not agree on where the plural starts, so the choice is left to
     * `Intl.PluralRules` rather than to a `count > 1` test in the components.
     * A missing key falls back to English, then to the key itself, so a gap in
     * a catalog degrades into readable text instead of an empty label.
     */
    const t = (key, params) => {
      let entry = lookup(messages, key) ?? lookup(en, key);
      if (entry == null) return key;
      if (typeof entry === "object") {
        const count = params?.count;
        entry = entry[count == null ? "other" : pluralRules.select(count)] ?? entry.other;
      }
      if (typeof entry !== "string") return key;
      // `count` is interpolated pre-formatted so plurals read "1 234 mails".
      const merged =
        params && typeof params.count === "number"
          ? { ...params, count: numberFormat.format(params.count) }
          : params;
      return interpolate(entry, merged);
    };

    /** 1234 → "1,234" (en) / "1 234" (fr). Non-numbers pass through. */
    const formatNumber = (input) =>
      typeof input === "number" ? numberFormat.format(input) : input;

    /** 0.128 → "12.8%" / "12,8 %". */
    const formatPercent = (ratio) => percentFormat.format(ratio);

    /** ISO date → "01 Sep 2026, 04:30". Falls back when unparsable. */
    const formatDate = (iso, fallback = "—") => {
      if (!iso) return fallback;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? fallback : dateFormat.format(date);
    };

    /** ISO date → "3 days ago" — gives a sense of freshness at a glance. */
    const formatRelative = (iso) => {
      if (!iso) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      const seconds = (date.getTime() - Date.now()) / 1000;
      for (const [unit, size] of RELATIVE_UNITS) {
        if (Math.abs(seconds) >= size) {
          return relativeFormat.format(Math.round(seconds / size), unit);
        }
      }
      return relativeFormat.format(Math.round(seconds), "second");
    };

    /** Page-size options shared by every table. */
    const pageSizeOptions = [10, 20, 50, 100].map((size) => ({
      value: size,
      label: t("table.rowsPerPage", { count: size }),
    }));

    return {
      language,
      setLanguage,
      locale: intl,
      t,
      formatNumber,
      formatPercent,
      formatDate,
      formatRelative,
      pageSizeOptions,
    };
  }, [language, setLanguage]);

  return (
    <I18nContext.Provider value={value}>
      <CloudscapeI18nProvider
        locale={LANGUAGES[language].intl}
        messages={[LANGUAGES[language].cloudscape]}
      >
        {children}
      </CloudscapeI18nProvider>
    </I18nContext.Provider>
  );
}

const RELATIVE_UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
