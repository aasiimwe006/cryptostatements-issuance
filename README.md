[README.md](https://github.com/user-attachments/files/33667518/README.md)
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
