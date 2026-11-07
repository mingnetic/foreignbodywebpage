import { DEFAULT_PARAMETERS } from './simulation-core.js';

const form = document.querySelector('#simulation-form');
const runButton = document.querySelector('#run-button');
const resetButton = document.querySelector('#reset-button');
const progressPanel = document.querySelector('#progress-panel');
const progressBar = document.querySelector('#progress-bar');
const progressText = document.querySelector('#progress-text');
const errorBox = document.querySelector('#error-box');
const warningBox = document.querySelector('#warning-box');
const resultsEmpty = document.querySelector('#results-empty');
const resultsContent = document.querySelector('#results-content');
const axialCanvas = document.querySelector('#axial-canvas');
const coronalCanvas = document.querySelector('#coronal-canvas');
const legendGradient = document.querySelector('#legend-gradient');
const legendMin = document.querySelector('#legend-min');
const legendMid = document.querySelector('#legend-mid');
const legendMax = document.querySelector('#legend-max');
const legendTitle = document.querySelector('#legend-title');
const viewDescription = document.querySelector('#view-description');
const diagnosticGrid = document.querySelector('#diagnostic-grid');
const downloadImageButton = document.querySelector('#download-image');
const downloadMetadataButton = document.querySelector('#download-metadata');

let activeWorker = null;
let currentResult = null;
let currentView = 'phase';

const inputMap = {
  chiMediumPpm: 'chi-medium',
  chiBodyPpm: 'chi-body',
  bodyDiameterMm: 'diameter',
  b0Tesla: 'b0',
  teMs: 'te',
  b0Direction: 'b0-direction',
  phaseSign: 'phase-sign',
  fovMm: 'fov',
  voxelMm: 'voxel',
  simulationSpacingMm: 'sim-spacing',
  farFieldToleranceRad: 'field-tolerance',
  signalThreshold: 'signal-threshold',
  displayHalfWidthMm: 'display-width',
  maskLowSignal: 'mask-low-signal',
};

function setFormValues(values) {
  for (const [key, id] of Object.entries(inputMap)) {
    const element = document.getElementById(id);
    if (element.type === 'checkbox') element.checked = Boolean(values[key]);
    else element.value = String(values[key]);
  }
}

function collectParameters() {
  const values = {};
  for (const [key, id] of Object.entries(inputMap)) {
    const element = document.getElementById(id);
    values[key] = element.type === 'checkbox' ? element.checked : element.value;
  }
  values.phaseSign = Number(values.phaseSign);
  return values;
}

function setBusy(busy) {
  runButton.disabled = busy;
  resetButton.disabled = busy;
  runButton.querySelector('span').textContent = busy ? 'Running…' : 'Run simulation';
  progressPanel.hidden = !busy;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function runSimulation() {
  showError('');
  warningBox.hidden = true;
  setBusy(true);
  progressBar.style.width = '2%';
  progressText.textContent = 'Preparing simulation…';
  if (activeWorker) activeWorker.terminate();
  activeWorker = new Worker('./simulation-worker.js', { type: 'module' });

  activeWorker.onmessage = (event) => {
    if (event.data.type === 'progress') {
      progressBar.style.width = `${Math.max(2, event.data.fraction * 100)}%`;
      progressText.textContent = event.data.message;
      return;
    }
    if (event.data.type === 'error') {
      setBusy(false);
      showError(event.data.message);
      activeWorker.terminate();
      activeWorker = null;
      return;
    }
    if (event.data.type === 'result') {
      currentResult = event.data.result;
      setBusy(false);
      activeWorker.terminate();
      activeWorker = null;
      resultsEmpty.hidden = true;
      resultsContent.hidden = false;
      renderAll();
    }
  };
  activeWorker.onerror = (event) => {
    setBusy(false);
    showError(event.message || 'The browser worker failed to start.');
  };
  activeWorker.postMessage({ type: 'simulate', parameters: collectParameters() });
}

function cropBounds(parameters, diagnostics) {
  const half = Math.min(Number(document.getElementById('display-width').value), diagnostics.realisedFovMm / 2);
  const center = Math.floor(diagnostics.matrixSize / 2);
  const pixels = Math.max(1, Math.round(half / parameters.voxelMm));
  return {
    start: Math.max(0, center - pixels),
    end: Math.min(diagnostics.matrixSize - 1, center + pixels),
    half,
  };
}

function percentileLimit(first, second, diagnostics, parameters) {
  const { start, end } = cropBounds(parameters, diagnostics);
  const values = [];
  const n = diagnostics.matrixSize;
  for (let row = start; row <= end; row += 1) {
    for (let column = start; column <= end; column += 1) {
      const index = row * n + column;
      values.push(Math.abs(first[index]), Math.abs(second[index]));
    }
  }
  values.sort((a, b) => a - b);
  return Math.max(values[Math.floor(0.995 * (values.length - 1))] || 0, Number.EPSILON);
}

function interpolate(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function divergingColour(value, limit) {
  const blue = [37, 99, 235];
  const white = [248, 250, 252];
  const red = [220, 38, 38];
  const t = Math.max(0, Math.min(1, (value / limit + 1) / 2));
  const from = t < 0.5 ? blue : white;
  const to = t < 0.5 ? white : red;
  const local = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [
    interpolate(from[0], to[0], local),
    interpolate(from[1], to[1], local),
    interpolate(from[2], to[2], local),
  ];
}

function formatTick(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1) return value.toFixed(1);
  if (absolute >= 0.01) return value.toFixed(2);
  return value.toExponential(1);
}

function drawHeatmap(canvas, data, magnitude, verticalLabel, scale) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const width = 620;
  const height = 620;
  canvas.width = width;
  canvas.height = height;
  const margin = { left: 72, right: 20, top: 18, bottom: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const { parameters, diagnostics } = currentResult;
  const { start, end, half } = cropBounds(parameters, diagnostics);
  const sourceSpan = Math.max(1, end - start);
  const image = ctx.createImageData(plotWidth, plotHeight);
  const n = diagnostics.matrixSize;
  const threshold = Number(document.getElementById('signal-threshold').value);
  const mask = document.getElementById('mask-low-signal').checked;

  for (let py = 0; py < plotHeight; py += 1) {
    const sourceRow = Math.round(start + (plotHeight - 1 - py) / (plotHeight - 1) * sourceSpan);
    for (let px = 0; px < plotWidth; px += 1) {
      const sourceColumn = Math.round(start + px / (plotWidth - 1) * sourceSpan);
      const sourceIndex = sourceRow * n + sourceColumn;
      const pixelIndex = (py * plotWidth + px) * 4;
      let colour;
      if (currentView === 'field') {
        colour = divergingColour(data[sourceIndex], scale);
      } else if (currentView === 'phase') {
        if (mask && magnitude[sourceIndex] < threshold) colour = [208, 0, 255];
        else {
          const grey = Math.round(255 * Math.max(0, Math.min(1, (data[sourceIndex] + Math.PI) / (2 * Math.PI))));
          colour = [grey, grey, grey];
        }
      } else {
        const grey = Math.round(255 * Math.max(0, Math.min(1, data[sourceIndex])));
        colour = [grey, grey, grey];
      }
      image.data[pixelIndex] = colour[0];
      image.data[pixelIndex + 1] = colour[1];
      image.data[pixelIndex + 2] = colour[2];
      image.data[pixelIndex + 3] = 255;
    }
  }
  ctx.putImageData(image, margin.left, margin.top);

  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin.left + 0.5, margin.top + 0.5, plotWidth, plotHeight);
  ctx.fillStyle = '#334155';
  ctx.font = '14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < 5; i += 1) {
    const fraction = i / 4;
    const x = margin.left + fraction * plotWidth;
    const value = -half + fraction * 2 * half;
    ctx.beginPath();
    ctx.moveTo(x, margin.top + plotHeight);
    ctx.lineTo(x, margin.top + plotHeight + 5);
    ctx.stroke();
    ctx.fillText(formatTick(value), x, margin.top + plotHeight + 9);
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = '15px Inter, system-ui, sans-serif';
  ctx.fillText('x (mm)', margin.left + plotWidth / 2, height - 23);

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#334155';
  ctx.font = '14px Inter, system-ui, sans-serif';
  for (let i = 0; i < 5; i += 1) {
    const fraction = i / 4;
    const y = margin.top + plotHeight - fraction * plotHeight;
    const value = -half + fraction * 2 * half;
    ctx.beginPath();
    ctx.moveTo(margin.left - 5, y);
    ctx.lineTo(margin.left, y);
    ctx.stroke();
    ctx.fillText(formatTick(value), margin.left - 10, y);
  }
  ctx.translate(19, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = '15px Inter, system-ui, sans-serif';
  ctx.fillText(verticalLabel, 0, 0);
  ctx.restore();
}

function diagnosticCard(label, value, detail = '') {
  return `<div class="diagnostic-card"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</div>`;
}

function renderDiagnostics() {
  const d = currentResult.diagnostics;
  diagnosticGrid.innerHTML = [
    diagnosticCard('MRI plane', `${d.matrixSize} × ${d.matrixSize}`, `${d.realisedFovMm.toFixed(2)} mm FOV`),
    diagnosticCard('Fine grid', `${d.subsamplesPerAxis}<sup>3</sup>`, `${d.simulationSpacingMm.toFixed(6)} mm spacing`),
    diagnosticCard('Local ROI', `${d.localRoiPixels} × ${d.localRoiPixels}`, `${(d.estimatedFineSamples / 1e6).toFixed(2)} M samples, two planes`),
    diagnosticCard('Δχ', `${d.deltaChiPpm >= 0 ? '+' : ''}${d.deltaChiPpm.toFixed(4)} ppm`),
    diagnosticCard('Minimum magnitude', d.minimumMagnitude.toFixed(4)),
    diagnosticCard('Particle fraction', `${(100 * d.maximumBodyFraction).toFixed(2)}%`, 'maximum in one MRI voxel'),
    diagnosticCard('Runtime', `${(d.runtimeMs / 1000).toFixed(2)} s`, 'on this device'),
  ].join('');
}

function renderLegend(fieldLimit) {
  if (currentView === 'field') {
    legendGradient.style.background = 'linear-gradient(90deg, #2563eb, #f8fafc 50%, #dc2626)';
    legendMin.textContent = `−${fieldLimit.toPrecision(3)}`;
    legendMid.textContent = '0';
    legendMax.textContent = `+${fieldLimit.toPrecision(3)}`;
    legendTitle.textContent = 'Local field shift (ppm)';
    viewDescription.textContent = 'Analytic 3D field sampled at MRI-voxel centres.';
  } else if (currentView === 'phase') {
    legendGradient.style.background = 'linear-gradient(90deg, #000, #808080 50%, #fff)';
    legendMin.textContent = '−π';
    legendMid.textContent = '0';
    legendMax.textContent = '+π';
    legendTitle.textContent = 'Wrapped GRE phase (rad)';
    viewDescription.textContent = '3D complex-averaged GRE phase at the selected TE.';
  } else {
    legendGradient.style.background = 'linear-gradient(90deg, #000, #fff)';
    legendMin.textContent = '0';
    legendMid.textContent = '0.5';
    legendMax.textContent = '1';
    legendTitle.textContent = 'Relative signal magnitude';
    viewDescription.textContent = 'Particle partial volume and static intravoxel dephasing only.';
  }
}

function renderPlots() {
  if (!currentResult) return;
  const { arrays, diagnostics, parameters } = currentResult;
  const fieldLimit = percentileLimit(arrays.fieldAxialPpm, arrays.fieldCoronalPpm, diagnostics, parameters);
  let axial;
  let coronal;
  if (currentView === 'field') {
    axial = arrays.fieldAxialPpm;
    coronal = arrays.fieldCoronalPpm;
  } else if (currentView === 'phase') {
    axial = arrays.phaseAxialRad;
    coronal = arrays.phaseCoronalRad;
  } else {
    axial = arrays.magnitudeAxial;
    coronal = arrays.magnitudeCoronal;
  }
  drawHeatmap(axialCanvas, axial, arrays.magnitudeAxial, 'y (mm)', fieldLimit);
  drawHeatmap(coronalCanvas, coronal, arrays.magnitudeCoronal, 'z (mm)', fieldLimit);
  renderLegend(fieldLimit);
}

function renderWarnings() {
  if (!currentResult.warnings.length) {
    warningBox.hidden = true;
    return;
  }
  warningBox.innerHTML = currentResult.warnings.map((warning) => `<div>${warning}</div>`).join('');
  warningBox.hidden = false;
}

function renderAll() {
  renderDiagnostics();
  renderWarnings();
  renderPlots();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

resetButton.addEventListener('click', () => {
  setFormValues(DEFAULT_PARAMETERS);
  runSimulation();
});

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    currentView = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach((candidate) => {
      candidate.classList.toggle('active', candidate === button);
      candidate.setAttribute('aria-selected', String(candidate === button));
    });
    renderPlots();
  });
});

['display-width', 'signal-threshold', 'mask-low-signal'].forEach((id) => {
  document.getElementById(id).addEventListener('change', renderPlots);
});

downloadImageButton.addEventListener('click', () => {
  if (!currentResult) return;
  const composite = document.createElement('canvas');
  composite.width = 1260;
  composite.height = 720;
  const ctx = composite.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, composite.width, composite.height);
  ctx.fillStyle = '#0f172a';
  ctx.font = '600 27px Inter, system-ui, sans-serif';
  ctx.fillText('Foreign-body GRE simulation', 28, 38);
  ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(`${currentView.toUpperCase()} • ${legendTitle.textContent}`, 28, 67);
  ctx.fillStyle = '#0f172a';
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillText('Axial', 30, 101);
  ctx.fillText('Coronal', 660, 101);
  ctx.drawImage(axialCanvas, 10, 110, 610, 610);
  ctx.drawImage(coronalCanvas, 640, 110, 610, 610);
  composite.toBlob((blob) => downloadBlob(blob, `foreign-body-gre-${currentView}.png`), 'image/png');
});

downloadMetadataButton.addEventListener('click', () => {
  if (!currentResult) return;
  const payload = {
    model: 'Analytic 3D spherical dipole field with local 3D complex voxel integration',
    generatedAt: new Date().toISOString(),
    parameters: currentResult.parameters,
    diagnostics: currentResult.diagnostics,
    warnings: currentResult.warnings,
    limitations: 'No intrinsic T2*, diffusion, noise, k-space PSF, readout distortion, vendor phase processing or MRI-safety prediction.',
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'foreign-body-gre-metadata.json');
});

setFormValues(DEFAULT_PARAMETERS);
runSimulation();

