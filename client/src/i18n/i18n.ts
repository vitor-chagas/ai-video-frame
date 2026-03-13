import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import nl from "./locales/nl.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import sv from "./locales/sv.json";
import da from "./locales/da.json";
import it from "./locales/it.json";
import fi from "./locales/fi.json";
import id from "./locales/id.json";
import ko from "./locales/ko.json";
import no from "./locales/no.json";
import pl from "./locales/pl.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";
import uk from "./locales/uk.json";
import pt from "./locales/pt.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "pt-BR", label: "Português", short: "PT" },
  { code: "es", label: "Español", short: "ES" },
  { code: "fr", label: "Français", short: "FR" },
  { code: "de", label: "Deutsch", short: "DE" },
  { code: "it", label: "Italiano", short: "IT" },
  { code: "nl", label: "Nederlands", short: "NL" },
  { code: "zh", label: "中文", short: "ZH" },
  { code: "ja", label: "日本語", short: "JA" },
  { code: "sv", label: "Svenska", short: "SV" },
  { code: "da", label: "Dansk", short: "DA" },
  { code: "fi", label: "Suomi", short: "FI" },
  { code: "id", label: "Bahasa Indonesia", short: "ID" },
  { code: "ko", label: "한국어", short: "KO" },
  { code: "no", label: "Norsk", short: "NO" },
  { code: "pl", label: "Polski", short: "PL" },
  { code: "pt", label: "Português", short: "PT" },
  { code: "ru", label: "Русский", short: "RU" },
  { code: "tr", label: "Türkçe", short: "TR" },
  { code: "uk", label: "Українська", short: "UK" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "pt-BR": { translation: ptBR },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      nl: { translation: nl },
      zh: { translation: zh },
      ja: { translation: ja },
      sv: { translation: sv },
      da: { translation: da },
      it: { translation: it },
      fi: { translation: fi },
      id: { translation: id },
      ko: { translation: ko },
      no: { translation: no },
      pl: { translation: pl },
      pt: { translation: pt },
      ru: { translation: ru },
      tr: { translation: tr },
      uk: { translation: uk },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "pt-BR", "es", "fr", "de", "it", "nl", "zh", "ja", "sv", "da", "fi", "id", "ko", "no", "pl", "pt", "ru", "tr", "uk"],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "ai-video-frame-lang",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
