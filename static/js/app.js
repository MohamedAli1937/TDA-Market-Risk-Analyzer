/**
 * TDA Market Risk Analyzer — Application Logic
 *
 * Handles:
 *  - File upload with drag-and-drop
 *  - API communication with the FastAPI backend
 *  - Chart rendering using TradingView Lightweight Charts
 *  - Synchronized time range between price and risk charts
 *  - Warning zone highlighting
 */

const state = {
  selectedFile: null,
  results: null,
  priceChart: null,
  riskChart: null,
  priceSeries: null,
  riskSeries: null,
  thresholdSeries: null,
};

const $ = (sel) => (sel.startsWith("#") ? document.getElementById(sel.slice(1)) : document.querySelector(sel));
const $$ = (sel) => document.querySelectorAll(sel);

/** Safe text update — avoids "Cannot set properties of null (setting 'textContent')". */
function setTextById(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Lightweight Charts requires strictly increasing, unique `time` values.
 * Duplicate or invalid rows cause internal null errors (e.g. textContent on missing nodes).
 */
function sanitizeCandles(rows) {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows
    .filter((r) => r && r.time != null)
    .map((r) => ({
      time: r.time,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    }))
    .filter((r) => [r.open, r.high, r.low, r.close].every((x) => Number.isFinite(x)))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const out = [];
  for (const c of cleaned) {
    if (out.length && out[out.length - 1].time === c.time) {
      out[out.length - 1] = c;
    } else {
      out.push(c);
    }
  }
  return out;
}

function sanitizeRiskBars(rows) {
  if (!Array.isArray(rows)) return [];
  const cleaned = rows
    .filter((r) => r && r.time != null && Number.isFinite(Number(r.value)))
    .map((r) => ({ time: r.time, value: Number(r.value), color: r.color }))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const out = [];
  for (const r of cleaned) {
    if (out.length && out[out.length - 1].time === r.time) {
      out[out.length - 1] = r;
    } else {
      out.push(r);
    }
  }
  return out;
}

const dropZone = $("#drop-zone");
const fileInput = $("#file-input");
const fileSelected = $("#file-selected");
const fileName = $("#file-name");
const analyzeBtn = $("#analyze-btn");
const uploadSection = $("#upload-section");
const dashboard = $("#dashboard");
const loadingOverlay = $("#loading-overlay");
const loadingStep = $("#loading-step");
const sampleBtn = $("#sample-btn");
const newAnalysisBtn = $("#new-analysis-btn");
const toastContainer = $("#toast-container");

document.addEventListener("DOMContentLoaded", () => {
  setupDragAndDrop();
  setupFileInput();
  setupAnalyzeButton();
  setupSampleButton();
  setupNewAnalysis();
  setupHelpDocumentation();
});

function setupDragAndDrop() {
  if (!dropZone || !fileInput) return;
  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  });

  dropZone.addEventListener("click", () => fileInput.click());
}

function setupFileInput() {
  if (!fileInput) return;
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });
}

function handleFileSelection(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showToast("Please select a CSV file.", "error");
    return;
  }
  state.selectedFile = file;
  if (fileName) fileName.textContent = file.name;
  if (fileSelected) fileSelected.classList.add("visible");
  if (analyzeBtn) analyzeBtn.disabled = false;
}

function setupSampleButton() {
  if (!sampleBtn) return;
  sampleBtn.addEventListener("click", async () => {
    sampleBtn.disabled = true;
    sampleBtn.textContent = "Generating...";

    try {
      const resp = await fetch("/api/generate-sample", { method: "POST" });
      if (!resp.ok) throw new Error("Failed to generate sample data");

      const data = await resp.json();
      const blob = new Blob([data.csv], { type: "text/csv" });
      const file = new File([blob], data.filename, { type: "text/csv" });

      handleFileSelection(file);
      showToast('Sample data loaded! Click "Run TDA Analysis" to start.', "success");
    } catch (err) {
      showToast("Failed to generate sample data: " + err.message, "error");
    } finally {
      sampleBtn.disabled = false;
      sampleBtn.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>
                Use Sample Data
            `;
    }
  });
}

function setupAnalyzeButton() {
  if (!analyzeBtn) return;
  analyzeBtn.addEventListener("click", runAnalysis);
}

async function runAnalysis() {
  if (!state.selectedFile) {
    showToast("Please select a CSV file first.", "error");
    return;
  }

  const wIn = $("#param-window");
  const dIn = $("#param-dim");
  const tIn = $("#param-delay");
  const windowSize = wIn ? parseInt(wIn.value, 10) || 50 : 50;
  const embeddingDim = dIn ? parseInt(dIn.value, 10) || 3 : 3;
  const timeDelay = tIn ? parseInt(tIn.value, 10) || 1 : 1;

  showLoading(true);
  updateLoadingStep("Uploading CSV data...");

  const formData = new FormData();
  formData.append("file", state.selectedFile);
  formData.append("window_size", windowSize);
  formData.append("embedding_dim", embeddingDim);
  formData.append("time_delay", timeDelay);

  try {
    updateLoadingStep("Parsing financial data...");
    await sleep(300);

    updateLoadingStep("Applying Takens time-delay embedding...");
    await sleep(200);

    const resp = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || "Analysis failed");
    }

    updateLoadingStep("Computing persistent homology...");
    await sleep(400);

    const results = await resp.json();
    state.results = results;

    updateLoadingStep("Rendering dashboard...");
    await sleep(300);

    await renderDashboard(results);
    showLoading(false);
    showToast("Analysis complete! TDA pipeline processed successfully.", "success");
  } catch (err) {
    showLoading(false);
    showToast(String(err?.message ?? err ?? "Analysis failed"), "error");
  }
}

async function renderDashboard(data) {
  if (uploadSection) uploadSection.style.display = "none";
  if (dashboard) dashboard.classList.add("visible");

  renderStats(data);
  renderWarningInfo(data);

  // Set asset name from selected file (prominent hero display)
  const nameEl = $("#data-name-display");
  if (nameEl && state.selectedFile) {
    // Show clean name: strip .csv extension for prominence
    const rawName = state.selectedFile.name;
    nameEl.textContent = rawName;
  }

  // Set TDA Engine badge
  const engineNameEl = $("#tda-engine-name");
  if (engineNameEl && data.tda_backend) {
    const engineLabels = {
      giotto: "Giotto-TDA",
      ripser: "Ripser",
      fallback: "Scipy Fallback",
    };
    engineNameEl.textContent = engineLabels[data.tda_backend] || data.tda_backend;
  }

  // Set pipeline parameters display
  const pipelineEmbEl = $("#pipeline-embedding");
  if (pipelineEmbEl && data.parameters) {
    pipelineEmbEl.textContent = `Takens d=${data.parameters.embedding_dim}, τ=${data.parameters.time_delay}`;
  }

  // Dashboard was `display:none` until now — layout may not run until the next frame.
  // If charts are created with 0×0 size, Lightweight Charts can throw internally
  // (often surfacing as "Cannot set properties of null (setting 'textContent')").
  await new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          renderPriceChart(data);
          renderRiskChart(data);
          syncCharts();
          resolve();
        } catch (e) {
          console.error(e);
          reject(e);
        }
      });
    });
  });
}

function renderStats(data) {
  const ohlcv = data.ohlcv;
  const risk = data.risk_index;
  const zones = data.warning_zones ?? [];

  const firstPrice = ohlcv[0].close;
  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const priceChange = (((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2);

  const maxRisk = Math.max(...risk.map((r) => r.value));

  setTextById("stat-data-points", ohlcv.length.toLocaleString());
  setTextById("stat-price-change", `${priceChange >= 0 ? "+" : ""}${priceChange}%`);
  setTextById("stat-max-risk", maxRisk.toFixed(4));
  setTextById("stat-warnings", String(zones.length));

  const priceEl = document.getElementById("stat-price-change");
  if (priceEl) {
    priceEl.className = parseFloat(priceChange) >= 0 ? "stat-value green" : "stat-value magenta";
  }
}

function renderPriceChart(data) {
  if (state.priceChart) {
    state.priceChart.remove();
    state.priceChart = null;
    state.priceSeries = null;
  }

  const container = $("#price-chart");
  if (!container) return;
  container.innerHTML = "";

  const chartW = Math.max(container.clientWidth || 0, 320);
  const chartH = Math.max(container.clientHeight || 0, 280);

  const chart = LightweightCharts.createChart(container, {
    width: chartW,
    height: chartH,
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: "#9a9a9e",
      fontFamily: "'Inter', sans-serif",
      fontSize: 12,
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.06)" },
      horzLines: { color: "rgba(255, 255, 255, 0.06)" },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(0, 255, 202, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#094026',
      },
      horzLine: {
        color: 'rgba(0, 255, 202, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#094026',
      },
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      timeVisible: false,
    },
  });

  const candlestick = chart.addCandlestickSeries({
    upColor: "#00d68f",
    downColor: "#ff3860",
    borderDownColor: "#ff3860",
    borderUpColor: "#00d68f",
    wickDownColor: "#ff3860",
    wickUpColor: "#00d68f",
  });

  const candles = sanitizeCandles(data.ohlcv);
  if (candles.length === 0) {
    state.priceChart = chart;
    state.priceSeries = candlestick;
    return;
  }
  candlestick.setData(candles);

  const timeSet = new Set(candles.map((c) => c.time));
  const zones = data.warning_zones ?? [];
  if (zones.length > 0) {
    const markers = [];
    zones.forEach((zone) => {
      if (zone && zone.start != null && timeSet.has(zone.start)) {
        markers.push({
          time: zone.start,
          position: "aboveBar",
          color: "#ff3860",
          shape: "arrowDown",
          text: "Risk",
        });
      }
    });
    if (markers.length > 0) {
      candlestick.setMarkers(markers);
    }
  }

  chart.timeScale().fitContent();
  state.priceChart = chart;
  state.priceSeries = candlestick;

  const ro = new ResizeObserver(() => {
    const w = Math.max(container.clientWidth || 0, 320);
    const h = Math.max(container.clientHeight || 0, 280);
    chart.applyOptions({ width: w, height: h });
  });
  ro.observe(container);
}

function renderRiskChart(data) {
  if (state.riskChart) {
    state.riskChart.remove();
    state.riskChart = null;
    state.riskSeries = null;
    state.thresholdSeries = null;
  }

  const container = $("#risk-chart");
  if (!container) return;
  container.innerHTML = "";

  const chartW = Math.max(container.clientWidth || 0, 320);
  const chartH = Math.max(container.clientHeight || 0, 280);

  const chart = LightweightCharts.createChart(container, {
    width: chartW,
    height: chartH,
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: "#9a9a9e",
      fontFamily: "'Inter', sans-serif",
      fontSize: 12,
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.06)" },
      horzLines: { color: "rgba(255, 255, 255, 0.06)" },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(0, 255, 202, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#094026',
      },
      horzLine: {
        color: 'rgba(0, 255, 202, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#094026',
      },
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      timeVisible: false,
    },
  });

  const riskSeries = chart.addHistogramSeries({
    priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    priceScaleId: "right",
  });
  const threshold = Number(data.threshold);
  const riskRows = Array.isArray(data.risk_index) ? data.risk_index : [];
  const coloredData = sanitizeRiskBars(
    riskRows.map((d) => ({
      time: d.time,
      value: d.value,
      color: d.value > threshold ? "rgba(255, 56, 96, 0.8)" : "rgba(94, 233, 168, 0.65)",
    }))
  );
  if (coloredData.length === 0) {
    state.riskChart = chart;
    state.riskSeries = riskSeries;
    state.thresholdSeries = null;
    return;
  }
  riskSeries.setData(coloredData);

  const thresholdLine = chart.addLineSeries({
    color: "#ffb830",
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    priceScaleId: "right",
    crosshairMarkerVisible: false,
    lastValueVisible: true,
    priceLineVisible: false,
    title: "Threshold",
  });

  const t0 = coloredData[0].time;
  const t1 = coloredData[coloredData.length - 1].time;
  thresholdLine.setData([
    { time: t0, value: threshold },
    { time: t1, value: threshold },
  ]);

  chart.timeScale().fitContent();
  state.riskChart = chart;
  state.riskSeries = riskSeries;
  state.thresholdSeries = thresholdLine;

  const ro = new ResizeObserver(() => {
    const w = Math.max(container.clientWidth || 0, 320);
    const h = Math.max(container.clientHeight || 0, 280);
    chart.applyOptions({ width: w, height: h });
  });
  ro.observe(container);
}

function syncCharts() {
  if (!state.priceChart || !state.riskChart) return;

  let syncingCrosshair = false; // Guard to prevent infinite feedback loop

  // --- Sync visible range (zoom/pan) ---
  state.priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    try {
      if (range && state.riskChart) {
        state.riskChart.timeScale().setVisibleLogicalRange(range);
      }
    } catch (e) {
      console.warn("sync range (price→risk)", e);
    }
  });

  state.riskChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    try {
      if (range && state.priceChart) {
        state.priceChart.timeScale().setVisibleLogicalRange(range);
      }
    } catch (e) {
      console.warn("sync range (risk→price)", e);
    }
  });

  // --- Sync crosshair position ---
  state.priceChart.subscribeCrosshairMove((param) => {
    if (syncingCrosshair) return;
    syncingCrosshair = true;
    try {
      if (!param || !param.time || !state.riskChart || !state.riskSeries) {
        state.riskChart && state.riskChart.clearCrosshairPosition();
      } else {
        state.riskChart.setCrosshairPosition(undefined, param.time, state.riskSeries);
      }
    } catch (e) { /* ignore */ }
    syncingCrosshair = false;
  });

  state.riskChart.subscribeCrosshairMove((param) => {
    if (syncingCrosshair) return;
    syncingCrosshair = true;
    try {
      if (!param || !param.time || !state.priceChart || !state.priceSeries) {
        state.priceChart && state.priceChart.clearCrosshairPosition();
      } else {
        state.priceChart.setCrosshairPosition(undefined, param.time, state.priceSeries);
      }
    } catch (e) { /* ignore */ }
    syncingCrosshair = false;
  });
}

function renderWarningInfo(data) {
  const infoEl = $("#warning-info");
  if (!infoEl) return;

  const zones = data.warning_zones ?? [];

  if (zones.length === 0) {
    infoEl.className = "warning-info stable";
    infoEl.innerHTML = `
      <div class="warning-header-row">
        <div class="warning-icon-box">
          <svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <div class="warning-summary">
          <span class="warning-status">Topologically Stable</span>
          <span class="warning-desc">No critical instability detected in market structure.</span>
        </div>
      </div>
      <div class="warning-details">
        <div class="warning-phrases">
          <div class="phrase-item">
            <span class="phrase-label">Risk Level</span>
            <span class="phrase-value" style="color:#00ffca">LOW</span>
          </div>
          <div class="phrase-item">
            <span class="phrase-label">Threshold</span>
            <span class="phrase-value">${data.threshold.toFixed(4)}</span>
          </div>
          <div class="phrase-item">
            <span class="phrase-label">Status</span>
            <span class="phrase-value">Clear</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  infoEl.className = "warning-info has-warnings";
  const zonesHtml = zones
    .map(
      (z, idx) => `
    <div class="zone-badge-simple">
      <span class="zone-badge-num">#${idx + 1}</span>
      <span class="zone-badge-date">${z.start}</span>
      <span class="zone-badge-arrow">→</span>
      <span class="zone-badge-date">${z.end}</span>
    </div>
  `
    )
    .join("");

  infoEl.innerHTML = `
    <div class="warning-header-row">
      <div class="warning-icon-box">
        <svg viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      </div>
      <div class="warning-summary">
        <span class="warning-status">
          <span class="warning-count">${zones.length}</span> Instability Zone${zones.length > 1 ? 's' : ''} Detected
        </span>
        <span class="warning-desc">Threshold: <strong>${data.threshold.toFixed(4)}</strong></span>
      </div>
    </div>
    <div class="warning-zones-inline">
      ${zonesHtml}
    </div>
  `;
}

function setupNewAnalysis() {
  if (!newAnalysisBtn) return;
  newAnalysisBtn.addEventListener("click", () => {
    state.selectedFile = null;
    state.results = null;

    if (state.priceChart) {
      state.priceChart.remove();
      state.priceChart = null;
    }
    if (state.riskChart) {
      state.riskChart.remove();
      state.riskChart = null;
    }

    fileInput.value = "";
    if (fileSelected) fileSelected.classList.remove("visible");
    if (analyzeBtn) analyzeBtn.disabled = true;

    if (dashboard) dashboard.classList.remove("visible");
    if (uploadSection) uploadSection.style.display = "";
  });
}

function showLoading(show) {
  if (!loadingOverlay) return;
  if (show) {
    loadingOverlay.classList.add("visible");
  } else {
    loadingOverlay.classList.remove("visible");
  }
}

function updateLoadingStep(text) {
  if (!loadingStep) return;
  loadingStep.textContent = text;
}

function showToast(message, type = "info") {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const iconPath =
    type === "error"
      ? '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>'
      : '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>';

  toast.innerHTML = `
        <svg viewBox="0 0 24 24">${iconPath}</svg>
        <span>${message}</span>
    `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(60px)";
    toast.style.transition = "0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Help Documentation Data */
const helpData = {
  window: {
    title: "Window Size",
    content: `
      <div class="help-section">
        <h4>What it does</h4>
        <p>Determines how many historical data points (e.g., days, hours) the algorithm looks at to calculate the current risk. It acts as the "memory" of the indicator.</p>
      </div>
      <div class="help-section">
        <h4>How to choose</h4>
        <ul>
          <li>Use <strong>30 to 50</strong> for daily stock market data (captures 1 to 2 months of market structure).</li>
          <li>Use <strong>14 to 30</strong> for highly volatile markets like Crypto.</li>
        </ul>
      </div>
      <div class="trade-off-box">
        <span>Trade-off</span>
        <p>A smaller window makes the risk index highly sensitive and fast to react, but it may produce "false alarms" (noise). A larger window gives more reliable signals but might be too slow.</p>
      </div>
    `,
  },
  dim: {
    title: "Embedding Dimension",
    content: `
      <div class="help-section">
        <h4>What it does</h4>
        <p>Represents the number of dimensions (e.g., 2D, 3D, 4D) the algorithm uses to "unfold" the flat price chart into a geometric shape (Point Cloud) to find hidden structural holes.</p>
      </div>
      <div class="help-section">
        <h4>How to choose</h4>
        <ul>
          <li><strong>3</strong> is the industry standard for financial time series. It perfectly balances accuracy and computational speed.</li>
          <li><strong>4 or 5</strong> can be used for very complex, multi-variable markets, but requires a larger Window Size.</li>
        </ul>
      </div>
      <div class="trade-off-box">
        <span>Trade-off</span>
        <p>Do not set to 1 or 2 (too flat). Higher values (6+) will slow down the app significantly and require massive amounts of data.</p>
      </div>
    `,
  },
  delay: {
    title: "Time Delay (τ)",
    content: `
      <div class="help-section">
        <h4>What it does</h4>
        <p>Determines the spacing (gap) between the data points used to build the multi-dimensional shape. E.g., a delay of 1 groups [1, 2, 3]; delay of 2 groups [1, 3, 5].</p>
      </div>
      <div class="help-section">
        <h4>How to choose</h4>
        <ul>
          <li>Leave it at <strong>1</strong> for standard daily financial charts (Open/Close prices).</li>
          <li>Increase to <strong>2 or 3</strong> only for extremely high-frequency data (tick or 1-minute charts).</li>
        </ul>
      </div>
      <div class="trade-off-box">
        <span>Trade-off</span>
        <p>A delay of 1 ensures no data is skipped. High delays skip data, causing the algorithm to lose the sequence of market events.</p>
      </div>
    `,
  },
};

function setupHelpDocumentation() {
  const triggers = $$(".help-trigger");
  const card = $("#help-card");
  const backdrop = $("#help-backdrop");
  const title = $("#help-title");
  const content = $("#help-content");
  const closeBtn = $("#close-help");

  if (!card || !triggers.length) return;

  const showHelp = (type) => {
    const data = helpData[type];
    if (data) {
      title.textContent = data.title;
      content.innerHTML = data.content;
      card.classList.remove("hidden");
      if (backdrop) backdrop.classList.remove("hidden");
      document.body.style.overflow = "hidden"; // Prevent scroll when open
    }
  };

  const hideHelp = () => {
    card.classList.add("hidden");
    if (backdrop) backdrop.classList.add("hidden");
    document.body.style.overflow = "";
  };

  triggers.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showHelp(btn.dataset.help);
    });
  });

  if (closeBtn) closeBtn.addEventListener("click", hideHelp);
  if (backdrop) backdrop.addEventListener("click", hideHelp);

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideHelp();
  });
}
