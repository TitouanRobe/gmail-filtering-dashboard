import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";

import SendersTable from "../components/SendersTable";
import { useAppData } from "../context/AppDataContext";
import { useI18n } from "../i18n/I18nContext";

export default function SendersPage() {
  const { senders, loading, stats, setSelectedSender, queueTrashSenders } = useAppData();
  const { t } = useI18n();

  return (
    <ContentLayout
      header={
        <Header variant="h1" description={t("senders.pageDescription")}>
          {t("senders.title")}
        </Header>
      }
    >
      <SendersTable
        senders={senders}
        loading={loading}
        totalEmails={stats?.total_emails ?? 0}
        onOpenSender={setSelectedSender}
        onTrashSenders={queueTrashSenders}
      />
    </ContentLayout>
  );
}
