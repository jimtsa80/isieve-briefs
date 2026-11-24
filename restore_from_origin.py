#!/usr/bin/env python3
"""
Restore corrupted files from Origin repository using cursor-origin MCP responses.
This script writes the base64-decoded content and verifies blob SHA matches.
"""
import base64
import hashlib
import subprocess
import sys

# Map of files with their base64 content from Origin
# Format: path: (base64_content, expected_sha)

files_to_restore = {
    "js/brief.js": "f5218c1c1b2f67946588de7b835c14b4f657f217",
    "js/upload.js": "PLACEHOLDER_SHA",  # Will get from Origin
}

# Already have app.js restored - verify it
app_js_expected = "c8ddd402668272636d3a26bb01ae81929da4302d"

def git_hash_object(filepath):
    """Calculate git blob SHA for a file"""
    try:
        result = subprocess.run(
            ['git', 'hash-object', filepath],
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        return f"ERROR: {e}"

def write_file_from_base64(filepath, content_b64):
    """Write file from base64 content"""
    decoded = base64.b64decode(content_b64)
    with open(filepath, 'wb') as f:
        f.write(decoded)
    print(f"✓ Wrote {filepath}")

# Verify app.js (already restored)
app_sha = git_hash_object('js/app.js')
print(f"\nVerifying js/app.js:")
print(f"  Expected: {app_js_expected}")
print(f"  Got:      {app_sha}")
print(f"  Match: {app_sha == app_js_expected}")

if __name__ == '__main__':
    print("\nTo complete restoration, need to:")
    print("1. Get js/brief.js and js/upload.js from Origin via MCP")
    print("2. Write decoded content")
    print("3. Verify SHAs match")
