import { useState, useEffect } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import Pagination from "@cloudscape-design/components/pagination";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Modal from "@cloudscape-design/components/modal";
import Alert from "@cloudscape-design/components/alert";
import { fetchSenderEmails, trashEmails } from "../api";

const COLUMN_DEFINITIONS = [
  {
    id: "subject",
    header: "Objet",
    cell: (item) => item.subject || "(sans objet)",
    sortingField: "subject",
  },
  {
    id: "date",
    header: "Date",
    cell: (item) => (
      <span style={{ whiteSpace: "nowrap" }}>{item.date || "—"}</span>
    ),
    sortingField: "date",
    width: 350,
  },
];

export default function EmailsPanel({ sender, onClose }) {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmAllVisible, setConfirmAllVisible] = useState(false);
  const [resultMessage, setResultMessage] = useState(null);

  const loadEmails = () => {
    if (!sender) return;
    setLoading(true);
    setSelectedItems([]);
    fetchSenderEmails(sender.from_email)
      .then(setEmails)
      .catch(() => setEmails([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEmails();
  }, [sender?.from_email]);

  const handleTrash = async (ids) => {
    setDeleting(true);
    setResultMessage(null);
    try {
      const result = await trashEmails(ids);
      setResultMessage({
        type: "success",
        content: `${result.trashed} mail(s) mis à la corbeille.${result.errors > 0 ? ` ${result.errors} erreur(s).` : ""}`,
      });
      // Retirer les mails supprimés de la liste locale
      setEmails((prev) => prev.filter((e) => !ids.includes(e.id)));
      setSelectedItems([]);
    } catch (e) {
      setResultMessage({ type: "error", content: e.message });
    } finally {
      setDeleting(false);
      setConfirmVisible(false);
      setConfirmAllVisible(false);
    }
  };

  const {
    items,
    filteredItemsCount,
    collectionProps,
    filterProps,
    paginationProps,
  } = useCollection(emails, {
    filtering: {
      filteringFunction: (item, filterText) =>
        (item.subject || "").toLowerCase().includes(filterText.toLowerCase()),
    },
    pagination: { pageSize: 15 },
    sorting: {},
    selection: {},
  });

  if (!sender) return null;

  return (
    <div>
      {/* Modal confirmation suppression sélection */}
      <Modal
        visible={confirmVisible}
        onDismiss={() => setConfirmVisible(false)}
        header="Confirmer la suppression"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmVisible(false)}>
                Annuler
              </Button>
              <Button
                variant="primary"
                loading={deleting}
                onClick={() => handleTrash(selectedItems.map((e) => e.id))}
              >
                Supprimer {selectedItems.length} mail(s)
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning">
          Vous allez mettre <strong>{selectedItems.length} mail(s)</strong> à la
          corbeille Gmail. Cette action est réversible depuis Gmail.
        </Alert>
      </Modal>

      {/* Modal confirmation suppression TOUS */}
      <Modal
        visible={confirmAllVisible}
        onDismiss={() => setConfirmAllVisible(false)}
        header="Supprimer TOUS les mails de cet expéditeur"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmAllVisible(false)}>
                Annuler
              </Button>
              <Button
                variant="primary"
                loading={deleting}
                onClick={() => handleTrash(emails.map((e) => e.id))}
              >
                Supprimer les {emails.length} mails
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning">
          Vous allez mettre <strong>TOUS les {emails.length} mails</strong> de{" "}
          <strong>{sender.from_name || sender.from_email}</strong> à la corbeille
          Gmail. Cette action est réversible depuis Gmail.
        </Alert>
      </Modal>

      {/* Message résultat */}
      {resultMessage && (
        <Box padding={{ bottom: "s" }}>
          <Alert
            type={resultMessage.type}
            dismissible
            onDismiss={() => setResultMessage(null)}
          >
            {resultMessage.content}
          </Alert>
        </Box>
      )}

      <Table
        {...collectionProps}
        items={items}
        columnDefinitions={COLUMN_DEFINITIONS}
        selectionType="multi"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) =>
          setSelectedItems(detail.selectedItems)
        }
        loading={loading}
        loadingText="Chargement des mails..."
        trackBy="id"
        variant="embedded"
        stickyHeader
        header={
          <Header
            variant="h3"
            counter={`(${emails.length} mails)`}
            description={sender.from_email}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={selectedItems.length === 0}
                  onClick={() => setConfirmVisible(true)}
                >
                  Supprimer la sélection ({selectedItems.length})
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setConfirmAllVisible(true)}
                  disabled={emails.length === 0}
                >
                  Supprimer tout ({emails.length})
                </Button>
              </SpaceBetween>
            }
          >
            {sender.from_name || sender.from_email}
          </Header>
        }
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Filtrer par objet..."
            countText={`${filteredItemsCount} résultat(s)`}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" color="inherit" padding="l">
            Aucun mail
          </Box>
        }
      />
    </div>
  );
}
