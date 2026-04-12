"""
TDA Pipeline for Financial Time Series Analysis.

Implements:
  1. Takens Time-Delay Embedding
  2. Vietoris-Rips Persistent Homology
  3. Risk Index Computation (L1 norm of H1 persistence)

Uses giotto-tda for the topological computations, with a fallback
to ripser + persim if giotto-tda is unavailable.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any

# Try giotto-tda first; fall back to ripser/persim
TDA_BACKEND = None

try:
    from gtda.time_series import SingleTakensEmbedding
    from gtda.homology import VietorisRipsPersistence
    TDA_BACKEND = "giotto"
except ImportError:
    pass

if TDA_BACKEND is None:
    try:
        import ripser
        TDA_BACKEND = "ripser"
    except ImportError:
        pass


# Takens' time-delay embedding
def takens_embedding(series: np.ndarray, dimension: int = 3, delay: int = 1) -> np.ndarray:
    """
    Apply Takens' time-delay embedding to a 1-D time series.

    Given x_1, …, x_N, construct vectors:
        v_i = (x_i, x_{i+τ}, x_{i+2τ}, …, x_{i+(d-1)τ})

    Parameters
    ----------
    series : np.ndarray
        1-D array of scalar observations (e.g., closing prices).
    dimension : int
        Embedding dimension d (default 3).
    delay : int
        Time delay τ (default 1).

    Returns
    -------
    np.ndarray of shape (n_points, dimension)
        The embedded point cloud in ℝ^d.
    """
    n = len(series)
    n_points = n - (dimension - 1) * delay
    if n_points <= 0:
        raise ValueError(
            f"Series too short ({n}) for embedding dim={dimension}, delay={delay}. "
            f"Need at least {(dimension - 1) * delay + 1} points."
        )
    indices = np.arange(n_points)[:, None] + delay * np.arange(dimension)[None, :]
    return series[indices]


# Persistent homology
def compute_persistence_giotto(point_cloud: np.ndarray, max_dim: int = 1) -> np.ndarray:
    """Compute persistence diagrams using giotto-tda."""
    vr = VietorisRipsPersistence(
        homology_dimensions=list(range(max_dim + 1)),
        n_jobs=-1,
    )
    diagrams = vr.fit_transform(point_cloud[np.newaxis, :, :])
    return diagrams[0] 


def compute_persistence_ripser(point_cloud: np.ndarray, max_dim: int = 1) -> np.ndarray:
    """Compute persistence diagrams using ripser."""
    result = ripser.ripser(point_cloud, maxdim=max_dim)
    rows = []
    for dim, dgm in enumerate(result["dgms"]):
        for birth, death in dgm:
            if np.isfinite(death):
                rows.append([birth, death, float(dim)])
    if not rows:
        return np.empty((0, 3))
    return np.array(rows)


def compute_persistence(point_cloud: np.ndarray, max_dim: int = 1) -> np.ndarray:
    """
    Compute persistent homology of a point cloud.

    Returns
    -------
    np.ndarray of shape (n_features, 3)
        Each row is (birth, death, homology_dimension).
    """
    if TDA_BACKEND == "giotto":
        return compute_persistence_giotto(point_cloud, max_dim)
    elif TDA_BACKEND == "ripser":
        return compute_persistence_ripser(point_cloud, max_dim)
    else:
        return _compute_persistence_fallback(point_cloud, max_dim)


def _compute_persistence_fallback(point_cloud: np.ndarray, max_dim: int = 1) -> np.ndarray:
    """
    Lightweight fallback when no TDA library is installed.
    Uses a distance-matrix heuristic to approximate H0 and H1 features.
    """
    from scipy.spatial.distance import pdist, squareform

    n = len(point_cloud)
    if n < 3:
        return np.empty((0, 3))

    dist_matrix = squareform(pdist(point_cloud))

    rows = []

    parent = list(range(n))
    rank = [0] * n

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return False
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        return True

    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            edges.append((dist_matrix[i, j], i, j))
    edges.sort()

    for dist, i, j in edges:
        if union(i, j):
            rows.append([0.0, dist, 0.0])  

    if max_dim >= 1:
        edge_count = min(len(edges), n * 3)
        threshold_edges = edges[:edge_count]
        for idx, (d1, i, j) in enumerate(threshold_edges[:min(50, len(threshold_edges))]):
            for k in range(n):
                if k == i or k == j:
                    continue
                d2 = dist_matrix[i, k]
                d3 = dist_matrix[j, k]
                birth = max(d1, d2, d3)
                death = birth + abs(d2 - d3) * 0.5
                if death > birth:
                    rows.append([birth, death, 1.0])

    if not rows:
        return np.empty((0, 3))
    return np.array(rows)


# Risk index
def compute_risk_index(diagram: np.ndarray, homology_dim: int = 1) -> float:
    """
    Compute the Risk Index from a persistence diagram.

    The Risk Index is the L1-norm (total persistence) of the
    H1 features: sum of |death_i - birth_i| for all H1 bars.

    Parameters
    ----------
    diagram : np.ndarray of shape (n_features, 3)
        Rows are (birth, death, dimension).
    homology_dim : int
        Which homology dimension to use (default 1 for loops).

    Returns
    -------
    float
        The scalar risk index value.
    """
    if len(diagram) == 0:
        return 0.0
    mask = diagram[:, 2] == homology_dim
    h1_bars = diagram[mask]
    if len(h1_bars) == 0:
        return 0.0
    lifetimes = np.abs(h1_bars[:, 1] - h1_bars[:, 0])
    # Filter out infinite lifetimes
    lifetimes = lifetimes[np.isfinite(lifetimes)]
    return float(np.sum(lifetimes))


# Full pipeline 
def run_pipeline(
    df: pd.DataFrame,
    window_size: int = 50,
    embedding_dim: int = 3,
    time_delay: int = 1,
    price_column: str = "Close",
) -> Dict[str, Any]:
    """
    Execute the full TDA pipeline on a financial DataFrame.

    For every rolling window of `window_size` days:
      1. Extract the closing price sub-series
      2. Normalize (z-score) the window for scale-invariance
      3. Apply Takens embedding → point cloud
      4. Compute persistent homology
      5. Extract the Risk Index (L1 norm of H1)

    Parameters
    ----------
    df : pd.DataFrame
        Must contain columns: Date, Open, High, Low, Close, Volume.
    window_size : int
        Size of the rolling window (default 50 days).
    embedding_dim : int
        Takens embedding dimension (default 3).
    time_delay : int
        Takens time delay (default 1).
    price_column : str
        Column to use for TDA (default "Close").

    Returns
    -------
    dict with keys:
        "ohlcv"         : list of {time, open, high, low, close, volume}
        "risk_index"    : list of {time, value}
        "threshold"     : float (mean + 2*std of risk index)
        "warning_zones" : list of {start, end} date-string pairs
        "tda_backend"   : which TDA library was used
        "parameters"    : dict of pipeline parameters
    """
    df = df.copy()
    required = {"Date", "Open", "High", "Low", "Close", "Volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing required columns: {missing}")

    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    # Duplicate calendar rows break Lightweight Charts (unique ascending time required).
    df = df.drop_duplicates(subset=["Date"], keep="last").reset_index(drop=True)

    if len(df) < window_size:
        raise ValueError(
            f"Not enough data rows ({len(df)}) for window size {window_size}."
        )

    prices = df[price_column].values.astype(np.float64)
    dates = df["Date"].dt.strftime("%Y-%m-%d").tolist()

    ohlcv = []
    for _, row in df.iterrows():
        ohlcv.append({
            "time": row["Date"].strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": round(float(row["Volume"]), 2),
        })

    risk_values = []
    risk_dates = []

    # Pad the first (window_size - 1) dates with 0 so the risk chart
    # starts at the same date as the price chart.
    for i in range(window_size - 1):
        risk_values.append(0.0)
        risk_dates.append(dates[i])

    for i in range(window_size, len(prices) + 1):
        window = prices[i - window_size : i]

        std = np.std(window)
        if std < 1e-10:
            risk_values.append(0.0)
            risk_dates.append(dates[i - 1])
            continue
        normalized = (window - np.mean(window)) / std

        try:
            cloud = takens_embedding(normalized, dimension=embedding_dim, delay=time_delay)
            diagram = compute_persistence(cloud, max_dim=1)
            risk = compute_risk_index(diagram, homology_dim=1)
        except Exception:
            risk = 0.0

        risk_values.append(risk)
        risk_dates.append(dates[i - 1])

    # Compute threshold only from real values (skip the padded warm-up zeros)
    real_risk = np.array(risk_values[window_size - 1:])

    if len(real_risk) > 0 and np.std(real_risk) > 0:
        threshold = float(np.mean(real_risk) + 2.0 * np.std(real_risk))
    else:
        threshold = 0.0
    warning_zones = []
    in_zone = False
    zone_start = None

    for idx, val in enumerate(risk_values):
        if val > threshold:
            if not in_zone:
                in_zone = True
                zone_start = risk_dates[idx]
        else:
            if in_zone:
                in_zone = False
                warning_zones.append({"start": zone_start, "end": risk_dates[idx - 1]})
    if in_zone:
        warning_zones.append({"start": zone_start, "end": risk_dates[-1]})

    risk_index = []
    for d, v in zip(risk_dates, risk_values):
        risk_index.append({
            "time": d,
            "value": round(v, 6),
        })

    return {
        "ohlcv": ohlcv,
        "risk_index": risk_index,
        "threshold": round(threshold, 6),
        "warning_zones": warning_zones,
        "tda_backend": TDA_BACKEND or "fallback",
        "parameters": {
            "window_size": window_size,
            "embedding_dim": embedding_dim,
            "time_delay": time_delay,
            "price_column": price_column,
        },
    }
