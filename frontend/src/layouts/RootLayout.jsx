import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { applyMode, Mode } from "@cloudscape-design/global-styles";

import AppLayout from "@cloudscape-design/components/app-layout";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import Modal from "@cloudscape-design/components/modal";

import EmailsPanel from "../components/EmailsPanel";
import ToastContainer from "../components/ToastContainer";
import { useAppData } from "../context/AppDataContext";
import { useI18n, LANGUAGES } from "../i18n/I18nContext";

const THEME_KEY = "gmail-filtering:theme";

export default function RootLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, language, setLanguage } = useI18n();
  const [darkMode, setDarkMode] = useState(
    () => (localStorage.getItem(THEME_KEY) ?? "dark") === "dark"
  );

  const {
    account,
    loading,
    refreshing,
    syncing,
    startGmailSync,
    openedSender,
    closeModal,
  } = useAppData();

  useEffect(() => {
    applyMode(darkMode ? Mode.Dark : Mode.Light);
    localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light");
  }, [darkMode]);

  // Language names stay written in their own language ("Français", not
  // "French"): that is what a reader looking for their own language expects.
  const languageItems = Object.entries(LANGUAGES).map(([code, { label }]) => ({
    id: code,
    text: label,
    disabled: code === language,
  }));

  const navItems = [
    { type: "link", text: t("nav.dashboard"), href: "/" },
    { type: "link", text: t("nav.senders"), href: "/senders" },
    { type: "link", text: t("nav.unsubscribe"), href: "/unsubscribe" },
  ];

  return (
    <>
      <Modal
        visible={Boolean(openedSender)}
        onDismiss={closeModal}
        size="max"
        header={
          openedSender && (
            <Header variant="h2" description={openedSender.from_email}>
              {openedSender.from_name || openedSender.from_email}
            </Header>
          )
        }
        footer={
          <Box float="right">
            <Button onClick={closeModal}>{t("common.close")}</Button>
          </Box>
        }
      >
        {openedSender && (
          <EmailsPanel
            key={openedSender.from_email}
            sender={openedSender}
            // Deletion keeps running in the background (toast): the modal can
            // close right away, no need to wait for the result.
            onDeleteAllRequested={closeModal}
          />
        )}
      </Modal>

      <div id="top-navigation" style={{ position: "sticky", top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{
            href: "/",
            title: t("topNav.title"),
            onFollow: (e) => {
              e.preventDefault();
              navigate("/");
            },
          }}
          utilities={[
            {
              type: "button",
              text: account ?? undefined,
              iconName: "user-profile",
              variant: account ? "primary-button" : undefined,
            },
            {
              type: "button",
              iconSvg: syncing ? <Spinner /> : undefined,
              iconName: syncing ? undefined : "refresh",
              text: syncing ? t("topNav.syncing") : t("topNav.sync"),
              ariaLabel: t("topNav.syncAriaLabel"),
              disabled: loading || refreshing || syncing,
              onClick: () => startGmailSync(),
            },
            {
              type: "menu-dropdown",
              text: LANGUAGES[language].label,
              title: t("language.label"),
              ariaLabel: t("language.label"),
              iconName: "globe",
              items: languageItems,
              onItemClick: ({ detail }) => setLanguage(detail.id),
            },
            {
              type: "button",
              iconUrl: darkMode ? "/svg/sun-solid-full.svg" : "/svg/moon-solid-full.svg",
              ariaLabel: darkMode ? t("topNav.switchToLight") : t("topNav.switchToDark"),
              title: darkMode ? t("topNav.lightMode") : t("topNav.darkMode"),
              onClick: () => setDarkMode((v) => !v),
            },
          ]}
        />
      </div>

      <AppLayout
        headerSelector="#top-navigation"
        contentType="default"
        toolsHide
        navigation={
          <SideNavigation
            activeHref={location.pathname}
            header={{ text: t("nav.header"), href: "/" }}
            items={navItems}
            onFollow={(e) => {
              e.preventDefault();
              navigate(e.detail.href);
            }}
          />
        }
        content={<Outlet />}
      />
      <ToastContainer />
    </>
  );
}
