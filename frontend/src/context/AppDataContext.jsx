import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import {
  fetchStats,
  fetchSenders,
  fetchMe,
  trashSenders,
  startSync,
  fetchSyncStatus,
  reloadCsv,
} from "../api";
import { useI18n } from "../i18n/I18nContext";
import { apiErrorMessage, syncStatusMessage } from "../i18n/backendMessages";
import { useToast } from "./ToastContext";

const AppDataContext = createContext(null);

const SYNC_POLL_MS = 1000;

/**
 * State shared by every page: Gmail data, the sync with Gmail and the open
 * email panel (which can be triggered from the dashboard or from the senders
 * page). Notifications go through the ToastContext (ephemeral toasts in the
 * bottom-right corner).
 */
export function AppDataProvider({ children }) {
  const [stats, setStats] = useState(null);
  const [senders, setSenders] = useState([]);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedSender, setSelectedSender] = useState(null);
  const syncPollTimeout = useRef(null);
  const syncToastId = useRef(null);
  const queueRef = useRef(Promise.resolve());

  const { t } = useI18n();
  const { addToast, updateToast, settleToast } = useToast();

  const fetchAll = useCallback(async () => {
    const [s, snd] = await Promise.all([fetchStats(), fetchSenders()]);
    setStats(s);
    setSenders(snd);
  }, []);

  const connectionError = useCallback(
    (e) =>
      addToast({
        type: "error",
        header: t("toast.backendUnreachable"),
        content: t("toast.backendUnreachableContent", { message: apiErrorMessage(t, e) }),
      }),
    [addToast, t]
  );

  /** `silent`: background refresh, without emptying the table. */
  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      silent ? setRefreshing(true) : setLoading(true);
      try {
        await fetchAll();
      } catch (e) {
        connectionError(e);
      } finally {
        silent ? setRefreshing(false) : setLoading(false);
      }
    },
    [fetchAll, connectionError]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStats(), fetchSenders()])
      .then(([s, snd]) => {
        if (cancelled) return;
        setStats(s);
        setSenders(snd);
      })
      .catch((e) => !cancelled && connectionError(e))
      .finally(() => !cancelled && setLoading(false));
    fetchMe()
      .then((data) => !cancelled && setAccount(data.email))
      .catch(() => !cancelled && setAccount(null));
    return () => {
      cancelled = true;
    };
    // The initial load must not run again when the language changes (which
    // rebuilds `connectionError`): only the very first mount matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Gmail sync (refresh_csv.py) ----------

  const startGmailSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    syncToastId.current = addToast({
      type: "in-progress",
      header: t("toast.syncHeader"),
      content: t("toast.syncStarting"),
      sticky: true,
    });

    const finishSync = (patch) => {
      settleToast(syncToastId.current, { progress: null, ...patch });
      setSyncing(false);
    };

    const poll = async () => {
      let data;
      try {
        data = await fetchSyncStatus();
      } catch (e) {
        finishSync({
          type: "error",
          header: t("toast.syncFailed"),
          content: apiErrorMessage(t, e),
        });
        return;
      }

      if (data.status === "running" || data.status === "idle") {
        const progress = data.total ? Math.round((data.current / data.total) * 100) : null;
        updateToast(syncToastId.current, {
          content: syncStatusMessage(t, data, t("toast.syncRunning")),
          progress,
        });
        syncPollTimeout.current = setTimeout(poll, SYNC_POLL_MS);
        return;
      }

      if (data.status === "done") {
        finishSync({
          type: "success",
          header: t("toast.syncDone"),
          content: syncStatusMessage(t, data),
        });
        try {
          await reloadCsv();
        } catch {
          /* the backend reloads on the next access anyway */
        }
        await loadData({ silent: true });
        return;
      }

      // status === "error"
      finishSync({
        type: "error",
        header: t("toast.syncFailed"),
        content: syncStatusMessage(t, data, t("toast.syncFailedFallback")),
      });
    };

    try {
      await startSync();
      poll();
    } catch (e) {
      finishSync({ type: "error", header: t("toast.syncFailed"), content: apiErrorMessage(t, e) });
    }
  }, [syncing, addToast, updateToast, settleToast, loadData, t]);

  useEffect(() => () => clearTimeout(syncPollTimeout.current), []);

  // ---------- Background action queue (deletion, unsubscribe...) ----------

  /**
   * Runs `jobFn` after the jobs already waiting, without ever blocking the UI:
   * the caller registers the job and moves on right away (closing a modal,
   * resetting a selection...). Sequencing avoids concurrent writes to the CSV
   * on the backend side; each job handles its own progress toast.
   */
  const queueAction = useCallback((jobFn) => {
    const run = queueRef.current.then(jobFn, jobFn);
    queueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const queueTrashSenders = useCallback(
    (emails) => {
      const senderCount = t("common.senderCount", { count: emails.length });
      const toastId = addToast({
        type: "in-progress",
        header: t("toast.deleting"),
        content: t("toast.deletingSenders", { senders: senderCount }),
        sticky: true,
      });
      return queueAction(async () => {
        try {
          const res = await trashSenders(emails);
          settleToast(toastId, {
            type: res.errors > 0 ? "warning" : "success",
            header: t("toast.deleteDone"),
            content: t("toast.deleteDoneSenders", {
              count: res.trashed,
              senders: senderCount,
              errors:
                res.errors > 0
                  ? t("toast.deleteErrorsSuffix", {
                      errors: t("common.errorCount", { count: res.errors }),
                    })
                  : "",
            }),
          });
          await loadData({ silent: true });
          return res;
        } catch (e) {
          settleToast(toastId, {
            type: "error",
            header: t("toast.deleteFailed"),
            content: apiErrorMessage(t, e),
          });
          throw e;
        }
      });
    },
    [addToast, settleToast, loadData, queueAction, t]
  );

  // The open sender is re-derived from the fresh data: its counter stays
  // correct after a deletion, without duplicating state.
  const openedSender =
    selectedSender &&
    (senders.find((s) => s.from_email === selectedSender.from_email) ?? selectedSender);

  const topSender = senders[0] ?? null;

  const closeModal = () => setSelectedSender(null);

  const value = {
    stats,
    senders,
    account,
    loading,
    refreshing,
    syncing,
    loadData,
    startGmailSync,
    topSender,
    openedSender,
    setSelectedSender,
    closeModal,
    queueAction,
    queueTrashSenders,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within an AppDataProvider");
  return ctx;
}
