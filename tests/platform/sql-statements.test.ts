import { it, expect } from "vitest";
import { sqlStatements } from "../../scripts/sql-statements";
it("keeps PL/pgSQL function bodies together while splitting following trigger statements", () => {
    const body =
        "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF true THEN RAISE EXCEPTION 'quoted; text'; END IF; RETURN NEW; END $fn$";
    expect(
        sqlStatements(
            `${body}; DROP TRIGGER IF EXISTS t ON x; CREATE TRIGGER t BEFORE INSERT ON x EXECUTE FUNCTION f();`,
        ),
    ).toEqual([
        body,
        "DROP TRIGGER IF EXISTS t ON x",
        "CREATE TRIGGER t BEFORE INSERT ON x EXECUTE FUNCTION f()",
    ]);
});
it("handles identifiers, escaped/doubled quotes, positional parameters and nested comments", () => {
    const first = String.raw`SELECT E'escaped\';value', 'doubled'';value', "column;name", $1`;
    expect(
        sqlStatements(
            `${first}; /* outer; /* inner; */ end; */ SELECT 2; -- trailing;`,
        ),
    ).toEqual([first, "/* outer; /* inner; */ end; */ SELECT 2"]);
    expect(sqlStatements("-- nothing;\n/* no statement; */")).toEqual([]);
});
it.each(["SELECT 'open", "DO $$ BEGIN;", "/* unfinished"])(
    "rejects incomplete migrations: %s",
    (sql) => expect(() => sqlStatements(sql)).toThrow("Unterminated"),
);
