#!/bin/sh
# Rendered as a versioned release asset by release:pack. No sudo or shell-profile edits.
set -eu
umask 077
version='__PANAS_VERSION__'
sha256='__PANAS_SHA256__'
commit='__PANAS_COMMIT__'
base="https://github.com/carlosrivera/panas/releases/download/v$version"
fail() { printf '%s\n' "$1" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail 'Install Node.js 24 first.'
command -v npm >/dev/null 2>&1 || fail 'npm bundled with Node.js 24 is required.'
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || fail 'Use Node.js 24.'
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
root=${PANAS_INSTALL_DIR:-"$HOME/.local/share/panas"}
bin=${PANAS_BIN_DIR:-"$HOME/.local/bin"}
case "$root:$bin" in /*:/*) ;; *) fail 'Installation paths must be absolute.' ;; esac
mkdir -p "$root/releases" "$bin"
release="$root/releases/$version"
work=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM
if [ ! -d "$release" ]; then
    artifact="panas-cli-$version.tgz"
    curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$base/$artifact" --output "$work/$artifact"
    node -e 'const fs=require("node:fs"),c=require("node:crypto");if(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex")!==process.argv[2]){console.error("Release checksum mismatch; nothing installed.");process.exit(1)}' "$work/$artifact" "$sha256"
    npm install --prefix "$work/package" --omit=dev --no-audit --no-fund --package-lock=false "$work/$artifact" >&2
    node -e 'const r=require(process.argv[1]);if(r.version!==process.argv[2]||r.sourceCommit!==process.argv[3])process.exit(1)' "$work/package/node_modules/@panas/cli/release.json" "$version" "$commit"
    node - "$work/package" "$release" <<'JS'
const fs=require('node:fs'), path=require('node:path');
const quote=value=>"'"+value.replaceAll("'", "'\\''")+"'";
const destination=process.argv[2], final=process.argv[3];
const cli=path.join(final,'node_modules/@panas/cli/bin/panas.js');
fs.writeFileSync(path.join(destination,'panas'), '#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(cli)+' "$@"\n', {mode:0o755,flag:'wx'});
JS
    mv "$work/package" "$release"
fi
node -e 'const r=require(process.argv[1]);if(r.version!==process.argv[2]||r.sourceCommit!==process.argv[3]){console.error("Existing release metadata mismatch.");process.exit(1)}' "$release/node_modules/@panas/cli/release.json" "$version" "$commit"
if [ -e "$bin/panas" ] || [ -L "$bin/panas" ]; then
    [ -L "$bin/panas" ] || fail 'Refusing to overwrite an existing panas executable.'
    case "$(readlink "$bin/panas")" in "$root"/releases/*/panas) ;; *) fail 'Existing panas link belongs to another installation.' ;; esac
fi
ln -s "$release/panas" "$work/panas"
mv -f "$work/panas" "$bin/panas"
printf '\nInstalled Panas %s\nProvider: %s/panas provider\nBuyer MCP config: %s/panas mcp-config\nDemo prompt: %s/panas demo-prompt\n' "$version" "$bin" "$bin" "$bin"
printf '%s\n' 'Configure owner files under ~/.config/panas first. Provider runs natively with process supervision, without an OS sandbox.'
