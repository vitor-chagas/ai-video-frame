import "@/i18n/i18n";
import "@/i18n/types";
import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import App from "./App";
import "./index.css";

if (import.meta.env.VITE_POSTHOG_API_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_API_KEY, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
  });
}

createRoot(document.getElementById("root")!).render(<App />);
