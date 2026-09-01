import { useState } from "react";
import * as tokens from "@cloudscape-design/design-tokens";
import BarChart from "@cloudscape-design/components/bar-chart";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import SegmentedControl from "@cloudscape-design/components/segmented-control";

import { useI18n } from "../i18n/I18nContext";

const TOP_SIZES = [5, 10, 20];

/** Short, unique label for the category axis. */
function buildLabels(senders) {
  const counts = new Map();
  for (const s of senders) {
    const base = s.from_name || s.from_email.split("@")[0];
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return senders.map((s) => {
    const base = s.from_name || s.from_email.split("@")[0];
    return counts.get(base) > 1 ? `${base} (${s.from_email})` : base;
  });
}

export default function SenderChart({ senders, onSelect }) {
  const { t, formatNumber } = useI18n();
  const [topN, setTopN] = useState("10");

  const top = senders.slice(0, Number(topN));
  const labels = buildLabels(top);
  const byLabel = new Map(labels.map((label, i) => [label, top[i]]));

  const series = [
    {
      title: t("chart.series"),
      type: "bar",
      data: top.map((s, i) => ({ x: labels[i], y: s.count })),
      color: tokens.colorChartsPaletteCategorical1,
    },
  ];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={t("chart.description")}
          actions={
            <SegmentedControl
              selectedId={topN}
              onChange={({ detail }) => setTopN(detail.selectedId)}
              options={TOP_SIZES.map((size) => ({
                id: String(size),
                text: t("chart.topN", { count: size }),
              }))}
              label={t("chart.senderCountLabel")}
            />
          }
        >
          {t("chart.title")}
        </Header>
      }
    >
      <BarChart
        series={series}
        height={Math.max(260, top.length * 28)}
        xTitle={t("chart.xTitle")}
        yTitle={t("chart.yTitle")}
        ariaLabel={t("chart.ariaLabel")}
        hideFilter
        hideLegend
        horizontalBars
        xScaleType="categorical"
        detailPopoverFooter={(x) => {
          const sender = byLabel.get(x);
          if (!sender) return null;
          return (
            <Box>
              <Box color="text-body-secondary" fontSize="body-s" padding={{ bottom: "xxs" }}>
                {sender.from_email} — {t("common.emailCount", { count: sender.count })}
              </Box>
              <Button variant="inline-link" onClick={() => onSelect?.(sender)}>
                {t("chart.viewEmails")}
              </Button>
            </Box>
          );
        }}
        yTickFormatter={(value) => formatNumber(value)}
        empty={
          <Box textAlign="center" color="inherit" padding={{ vertical: "l" }}>
            {t("chart.empty")}
          </Box>
        }
        noMatch={
          <Box textAlign="center" color="inherit" padding={{ vertical: "l" }}>
            {t("common.noResults")}
          </Box>
        }
      />
    </Container>
  );
}
