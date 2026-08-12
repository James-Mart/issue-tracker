import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/app/app";
import { Providers } from "@/app/providers";
import { applyThemeToDocument, readStoredTheme } from "@/lib/theme/theme";
import "@/styles/globals.css";

applyThemeToDocument(readStoredTheme());

// Do not import `@/app/bootstrap-fault` from this file. It is a separate
// index.html entry so a failed main chunk still loads the Fault painter.
try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <Providers>
          <App />
        </Providers>
      </BrowserRouter>
    </StrictMode>,
  );
} catch (error) {
  const show = window.__showBootstrapFault;
  if (!show) throw error;
  show(error);
}
