import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import sk from "./locales/sk.json";
import en from "./locales/en.json";

const savedLang = typeof window !== "undefined"
  ? (() => {
      const stored = window.localStorage.getItem("APP_LANG");
      if (stored === "sk" || stored === "en") return stored;
      const browserCandidates = [
        ...(Array.isArray(window.navigator?.languages) ? window.navigator.languages : []),
        window.navigator?.language,
        window.navigator?.userLanguage,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      return browserCandidates.some((value) => value.startsWith("sk")) ? "sk" : "en";
    })()
  : "en";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      sk: { translation: sk, map_viewer: sk.map_viewer },
      en: { translation: en, map_viewer: en.map_viewer },
    },
    lng: savedLang,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("APP_LANG", lng);
  }
});

export default i18n;
