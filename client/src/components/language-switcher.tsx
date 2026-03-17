import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES } from "@/i18n/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const currentCode = i18n.language;

  const currentLang = SUPPORTED_LANGUAGES.find((l) => l.code === currentCode)
    ?? SUPPORTED_LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-[hsl(24,10%,10%)] transition-colors px-2 py-1 rounded-full hover:bg-[hsl(38,20%,95%)]"
          aria-label="Select language"
        >
          <Globe className="h-4 w-4" />
          <span>{currentLang.short}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => i18n.changeLanguage(lang.code)}
            className={currentCode === lang.code ? "font-semibold text-[hsl(24,10%,10%)]" : ""}
          >
            <span className="text-xs text-muted-foreground w-7 shrink-0">{lang.short}</span>
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
