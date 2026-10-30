/** PostgreSQL statement boundaries; keep quoted function bodies and comments intact.
 * Migration files retain their original checksum. standard_conforming_strings stays on.
 */
export function sqlStatements(sql: string): string[] {
    const statements: string[] = [];
    let start = 0,
        mode: "plain" | "single" | "double" | "line" | "block" | "dollar" =
            "plain",
        tag = "",
        depth = 0,
        hasSql = false,
        escape = false;
    for (let i = 0; i < sql.length; i++) {
        const c = sql[i]!,
            next = sql[i + 1];
        if (mode === "line") {
            if (c === "\n") mode = "plain";
            continue;
        }
        if (mode === "block") {
            if (c === "/" && next === "*") {
                depth++;
                i++;
            } else if (c === "*" && next === "/") {
                i++;
                if (--depth === 0) mode = "plain";
            }
            continue;
        }
        if (mode === "dollar") {
            if (sql.startsWith(tag, i)) {
                i += tag.length - 1;
                mode = "plain";
            }
            continue;
        }
        if (mode === "single") {
            if (escape && c === "\\") {
                i++;
                continue;
            }
            if (c === "'") {
                if (next === "'") i++;
                else mode = "plain";
            }
            continue;
        }
        if (mode === "double") {
            if (c === '"') {
                if (next === '"') i++;
                else mode = "plain";
            }
            continue;
        }
        if (c === "-" && next === "-") {
            mode = "line";
            i++;
            continue;
        }
        if (c === "/" && next === "*") {
            mode = "block";
            depth = 1;
            i++;
            continue;
        }
        if (c === ";") {
            if (hasSql) statements.push(sql.slice(start, i).trim());
            start = i + 1;
            hasSql = false;
            continue;
        }
        if (!/\s/.test(c)) hasSql = true;
        if (c === "'") {
            escape =
                (sql[i - 1] === "E" || sql[i - 1] === "e") &&
                !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? "");
            mode = "single";
        } else if (c === '"') mode = "double";
        else if (c === "$" && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
            const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (match) {
                tag = match[0];
                i += tag.length - 1;
                mode = "dollar";
            }
        }
    }
    if (mode !== "plain" && mode !== "line")
        throw new Error("Unterminated SQL migration quote or comment");
    if (hasSql) statements.push(sql.slice(start).trim());
    return statements;
}
