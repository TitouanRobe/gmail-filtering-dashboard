import { useState, useEffect } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

const COLUMN_DEFINITIONS = [
  {
    id: "rank",
    header: "#",
    cell: (_, index) => index + 1,
    width: 60,
  },
  {
    id: "from_name",
    header: "Nom",
    cell: (item) => item.from_name || "—",
    sortingField: "from_name",
    width: 200,
  },
  {
    id: "from_email",
    header: "Email",
    cell: (item) => item.from_email,
    sortingField: "from_email",
  },
  {
    id: "count",
    header: "Nb mails",
    cell: (item) => (
      <Box fontWeight="bold" color="text-status-info">
        {item.count.toLocaleString("fr-FR")}
      </Box>
    ),
    sortingField: "count",
    width: 120,
  },
  {
    id: "bar",
    header: "Proportion",
    cell: (item) => {
      const pct = item._pct || 0;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              height: 14,
              width: `${pct}%`,
              minWidth: 4,
              background: "linear-gradient(90deg, #0972d3, #44b9d6)",
              borderRadius: 4,
              transition: "width 0.4s ease",
            }}
          />
          <span style={{ fontSize: 12, color: "#687078" }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      );
    },
    width: 220,
  },
];

export default function SendersTable({ senders, loading, onSelect }) {
  const [selectedItems, setSelectedItems] = useState([]);

  // Enrich with percentage
  const maxCount = senders.length > 0 ? senders[0].count : 1;
  const enriched = senders.map((s, i) => ({
    ...s,
    _pct: (s.count / maxCount) * 100,
    _rank: i + 1,
  }));

  const {
    items,
    filteredItemsCount,
    collectionProps,
    filterProps,
    paginationProps,
  } = useCollection(enriched, {
    filtering: {
      empty: (
        <Box textAlign="center" color="inherit" padding="l">
          Aucun expéditeur trouvé
        </Box>
      ),
      noMatch: (
        <Box textAlign="center" color="inherit" padding="l">
          Aucun résultat pour ce filtre
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
    pagination: { pageSize: 20 },
    sorting: {
      defaultState: { sortingColumn: COLUMN_DEFINITIONS[3], isDescending: true },
    },
    selection: {},
  });

  // Override cell for rank column to show index in current page
  const columnDefs = COLUMN_DEFINITIONS.map((col) => {
    if (col.id === "rank") {
      return {
        ...col,
        cell: (item) => item._rank,
      };
    }
    return col;
  });

  return (
    <Table
      {...collectionProps}
      items={items}
      columnDefinitions={columnDefs}
      selectionType="single"
      selectedItems={selectedItems}
      onSelectionChange={({ detail }) => {
        setSelectedItems(detail.selectedItems);
        if (detail.selectedItems.length > 0) {
          onSelect(detail.selectedItems[0]);
        }
      }}
      loading={loading}
      loadingText="Chargement des expéditeurs..."
      trackBy="from_email"
      variant="full-page"
      stickyHeader
      header={
        <Header
          counter={`(${senders.length} expéditeurs)`}
          description="Cliquez sur un expéditeur pour voir ses mails"
        >
          Expéditeurs
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Rechercher un expéditeur..."
          countText={`${filteredItemsCount} résultat(s)`}
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" color="inherit" padding="l">
          Aucun expéditeur
        </Box>
      }
    />
  );
}
