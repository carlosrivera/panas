export const handler = async () => ({
    statusCode: 200,
    headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
    },
    body: JSON.stringify({
        service: "panas-control-plane",
        status: "foundation",
        payments: "test-credits-only",
    }),
});
