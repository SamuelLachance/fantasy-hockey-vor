import { ImageResponse } from "next/og";
import { PROJECTION_SEASON } from "@/lib/nhl-api";
import { SITE_BRAND } from "@/lib/site";

export const dynamic = "force-static";
export const alt = `${SITE_BRAND} rankings`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Build-time Open Graph / Twitter share image (static export friendly). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(145deg, #020617 0%, #0f172a 55%, #083344 100%)",
          padding: 72,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            color: "#67e8f9",
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 48,
              height: 48,
              borderRadius: 12,
              border: "2px solid #38bdf8",
              alignItems: "center",
              justifyContent: "center",
              color: "#38bdf8",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ display: "flex" }}>{SITE_BRAND}</div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#f8fafc",
              fontSize: 72,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            {PROJECTION_SEASON} ML VOR Rankings
          </div>
          <div
            style={{
              display: "flex",
              color: "#94a3b8",
              fontSize: 30,
              lineHeight: 1.35,
            }}
          >
            Stacked ensemble · draft Edge · calibrated uncertainty
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
