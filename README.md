[README.md](https://github.com/user-attachments/files/33608970/README.md)
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
