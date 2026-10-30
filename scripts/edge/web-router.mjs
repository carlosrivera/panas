const pagesOrigin = "https://carlosrivera.github.io";
const pagesPrefix = "/panas";

/** @param {Request} request */
export async function routeWebRequest(request, upstreamFetch = fetch) {
    const url = new URL(request.url);
    // Defense in depth: production has more-specific, no-Worker API routes.
    // Forward the original request intact so signed paths and streaming survive.
    if (/^\/(registry|accounting)(\/|$)/.test(url.pathname))
        return upstreamFetch(request);
    if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD" },
        });

    const upstream = new URL(pagesOrigin);
    upstream.pathname = `${pagesPrefix}${url.pathname}`;
    const headers = new Headers();
    for (const name of [
        "accept",
        "accept-encoding",
        "range",
        "if-none-match",
        "if-modified-since",
    ]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    // Never send API authorization, cookies or request bodies to GitHub Pages.
    const response = await upstreamFetch(upstream, {
        method: request.method,
        headers,
        redirect: "manual",
    });
    const outgoing = new Headers(response.headers);
    const location = outgoing.get("location");
    if (location) {
        const target = new URL(location, upstream);
        if (
            target.origin !== pagesOrigin ||
            !(
                target.pathname === pagesPrefix ||
                target.pathname.startsWith(`${pagesPrefix}/`)
            )
        ) {
            await response.body?.cancel();
            return new Response("Website unavailable", { status: 502 });
        }
        target.protocol = url.protocol;
        target.host = url.host;
        target.pathname = target.pathname.slice(pagesPrefix.length) || "/";
        target.search = url.search;
        outgoing.set("location", target.href);
    }
    outgoing.set("X-Panas-Web-Host", "github-pages");
    if (url.pathname === "/opengraph-image")
        outgoing.set("Content-Type", "image/png");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outgoing,
    });
}

export default {
    async fetch(request) {
        try {
            return await routeWebRequest(request);
        } catch {
            return new Response("Website unavailable", {
                status: 502,
                headers: { "Cache-Control": "no-store" },
            });
        }
    },
};
