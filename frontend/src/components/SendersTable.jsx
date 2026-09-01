import { useState } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import CollectionPreferences from "@cloudscape-design/components/collection-preferences";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Modal from "@cloudscape-design/components/modal";
import Alert from "@cloudscape-design/components/alert";

import ProportionBar from "./ProportionBar";
import { useI18n } from "../i18n/I18nContext";

const DEFAULT_PREFERENCES = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: true,
  contentDisplay: [
    { id: "rank", visible: true },
    { id: "from_name", visible: true },
    { id: "from_email", visible: true },
    { id: "count", visible: true },
    { id: "last_email_date", visible: true },
    { id: "bar", visible: true },
  ],
};

export default function SendersTable({
  senders,
  loading,
  totalEmails,
  onOpenSender,
  onTrashSenders,
}) {
  const { t, formatDate, formatNumber, formatRelative, pageSizeOptions } = useI18n();
  const [selectedItems, setSelectedItems] = useState([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Rank and share are computed on the whole list (already sorted by the
  // backend), not on the current page: they stay stable when filtering.
  const maxCount = senders.length > 0 ? Math.max(...senders.map((s) => s.count)) : 1;
  const enriched = senders.map((sender, i) => ({
    ...sender,
    _rank: i + 1,
    _ratio: sender.count / maxCount,
    _share: totalEmails > 0 ? sender.count / totalEmails : 0,
  }));

  const columnDefinitions = [
    {
      id: "rank",
      header: t("senders.columns.rank"),
      cell: (item) => (
        <Box color="text-body-secondary" fontSize="body-s">
          {item._rank}
        </Box>
      ),
      width: 70,
      minWidth: 70,
    },
    {
      id: "from_name",
      header: t("senders.columns.name"),
      cell: (item) => (
        <Link
          href="#"
          onFollow={(e) => {
            e.preventDefault();
            onOpenSender(item);
          }}
        >
          {item.from_name || item.from_email}
        </Link>
      ),
      sortingField: "from_name",
      width: 260,
      minWidth: 160,
    },
    {
      id: "from_email",
      header: t("senders.columns.email"),
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
      header: t("senders.columns.count"),
      cell: (item) => (
        <Box fontWeight="bold" textAlign="right">
          {formatNumber(item.count)}
        </Box>
      ),
      sortingField: "count",
      width: 120,
      minWidth: 110,
    },
    {
      id: "last_email_date",
      header: t("senders.columns.lastEmail"),
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
      id: "bar",
      header: t("senders.columns.share"),
      cell: (item) => <ProportionBar ratio={item._ratio} label={item._share} />,
      sortingField: "count",
      width: 240,
      minWidth: 180,
    },
  ];

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } =
    useCollection(enriched, {
      filtering: {
        empty: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "xl" }}>
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                {t("senders.emptyTitle")}
              </Box>
              <Box variant="p" color="inherit">
                {t("senders.emptyDescription")}
              </Box>
            </SpaceBetween>
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="inherit" padding={{ vertical: "xl" }}>
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                {t("senders.noMatchTitle")}
              </Box>
              <Box variant="p" color="inherit">
                {t("senders.noMatchDescription")}
              </Box>
            </SpaceBetween>
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

  const selectedCount = selectedItems.length;
  const selectedMails = selectedItems.reduce((sum, s) => sum + s.count, 0);
  const selectedMailsLabel = t("common.emailCount", { count: selectedMails });

  // Deletion runs in the background (toast): the modal closes and the
  // selection is cleared right away, no need to wait for the result.
  const handleConfirmTrash = () => {
    const emails = selectedItems.map((s) => s.from_email);
    setSelectedItems([]);
    setConfirmVisible(false);
    onTrashSenders(emails);
  };

  return (
    <>
      <Modal
        visible={confirmVisible}
        onDismiss={() => setConfirmVisible(false)}
        header={t("senders.confirmDeleteTitle")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmVisible(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={handleConfirmTrash}>
                {t("senders.deleteNEmails", { emails: selectedMailsLabel })}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <Alert type="warning">
            {t("senders.confirmDeleteWarning", {
              count: selectedMails,
              senders: t("common.senderCount", { count: selectedCount }),
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
              {selectedCount > 10 && (
                <li>{t("common.andNMore", { count: selectedCount - 10 })}</li>
              )}
            </ul>
          </Box>
        </SpaceBetween>
      </Modal>

      <Table
        {...collectionProps}
        items={items}
        columnDefinitions={columnDefinitions}
        columnDisplay={preferences.contentDisplay}
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        selectionType="multi"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
        loading={loading}
        loadingText={t("senders.loading")}
        trackBy="from_email"
        variant="container"
        resizableColumns
        stickyHeader
        ariaLabels={{
          selectionGroupLabel: t("senders.selectionGroupLabel"),
          allItemsSelectionLabel: () => t("table.selectAll"),
          itemSelectionLabel: (_data, item) => item.from_name || item.from_email,
          tableLabel: t("senders.tableLabel"),
        }}
        header={
          <Header
            variant="h2"
            counter={
              selectedCount > 0
                ? `(${selectedCount}/${senders.length})`
                : `(${formatNumber(senders.length)})`
            }
            description={t("senders.tableDescription")}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={selectedCount !== 1}
                  onClick={() => onOpenSender(selectedItems[0])}
                >
                  {t("senders.viewEmails")}
                </Button>
                <Button
                  variant="primary"
                  iconName="remove"
                  disabled={selectedCount === 0}
                  onClick={() => setConfirmVisible(true)}
                >
                  {selectedCount === 0
                    ? t("senders.deleteEmails")
                    : t("senders.deleteNEmails", { emails: selectedMailsLabel })}
                </Button>
              </SpaceBetween>
            }
          >
            {t("senders.title")}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder={t("senders.searchPlaceholder")}
            filteringAriaLabel={t("senders.searchAriaLabel")}
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
            contentDisplayPreference={{
              title: t("table.columns"),
              options: [
                { id: "rank", label: t("senders.columns.rank"), alwaysVisible: true },
                { id: "from_name", label: t("senders.columns.name") },
                { id: "from_email", label: t("senders.columns.email") },
                { id: "count", label: t("senders.columns.count") },
                { id: "last_email_date", label: t("senders.columns.lastEmail") },
                { id: "bar", label: t("senders.columns.share") },
              ],
            }}
          />
        }
      />
    </>
  );
}
