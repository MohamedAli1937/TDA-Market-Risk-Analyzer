# TDA Market Risk Analyzer

**Topological Data Analysis for Financial Crash Prediction**

A premium, real-time financial risk detection system that moves beyond traditional statistical indicators by applying the advanced mathematics of **Topological Data Analysis (TDA)**. Specifically utilizing **Persistent Homology**, this engine treats market data as a **multi-dimensional** geometric shape. By continuously monitoring the **"shape"** of the market, it detects hidden structural tearing and topological anomalies—providing an institutional-grade early warning system that identifies critical market instability days before catastrophic crashes occur.

---

## Overview

Traditional risk indicators (RSI, Bollinger Bands, VaR) rely on **statistical assumptions** about price distributions. This tool takes a fundamentally different approach:

> It treats the price time series as a **geometric shape** in high-dimensional space and analyzes its **topological features** — specifically, the formation and collapse of "holes" (loops) in the data's structure — to detect when the market's geometry is breaking down.

**When the topology collapses, a crash is likely imminent.**

---

## How It Works — The TDA Pipeline

The analysis follows a rigorous 3-stage mathematical pipeline:

### Stage 1: Takens Time-Delay Embedding

Converts a flat 1D price series into a multi-dimensional **point cloud** using [Takens' Embedding Theorem](https://en.wikipedia.org/wiki/Takens%27s_theorem):

```
Given: x₁, x₂, ..., xₙ (closing prices)
Embed: vᵢ = (xᵢ, xᵢ₊τ, xᵢ₊₂τ, ..., xᵢ₊₍ₐ₋₁₎τ)
```

- **Dimension (d)**: Number of coordinates per embedded vector (default: 3)
- **Time Delay (τ)**: Spacing between observations (default: 1)

### Stage 2: Vietoris-Rips Persistent Homology

Constructs a [Vietoris-Rips filtration](https://en.wikipedia.org/wiki/Vietoris%E2%80%93Rips_complex) on the point cloud and tracks the birth and death of topological features:

- **H₀ (Connected Components)**: Clusters in the data
- **H₁ (Loops / 1-Cycles)**: Circular structures that form and collapse

### Stage 3: Risk Index Computation

The **Risk Index** is computed as the **L₁-norm** (total persistence) of all H₁ features:

```
Risk Index = Σ |deathᵢ - birthᵢ|  for all H₁ bars
```

A spike in this index indicates that the topological structure of the market is undergoing rapid change — a precursor to a crash.

---

## Architecture

```
TDA/
├── main.py              # FastAPI backend server
├── tda_pipeline.py       # Core TDA computation engine
├── requirements.txt      # Python dependencies
├── README.md             # This file
└── static/
    ├── index.html        # Single-page frontend application
    ├── css/
    │   └── style.css     # Design system (True Black + Neon theme)
    ├── js/
    │   └── app.js        # Frontend application logic
    └── images/
        ├── logo.png          # Application logo
        └── logo-withoutbg.png # Transparent logo variant
```

---

## Quick Start

### Prerequisites

- **Python 3.10+**
- **pip** (Python package manager)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/MohamedAli1937/TDA-Market-Risk-Analyzer.git
cd TDA-Market-Risk-Analyzer

# 2. Install dependencies (includes Ripser engine by default)
pip install -r requirements.txt

# 3. (Optional) Install Giotto-TDA for extreme production accuracy 
# Note: May require C++ build tools on Windows
pip install giotto-tda
```

### Running

```bash
# Start the server
uvicorn main:app --reload --port 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

---

## TDA Engines

The application supports **three TDA computation backends**, automatically selecting the best available:

| Priority | Engine             | Package            | Description                                                                                                           |
| -------- | ------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1st      | **Giotto-TDA**     | `giotto-tda`       | Full-featured, production-grade. Uses optimized C++ bindings for Vietoris-Rips persistence. Recommended for accuracy. |
| 2nd      | **Ripser**         | `ripser`           | Lightweight and fast. Implements the Ripser algorithm for efficient persistent homology computation.                  |
| 3rd      | **Scipy Fallback** | `scipy` (built-in) | Heuristic approximation using distance matrices. No additional installation needed. Suitable for demos.               |

> The active engine is displayed in the dashboard's **TDA Engine badge** after each analysis run.

---

## Input Format

Upload a CSV file with the following columns:

| Column   | Type      | Description                                       |
| -------- | --------- | ------------------------------------------------- |
| `Date`   | string    | Date in any parseable format (e.g., `2024-01-15`) |
| `Open`   | float     | Opening price                                     |
| `High`   | float     | Highest price                                     |
| `Low`    | float     | Lowest price                                      |
| `Close`  | float     | Closing price                                     |
| `Volume` | int/float | Trading volume                                    |

> **Tip:** You can also use the **"Use Sample Data"** button to generate a synthetic dataset with a simulated crash event for testing.

---

## Parameters

| Parameter               | Default | Range  | Description                                                                                |
| ----------------------- | ------- | ------ | ------------------------------------------------------------------------------------------ |
| **Window Size**         | 50      | 20–500 | Number of data points per rolling analysis window. Controls the "memory" of the indicator. |
| **Embedding Dimension** | 3       | 2–10   | Takens embedding dimension. 3 is the standard for financial time series.                   |
| **Time Delay**          | 1       | 1–10   | Spacing between embedded observations. Keep at 1 for daily data.                           |

> **Configuration Guide Available:** Unsure which values to choose? The application dashboard includes built-in **help notes and tooltips** for each parameter. These guides will help you select the optimal configuration based on your specific market data.

---

## Features

- **📈 Interactive OHLC Candlestick Chart** — TradingView Lightweight Charts with synchronized crosshair
- **📉 TDA Risk Index Chart** — Real-time H₁ persistence visualization with dynamic threshold
- **🔴 Warning Zone Detection** — Automatic identification of instability periods (μ + 2σ threshold)
- **⚡ Live TDA Engine Display** — Shows which computation backend is active
- **📊 Pipeline Info Bar** — Visual breakdown of the mathematical pipeline stages
- **🎨 Premium Dark UI** — True black design with neon accents and glassmorphism
- **📱 Responsive Layout** — Full mobile and tablet support
- **🔧 Parameter Help System** — In-app documentation with trade-off guidance

---

## API Reference

### `GET /api/health`

Health check endpoint. Returns the active TDA backend.

```json
{
  "status": "ok",
  "tda_backend": "giotto"
}
```

### `POST /api/analyze`

Run TDA analysis on uploaded CSV data.

**Form Parameters:**

- `file` — CSV file (multipart)
- `window_size` — Rolling window size (int, default: 50)
- `embedding_dim` — Takens embedding dimension (int, default: 3)
- `time_delay` — Takens time delay (int, default: 1)

**Response:**

```json
{
  "ohlcv": [{ "time": "2024-01-15", "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0, "volume": 1000000 }],
  "risk_index": [{ "time": "2024-03-01", "value": 0.4523 }],
  "threshold": 1.2345,
  "warning_zones": [{ "start": "2024-06-01", "end": "2024-06-15" }],
  "tda_backend": "giotto",
  "parameters": {
    "window_size": 50,
    "embedding_dim": 3,
    "time_delay": 1,
    "price_column": "Close"
  }
}
```

### `POST /api/generate-sample`

Generate a synthetic stock dataset with a simulated crash for testing.

---

## Mathematical Background

### Persistent Homology

Persistent homology tracks topological features across a range of spatial scales:

- **Birth**: The scale at which a feature first appears
- **Death**: The scale at which a feature disappears
- **Persistence**: `death - birth` — long-lived features are "real" topological structure

### Why Loops Matter (H₁)

In a stable market, price embeddings form smooth, consistent curves. When instability grows:

1. The point cloud begins to form **loops** (H₁ features)
2. These loops have **high persistence** (they don't collapse quickly)
3. The **total persistence** (L₁ norm) spikes
4. This spike **precedes** the actual price crash by several days

This gives TDA its predictive power — it detects **structural change** before it manifests as price change.

---

## 🤝 Contributing

Contributions are welcome! Key areas for improvement:

- Additional TDA backends (e.g., GUDHI, Dionysus)
- Multi-asset comparison views
- Persistence diagram visualization
- Real-time data feeds (WebSocket integration)
- Backtesting framework with historical crash data

---

## 📄 License

This project is licensed under the MIT License.

---
