import { ImageResponse } from "next/og";

export const alt = "Panas — Your agent needs compute. Your pana has it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
    return new ImageResponse(
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                backgroundColor: "#0b0b0a",
                color: "#edede6",
                padding: "64px 72px",
                fontFamily: "sans-serif",
                borderTop: "8px solid #c5f74f",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>
                    panas<span style={{ color: "#c5f74f" }}>_</span>
                </div>
                <div
                    style={{ display: "flex", fontSize: 20, color: "#a3a39a" }}
                >
                    spare compute, between panas.
                </div>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    fontSize: 72,
                    fontWeight: 700,
                    lineHeight: 1.12,
                    letterSpacing: "-3px",
                }}
            >
                <span>Your agent needs compute.</span>
                <span style={{ color: "#c5f74f" }}>Your pana has it.</span>
            </div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    borderTop: "1px solid #45453e",
                    paddingTop: 24,
                    fontSize: 21,
                }}
            >
                <span>encrypted p2p · agent-native MCP · free or paid</span>
                <span style={{ color: "#c5f74f" }}>panas.mcpwire.co</span>
            </div>
        </div>,
        size,
    );
}
