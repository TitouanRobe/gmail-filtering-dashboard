import { useState, useEffect } from "react";
import "@cloudscape-design/global-styles/index.css";
import { applyMode, Mode } from "@cloudscape-design/global-styles";

import AppLayout from "@cloudscape-design/components/app-layout";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Container from "@cloudscape-design/components/container";
import Box from "@cloudscape-design/components/box";
import Grid from "@cloudscape-design/components/grid";
import Button from "@cloudscape-design/components/button";
import Flashbar from "@cloudscape-design/components/flashbar";
import Modal from "@cloudscape-design/components/modal";
import Toggle from "@cloudscape-design/components/toggle";

import SendersTable from "./components/SendersTable";
import SenderChart from "./components/SenderChart";
import EmailsPanel from "./components/EmailsPanel";
import { fetchStats, fetchSenders } from "./api";

function StatsCard({ title, value }) {
  return (
    <Container>
      <Box variant="awsui-key-label">{title}</Box>
      <Box variant="h1" padding={{ top: "xxs" }}>
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          <span>{typeof value === "number" ? value.toLocaleString("fr-FR") : value}</span>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

export default function App() {
  const [stats, setStats] = useState(null);
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSender, setSelectedSender] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [flashItems, setFlashItems] = useState([]);
  const [darkMode, setDarkMode] = useState(true);

  // Appliquer le dark mode au chargement
  useEffect(() => {
    applyMode(Mode.Dark);
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    applyMode(newMode ? Mode.Dark : Mode.Light);
  };

  const loadData = async () => {
    setLoading(true);
    setFlashItems([]);
    try {
      const [s, snd] = await Promise.all([fetchStats(), fetchSenders()]);
      setStats(s);
      setSenders(snd);
    } catch (e) {
      setFlashItems([
        {
          type: "error",
          content: `Erreur : ${e.message}. Vérifiez que le backend est lancé sur le port 8000.`,
          dismissible: true,
          onDismiss: () => setFlashItems([]),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelect = (sender) => {
    setSelectedSender(sender);
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setSelectedSender(null);
  };

  return (
    <>
      {/* Modal des mails d'un expéditeur */}
      <Modal
        visible={modalVisible}
        onDismiss={handleCloseModal}
        size="max"
        header={
          selectedSender
            ? `${selectedSender.from_name || selectedSender.from_email}`
            : "Mails"
        }
      >
        {selectedSender && (
          <EmailsPanel sender={selectedSender} onClose={handleCloseModal} />
        )}
      </Modal>

      <AppLayout
        contentType="default"
        navigationHide
        toolsHide
        notifications={<Flashbar items={flashItems} />}
        content={
          <ContentLayout
            header={
              <Header
                variant="h1"
                actions={
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <button
                      onClick={toggleDarkMode}
                      aria-label={darkMode ? "Mode clair" : "Mode sombre"}
                      style={{
                        background: "none",
                        border: `2px solid ${darkMode ? "#42b4ff" : "#0972d3"}`,
                        borderRadius: 15,
                        cursor: "pointer",
                        padding: 5,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      <img
                        src={darkMode ? "/svg/sun-solid-full.svg" : "/svg/moon-solid-full.svg"}
                        alt={darkMode ? "Mode clair" : "Mode sombre"}
                        style={{ width: 22, height: 22 }}
                      />
                    </button>
                    <Button iconName="refresh" onClick={loadData} loading={loading}>
                      Actualiser
                    </Button>
                  </SpaceBetween>
                }
                description="Analyse des expéditeurs de votre boîte Gmail"
              >
                Gmail Dashboard
              </Header>
            }
          >
            <SpaceBetween size="l">
              {/* Stats cards */}
              {stats && (
                <Grid
                  gridDefinition={[
                    { colspan: 4 },
                    { colspan: 4 },
                    { colspan: 4 },
                  ]}
                >
                  <StatsCard
                    title="Total mails analysés"
                    value={stats.total_emails}
                  />
                  <StatsCard
                    title="Expéditeurs uniques"
                    value={stats.unique_senders}
                  />
                  <StatsCard
                    title="Plus gros expéditeur"
                    value={`${stats.top_sender.email.split("@")[0]} (${stats.top_sender.count})`}
                  />
                </Grid>
              )}

              {/* Bar chart */}
              {senders.length > 0 && <SenderChart senders={senders} />}

              {/* Table */}
              <SendersTable
                senders={senders}
                loading={loading}
                onSelect={handleSelect}
              />
            </SpaceBetween>
          </ContentLayout>
        }
      />
    </>
  );
}
