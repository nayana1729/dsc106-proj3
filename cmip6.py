import argparse
import os
import json
import warnings
import pandas as pd
import numpy as np
import xarray as xr
import gcsfs

warnings.filterwarnings("ignore")
CATALOG_URL = "https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv"

MODELS = [
    { "source_id": "MPI-ESM1-2-LR", "member_id": "r1i1p1f1", "grid_label": "gn" },
    { "source_id": "GFDL-ESM4",     "member_id": "r1i1p1f1", "grid_label": "gr1" },
]

EXPERIMENTS = {
    "historical": "historical",
    "ssp245": "ssp245",
    "ssp585": "ssp585",
}

VARIABLES = ["tas", "pr", "sfcWind", "huss", "psl", "rsds"]


def load_catalog():
    print("Loading CMIP6 catalog...")
    df = pd.read_csv(CATALOG_URL, low_memory=False)
    print(f"  {len(df):,} entries found")
    return df


def find_store(catalog, source_id, member_id, grid_label, experiment_id, variable_id):
    result = catalog.query(
        f"source_id == '{source_id}' and "
        f"member_id == '{member_id}' and "
        f"grid_label == '{grid_label}' and "
        f"experiment_id == '{experiment_id}' and "
        f"variable_id == '{variable_id}' and "
        f"table_id == 'day'"
    )
    if result.empty:
        return None
    return result.zstore.values[0]


def global_mean(da):
    weights = np.cos(np.deg2rad(da.lat))
    return da.weighted(weights).mean(dim=["lat", "lon"])


def extract_day(ds, variable, month, day):
    mask = (ds.time.dt.month == month) & (ds.time.dt.day == day)
    day_ds = ds.sel(time=mask)
    if len(day_ds.time) == 0:
        return {}

    means = global_mean(day_ds[variable]).compute()
    result = {}
    for i, t in enumerate(day_ds.time.values):
        yr = pd.Timestamp(t).year
        result[yr] = float(means.isel(time=i).values)
    return result


def convert(variable, raw):
    out = {}
    for yr, val in raw.items():
        if variable == "tas":
            out[yr] = round(val - 273.15, 4)
        elif variable == "pr":
            out[yr] = round(val * 86400, 4)
        else:
            out[yr] = round(val, 6)
    return out


def main(month, day, out_csv, out_grid):
    catalog = load_catalog()
    gcs = gcsfs.GCSFileSystem(token="anon")

    rows = []
    grid_data = {}

    for model in MODELS:
        sid = model["source_id"]
        mid = model["member_id"]
        grid = model["grid_label"]
        print(f"\n{sid}")

        for variable in VARIABLES:
            print(f"  {variable}")

            for scenario, experiment in EXPERIMENTS.items():
                store_url = find_store(catalog, sid, mid, grid, experiment, variable)
                if store_url is None:
                    print(f"    {scenario}: no daily store found, skipping")
                    continue

                try:
                    ds = xr.open_zarr(gcs.get_mapper(store_url), consolidated=True)
                    raw = extract_day(ds, variable, month, day)
                    converted = convert(variable, raw)

                    unit = "°C" if variable == "tas" else ("mm/day" if variable == "pr" else "")
                    for yr, val in converted.items():
                        rows.append({
                            "year": yr, "variable": variable, "value": val,
                            "scenario": scenario, "model": sid, "unit": unit,
                        })
                    print(f"    {scenario}: {len(converted)} years extracted")

                    key = f"{sid}_{variable}_{scenario}"
                    if key not in grid_data:
                        grid_data[key] = {
                            "source_id": sid, "variable": variable, "scenario": scenario,
                            "lats": ds.lat.values.tolist(), "lons": ds.lon.values.tolist(),
                            "years": {}
                        }
                    mask = (ds.time.dt.month == month) & (ds.time.dt.day == day)
                    day_ds = ds.sel(time=mask)
                    for i, t in enumerate(day_ds.time.values):
                        yr = pd.Timestamp(t).year
                        if yr % 10 != 0:
                            continue
                        vals = day_ds[variable].isel(time=i).compute().values
                        if variable == "tas":
                            vals = vals - 273.15
                        elif variable == "pr":
                            vals = vals * 86400
                        grid_data[key]["years"][str(yr)] = np.round(vals, 2).tolist()

                except Exception as e:
                    print(f"    {scenario}: error — {e}")
                    continue

    if not rows:
        print("\nNo data extracted, check model/experiment availability")
        return

    os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)

    df = pd.DataFrame(rows)
    hist = df[(df.scenario == "historical") & (df.year <= 2014)]
    future = df[df.scenario != "historical"]
    final = pd.concat([hist, future]).sort_values(["model", "variable", "scenario", "year"])
    final.to_csv(out_csv, index=False)
    print(f"\nSaved {out_csv} ({len(final)} rows, {final.year.min()}–{final.year.max()})")

    if out_grid:
        with open(out_grid, "w") as f:
            json.dump(grid_data, f)
        print(f"Saved {out_grid}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", type=int, required=True)
    parser.add_argument("--day", type=int, required=True)
    parser.add_argument("--output", default="data/birthday_climate.csv")
    parser.add_argument("--output-grid", default="data/birthday_climate_grid.json")
    args = parser.parse_args()
    main(args.month, args.day, args.output, args.output_grid)