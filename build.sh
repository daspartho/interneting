#!/bin/sh
# Makes site/: the canvas online, the exact files to put at its address (in
# extension/canvases.js), with the add-on beside it as extension.zip.
# The add-on's name is the canvas's: the <title> of app/index.html. It also
# refreshes extension/inject.js, the add-on's copy of app/inject.js.
set -eu
cd "$(dirname "$0")"
NAME=$(sed -n 's:.*<title>\(.*\)</title>.*:\1:p' app/index.html)

# the add-on's own copy of inject.js, for pages that refuse the canvas's (see background.js)
cp app/inject.js extension/inject.js

rm -rf site
mkdir site
for f in index.html app.js style.css sound.js inject.js bangs.json tlds.txt suffixes.txt; do cp "app/$f" site/; done
cp -R app/fonts site/ # (DM Mono, the printed type: OFL, its licence beside it)

# the zip holds one folder, named as the add-on
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/$NAME"
cp extension/manifest.json extension/*.js "$tmp/$NAME/"
node -e '
const fs = require("fs")
const [file, name] = process.argv.slice(1)
const m = JSON.parse(fs.readFileSync(file, "utf8"))
fs.writeFileSync(file, JSON.stringify({ ...m, name }, null, 2) + "\n")
' "$tmp/$NAME/manifest.json" "$NAME"
(cd "$tmp" && zip -qrX extension.zip "$NAME")
mv "$tmp/extension.zip" site/

echo "site/: $(ls site | tr '\n' ' ')"
echo "goes at: $(sed -n "s:^ *'\(https\:[^']*\)'.*:\1:p" extension/canvases.js | head -1)"
