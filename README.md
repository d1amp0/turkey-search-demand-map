# Turkey Search Demand Map

An interactive analytics map for exploring geo-search demand across Turkey. The web app shows province-level heatmaps, filters requests by time and category, and supports demand forecasting with a machine-learning model.

## What it does

- **Choropleth map** — color Turkish provinces by metrics such as search volume or average organization rating.
- **Filters** — slice data by hour ranges, weekdays, provinces, categories, and rating.
- **Province drill-down** — inspect aggregated stats and distributions for a selected region.
- **ML forecasting** — predict short-term demand for a province (requires a trained model file).
- **Localization** — English and Turkish UI.

Search-system request logs are cleaned and joined to city boundaries before the map can show demand.

## Project layout

```
turkey/
├── api/                 # FastAPI backend (demand + ML endpoints)
├── cli/                 # Data preparation scripts (run_map.py)
├── data/
│   └── tr-cities.json   # Province boundaries (GeoJSON; see note below)
├── ds/                  # Notebooks and offline preprocessing / ML
├── frontend/            # React + Vite + Leaflet UI
├── app.py               # ASGI entrypoint (exports FastAPI app)
└── requirements.txt     # Python dependencies
```

### Map boundaries (`data/tr-cities.json`)

Province boundaries are not authored in this repo. `tr-cities.json` was taken from an external project:

**Source:** [https://github.com/alpers/Turkey-Maps-GeoJSON]()

## Prerequisites

- **Python** 3.10 or newer (3.11+ recommended)
- **Node.js** 18+ and npm (for the frontend)
- A C compiler may be required on some systems to install **GeoPandas** / **Shapely** wheels if prebuilt packages are unavailable.

## Installation

### 1. Python environment

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Preparing data

The UI and API will start without prepared data, but the map and analytics will be empty until you run the pipeline.

Input logs are **search-system request logs** (JSONL). Use the CLI to slim records, keep points inside the map, and write a cleaned CSV:

```bash
python cli/run_map.py --logs path/to/logs.jsonl --geojson data/tr-cities.json
```

By default the result is written to `data/df.csv`. Query cleanup is **skipped** unless you opt in (see below). See `python cli/run_map.py --help` for required JSONL fields.

### Optional query cleanup

Noisy high-volume prompts (often from other systems) are not removed by default. Use either or both flags:

| Flag | Effect |
|------|--------|
| `--exclude-queries PATH` | Drop rows whose `query` exactly matches a line in `PATH` (one query per line; `#` comments and blank lines ignored). |
| `--drop-min-count N` | Drop every row whose `query` appears **at least N times** in the dataset after the spatial join. |

```bash
python cli/run_map.py --logs path/to/logs.jsonl --geojson data/tr-cities.json \
  --exclude-queries data/bad_queries.txt
```

Example — drop any query that occurs 500+ times:

```bash
python cli/run_map.py --logs path/to/logs.jsonl --geojson data/tr-cities.json \
  --drop-min-count 500
```

Both flags can be combined; exclusions run first, then the frequency threshold.

Further splitting, categorization, and model training live under `ds/` (Jupyter notebooks).

## Running the application

### Production-style (single server)

Build the frontend, then start the API (it serves the built static files):

```bash
cd frontend && npm run build && cd ..
uvicorn app:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Development (hot reload)

Use two terminals.

**Terminal 1 — API:**

```bash
source .venv/bin/activate
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend dev server** (proxies `/api` and `/tr-cities.json` to the API):

```bash
cd frontend
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Machine learning

Demand prediction endpoints (`/api/ml/*`) expect a serialized model at `api/rf_model.pkl`. This file is not committed (see `.gitignore`). Train or export the model using notebooks under `ds/ml/`, then place `rf_model.pkl` in `api/` before using the predict panel in the UI.

## API overview


| Endpoint                         | Description                           |
| -------------------------------- | ------------------------------------- |
| `GET /api/metrics`               | Available map metrics                 |
| `GET /api/categories`            | Category list for filters             |
| `GET /api/demand/region-values`  | Province values for the heatmap       |
| `GET /api/demand/overview`       | National summary for current filters  |
| `GET /api/demand/provinces/{n}`  | Detail for province number `n` (1–81) |
| `GET /tr-cities.json`            | Province boundary GeoJSON             |
| `POST /api/ml/predict`           | Single-step demand forecast           |
| `POST /api/ml/predict-recursive` | Multi-step recursive forecast         |


Interactive API docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) when the server is running.

## Data science workflow


| Path                | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `cli/run_map.py`    | Search request logs (JSONL) → slim + spatial filter → CSV |
| `ds/preprocessing/` | Cleaning and memory-efficient JSONL parsing               |
| `ds/splitting/`     | Split cleaned data for downstream use                     |
| `ds/ml/`            | Model training and evaluation                             |
| `ds/analysis/`      | Exploratory analysis                                      |
