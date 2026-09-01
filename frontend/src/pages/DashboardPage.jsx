import { useNavigate } from "react-router-dom";

import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Container from "@cloudscape-design/components/container";
import Box from "@cloudscape-design/components/box";
import Grid from "@cloudscape-design/components/grid";
import Button from "@cloudscape-design/components/button";

import SenderChart from "../components/SenderChart";
import { useAppData } from "../context/AppDataContext";
import { useI18n } from "../i18n/I18nContext";

function StatsCard({ label, value, hint }) {
  const { formatNumber } = useI18n();

  return (
    <Container>
      <SpaceBetween size="xxxs">
        <Box variant="awsui-key-label">{label}</Box>
        <Box variant="h1" padding="n">
          {formatNumber(value)}
        </Box>
        <Box variant="small" color="text-body-secondary">
          {hint}
        </Box>
      </SpaceBetween>
    </Container>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { stats, senders, account, setSelectedSender, topSender } = useAppData();
  const { t, formatPercent } = useI18n();

  const topSenderHint = stats?.top_sender
    ? t("dashboard.topSenderHint", {
        email: topSender?.from_email ?? stats.top_sender.email,
        emails: t("common.emailCount", { count: stats.top_sender.count }),
        share: formatPercent(stats.top_sender.count / Math.max(stats.total_emails, 1)),
      })
    : t("dashboard.noData");

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            account
              ? t("dashboard.descriptionWithAccount", { account })
              : t("dashboard.description")
          }
          actions={
            <Button iconName="filter" onClick={() => navigate("/senders")}>
              {t("dashboard.viewAllSenders")}
            </Button>
          }
        >
          {t("dashboard.title")}
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Grid
          gridDefinition={[
            { colspan: { default: 12, xs: 4 } },
            { colspan: { default: 12, xs: 4 } },
            { colspan: { default: 12, xs: 4 } },
          ]}
        >
          <StatsCard
            label={t("dashboard.totalEmails")}
            value={stats?.total_emails ?? t("common.empty")}
            hint={t("dashboard.totalEmailsHint")}
          />
          <StatsCard
            label={t("dashboard.uniqueSenders")}
            value={stats?.unique_senders ?? t("common.empty")}
            hint={t("dashboard.uniqueSendersHint")}
          />
          <StatsCard
            label={t("dashboard.topSender")}
            value={
              topSender ? topSender.from_name || topSender.from_email : t("common.empty")
            }
            hint={topSenderHint}
          />
        </Grid>

        <SenderChart senders={senders} onSelect={setSelectedSender} />
      </SpaceBetween>
    </ContentLayout>
  );
}
