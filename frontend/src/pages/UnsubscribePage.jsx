import { useEffect, useRef, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";

import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Modal from "@cloudscape-design/components/modal";
import Alert from "@cloudscape-design/components/alert";
import Checkbox from "@cloudscape-design/components/checkbox";

import { fetchUnsubscribeSenders, scanUnsubscribe, runUnsubscribe, trashSenders } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { apiErrorMessage } from "../i18n/backendMessages";
import { useAppData } from "../context/AppDataContext";
import { useToast } from "../context/ToastContext";

const DEFAULT_PREFERENCES = { pageSize: 20, wrapLines: false, stripedRows: true };

// One click: http(s) link + List-Unsubscribe-Post="One-Click" (RFC 8058), a
// plain POST is enough. Link: http(s) only, a confirmation is often asked for
// on the page. Manual: a mailto only — we never send an email on behalf of the
// user, just a link to open.
const STATUS_TYPES = {
  one_click: "success",
  link: "info",
  mailto: "warning",
  none: "stopped",
  unknown: "pending",
};

// Statuses shown in the table: they are the only ones with a possible action
// (automatic or manual). "none" and "unknown" stay out of the table, they are
// only counted in the summary above it.
const NEWSLETTER_STATUSES = new Set(["one_click", "link", "mailto"]);
const ACTIONABLE_STATUSES = new Set(["one_click", "link"]);

function statusType(status) {
  return STATUS_TYPES[status] ?? STATUS_TYPES.unknown;
}

export default function UnsubscribePage() {
  const { setSelectedSender, queueAction, loadData, senders: sharedSenders } = useAppData();
  const { addToast, settleToast } = useToast();
  const { t, formatDate, formatNumber, formatRelative, pageSizeOptions } = useI18n();
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [alsoDeleteAll, setAlsoDeleteAll] = useState(false);
  const [result, setResult] = useState(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const isFirstLoad = useRef(true);

  /** Label of an unsubscribe status, translated. */
  const statusLabel = (status) => t(`unsubscribe.status.${status in STATUS_TYPES ? status : "unknown"}`);

  const load = () =>
    fetchUnsubscribeSenders()
      .then(setSenders)
      .catch((e) =>
        setResult({
          type: "error",
          header: t("unsubscribe.loadFailed"),
          content: apiErrorMessage(t, e),
        })
      );

  // A deletion made elsewhere (email panel opened from this page, Senders
  // page...) updates the shared data: this list is silently resynced as soon
  // as that happens, rather than sitting on stale counters until the next
  // full reload.
  useEffect(() => {
    if (isFirstLoad.current) {
      setLoading(true);
      load().finally(() => {
        setLoading(false);
        isFirstLoad.current = false;
      });
    } else {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSenders]);

  const enriched = senders.map((s) => ({
    ...s,
    _status: s.unsubscribe.status,
    _statusLabel: statusLabel(s.unsubscribe.status),
  }));

  // The page only shows unsubscribable newsletters: senders without a
  // List-Unsubscribe header ("none") or not scanned yet ("unknown") are only
  // counted, not listed — this is not a sender list.
  const newsletters = enriched.filter((s) => NEWSLETTER_STATUSES.has(s._status));
  const noneCount = enriched.filter((s) => s._status === "none").length;

  const unknownEmails = senders
    .filter((s) => s.unsubscribe.status === "unknown")
    .map((s) => s.from_email);

  const handleScan = async (force) => {
    const targets = force ? senders.map((s) => s.from_email) : unknownEmails;
    if (targets.length === 0) {
      addToast({ type: "success", content: t("toast.allScanned") });
      return;
    }
    setScanning(true);
    const toastId = addToast({
      type: "in-progress",
      header: t("toast.scanHeader"),
      content: t("toast.scanRunning", {
        senders: t("common.senderCount", { count: targets.length }),
      }),
      sticky: true,
    });
    try {
      await scanUnsubscribe(targets, force);
      await load();
      settleToast(toastId, {
        type: "success",
        header: t("toast.scanDone"),
        content: t("toast.scanDoneContent", { count: targets.length }),
      });
    } catch (e) {
      settleToast(toastId, {
        type: "error",
        header: t("toast.scanFailed"),
        content: apiErrorMessage(t, e),
      });
    } finally {
      setScanning(false);
    }
  };

  const actionableSelection = selectedItems.filter((s) => ACTIONABLE_STATUSES.has(s._status));
  const manualSelection = selectedItems.filter((s) => s._status === "mailto");
  const selectedMailCount = selectedItems.reduce((sum, s) => sum + s.count, 0);

  // Plain deletion, with no unsubscribe attempt: the only way to act in bulk
  // on "manual (mailto)" senders, which cannot be unsubscribed automatically
  // but whose emails can perfectly well be emptied in one go rather than one
  // by one.
  const handleConfirmDelete = () => {
    const emails = selectedItems.map((s) => s.from_email);
    const mailCount = selectedMailCount;
    setSelectedItems([]);
    setDeleteConfirmVisible(false);

    queueAction(async () => {
      const toastId = addToast({
        type: "in-progress",
        header: t("toast.deleting"),
        content: t("toast.deletingCount", {
          emails: t("common.emailCount", { count: mailCount }),
          senders: t("common.senderCount", { count: emails.length }),
        }),
        sticky: true,
      });
      try {
        const res = await trashSenders(emails);
        settleToast(toastId, {
          type: res.errors > 0 ? "warning" : "success",
          header: t("toast.deleteDone"),
          content: `${t("common.deletedEmailCount", { count: res.trashed })}${
            res.errors > 0
              ? t("toast.deleteErrorsSuffix", {
                  errors: t("common.errorCount", { count: res.errors }),
                })
              : ""
          }.`,
        });
        await loadData({ silent: true });
      } catch (e) {
        settleToast(toastId, {
          type: "error",
          header: t("toast.deleteFailed"),
          content: apiErrorMessage(t, e),
        });
      }
    });
  };

  // The unsubscribe (and the optional deletion) run in the background: the
  // modal closes right away, the outcome arrives through a toast.
  const handleConfirmRun = () => {
    const emails = actionableSelection.map((s) => s.from_email);
    const deleteAlso = alsoDeleteAll;
    setSelectedItems([]);
    setConfirmVisible(false);

    queueAction(async () => {
      const toastId = addToast({
        type: "in-progress",
        header: t("toast.unsubscribing"),
        content: t("toast.unsubRunning", {
          requests: t("toast.unsubRequestCount", { count: emails.length }),
          deleteNote: deleteAlso ? t("toast.unsubRunningDeleteNote") : "",
        }),
        sticky: true,
      });
      try {
        const res = await runUnsubscribe(emails);
        const entries = Object.values(res);
        const okCount = entries.filter((r) => r.ok).length;
        const failCount = entries.length - okCount;

        let deleteNote = "";
        if (deleteAlso) {
          try {
            const delRes = await trashSenders(emails);
            deleteNote = t("toast.unsubDeleteNote", {
              emails: t("common.deletedEmailCount", { count: delRes.trashed }),
            });
            // The deletion changes the shared counters (Senders page,
            // dashboard): without this they stay stale until the next full
            // page reload.
            await loadData({ silent: true });
          } catch (e) {
            deleteNote = t("toast.unsubDeleteFailedNote", { message: apiErrorMessage(t, e) });
          }
        }

        settleToast(toastId, {
          type: failCount > 0 ? "warning" : "success",
          header: t("toast.unsubDone"),
          // An HTTP 200 does not guarantee the remote server actually
          // processed the request: we say "request sent", not "unsubscribe
          // confirmed".
          content: t("toast.unsubDoneContent", {
            sent: t("toast.unsubSentCount", { count: okCount }),
            failures:
              failCount > 0
                ? t("toast.deleteErrorsSuffix", {
                    errors: t("toast.unsubFailCount", { count: failCount }),
                  })
                : "",
            deleteNote,
          }),
        });
        await load();
      } catch (e) {
        settleToast(toastId, {
          type: "error",
          header: t("toast.unsubscribeError"),
          content: apiErrorMessage(t, e),
        });
      }
    });
  };

  const columnDefinitions = [
    {
      id: "from_name",
      header: t("unsubscribe.columns.name"),
      cell: (item) => (
        <Link
          href="#"
          onFollow={(e) => {
            e.preventDefault();
            setSelectedSender(item);
          }}
        >
          {item.from_name || item.from_email}
        </Link>
      ),
      sortingField: "from_name",
      minWidth: 180,
    },
    {
      id: "from_email",
      header: t("unsubscribe.columns.email"),
      cell: (item) => (
        <Box color="text-body-secondary" fontSize="body-s">
          {item.from_email}
        </Box>
      ),
      sortingField: "from_email",
      minWidth: 220,
    },
    {
      id: "count",
      header: t("unsubscribe.columns.count"),
      cell: (item) => (
        <Box fontWeight="bold" textAlign="right">
          {formatNumber(item.count)}
        </Box>
      ),
      sortingField: "count",
      width: 110,
      minWidth: 100,
    },
    {
      id: "last_email_date",
      header: t("unsubscribe.columns.lastEmail"),
      cell: (item) => (
        <Box fontSize="body-s" title={formatDate(item.last_email_date)}>
          {formatRelative(item.last_email_date) || t("common.empty")}
        </Box>
      ),
      sortingField: "last_email_date",
      width: 150,
      minWidth: 130,
    },
    {
      id: "status",
      header: t("unsubscribe.columns.status"),
      cell: (item) => (
        <StatusIndicator type={statusType(item._status)}>{item._statusLabel}</StatusIndicator>
      ),
      sortingField: "_statusLabel",
      width: 160,
      minWidth: 150,
    },
    {
      id: "last_run",
      header: t("unsubscribe.columns.lastRun"),
      cell: (item) => {
        const lastRun = item.unsubscribe.last_run;
        if (!lastRun) return <Box color="text-body-secondary">{t("common.empty")}</Box>;
        return (
          <StatusIndicator type={lastRun.ok ? "success" : "error"}>
            {lastRun.ok
              ? t("unsubscribe.lastRunSent", { relative: formatRelative(lastRun.at) })
              : t("unsubscribe.lastRunFailed", { relative: formatRelative(lastRun.at) })}
          </StatusIndicator>
        );
      },
      minWidth: 170,
    },
    {
      id: "action",
      header: t("unsubscribe.columns.manualAction"),
      cell: (item) => {
        if (item._status === "mailto" && item.unsubscribe.mailto) {
          return (
            <Link external href={`mailto:${item.unsubscribe.mailto}`}>
              {t("unsubscribe.openMail")}
            </Link>
          );
        }
        if (item._status === "link" && item.unsubscribe.url) {
          return (
            <Link external href={item.unsubscribe.url}>
              {t("unsubscribe.openPage")}
            </Link>
          );
        }
        return <Box color="text-body-secondary">{t("common.empty")}</Box>;
      },
      minWidth: 150,
    },
  ];

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } =
    useCollection(newsletters, {
      filtering: {
        empty: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "xl" }}>
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                {t("unsubscribe.emptyTitle")}
              </Box>
              <Box variant="p" color="inherit">
                {unknownEmails.length > 0
                  ? t("unsubscribe.emptyScanHint")
                  : t("unsubscribe.emptyNoLinkHint")}
              </Box>
            </SpaceBetween>
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "xl" }}>
            {t("common.noResults")}
          </Box>
        ),
        filteringFunction: (item, filterText) => {
          const text = filterText.toLowerCase();
          return (
            item.from_email.toLowerCase().includes(text) ||
            (item.from_name || "").toLowerCase().includes(text)
          );
        },
      },
      pagination: { pageSize: preferences.pageSize },
      sorting: { defaultState: { sortingColumn: { sortingField: "count" }, isDescending: true } },
      selection: {},
    });

  const selectedMailsLabel = t("common.emailCount", { count: selectedMailCount });

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            senders.length === 0
              ? t("unsubscribe.pageDescriptionEmpty")
              : t("unsubscribe.pageDescription", {
                  newsletters: t("unsubscribe.newsletterCount", { count: newsletters.length }),
                  total: formatNumber(senders.length),
                  none: formatNumber(noneCount),
                  unknown: t("unsubscribe.unknownCount", { count: unknownEmails.length }),
                })
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => handleScan(true)} loading={scanning} disabled={loading}>
                {t("unsubscribe.rescanAll")}
              </Button>
              <Button
                variant="primary"
                onClick={() => handleScan(false)}
                loading={scanning}
                disabled={loading || unknownEmails.length === 0}
              >
                {unknownEmails.length === 0
                  ? t("unsubscribe.allScanned")
                  : t("unsubscribe.scanNew", {
                      senders: t("unsubscribe.newSenderCount", { count: unknownEmails.length }),
                    })}
              </Button>
            </SpaceBetween>
          }
        >
          {t("unsubscribe.title")}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {result && (
          <Alert type={result.type} header={result.header} dismissible onDismiss={() => setResult(null)}>
            {result.content}
          </Alert>
        )}

        <Modal
          visible={confirmVisible}
          onDismiss={() => setConfirmVisible(false)}
          header={t("unsubscribe.confirmRunTitle")}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setConfirmVisible(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={handleConfirmRun}>
                  {alsoDeleteAll
                    ? t("unsubscribe.confirmRunAndDelete", { count: actionableSelection.length })
                    : t("unsubscribe.unsubscribeActionCount", {
                        count: actionableSelection.length,
                      })}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="warning">
              {t("unsubscribe.confirmRunWarning", {
                senders: t("common.senderCount", { count: actionableSelection.length }),
              })}
            </Alert>
            <Box>
              <Box variant="awsui-key-label">{t("common.affectedSenders")}</Box>
              <ul>
                {actionableSelection.slice(0, 10).map((s) => (
                  <li key={s.from_email}>
                    {s.from_name || s.from_email} — {statusLabel(s._status)}
                  </li>
                ))}
                {actionableSelection.length > 10 && (
                  <li>{t("common.andNMore", { count: actionableSelection.length - 10 })}</li>
                )}
              </ul>
            </Box>
            {manualSelection.length > 0 && (
              <Alert type="info">
                {t("unsubscribe.manualSelectionNote", { count: manualSelection.length })}
              </Alert>
            )}
            <Checkbox
              checked={alsoDeleteAll}
              onChange={({ detail }) => setAlsoDeleteAll(detail.checked)}
            >
              {t("unsubscribe.alsoDeleteAll")}
            </Checkbox>
          </SpaceBetween>
        </Modal>

        <Modal
          visible={deleteConfirmVisible}
          onDismiss={() => setDeleteConfirmVisible(false)}
          header={t("unsubscribe.confirmDeleteTitle")}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setDeleteConfirmVisible(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={handleConfirmDelete}>
                  {t("unsubscribe.deleteNEmails", { emails: selectedMailsLabel })}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="warning">
              {t("unsubscribe.confirmDeleteWarning", {
                count: selectedMailCount,
                senders: t("common.senderCount", { count: selectedItems.length }),
              })}
            </Alert>
            <Box>
              <Box variant="awsui-key-label">{t("common.affectedSenders")}</Box>
              <ul>
                {selectedItems.slice(0, 10).map((s) => (
                  <li key={s.from_email}>
                    {s.from_name || s.from_email} — {t("common.emailCount", { count: s.count })}
                  </li>
                ))}
                {selectedItems.length > 10 && (
                  <li>{t("common.andNMore", { count: selectedItems.length - 10 })}</li>
                )}
              </ul>
            </Box>
          </SpaceBetween>
        </Modal>

        <Table
          {...collectionProps}
          items={items}
          columnDefinitions={columnDefinitions}
          wrapLines={preferences.wrapLines}
          stripedRows={preferences.stripedRows}
          selectionType="multi"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          loading={loading}
          loadingText={t("unsubscribe.loading")}
          trackBy="from_email"
          variant="container"
          resizableColumns
          stickyHeader
          ariaLabels={{
            selectionGroupLabel: t("senders.selectionGroupLabel"),
            allItemsSelectionLabel: () => t("table.selectAll"),
            itemSelectionLabel: (_data, item) => item.from_name || item.from_email,
            tableLabel: t("unsubscribe.tableLabel"),
          }}
          header={
            <Header
              variant="h2"
              counter={
                selectedItems.length > 0
                  ? `(${selectedItems.length}/${newsletters.length})`
                  : `(${formatNumber(newsletters.length)})`
              }
              description={t("unsubscribe.tableDescription")}
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    disabled={selectedItems.length !== 1}
                    onClick={() => setSelectedSender(selectedItems[0])}
                  >
                    {t("unsubscribe.viewEmails")}
                  </Button>
                  <Button
                    iconName="remove"
                    disabled={selectedItems.length === 0}
                    onClick={() => setDeleteConfirmVisible(true)}
                  >
                    {selectedItems.length === 0
                      ? t("unsubscribe.deleteEmails")
                      : t("unsubscribe.deleteNEmails", { emails: selectedMailsLabel })}
                  </Button>
                  <Button
                    variant="primary"
                    iconName="close"
                    disabled={actionableSelection.length === 0}
                    onClick={() => setConfirmVisible(true)}
                  >
                    {actionableSelection.length === 0
                      ? t("unsubscribe.unsubscribeAction")
                      : t("unsubscribe.unsubscribeActionCount", {
                          count: actionableSelection.length,
                        })}
                  </Button>
                </SpaceBetween>
              }
            >
              {t("unsubscribe.tableTitle")}
            </Header>
          }
          filter={
            <TextFilter
              {...filterProps}
              filteringPlaceholder={t("unsubscribe.searchPlaceholder")}
              filteringAriaLabel={t("unsubscribe.searchAriaLabel")}
              countText={t("common.resultCount", { count: filteredItemsCount })}
            />
          }
          pagination={
            <Pagination
              {...paginationProps}
              ariaLabels={{
                nextPageLabel: t("table.nextPage"),
                previousPageLabel: t("table.previousPage"),
                pageLabel: (page) => t("table.pageLabel", { page }),
              }}
            />
          }
          preferences={
            <CollectionPreferences
              title={t("table.preferences")}
              confirmLabel={t("common.confirm")}
              cancelLabel={t("common.cancel")}
              preferences={preferences}
              onConfirm={({ detail }) => setPreferences(detail)}
              pageSizePreference={{
                title: t("table.sendersPerPage"),
                options: pageSizeOptions,
              }}
              wrapLinesPreference={{
                label: t("table.wrapLines"),
                description: t("table.wrapLinesDescriptionText"),
              }}
              stripedRowsPreference={{
                label: t("table.stripedRows"),
                description: t("table.stripedRowsDescription"),
              }}
            />
          }
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
