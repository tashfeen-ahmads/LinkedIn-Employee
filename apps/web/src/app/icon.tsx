import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** The same mark as the header, so a browser tab matches the page it opened. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2.5,
          background: "#3730E8",
          borderRadius: 7,
        }}
      >
        <div style={{ width: 17, height: 3, borderRadius: 2, background: "rgba(255,255,255,.95)" }} />
        <div style={{ width: 13, height: 3, borderRadius: 2, background: "rgba(255,255,255,.75)" }} />
        <div style={{ width: 8, height: 3, borderRadius: 2, background: "#12A5A0" }} />
      </div>
    ),
    size,
  );
}
