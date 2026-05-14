import BarChart from "@cloudscape-design/components/bar-chart";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";

export default function SenderChart({ senders }) {
  const top10 = senders.slice(0, 10);

  const series = [
    {
      title: "Nombre de mails",
      type: "bar",
      data: top10.map((s) => ({
        x: s.from_name || s.from_email.split("@")[0],
        y: s.count,
      })),
      color: "#0972d3",
    },
  ];

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Les 10 expéditeurs avec le plus de mails"
        >
          Top 10 expéditeurs
        </Header>
      }
    >
      <BarChart
        series={series}
        height={300}
        xTitle="Expéditeur"
        yTitle="Nombre de mails"
        hideFilter
        horizontalBars
        xScaleType="categorical"
        empty={
          <Box textAlign="center" color="inherit" padding="l">
            Aucune donnée
          </Box>
        }
        noMatch={
          <Box textAlign="center" color="inherit" padding="l">
            Aucun résultat
          </Box>
        }
      />
    </Container>
  );
}
