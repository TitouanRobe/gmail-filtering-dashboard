import "@cloudscape-design/global-styles/index.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import RootLayout from "./layouts/RootLayout";
import DashboardPage from "./pages/DashboardPage";
import SendersPage from "./pages/SendersPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import { AppDataProvider } from "./context/AppDataContext";
import { ToastProvider } from "./context/ToastContext";
import { I18nProvider } from "./i18n/I18nContext";

export default function App() {
  return (
    // The language provider wraps everything: toasts and shared data build
    // translated messages too, not just the pages.
    <I18nProvider>
      <ToastProvider>
        <AppDataProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<RootLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="senders" element={<SendersPage />} />
                <Route path="unsubscribe" element={<UnsubscribePage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AppDataProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
