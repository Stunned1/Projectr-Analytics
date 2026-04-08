# Projectr-Analytics
um haha yes!!

## Known Bugs

- **DC Metro velocity null** — Zips in the Washington-Arlington-Alexandria metro return `metro_velocity: null` because the metro name is too long to match the short name stored in `zillow_metro_snapshot`. The `getZillowData` function in `app/api/market/route.ts` needs smarter truncation logic for multi-city metro names.

- **ZHVF outlier values** — Some zips return extreme ZHVF forecast values (e.g. -50, -90, -10) from the Zillow CSV. These appear to be data artifacts. The UI currently caps display at ±50% and shows `—` for outliers, but the raw values are still stored in Supabase. The ingestion script should filter these on write.

- **Zillow `as_of_date` shows future date** — The ZHVF CSV uses forward-looking forecast dates (e.g. `2027-02-28`). This bleeds into the `as_of_date` field on the zip snapshot. The ingestion script should use the ZHVI or ZORI date as the canonical `as_of_date` instead.

## Minor Gaps

- **Employment Rate (FRED)** — The FRED series search for "employed persons" at the county level doesn't reliably return a consistent series name across all markets. The computation (employed / labor force × 100) is built and ready, but the series lookup needs a more robust matching strategy. Revisit before demo.

- **FRED missing for large metros** — Zips in large counties (e.g. Prince William County, VA) sometimes return no FRED data because the search query times out or returns no match. Likely needs a fallback to a direct LAUCN series ID lookup using the county FIPS.

- **Population Growth 3yr is enrollment-sensitive** — For college towns, the 2019→2022 ACS population delta reflects COVID-era enrollment swings, not real migration. Consider adding a note in the UI or suppressing this metric for known university zip codes.

- **Building permits are county-level, not zip-level** — Census BPS data is aggregated at the county level. A zip like 22193 (Woodbridge) shares permit counts with all of Prince William County. This overstates activity for individual zip codes. Noted for the demo script.

## Zillow Research CSVs

The `zillow-csv's/` folder is gitignored due to file size. Before running `npm run ingest:zillow`, download the following files from [Zillow Research](https://www.zillow.com/research/data/) and place them in a `zillow-csv's/` folder at the repo root:

| File | Section on Zillow Research page | Geography |
|------|--------------------------------|-----------|
| `Zip_zori_uc_sfrcondomfr_sm_month.csv` | Rentals → ZORI (All Homes, Smoothed) | ZIP |
| `Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` | Home Values → ZHVI (All Homes, Mid-Tier, Smoothed SA) | ZIP |
| `Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` | Home Value Forecasts → ZHVF (All Homes, Mid-Tier) | ZIP |
| `Metro_mean_doz_pending_uc_sfrcondo_sm_month.csv` | Days on Market → Days to Pending (Mean, Smoothed) | Metro |
| `Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv` | Days on Market → Price Cuts (Share of Listings) | Metro |
| `Metro_invt_fs_uc_sfrcondo_sm_month.csv` | For-Sale Listings → Inventory (Smoothed) | Metro |

Once downloaded, run:

```bash
cd projectr-analytics
npm run ingest:zillow
```
