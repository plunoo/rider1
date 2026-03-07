import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LANG, LANGUAGE_LABELS, TRANSLATIONS, type Lang } from "./translations";

const STORAGE_KEY = "rider_lang";

type I18nContextValue = {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  labels: Record<Lang, string>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const isLang = (value: string | null): value is Lang => {
  if (!value) return false;
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, value);
};

const getInitialLang = (): Lang => {
  if (typeof window === "undefined") return DEFAULT_LANG;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLang(stored)) return stored;
  const browser = navigator.language?.slice(0, 2);
  if (isLang(browser)) return browser;
  return DEFAULT_LANG;
};

const interpolate = (value: string, params?: Record<string, string | number>) => {
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const raw = params[key];
    return raw === undefined || raw === null ? "" : String(raw);
  });
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getInitialLang());
  const dir: "ltr" | "rtl" = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
    }
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG];
      const fallback = TRANSLATIONS[DEFAULT_LANG][key] || key;
      const value = dict[key] || fallback;
      return interpolate(value, params);
    },
    [lang]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      dir,
      setLang,
      t,
      labels: LANGUAGE_LABELS,
    }),
    [dir, lang, setLang, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
