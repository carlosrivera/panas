/** Append a service-relative path without discarding a mounted base path. */
export function serviceUrl(base: string | URL, path: string): URL {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return new URL(path.replace(/^\/+/, ""), url);
}
