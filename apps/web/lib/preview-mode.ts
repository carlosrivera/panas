export function isFixturePreview(): boolean {
    return (
        process.env.NODE_ENV === "development" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("preview") ===
            "fixtures"
    );
}
