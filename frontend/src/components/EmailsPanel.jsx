import { useEffect, useRef, useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import Grid from "@cloudscape-design/components/grid";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Alert from "@cloudscape-design/components/alert";
import Checkbox from "@cloudscape-design/components/checkbox";

import EmailPreview from "./EmailPreview";
import { fetchSenderEmails, scanUnsubscribe, runUnsubscribe, trashEmails } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { apiErrorMessage, unsubscribeDetail } from "../i18n/backendMessages";
import { useAppData } from "../context/AppDataContext";
import { useToast } from "../context/ToastContext";

const DEFAULT_PREFERENCES = { pageSize: 20, wrapLines: false, stripedRows: true };
const UNSUB_ACTIONABLE = new Set(["one_click", "link"]);

export default function EmailsPanel({ sender, onDeleteAllRequested }) {
  const { queueAction, loadData } = useAppData();
  const { addToast, settleToast } = useToast();
  const { t, formatDate, formatRelative, pageSizeOptions } = useI18n();
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState([]);
  const [previewId, setPreviewId] = useState(null);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  // { scope: "selection" | "all" | "single", ids: string[] }
  const [pendingTrash, setPendingTrash] = useState(null);
  const [unsubStatus, setUnsubStatus] = useState(null); // null until loaded
  const [alsoUnsubscribe, setAlsoUnsubscribe] = useState(true);
  const mountedRef = useRef(true);

  const senderEmail = sender?.from_email;
  const unsubActionable = unsubStatus && UNSUB_ACTIONABLE.has(unsubStatus.status);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // The component is mounted with `key={sender.from_email}`: switching sender
  // starts from a fresh state, so the effect only has to load the list.
  useEffect(() => {
    if (!senderEmail) return undefined;
    let cancelled = false;

    fetchSenderEmails(senderEmail)
      .then((data) => {
        if (cancelled) return;
        setEmails(data);
        setPreviewId(data[0]?.id ?? null);
      })
      .catch(() => !cancelled && setEmails([]))
      .finally(() => !cancelled && setLoading(false));

    // Probe (or read back from cache) the List-Unsubscribe header of this
    // sender, so the unsubscribe action is offered even when arriving from the
    // Senders page or from the dashboard.
    scanUnsubscribe([senderEmail], false)
      .then((cache) => !cancelled && setUnsubStatus(cache[senderEmail] ?? { status: "unknown" }))
      .catch(() => !cancelled && setUnsubStatus({ status: "unknown" }));

    return () => {
      cancelled = true;
    };
  }, [senderEmail]);

  const handleUnsubscribe = () => {
    const label = sender.from_name || sender.from_email;
    queueAction(async () => {
      const toastId = addToast({
        type: "in-progress",
        header: t("toast.unsubscribing"),
        content: label,
        sticky: true,
      });
      try {
        const res = await runUnsubscribe([senderEmail]);
        const entry = res[senderEmail];
        settleToast(toastId, {
          type: entry?.ok ? "success" : "warning",
          header: entry?.ok ? t("toast.unsubscribeSent") : t("toast.unsubscribeFailedHeader"),
          content: entry?.ok
            ? label
            : t("toast.unsubscribeFailedContent", {
                sender: label,
                reason: unsubscribeDetail(t, entry, t("toast.unknownReason")),
              }),
        });
        if (mountedRef.current) {
          setUnsubStatus((current) => ({
            ...current,
            last_run: { ok: Boolean(entry?.ok), at: new Date().toISOString() },
          }));
        }
      } catch (e) {
        settleToast(toastId, {
          type: "error",
          header: t("toast.unsubscribeError"),
          content: apiErrorMessage(t, e),
        });
      }
    });
  };

  /**
   * Starts the deletion in the background: the caller closes its confirmation
   * right away, the outcome (success/error) arrives later through a toast.
   * "all" leaves the panel immediately (onDeleteAllRequested); the other
   * scopes drop the affected rows from the list once the job succeeds.
   */
  const runTrash = (ids, { scope, unsubscribeAlso = false } = {}) => {
    const label = sender.from_name || sender.from_email;
    const isAll = scope === "all";

    if (isAll) {
      onDeleteAllRequested?.();
    } else {
      setSelectedItems([]);
    }

    queueAction(async () => {
      const toastId = addToast({
        type: "in-progress",
        header: isAll
          ? t("toast.deleteAllHeader")
          : t("toast.deleteSomeHeader", { emails: t("common.emailCount", { count: ids.length }) }),
        content: unsubscribeAlso
          ? t("toast.deleteSenderContentUnsub", { sender: label })
          : t("toast.deleteSenderContent", { sender: label }),
        sticky: true,
      });

      let unsubNote = "";
      if (unsubscribeAlso) {
        try {
          const res = await runUnsubscribe([senderEmail]);
          unsubNote = res[senderEmail]?.ok
            ? t("toast.unsubNoteOk")
            : t("toast.unsubNoteFailed", {
                reason: unsubscribeDetail(t, res[senderEmail], t("toast.unknownReason")),
              });
        } catch (e) {
          unsubNote = t("toast.unsubNoteError", { message: apiErrorMessage(t, e) });
        }
      }

      try {
        const res = await trashEmails(ids);
        settleToast(toastId, {
          type: res.errors > 0 ? "warning" : "success",
          header: t("toast.deleteDone"),
          content: t("toast.deleteSenderDone", {
            count: res.trashed,
            sender: label,
            errors:
              res.errors > 0
                ? t("toast.deleteErrorsSuffix", {
                    errors: t("common.errorCount", { count: res.errors }),
                  })
                : "",
            unsubNote,
          }),
        });
        if (!isAll && mountedRef.current) {
          // Emails Gmail refused to delete stay in the list.
          const failed = new Set((res.error_details ?? []).map((d) => d.id));
          setEmails((current) => {
            const remaining = current.filter((e) => !ids.includes(e.id) || failed.has(e.id));
            setPreviewId((currentPreview) =>
              remaining.some((e) => e.id === currentPreview)
                ? currentPreview
                : remaining[0]?.id ?? null
            );
            return remaining;
          });
        }
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

  const columnDefinitions = [
    {
      id: "subject",
      header: t("emailsPanel.columns.subject"),
      cell: (item) => (
        <Link
          href="#"
          variant={item.id === previewId ? "primary" : "secondary"}
          onFollow={(e) => {
            e.preventDefault();
            setPreviewId(item.id);
          }}
        >
          {item.id === previewId ? (
            <b>{item.subject || t("emailsPanel.noSubject")}</b>
          ) : (
            item.subject || t("emailsPanel.noSubject")
          )}
        </Link>
      ),
      sortingField: "subject",
      minWidth: 240,
    },
    {
      id: "date",
      header: t("emailsPanel.columns.date"),
      cell: (item) => (
        <SpaceBetween size="xxxs">
          <Box fontSize="body-s">{formatDate(item.date_iso, item.date)}</Box>
          <Box fontSize="body-s" color="text-body-secondary">
            {formatRelative(item.date_iso)}
          </Box>
        </SpaceBetween>
      ),
      // Sort on the ISO date: the raw RFC 2822 header would sort alphabetically.
      sortingField: "date_iso",
      width: 190,
      minWidth: 150,
    },
  ];

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } =
    useCollection(emails, {
      filtering: {
        empty: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "l" }}>
            {t("emailsPanel.emptyList")}
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "l" }}>
            {t("emailsPanel.noMatch")}
          </Box>
        ),
        filteringFunction: (item, filterText) =>
          (item.subject || "").toLowerCase().includes(filterText.toLowerCase()),
      },
      pagination: { pageSize: preferences.pageSize },
      sorting: { defaultState: { sortingColumn: { sortingField: "date_iso" }, isDescending: true } },
      selection: {},
    });

  if (!sender) return null;

  const pendingCount = pendingTrash?.ids.length ?? 0;
  const pendingLabel = t("common.emailCount", { count: pendingCount });
  const confirmLabels = {
    selection: t("emailsPanel.confirmSelection", { emails: pendingLabel }),
    all: t("emailsPanel.confirmAll", { emails: pendingLabel }),
    single: t("emailsPanel.confirmSingle"),
  };

  return (
    <SpaceBetween size="m">
      {pendingTrash && (
        <Alert
          type="warning"
          header={t("emailsPanel.confirmTrashTitle")}
          action={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setPendingTrash(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const { scope, ids } = pendingTrash;
                  setPendingTrash(null);
                  runTrash(ids, {
                    scope,
                    unsubscribeAlso: scope === "all" && unsubActionable && alsoUnsubscribe,
                  });
                }}
              >
                {confirmLabels[pendingTrash.scope]}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="s">
            <Box>
              {t("emailsPanel.confirmTrashBody", {
                count: pendingCount,
                sender: sender.from_name || sender.from_email,
              })}
            </Box>
            {pendingTrash.scope === "all" && unsubActionable && (
              <Checkbox
                checked={alsoUnsubscribe}
                onChange={({ detail }) => setAlsoUnsubscribe(detail.checked)}
              >
                {t("emailsPanel.alsoUnsubscribe")}
              </Checkbox>
            )}
          </SpaceBetween>
        </Alert>
      )}

      <Grid
        gridDefinition={[
          { colspan: { default: 12, m: 7 } },
          { colspan: { default: 12, m: 5 } },
        ]}
      >
        <Table
          {...collectionProps}
          items={items}
          columnDefinitions={columnDefinitions}
          wrapLines={preferences.wrapLines}
          stripedRows={preferences.stripedRows}
          selectionType="multi"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          onRowClick={({ detail }) => setPreviewId(detail.item.id)}
          loading={loading}
          loadingText={t("emailsPanel.loading")}
          trackBy="id"
          variant="container"
          resizableColumns
          ariaLabels={{
            selectionGroupLabel: t("emailsPanel.selectionGroupLabel"),
            allItemsSelectionLabel: () => t("table.selectAll"),
            itemSelectionLabel: (_data, item) => item.subject || t("emailsPanel.noSubject"),
            tableLabel: t("emailsPanel.tableLabel"),
          }}
          header={
            <Header
              variant="h3"
              counter={
                selectedItems.length > 0
                  ? `(${selectedItems.length}/${emails.length})`
                  : `(${emails.length})`
              }
              description={sender.from_email}
              actions={
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  {unsubStatus?.status === "mailto" && (
                    <Button
                      iconName="envelope"
                      onClick={() => window.open(`mailto:${unsubStatus.mailto}`, "_self")}
                    >
                      {t("emailsPanel.openUnsubscribeMail")}
                    </Button>
                  )}
                  {unsubActionable && (
                    <Button onClick={handleUnsubscribe}>
                      {t("emailsPanel.unsubscribeAction")}
                    </Button>
                  )}
                  <Button
                    disabled={selectedItems.length === 0}
                    onClick={() =>
                      setPendingTrash({
                        scope: "selection",
                        ids: selectedItems.map((e) => e.id),
                      })
                    }
                  >
                    {t("emailsPanel.deleteSelection", { count: selectedItems.length })}
                  </Button>
                  <Button
                    variant="primary"
                    iconName="remove"
                    disabled={emails.length === 0}
                    onClick={() =>
                      setPendingTrash({ scope: "all", ids: emails.map((e) => e.id) })
                    }
                  >
                    {t("emailsPanel.deleteAll", { count: emails.length })}
                  </Button>
                </SpaceBetween>
              }
            >
              {t("emailsPanel.title")}
            </Header>
          }
          filter={
            <TextFilter
              {...filterProps}
              filteringPlaceholder={t("emailsPanel.filterPlaceholder")}
              filteringAriaLabel={t("emailsPanel.filterAriaLabel")}
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
              title={t("emailsPanel.preferences")}
              confirmLabel={t("common.confirm")}
              cancelLabel={t("common.cancel")}
              preferences={preferences}
              onConfirm={({ detail }) => setPreferences(detail)}
              pageSizePreference={{
                title: t("table.emailsPerPage"),
                options: pageSizeOptions,
              }}
              wrapLinesPreference={{
                label: t("table.wrapLines"),
                description: t("table.wrapLinesDescriptionSubject"),
              }}
              stripedRowsPreference={{
                label: t("table.stripedRows"),
                description: t("table.stripedRowsDescription"),
              }}
            />
          }
        />

        <EmailPreview
          emailId={previewId}
          height={480}
          onTrash={(id) => setPendingTrash({ scope: "single", ids: [id] })}
        />
      </Grid>
    </SpaceBetween>
  );
}
