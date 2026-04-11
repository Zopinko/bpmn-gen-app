import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import sk from "./locales/sk.json";
import en from "./locales/en.json";

const savedLang = typeof window !== "undefined"
  ? (window.localStorage.getItem("APP_LANG") || "sk")
  : "sk";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      sk: { translation: sk },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: "sk",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("APP_LANG", lng);
  }
});

export default i18n;
