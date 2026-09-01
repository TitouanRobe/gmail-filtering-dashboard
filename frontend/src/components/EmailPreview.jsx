import { useEffect, useState } from "react";
import * as tokens from "@cloudscape-design/design-tokens";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import Alert from "@cloudscape-design/components/alert";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Badge from "@cloudscape-design/components/badge";
import CopyToClipboard from "@cloudscape-design/components/copy-to-clipboard";

import { fetchEmailDetail } from "../api";
import { useI18n } from "../i18n/I18nContext";
import { apiErrorMessage } from "../i18n/backendMessages";

const BODY_STYLES = `
  html, body { margin: 0; padding: 16px; background: #ffffff; }
  body {
    color: #16191f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
  }
  img, video, table { max-width: 100% !important; height: auto; }
  a { color: #0972d3; }
  pre { white-space: pre-wrap; font-family: inherit; margin: 0; }
`;

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Builds the document rendered inside the iframe.
 * The iframe is `sandbox=""` (no script, no access to the page) and a CSP
 * blocks remote images until the user allows them: a newsletter therefore
 * cannot track when the email is opened.
 */
function buildSrcDoc(email, showRemoteImages, emptyBodyText) {
  const imgSrc = showRemoteImages ? "data: https: http:" : "data:";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; media-src ${imgSrc}; font-src data:;`;
  const content = email.body_html
    ? email.body_html
    : `<pre>${escapeHtml(email.body_text || email.snippet || emptyBodyText)}</pre>`;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BODY_STYLES}</style></head><body>${content}</body></html>`;
}

function hasRemoteImages(email) {
  return /<img[^>]+src=["']?https?:/i.test(email?.body_html || "");
}

export default function EmailPreview({ emailId, height = 420, onTrash, trashing }) {
  const { t, formatDate, formatRelative } = useI18n();
  // The result is stored along with the id it belongs to: as long as the
  // displayed id differs from the loaded one, we know we are still loading.
  const [fetched, setFetched] = useState(null);
  const [imagesAllowedFor, setImagesAllowedFor] = useState(null);

  useEffect(() => {
    if (!emailId) return undefined;
    let cancelled = false;

    fetchEmailDetail(emailId)
      .then((data) => !cancelled && setFetched({ id: emailId, data }))
      .catch((e) => !cancelled && setFetched({ id: emailId, error: e }));

    return () => {
      cancelled = true;
    };
  }, [emailId]);

  const current = fetched?.id === emailId ? fetched : null;
  const email = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = Boolean(emailId) && !current;
  const showRemoteImages = imagesAllowedFor === emailId;

  const body = () => {
    if (!emailId) {
      return (
        <Box textAlign="center" color="text-body-secondary" padding={{ vertical: "xxl" }}>
          <SpaceBetween size="xs">
            <Box variant="strong" color="inherit">
              {t("preview.noSelectionTitle")}
            </Box>
            <Box variant="p" color="inherit">
              {t("preview.noSelectionDescription")}
            </Box>
          </SpaceBetween>
        </Box>
      );
    }

    if (loading) {
      return (
        <Box textAlign="center" padding={{ vertical: "xxl" }}>
          <SpaceBetween size="xs" alignItems="center">
            <Spinner size="large" />
            <Box color="text-body-secondary">{t("preview.loading")}</Box>
          </SpaceBetween>
        </Box>
      );
    }

    if (error) {
      return (
        <Alert type="error" header={t("preview.errorHeader")}>
          {apiErrorMessage(t, error)}
        </Alert>
      );
    }

    if (!email) return null;

    return (
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={2}
          items={[
            { label: t("preview.from"), value: email.from || t("common.empty") },
            { label: t("preview.to"), value: email.to || t("common.empty") },
            {
              label: t("preview.receivedAt"),
              value: (
                <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                  <span>{formatDate(email.date_iso, email.date || t("common.empty"))}</span>
                  <Box color="text-body-secondary" fontSize="body-s">
                    {formatRelative(email.date_iso)}
                  </Box>
                </SpaceBetween>
              ),
            },
            {
              label: t("preview.labels"),
              value:
                email.labels?.length > 0 ? (
                  <SpaceBetween direction="horizontal" size="xxs">
                    {email.labels.slice(0, 4).map((l) => (
                      <Badge key={l}>{l}</Badge>
                    ))}
                  </SpaceBetween>
                ) : (
                  t("common.empty")
                ),
            },
          ]}
        />

        {!showRemoteImages && hasRemoteImages(email) && (
          <Alert
            type="info"
            action={
              <Button onClick={() => setImagesAllowedFor(emailId)}>
                {t("preview.showImages")}
              </Button>
            }
          >
            {t("preview.remoteImagesBlocked")}
          </Alert>
        )}

        <div
          style={{
            border: `1px solid ${tokens.colorBorderDividerDefault}`,
            borderRadius: tokens.borderRadiusContainer,
            overflow: "hidden",
            background: "#ffffff",
          }}
        >
          <iframe
            title={email.subject || t("preview.iframeTitle")}
            srcDoc={buildSrcDoc(email, showRemoteImages, t("preview.emptyBody"))}
            sandbox=""
            referrerPolicy="no-referrer"
            style={{ display: "block", width: "100%", height, border: "none" }}
          />
        </div>
      </SpaceBetween>
    );
  };

  return (
    <Container
      header={
        <Header
          variant="h3"
          description={email?.subject ? undefined : t("preview.subtitle")}
          actions={
            email && (
              <SpaceBetween direction="horizontal" size="xs">
                <CopyToClipboard
                  copyButtonAriaLabel={t("preview.copySubject")}
                  copyErrorText={t("preview.copyError")}
                  copySuccessText={t("preview.copySuccess")}
                  textToCopy={email.subject || ""}
                  variant="icon"
                />
                <Button
                  iconName="external"
                  iconAlign="right"
                  href={`https://mail.google.com/mail/u/0/#all/${email.id}`}
                  target="_blank"
                >
                  {t("preview.openInGmail")}
                </Button>
                <Button
                  iconName="remove"
                  loading={trashing}
                  onClick={() => onTrash?.(email.id)}
                >
                  {t("preview.delete")}
                </Button>
              </SpaceBetween>
            )
          }
        >
          {email?.subject || t("preview.title")}
        </Header>
      }
    >
      {body()}
    </Container>
  );
}
