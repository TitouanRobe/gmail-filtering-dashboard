import * as tokens from "@cloudscape-design/design-tokens";

import { useI18n } from "../i18n/I18nContext";

/**
 * Proportion bar aligned on the Cloudscape tokens (so it reads correctly in
 * both light and dark mode).
 *
 * @param ratio  Bar length, relative to the biggest sender (0 → 1).
 * @param label  Value shown on the right, as a share of the mailbox (0 → 1).
 */
export default function ProportionBar({ ratio = 0, label = 0 }) {
  const { formatPercent } = useI18n();
  const width = Math.max(2, Math.min(100, ratio * 100));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: tokens.spaceScaledXs }}>
      <div
        style={{
          flex: 1,
          minWidth: 60,
          height: 8,
          borderRadius: tokens.borderRadiusBadge,
          background: tokens.colorBackgroundInputDisabled,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${width}%`,
            borderRadius: tokens.borderRadiusBadge,
            background: tokens.colorChartsPaletteCategorical1,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span
        style={{
          color: tokens.colorTextBodySecondary,
          fontSize: tokens.fontSizeBodyS,
          fontVariantNumeric: "tabular-nums",
          minWidth: 48,
          textAlign: "right",
        }}
      >
        {formatPercent(label)}
      </span>
    </div>
  );
}
