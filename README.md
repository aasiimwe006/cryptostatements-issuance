# cryptostatements-issuance

The daily on-chain issuance archive behind the CRYPTO STATEMENTS Reserve Monitor: mint, burn,
freeze, wipe and pause events from the USDC, USDT and PAXG contracts on Ethereum.

- **index.json** (this repository, served by GitHub Pages): daily totals, and the address of every day's file.
- **Releases** `issuance-YYYY-MM`: one file per UTC day (`YYYY-MM-DD.json`, format rows-v1: columns named once in `cols`, one event per line), and after the month ends, `issuance-YYYY-MM.json.gz` with the whole month.
- **Workflows**: `daily.yml` (00:23 UTC, the previous day) and `monthly.yml` (the 1st, 02:11 UTC, the previous month). Both can be run by hand.
- **Secret** `ISSUANCE_RPCS`: the Ethereum node URL (with its key) the daily run reads from.

Primary on-chain facts only, never interpretation. USDC mints and burns on Ethereum include
cross-chain transfers (Circle's CCTP); they show the supply on Ethereum, not issuance or
redemption of the whole token.


## Daily supply readings (r147)

`supply.json` holds one reading per UTC day of `totalSupply()` for USDC, USDT, PAXG, EURC, PYUSD, RLUSD, XAU₮ (key `XAUT`) and BUIDL (two addresses BlackRock lists, keys `BUIDL:0x7712` and `BUIDL:0x6a9d`, never added together) on Ethereum, taken by the daily workflow just after midnight UTC at the latest block, with the block number and block time. Each address is the one the issuer publishes (listed under `tokens` with its source page). It is the supply on Ethereum at that block: not the issue across chains, not a market value, not a reserve check. EURC and PYUSD are also in the daily event archive from r147.


From r152, each reading also carries RLUSD on the XRP Ledger (key `RLUSD:XRPL`): the issuer account's obligations from `gateway_balances` at a validated ledger (issuer rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De, as Ripple publishes it), with the ledger index under `xrpl`. RLUSD's Ethereum mints and burns join the daily event archive, read as Transfer events from or to the zero address.

From r153, XAU₮ is also read on BNB Smart Chain (key `XAUT:BSC`, address 0x21cAef8A43163Eea865baeE23b9C2E327696A3bf as Tether publishes it), with that chain's block under `bsc`. Each chain is its own figure; chains are never added together.


## Official source registry (r178, AP28)

`sources.json` lists the official sources used in the AP23 regional audits: UAE, UK, EU, Hong Kong, Singapore, US and Africa, with 39 authorities. For each authority it gives the list page that was read, how it reads (`automated`, `founder-checked` when the site blocks automated reading and the founder supplied the text, `partial`, or `blocked`), what was found and excluded, the limits, the source pages behind each record, and the archive records it produced. It is built from the Coverage page's authority-audit panels, and only pages actually read are listed. It is the source list the disclosure watcher (AP12) will read. It does not contain prices, readings or interpretation.

## bStocks (bstocks.json, bstocks_prices.json)

`bstocks.json` is the record side: the issuer's weekly ADGM filing of certificates outstanding per ticker, daily `totalSupply()` on BNB Chain for tokens whose address the issuer group has published, the supply rebuilt at each Friday 23:59:59 UTC, and the comparison of the two (`tools/bstocks.mjs`). The shares at the custodian are not checked; no periodic independent attestation of them is published.

`bstocks_prices.json` is market context, kept apart: the daily candles of each bStock that trades on Binance Spot against USDT, as the exchange records them, one row per completed UTC day (`[date, open, high, low, close, quote volume in USDT, trades]`), backfilled from a pair's first day and appended daily (`tools/bstocks_prices.mjs`). It lists the disclosed tickers with no Spot pair and the day a new pair is first seen. It is not a valuation and is not compared with the US share price.

## Exchange Register re-read (r219)

`exchanges.json` is the Exchange Register as the site publishes it (copied here from the site build).
`tools/registers.mjs` runs nightly in the daily workflow and checks every licence row against the
regulator's own page: the ESMA MiCA CASP file (LEI and name), VARA (reference and name), SFC and NYDFS
(name) and each FSRA, DFSA or CFTC firm page (name). It writes `registers.json`: the last day each row
was found, and `missing_since` for a row not found. Nothing is removed or relabelled automatically;
rows not found and new MiCA providers naming a tracked exchange are listed under `review` for a person
to check. The Japan FSA list is a PDF and is read by hand. Update `exchanges.json` whenever the site's
register changes.
