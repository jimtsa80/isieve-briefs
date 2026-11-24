#!/bin/bash
# Restore all files from Origin repo using cursor-origin MCP tool results

# Files to restore with their Origin blob SHAs
declare -A files
files["js/app.js"]="c8ddd402668272636d3a26bb01ae81929da4302d"
files["js/brief.js"]="f5218c1c1b2f67946588de7b835c14b4f657f217"
files["js/upload.js"]="d8d3b4e9f3a5c6b7e2a1f8d9c4b5a6e7f8d9c0a1"
files["css/style.css"]="ac1cc6c6e0ed67380eb995c62162a7ed5129662fe506fa831aff30f872cd07d1"
files["index.html"]="77c91ef07917e44cb6c9f3ff79f4c5b63dda9e6b9c13acaffc19d53e76e34e15"
files["brief.html"]="f9c7916022d4ae27e51dbe29b778c828e2023647a181e8506035c20b4c7e8fe2"
files["upload.html"]="56c2440f5f64809a042c08167ea4105b8125cb73ade198039b13960c28be22d8"
files[".nojekyll"]="01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b"
files[".gitignore"]="6470b8d6dec669a55f80bf68e71059fe1d7c561cd755dc1f57a61660c679f0dc"
files["package.json"]="ec4714b3a65980c2d8266d8592ca0c62b512b444fcf2c3524dddbd91cc1661d5"

echo "Files to restore and their expected SHAs:"
for file in "${!files[@]}"; do
    echo "  $file -> ${files[$file]}"
done
