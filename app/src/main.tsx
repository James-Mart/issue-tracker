import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/app/app";
import { Providers } from "@/app/providers";
import { applyThemeToDocument, readStoredTheme } from "@/lib/theme/theme";
import "@/styles/globals.css";

applyThemeToDocument(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
