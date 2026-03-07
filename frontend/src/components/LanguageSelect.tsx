import { useI18n } from "../i18n/I18nContext";
import type { Lang } from "../i18n/translations";

export function LanguageSelect({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { lang, setLang, t, labels } = useI18n();

  return (
    <label className={`lang-select ${compact ? "compact" : ""} ${className}`.trim()}>
      <span className="lang-label">{t("language.label")}</span>
      <select
        className="lang-select-input"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label={t("language.label")}
      >
        {Object.entries(labels).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
