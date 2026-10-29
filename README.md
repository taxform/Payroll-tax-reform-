name: Daily IRS Tax Updates

on:
  schedule:
    - cron: '0 11 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check-tax-updates:
    runs-on: ubuntu-latest

    steps:
      - name: Download website files
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Check official IRS newsroom
        run: |
          python - <<'PY'
          import urllib.request

          url = "https://www.irs.gov/newsroom"

          req = urllib.request.Request(
              url,
              headers={
                  "User-Agent": "Mozilla/5.0"
              }
          )

          with urllib.request.urlopen(req, timeout=30) as response:
              content = response.read().decode(
                  "utf-8", errors="replace"
              )

          if "Internal Revenue Service" not in content:
              raise RuntimeError("Unexpected IRS page content")

          print("SUCCESS: IRS Newsroom is accessible.")
          print("Downloaded", len(content), "characters.")
          PY
