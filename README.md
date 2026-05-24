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
├── cli/                 # Data pipeline (python -m cli.run_map)
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

Input logs are **search-system request logs** (JSONL). One command runs the full pipeline:

```bash
python -m cli.run_map --logs path/to/logs.jsonl --geojson data/tr-cities.json
```

Stages (in order):

1. Slim JSONL — extract `org_*` from `model_response_full`
2. Spatial join — keep points inside `tr-cities.json` (adds province `name`, `number`)
3. Optional query cleanup (`--exclude-queries`, `--drop-min-count`)
4. Translation + categorization — `org_type_en` and `category` on `data/df_with_cat.csv`
5. Province split — `data/provinces/{number}.csv` with `org_name`, `time`, `category`, `org_rating`

Query cleanup is **skipped** unless you opt in (see below). See `python -m cli.run_map --help` for all flags (`--regions-dir`, `--exclude-queries`, etc.).

**Translation model:** the pipeline uses [Helsinki-NLP/opus-mt-tr-en](https://huggingface.co/Helsinki-NLP/opus-mt-tr-en) as a **free, local example** — it is not the best Turkish→English option. Replace it in `cli/translate.py` if you need higher quality (e.g. a larger Marian/NLLB model or a paid API). Categorization uses [BAAI/bge-large-en-v1.5](https://huggingface.co/BAAI/bge-large-en-v1.5) on the translated labels.

### Optional query cleanup

Noisy high-volume prompts (often from other systems) are not removed by default. Use either or both flags:

| Flag | Effect |
|------|--------|
| `--exclude-queries PATH` | Drop rows whose `query` exactly matches a line in `PATH` (one query per line; `#` comments and blank lines ignored). |
| `--drop-min-count N` | Drop every row whose `query` appears **at least N times** in the dataset after the spatial join. |

```bash
python -m cli.run_map --logs path/to/logs.jsonl --geojson data/tr-cities.json \
  --exclude-queries data/bad_queries.txt
```

Example — drop any query that occurs 500+ times:

```bash
python -m cli.run_map --logs path/to/logs.jsonl --geojson data/tr-cities.json \
  --drop-min-count 500
```

Both flags can be combined; exclusions run first, then the frequency threshold.

To re-run only categorization + split on an existing CSV: `python ds/ml/categorize_org_types.py --input data/df.csv`.

Further model training and notebooks live under `ds/`.

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
| `cli/run_map.py` | CLI entry (`python -m cli.run_map`) |
| `cli/pipeline.py` | Pipeline orchestration |
| `cli/slim.py`, `cli/spatial.py`, `cli/queries.py` | JSONL slimming, map filter, query cleanup |
| `cli/translate.py`, `cli/categorize.py`, `cli/split.py` | HF translation, BGE labels, province CSVs |
| `ds/preprocessing/` | Cleaning and memory-efficient JSONL parsing |
| `ds/ml/` | Notebooks (`result.ipynb`, training, evaluation) |
| `ds/analysis/`      | Exploratory analysis                                      |
