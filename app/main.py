from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.analysis import get_dashboard_data, get_segment_samples

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST_DIR = BASE_DIR / "frontend" / "dist"

app = FastAPI(
    title="Drifter",
    description="Concept drift explorer for time-evolving text datasets.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="assets")


@app.get("/api/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard() -> dict:
    return get_dashboard_data()


@app.get("/api/segments")
def segment_samples(
    year: int | None = Query(default=None),
    cluster: int | None = Query(default=None, ge=0),
    limit: int = Query(default=12, ge=1, le=40),
) -> dict:
    return {"items": get_segment_samples(year=year, cluster=cluster, limit=limit)}


@app.get("/")
def index() -> FileResponse:
    frontend_index = FRONTEND_DIST_DIR / "index.html"
    if frontend_index.exists():
        return FileResponse(frontend_index)
    raise HTTPException(status_code=503, detail="Frontend build not found. Run npm run build in frontend/.")


@app.get("/{full_path:path}")
def frontend_routes(full_path: str) -> FileResponse:
    if full_path.startswith("api/") or full_path.startswith("assets/"):
        raise HTTPException(status_code=404)

    frontend_index = FRONTEND_DIST_DIR / "index.html"
    if frontend_index.exists():
        return FileResponse(frontend_index)

    raise HTTPException(status_code=503, detail="Frontend build not found. Run npm run build in frontend/.")