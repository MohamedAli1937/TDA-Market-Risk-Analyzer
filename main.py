"""
FastAPI Backend for TDA Financial Backtesting Application.

Endpoints:
  POST /api/analyze   — Upload CSV, run TDA pipeline, return results
  GET  /api/health    — Health check
  GET  /              — Serve frontend
"""

import os
import io
import traceback

import pandas as pd
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from tda_pipeline import run_pipeline

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="TDA Market Risk Analyzer",
    description="Topological Data Analysis for financial crash prediction",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend assets
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    """Health-check endpoint."""
    from tda_pipeline import TDA_BACKEND
    return {"status": "ok", "tda_backend": TDA_BACKEND or "fallback"}


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    window_size: int = Form(50),
    embedding_dim: int = Form(3),
    time_delay: int = Form(1),
):
    """
    Upload a financial CSV and run the TDA pipeline.

    Expected CSV columns: Date, Open, High, Low, Close, Volume
    Returns JSON with ohlcv data, risk_index, threshold, and warning_zones.
    """
    # --- Validate file type ---
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    # --- Validate parameters ---
    if window_size < 20:
        raise HTTPException(status_code=400, detail="Window size must be at least 20.")
    if window_size > 500:
        raise HTTPException(status_code=400, detail="Window size must be at most 500.")
    if embedding_dim < 2:
        raise HTTPException(status_code=400, detail="Embedding dimension must be at least 2.")
    if embedding_dim > 10:
        raise HTTPException(status_code=400, detail="Embedding dimension must be at most 10.")
    if time_delay < 1:
        raise HTTPException(status_code=400, detail="Time delay must be at least 1.")
    if time_delay > 10:
        raise HTTPException(status_code=400, detail="Time delay must be at most 10.")

    # --- Read and parse CSV ---
    try:
        content = await file.read()
        text = content.decode("utf-8")
        df = pd.read_csv(io.StringIO(text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")

    # --- Run TDA pipeline ---
    try:
        results = run_pipeline(
            df,
            window_size=window_size,
            embedding_dim=embedding_dim,
            time_delay=time_delay,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"TDA pipeline error: {str(e)}",
        )

    return JSONResponse(content=results)


@app.post("/api/generate-sample")
async def generate_sample():
    """
    Generate a synthetic stock dataset with a simulated crash.
    Returns CSV text that the frontend can offer as a downloadable file.
    """
    np.random.seed(42)
    n_days = 500

    dates = pd.bdate_range(start="2022-01-03", periods=n_days)

    # Simulate a stock with a crash around day 350
    price = 100.0
    prices = []
    for i in range(n_days):
        if i < 300:
            # Normal bull market with mild volatility
            ret = np.random.normal(0.0005, 0.012)
        elif i < 330:
            # Increasing instability
            ret = np.random.normal(0.0002, 0.025)
        elif i < 370:
            # Crash period
            ret = np.random.normal(-0.008, 0.035)
        else:
            # Recovery
            ret = np.random.normal(0.001, 0.015)
        price *= (1 + ret)
        prices.append(price)

    prices = np.array(prices)
    daily_range = prices * np.random.uniform(0.005, 0.02, n_days)

    opens = np.where(np.random.rand(n_days) > 0.5, 
                     np.round(prices - daily_range * 0.3, 2), 
                     np.round(prices + daily_range * 0.3, 2))
    
    df = pd.DataFrame({
        "Date": dates.strftime("%Y-%m-%d"),
        "Open": opens,
        "High": np.round(prices + daily_range * 0.5, 2),
        "Low": np.round(prices - daily_range * 0.5, 2),
        "Close": np.round(prices, 2),
        "Volume": np.random.randint(1_000_000, 50_000_000, n_days),
    })

    csv_text = df.to_csv(index=False)
    return JSONResponse(content={"csv": csv_text, "filename": "sample_stock_data.csv"})


# ---------------------------------------------------------------------------
# Catch-all: serve frontend index.html
# ---------------------------------------------------------------------------

@app.get("/{rest_of_path:path}")
async def serve_frontend(rest_of_path: str):
    """Serve the frontend SPA."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse(
        status_code=404,
        content={"detail": "Frontend not found. Place index.html in /static."},
    )
