import { ImageResponse } from "next/og";
import { SITE_BRAND } from "@/lib/site";

export const dynamic = "force-static";
export const alt = `${SITE_BRAND} — mes ligues de hockey fantasy`;
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
          background: "linear-gradient(145deg, #020617 0%, #0f172a 55%, #083344 100%)",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
            Mes ligues de hockey fantasy
          </div>
          <div style={{ display: "flex", color: "#94a3b8", fontSize: 30, lineHeight: 1.35 }}>
            Alignements · repêchages · joueurs · opinions de Snake
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
