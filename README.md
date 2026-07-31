# AKD VaultPDF — MCP server

mcp-name: io.github.LifeAbundantly/akd-vaultpdf

**Document tools that run on the user's own machine.** Your files are read where they already
are. Nothing is uploaded, there is no account, and there is no server holding a copy.

```bash
npx akd-vaultpdf-mcp
```

## What it does

| tool | what it does |
|---|---|
| `pdf_pages` | Page count and per-page text length of a local PDF. |
| `pdf_find` | Every occurrence of a phrase across a local PDF — page numbers and the line. |
| `redact_plan` | For a local PDF and a list of terms, how many occurrences would be blacked out on each page, before anything is changed. |
| `score_resume` | Scores a local resume PDF against a job posting: coverage, the missing terms, and format flags. |
| `column_stats` | Sum, average, min and max of a column in a local CSV. |

## The thing worth knowing before you use it

**It refuses rather than guessing.** Point `column_stats` at a column of dates and it declines
and says why, instead of parsing the years and handing back a confident `1,013,000`. Measured
on a 500-row invoice file: the amount column totals **2,413,791.56**, matching Python to the
cent; the date column and the invoice-ID column are both **refused**.

Currency and accounting notation are understood — `$2,150.00` reads as `2150`, and `(1,234.50)`
reads as `-1234.5`, because a bracketed number in a ledger is a negative.

## Why there is no free tier here

The browser version gives three free runs. This one gives none, and that is deliberate.

Three free runs is an honest enough gate for a person: the counter survives closing the tab,
and anyone opening devtools to dodge $2.22 was never going to pay. **It is worthless against
an agent.** An MCP client is an AI with a shell — clearing a counter is one tool call, and it
will do it without malice, simply because that is cheaper than asking.

So the licence is checked server-side against Stripe's own record of the payment. **Unlicensed,
`tools/list` returns an empty list** and every call returns an error. There is nothing to meter
and nothing to reset.

A pass is **$2.22 for a day**, $5.55 a week, $16 a month, and the day and week passes do not
renew. Buy one at <https://still-wildflower-dc6f.akdmediax.workers.dev/#pricing>.

## Setup

```json
{
  "mcpServers": {
    "akd-vaultpdf": {
      "command": "npx",
      "args": ["-y", "akd-vaultpdf-mcp"],
      "env": { "VAULTPDF_SESSION": "cs_...your checkout session id..." }
    }
  }
}
```

The session id comes back in the success URL after you buy a pass. It is exchanged once for a
licence token, which is cached at `~/.vaultpdf/licence.json`; after that the session id is no
longer needed. The token is checked against the server on every start, so a cached token that
has expired fails honestly rather than half-working.

## What it does not do

It does not upload your files, so it cannot work on files it cannot reach — this reads the
local filesystem, and a remote MCP server could not do this job at all. It does not sign in
anywhere on your behalf. It has no telemetry.

---

AKD VaultPDF by AKDmediaX · <https://still-wildflower-dc6f.akdmediax.workers.dev/>
