#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
pnpm release:bundle
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("dist/panas-cli/package.json"));if(p.dependencies["@mcpwire/cli"]!=="1.1.3")process.exit(1)'
npm install --prefix dist/panas-cli --omit=dev --ignore-scripts --no-audit --no-fund
revision=$(node -p 'require("./dist/panas-cli/release.json").sourceCommit')
dirty=$(node -p 'require("./dist/panas-cli/release.json").sourceDirty')
version=$(node -p 'require("./dist/panas-cli/release.json").version')
docker build --platform linux/arm64 -f docker/Dockerfile --build-arg "SOURCE_COMMIT=$revision" --build-arg "SOURCE_DIRTY=$dirty" -t "${PANAS_SANDBOX_BUILD_TAG:-panas-provider:$version}" dist/panas-cli
