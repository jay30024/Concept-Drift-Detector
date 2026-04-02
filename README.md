## Drifter

Drifter is a full-stack concept drift analysis platform for detecting how language, themes, and narratives shift over time in any evolving text dataset.

## Overview

- The backend segments time-ordered text into analysis windows, vectorizes them with TF-IDF, clusters recurring themes, and measures drift between adjacent periods.
- The frontend visualizes drift scores, cluster balance over time, a semantic landscape, and filtered source passages.
- The current release uses a political corpus as the demo dataset, but the product is not limited to politics.

## Stack

- Backend: FastAPI
- Analysis: NumPy, SciPy, scikit-learn, NLTK
- Frontend: React + Vite

## Dataset

The current demo dataset is the NLTK State of the Union corpus, a real collection of United States presidential addresses. The app downloads the corpus on first run into a local `.nltk_data` directory.

Why this dataset works well here:

- It is real, historical, and reproducible.
- It has a clear temporal dimension.
- It provides a strong example of how concept drift appears in time-ordered text.

Drifter can be adapted to other domains, including:

- News archives
- Support tickets
- Product reviews
- Research abstracts
- Internal knowledge bases
- Social or community discussions

## Run locally

1. Create or activate the virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start the API:

```bash
uvicorn app.main:app --reload
```

4. Start the React client in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

5. Open `http://127.0.0.1:5173` during development.

6. For a production-style build served by FastAPI:

```bash
cd frontend
npm run build
```

Then open `http://127.0.0.1:8000`.

## API endpoints

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/segments?year=1995&cluster=2`

## Project layout

```text
app/
	analysis.py     # dataset loading and drift analysis
	main.py         # FastAPI app and endpoints
frontend/
	src/            # React application
	vite.config.js  # dev proxy and build config
requirements.txt
```

## Notes

- The React app uses a Vite proxy in development so `/api` requests go to the FastAPI server.
- FastAPI serves `frontend/dist` automatically after `npm run build`.
