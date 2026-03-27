/* =================================================================
   RangeRover — app.js
   Probabilistic Volume Screener with Multi-Reservoir Support
   ================================================================= */

/* ===== 1. GLOBALS & STATE ===== */
let previewTimer = null;
let lastSim = null;
let syncing = false;
let lastSimulationData = null;

/* Advanced mode state */
let advancedMode = false;
let reservoirs = [];       // array of reservoir config objects
let activeReservoirIdx = 0;
let lastMultiResults = null;  // stored multi-reservoir results

/* ===== 2. UNITS ===== */
const AREA_FACTORS = { m2: 0.000247105, km2: 247.105, acres: 1.0, ft2: 2.2957e-5 };
const THICK_FACTORS = { m: 3.28084, ft: 1.0 };
const GRV_FACTORS = {
  'acre-ft': 1e6,
  'ft^3': (1e9 / 43560),
  'm^3': (1e6 / 1233.48184)
};

/* ===== 3. FLUID CONFIGS ===== */
function geometryMode() {
  const sel = document.getElementById('geometryMode');
  return sel ? sel.value : 'area-thickness';
}

function paramsFor(fluid) {
  const geom = geometryMode();
  const geomParams = (geom === 'grv') ? [{ name: "GRV" }] : [{ name: "Area" }, { name: "Thickness" }];
  if (fluid === 'gas')
    return [...geomParams, { name: "Net to Gross", isFrac: true }, { name: "Porosity", isFrac: true }, { name: "Water Saturation", isFrac: true }, { name: "Bg", pos: true }];
  if (fluid === 'csg')
    return [...geomParams, { name: "Coal Density", pos: true }, { name: "Gas Content", pos: true }];
  if (fluid === 'oilgas')
    return [...geomParams, { name: "Net to Gross", isFrac: true }, { name: "Porosity", isFrac: true }, { name: "Water Saturation", isFrac: true }, { name: "Bo", pos: true }, { name: "Rs", pos: true }];
  if (fluid === 'gasvo')
    return [...geomParams, { name: "Net to Gross", isFrac: true }, { name: "Porosity", isFrac: true }, { name: "Water Saturation", isFrac: true }, { name: "Bg", pos: true }, { name: "Rv", pos: true }];
  return [...geomParams, { name: "Net to Gross", isFrac: true }, { name: "Porosity", isFrac: true }, { name: "Water Saturation", isFrac: true }, { name: "Bo", pos: true }];
}

function labelsFor(fluid) {
  if (fluid === 'gas') {
    return { primary: "GIIP", unit: "BCF", xMain: "GIIP (BCF)", xRec: "Recoverable (BCF)",
      cdfTitle: "GIIP CDF", histTitle: "GIIP Histogram", metricRec: "Recoverable GIIP",
      formula: 'Formula (Gas): <code>GIIP = 43,560 × A × h × NTG × φ × (1 − Sw) / Bg</code> (SCF; plots in BCF).'
    };
  }
  if (fluid === 'csg') {
    return { primary: "GIIP", unit: "BCF", xMain: "GIIP (BCF)", xRec: "Recoverable (BCF)",
      cdfTitle: "GIIP CDF", histTitle: "GIIP Histogram", metricRec: "Recoverable GIIP",
      formula: 'Formula (Coal Seam Gas): <code>GIIP = 48,013 × A × h × ρ<sub>coal</sub> × G<sub>c</sub></code> where ρ<sub>coal</sub> = coal density (g/cm³), G<sub>c</sub> = gas content (m³/ton). Result in SCF; plots in BCF.'
    };
  }
  if (fluid === 'gasvo') {
    return { primary: "GIIP", unit: "BCF", xMain: "GIIP (BCF)", xRec: "Recoverable (BCF)",
      cdfTitle: "GIIP CDF", histTitle: "GIIP Histogram", metricRec: "Recoverable GIIP",
      formula: 'Formula (Gas + Vaporized Oil): <code>GIIP = 43,560 × A × h × NTG × φ × (1 − Sw) / Bg</code> (SCF; plots in BCF). Vaporized oil from gas cap: <code>VO = 43,560 × A × h × NTG × φ × (1 − Sw) × Rv / Bg</code> (STB). Total MMBOE = GIIP(MMBOE) + VO(MMBO).'
    };
  }
  return { primary: "STOIIP", unit: "MMBO", xMain: "STOIIP (MMBO)", xRec: "Recoverable (MMBO)",
    cdfTitle: "STOIIP CDF", histTitle: "STOIIP Histogram", metricRec: "Recoverable STOIIP",
    formula: 'Formula (Oil): <code>STOIIP = 7758 × A × h × NTG × φ × (1 − Sw) / Bo</code> (STB; plots in MMBO).'
  };
}

function labelsForFluidMetric(fluid, metric) {
  if (fluid === 'oilgas') {
    if (metric === 'stoiip') return labelsFor('oil');
    if (metric === 'giip') return {
      primary: 'GIIP', unit: 'BCF', xMain: 'GIIP (BCF)', xRec: 'Recoverable (BCF)',
      cdfTitle: 'GIIP CDF', histTitle: 'GIIP Histogram', metricRec: 'Recoverable GIIP',
      formula: 'Formula (Solution Gas): <code>GIIP = 7758 × A × h × NTG × φ × (1 − Sw) × Rs / Bo</code> (SCF; plots in BCF).'
    };
    return {
      primary: 'Total MMBOE', unit: 'MMBOE', xMain: 'Total (MMBOE)', xRec: 'Recoverable (MMBOE)',
      cdfTitle: 'Total MMBOE CDF', histTitle: 'Total MMBOE Histogram', metricRec: 'Recoverable MMBOE',
      formula: 'Formula (Total): <code>Total MMBOE = STOIIP + GIIP</code> (plots in MMBOE).'
    };
  }
  if (fluid === 'gasvo') {
    if (metric === 'giip') return labelsFor('gas');
    if (metric === 'vo') return {
      primary: 'Vaporized Oil', unit: 'MMBO', xMain: 'Vaporized Oil (MMBO)', xRec: 'Recoverable (MMBO)',
      cdfTitle: 'Vaporized Oil CDF', histTitle: 'Vaporized Oil Histogram', metricRec: 'Recoverable Vaporized Oil',
      formula: 'Formula (Vaporized Oil): <code>VO = 43,560 × A × h × NTG × φ × (1 − Sw) × Rv / Bg</code> (STB; plots in MMBO).'
    };
    return {
      primary: 'Total MMBOE', unit: 'MMBOE', xMain: 'Total (MMBOE)', xRec: 'Recoverable (MMBOE)',
      cdfTitle: 'Total MMBOE CDF', histTitle: 'Total MMBOE Histogram', metricRec: 'Recoverable MMBOE',
      formula: 'Formula (Total): <code>Total MMBOE = GIIP(MMBOE) + Vaporized Oil (MMBO)</code>.'
    };
  }
  return labelsFor(fluid);
}

/* ===== 4. RNG & DISTRIBUTIONS ===== */
const Z90 = 1.2815515655446004;
function normalFromP90P50P10(p90, p50, p10) { return { mean: p50, sigma: (p10 - p90) / (2 * Z90) }; }
function mulberry32(a) { return function () { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seeded(s) { if (!s) return Math.random; let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return mulberry32(h >>> 0); }
function sampleTriangular(r, min, mode, max) { if (!(min <= mode && mode <= max)) return NaN; const u = r(), c = (mode - min) / (max - min); return (u < c) ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode)); }
function sampleUniform(r, min, max) { if (min > max) return NaN; return min + (max - min) * r(); }
function sampleNormal(r, mean, std) { if (std < 0) return NaN; let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); return mean + std * z; }

function sampleGamma(r, k, theta = 1) {
  if (k <= 0 || !Number.isFinite(k)) return NaN;
  if (k < 1) { const u = r(); return sampleGamma(r, k + 1, theta) * Math.pow(u, 1 / k); }
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { let u = 0, v0 = 0; while (u === 0) u = r(); while (v0 === 0) v0 = r(); x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v0); v = Math.pow(1 + c * x, 3); } while (v <= 0);
    const u2 = r();
    if (u2 < 1 - 0.0331 * Math.pow(x, 4)) return d * v * theta;
    if (Math.log(u2) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta;
  }
}

function sampleBeta(r, a, b) {
  if (!(a > 0 && b > 0)) return NaN;
  const x = sampleGamma(r, a, 1), y = sampleGamma(r, b, 1);
  return x / (x + y);
}

function samplePERT(r, a, m, b, lambda = 4) {
  if (!(a < b) || !(a <= m && m <= b)) return NaN;
  const alpha = 1 + lambda * (m - a) / (b - a);
  const beta = 1 + lambda * (b - m) / (b - a);
  const u = sampleBeta(r, alpha, beta);
  return a + u * (b - a);
}

function isFrac(name) { return ["Net to Gross", "Porosity", "Water Saturation", "Recovery Factor"].includes(name); }

/* ===== 5. PHYSICAL BOUNDS & TRUNCATION ===== */
function boundsFor(name, fluid) {
  if (name === 'Area' || name === 'Thickness' || name === 'GRV') return { min: 1e-9, max: Infinity };
  if (isFrac(name)) return { min: 0, max: 1 };
  if (name === 'Bo') return { min: 1.0, max: Infinity };
  if (name === 'Bg') return { min: 1e-9, max: Infinity };
  if (name === 'Rv') return { min: 0, max: Infinity };
  if (name === 'Coal Density') return { min: 0.1, max: Infinity };
  if (name === 'Gas Content') return { min: 0, max: Infinity };
  return { min: -Infinity, max: Infinity };
}

function sampleNormalTrunc(r, mean, std, min, max) {
  for (let k = 0; k < 32; k++) { const x = sampleNormal(r, mean, std); if (x >= min && x <= max) return x; }
  return Math.max(min, Math.min(max, mean));
}

/* ===== 6. UNIT CONVERSION ===== */
const FLUID = document.getElementById('fluid');
const AREA = document.getElementById('areaUnit');
const THICK = document.getElementById('thicknessUnit');
let GRV_UNIT = null;
let PARAMS = paramsFor('oil');

const DIST_LABELS = {
  "Discrete": ["Value 1", "Value 2", "Value 3"],
  "Triangular": ["Min", "Mode", "Max"],
  "Uniform": ["Min", "(ignore)", "Max"],
  "Normal": ["Mean", "Std Dev", "(ignore)"],
  "Known Distribution": ["P90 (Low)", "P50 (Median)", "P10 (High)"],
  "PERT": ["Min", "Mode", "Max"]
};

function xLabelFor(name) {
  if (isFrac(name)) return 'Percent (%)';
  if (name === 'Area') return AREA.options[AREA.selectedIndex].text;
  if (name === 'Thickness') return THICK.options[THICK.selectedIndex].text;
  if (name === 'GRV') { const sel = document.getElementById('grvUnit'); return sel ? sel.options[sel.selectedIndex].text : 'acre-ft'; }
  if (name === 'Bo') return 'RB/STB';
  if (name === 'Bg') return 'scf/SCF';
  if (name === 'Rs') return 'scf/bbl';
  if (name === 'Rv') return 'bbl/scf';
  return '';
}

function convTriplet(name, arr) {
  const t = arr.slice();
  if (name === 'Area') { const f = AREA_FACTORS[AREA.value]; for (let i = 0; i < t.length; i++) if (!Number.isNaN(t[i])) t[i] *= f; }
  if (name === 'Thickness') { const f = THICK_FACTORS[THICK.value]; for (let i = 0; i < t.length; i++) if (!Number.isNaN(t[i])) t[i] *= f; }
  if (name === 'GRV') { const u = document.getElementById('grvUnit'); const key = u ? u.value : 'acre-ft'; const f = GRV_FACTORS[key] || 1; for (let i = 0; i < t.length; i++) if (!Number.isNaN(t[i])) t[i] *= f; }
  return t;
}

function discreteValsAndWeights(rawVals, weightPercents) {
  const vals = [];
  for (let i = 0; i < 3; i++) { const v = rawVals[i]; if (Number.isFinite(v)) vals.push(v); }
  const n = vals.length;
  if (n === 0) return { vals: [], weights: [] };
  let wInputs = Array.isArray(weightPercents) ? weightPercents : [...weightPercents].map(e => Number(e.value));
  const wFiltered = [];
  for (let i = 0; i < 3; i++) {
    const v = rawVals[i];
    if (Number.isFinite(v)) {
      const w = (Number.isFinite(wInputs[i]) && wInputs[i] >= 0) ? wInputs[i] : NaN;
      wFiltered.push(w);
    }
  }
  const allMissing = wFiltered.every(x => !Number.isFinite(x));
  if (allMissing) return { vals, weights: Array(n).fill(1 / n) };
  const zeros = wFiltered.map(x => Number.isFinite(x) ? x : 0);
  let sum = zeros.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { vals, weights: Array(n).fill(1 / n) };
  const weights = zeros.map(x => x / sum);
  return { vals, weights };
}

/* ===== 7. VOLUME COMPUTATION (REFACTORED) ===== */
function computeVolumeSingle(fluid, metric, AH, params) {
  const NTG = params['Net to Gross'];
  const PHI = params['Porosity'];
  const SW = params['Water Saturation'];
  switch (fluid) {
    case 'oil':
      return (7758 * AH * NTG * PHI * (1 - SW) / params['Bo']) / 1e6;
    case 'gas':
      return (43560 * AH * NTG * PHI * (1 - SW) / params['Bg']) / 1e9;
    case 'csg':
      return (48013 * AH * params['Coal Density'] * params['Gas Content']) / 1e9;
    case 'oilgas': {
      const stoiip = (7758 * AH * NTG * PHI * (1 - SW) / params['Bo']) / 1e6;
      const giipBCF = (7758 * AH * NTG * PHI * (1 - SW) * params['Rs'] / params['Bo']) / 1e9;
      const giipBOE = (7758 * AH * NTG * PHI * (1 - SW) * params['Rs'] / params['Bo']) / 5.8e9;
      if (metric === 'stoiip') return stoiip;
      if (metric === 'giip') return giipBCF;
      return stoiip + giipBOE;
    }
    case 'gasvo': {
      const giip = (43560 * AH * NTG * PHI * (1 - SW) / params['Bg']) / 1e9;
      const giipBOE = (43560 * AH * NTG * PHI * (1 - SW) / params['Bg']) / 5.8e9;
      const vo = (43560 * AH * NTG * PHI * (1 - SW) * params['Rv'] / params['Bg']) / 1e6;
      if (metric === 'giip') return giip;
      if (metric === 'vo') return vo;
      return giipBOE + vo;
    }
  }
  return NaN;
}

function volumeToMBOE(value, fluid, metric) {
  if (fluid === 'oil') return value;
  if (fluid === 'gas' || fluid === 'csg') return value / 5.8;
  if (fluid === 'oilgas') {
    if (metric === 'stoiip') return value;
    if (metric === 'giip') return value / 5.8;
    return value;
  }
  if (fluid === 'gasvo') {
    if (metric === 'giip') return value / 5.8;
    if (metric === 'vo') return value;
    return value;
  }
  return value;
}

/* ===== 8. IMAN-CONOVER RANK CORRELATION ENGINE ===== */
function choleskyL(matrix) {
  const n = matrix.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const diag = matrix[i][i] - sum;
        if (diag < -1e-10) return null; // not positive definite
        L[i][j] = Math.sqrt(Math.max(0, diag));
      } else {
        L[i][j] = L[j][j] > 1e-15 ? (matrix[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  return L;
}

function isPositiveDefinite(matrix) {
  return choleskyL(matrix) !== null;
}

function rankArray(arr) {
  const n = arr.length;
  const indexed = Array.from(arr, (v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(n);
  for (let i = 0; i < n; i++) ranks[indexed[i].i] = i;
  return ranks;
}

function imanConover(sampleColumns, targetCorr) {
  // sampleColumns: array of Float64Arrays, each length n
  // targetCorr: k×k Spearman correlation matrix
  // Returns: reordered sampleColumns (new arrays, originals unchanged)
  const k = sampleColumns.length;
  const n = sampleColumns[0].length;
  if (k <= 1) return sampleColumns.map(c => Float64Array.from(c));

  // Check if all correlations are zero (independent) — skip if so
  let allZero = true;
  for (let i = 0; i < k && allZero; i++)
    for (let j = 0; j < k && allZero; j++)
      if (i !== j && Math.abs(targetCorr[i][j]) > 1e-10) allZero = false;
  if (allZero) return sampleColumns.map(c => Float64Array.from(c));

  const L = choleskyL(targetCorr);
  if (!L) return sampleColumns.map(c => Float64Array.from(c)); // fallback if not PD

  // Step 1: Generate independent standard normal scores with deterministic RNG
  const rng = mulberry32(98765);
  const normalScores = [];
  for (let j = 0; j < k; j++) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let u1 = 0, u2 = 0;
      while (u1 === 0) u1 = rng();
      while (u2 === 0) u2 = rng();
      col[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    normalScores.push(col);
  }

  // Step 2: Apply Cholesky factor to normal scores → correlated normal scores
  const correlated = [];
  for (let i = 0; i < k; i++) {
    const col = new Float64Array(n);
    for (let s = 0; s < n; s++) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += L[i][j] * normalScores[j][s];
      col[s] = sum;
    }
    correlated.push(col);
  }

  // Step 3: Get target ranks from correlated normal scores
  const targetRanks = correlated.map(col => rankArray(col));

  // Step 4: Reorder each sample column to match target ranks
  const result = [];
  for (let j = 0; j < k; j++) {
    const sorted = Array.from(sampleColumns[j]).sort((a, b) => a - b);
    const reordered = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      reordered[i] = sorted[Math.round(targetRanks[j][i])];
    }
    result.push(reordered);
  }
  return result;
}

/* ===== 9. DRAW ONE SAMPLE ===== */
function drawOne(rng, type, vals, name, weightsPerc, fluid) {
  const { min, max } = boundsFor(name, fluid);
  if (type === 'Discrete') {
    const { vals: dVals, weights } = discreteValsAndWeights(vals, weightsPerc);
    if (dVals.length === 0) return NaN;
    const u = rng();
    let acc = 0;
    for (let i = 0; i < dVals.length; i++) { acc += weights[i]; if (u <= acc) return Math.max(min, Math.min(max, dVals[i])); }
    return Math.max(min, Math.min(max, dVals[dVals.length - 1]));
  } else if (type === 'Triangular') {
    return sampleTriangular(rng, vals[0], vals[1], vals[2]);
  } else if (type === 'Uniform') {
    return sampleUniform(rng, vals[0], vals[2]);
  } else if (type === 'Normal') {
    return sampleNormalTrunc(rng, vals[0], vals[1], min, max);
  } else if (type === 'PERT') {
    const x = samplePERT(rng, vals[0], vals[1], vals[2], 4);
    return Math.max(min, Math.min(max, x));
  } else { // Known Distribution
    const { mean, sigma } = normalFromP90P50P10(vals[0], vals[1], vals[2]);
    return sampleNormalTrunc(rng, mean, sigma, min, max);
  }
}

/* ===== 10. DETERMINISTIC & SENSITIVITY HELPERS ===== */
const Z = Z90;
function mostLikely(type, v, wPerc) {
  if (type === 'Normal') return v[0];
  if (type === 'Triangular' || type === 'PERT') return v[1];
  if (type === 'Uniform') return (v[0] + v[2]) / 2;
  if (type === 'Known Distribution') return v[1];
  if (type === 'Discrete') {
    const { vals, weights } = discreteValsAndWeights(v, wPerc);
    if (vals.length === 0) return NaN;
    let maxIdx = 0, maxW = -1;
    for (let i = 0; i < weights.length; i++) { if (weights[i] > maxW) { maxW = weights[i]; maxIdx = i; } }
    return vals[maxIdx];
  }
  return NaN;
}

function lowHighFrom(type, v) {
  if (type === 'Triangular' || type === 'Uniform' || type === 'PERT') return { low: v[0], high: v[2] };
  if (type === 'Normal') return { low: v[0] - Z * v[1], high: v[0] + Z * v[1] };
  if (type === 'Known Distribution') return { low: v[0], high: v[2] };
  const xs = v.filter(Number.isFinite).sort((a, b) => a - b);
  return { low: xs[0] ?? NaN, high: xs[xs.length - 1] ?? NaN };
}

/* ===== 11. NUMBER FORMATTING ===== */
function formatWithCommas(num, decimals) {
  if (!Number.isFinite(num)) return 'NaN';
  const fixed = num.toFixed(decimals);
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/* ===== 12. SIMULATE RESERVOIR (REFACTORED CORE) ===== */
function sampleReservoir(config, rng) {
  const { dists, rfType, rfRaw, rfPerc, fluid, iterations } = config;
  const n = iterations;
  const samples = {};
  for (const d of dists) samples[d.name] = new Float64Array(n);
  samples['Recovery Factor'] = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (const d of dists) {
      samples[d.name][i] = drawOne(rng, d.type, d.v, d.name, d.wPerc, fluid);
    }
    samples['Recovery Factor'][i] = drawOne(rng, rfType, rfRaw, 'Recovery Factor', rfPerc, fluid);
  }
  return samples;
}

function computeReservoirVolumes(fluid, metric, samples, dists, useGRV) {
  const n = samples['Recovery Factor'].length;
  const primary = new Float64Array(n);
  const rec = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const AH = useGRV ? samples['GRV'][i] : (samples['Area'][i] * samples['Thickness'][i]);
    const p = {};
    for (const d of dists) p[d.name] = samples[d.name][i];
    primary[i] = computeVolumeSingle(fluid, metric, AH, p);
    rec[i] = primary[i] * samples['Recovery Factor'][i];
  }
  return { primary, rec };
}

function computeDetMidCase(dists, rfType, rfRaw, rfPerc, fluid, metric, useGRV) {
  const detParams = {};
  for (const d of dists) detParams[d.name] = mostLikely(d.type, d.v, d.wPerc);
  const hasGRV = dists.some(d => d.name === 'GRV');
  const detAH = hasGRV
    ? detParams['GRV']
    : ((detParams['Area'] || 0) * (detParams['Thickness'] || 0));
  const detMidCase = computeVolumeSingle(fluid, metric, detAH, detParams);
  const detRecMidCase = detMidCase * mostLikely(rfType, rfRaw, rfPerc);
  return { detMidCase, detRecMidCase };
}

/* ===== 13. DISPLAY & PLOTTING (CONSOLIDATED) ===== */
function computeQuantiles(arr) {
  const s = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  return n > 0 ? [s[Math.floor(n * 0.1)], s[Math.floor(n * 0.5)], s[Math.floor(n * 0.9)]] : [NaN, NaN, NaN];
}

function computePercentile(arr, x) {
  const s = Array.from(arr).filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0 || !Number.isFinite(x)) return NaN;
  let lo = 0, hi = s.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid] < x) lo = mid + 1; else hi = mid - 1; }
  const idx = lo;
  return idx < s.length ? (idx + 1) / s.length : 1;
}

function displayResults(primary, rec, detMidCase, detRecMidCase, labelSet, nbins) {
  const fmt = x => (Math.abs(x) >= 100) ? formatWithCommas(x, 0) : formatWithCommas(x, 2);
  const [P90, P50, P10] = computeQuantiles(primary);
  const [RP90, RP50, RP10] = computeQuantiles(rec);

  const pDetMain = computePercentile(primary, detMidCase);
  const pValMain = Number.isFinite(pDetMain) ? Math.max(0, Math.min(100, Math.round((1 - pDetMain) * 100))) : NaN;
  const pDetRec = computePercentile(rec, detRecMidCase);
  const pValRec = Number.isFinite(pDetRec) ? Math.max(0, Math.min(100, Math.round((1 - pDetRec) * 100))) : NaN;

  // Update header & table
  document.getElementById('results-title').innerHTML = `Results (${labelSet.unit}) <span class="chip">P90 / P50 / P10</span>`;
  document.getElementById('metric-name').textContent = labelSet.primary;
  document.getElementById('metric-name-rec').textContent = labelSet.metricRec;
  document.getElementById('formula-note').innerHTML = labelSet.formula;

  document.querySelector('.s-p90').textContent = fmt(P90);
  document.querySelector('.s-p50').textContent = fmt(P50);
  document.querySelector('.s-p10').textContent = fmt(P10);
  document.querySelector('.s-mid').textContent = Number.isFinite(pValMain) ? `${fmt(detMidCase)} (P${pValMain})` : fmt(detMidCase);
  document.querySelector('.r-p90').textContent = fmt(RP90);
  document.querySelector('.r-p50').textContent = fmt(RP50);
  document.querySelector('.r-p10').textContent = fmt(RP10);
  document.querySelector('.r-mid').textContent = Number.isFinite(pValRec) ? `${fmt(detRecMidCase)} (P${pValRec})` : fmt(detRecMidCase);

  // Plots
  const config = { displayModeBar: true, responsive: true, toImageButtonOptions: { format: 'png', filename: 'rangerover', width: 1600, height: 1000, scale: 3 } };

  function baseLayout(title, x, y) {
    return {
      autosize: true,
      title: { text: title, font: { size: 19, color: '#111827' }, x: 0.02, xanchor: 'left' },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff',
      margin: { t: 86, l: 90, r: 46, b: 70 },
      xaxis: { title: { text: x, standoff: 10 }, gridcolor: '#EFEFEF', color: '#374151', ticks: 'outside', ticklen: 6, tickwidth: 1, tickcolor: '#e5e7eb', titlefont: { size: 15 }, tickfont: { size: 13 }, automargin: true },
      yaxis: { title: y, gridcolor: '#EFEFEF', color: '#374151', ticks: 'outside', ticklen: 6, tickwidth: 1, tickcolor: '#e5e7eb', titlefont: { size: 15 }, tickfont: { size: 13 }, fixedrange: true },
      hoverlabel: { font: { size: 12 } }, showlegend: false
    };
  }

  function cdf(arr) {
    const s = Array.from(arr).sort((a, b) => a - b);
    const y = s.map((_, i) => (i + 1) / s.length);
    return { x: s, y };
  }

  const vLines = xs => xs.map(x => ({ type: 'line', x0: x, x1: x, y0: 0, y1: 1, yref: 'paper', line: { dash: 'dot', width: 3, color: '#ED1C24' } }));
  const midLine = x => ({ type: 'line', x0: x, x1: x, y0: 0, y1: 1, yref: 'paper', line: { dash: 'dot', width: 3, color: 'var(--mid)' } });

  function histogram(arr, tgt, title, xlabel, marks, mid) {
    const trace = { x: Array.from(arr), type: 'histogram', nbinsx: nbins, marker: { color: 'var(--blue-light)', line: { width: 0.8, color: 'var(--blue-stroke)' } } };
    Plotly.newPlot(tgt, [trace], baseLayout(title, xlabel, 'Frequency (count)'), config)
      .then(gd => Plotly.relayout(gd, { shapes: [...vLines(marks), midLine(mid)] }));
  }

  // CDF In-place
  const cMain = cdf(primary);
  Plotly.newPlot('cdf-main', [
    { x: cMain.x, y: cMain.y, mode: 'lines', line: { width: 3, color: 'var(--blue)' } },
    { x: [P90, P50, P10], y: [0.1, 0.5, 0.9], mode: 'markers+text', marker: { size: 10, color: '#ED1C24', symbol: 'circle' }, text: [`P90=${fmt(P90)}`, `P50=${fmt(P50)}`, `P10=${fmt(P10)}`], textposition: ['right center', 'left center', 'right center'], textfont: { size: 12 }, hoverinfo: 'skip' },
    { x: [detMidCase], y: [pDetMain], mode: 'markers+text', marker: { size: 12, color: 'var(--mid)', symbol: 'diamond' }, text: [`Det. Mid Case=${fmt(detMidCase)}`], textposition: 'top right', textfont: { size: 12 }, hoverinfo: 'skip' }
  ], baseLayout(labelSet.cdfTitle, labelSet.xMain, 'Cumulative Probability (unitless)'), config);

  histogram(primary, 'hist-main', labelSet.histTitle, labelSet.xMain, [P90, P50, P10], detMidCase);

  // CDF + Histogram Recoverable
  const cRec = cdf(rec);
  Plotly.newPlot('cdf-rec', [
    { x: cRec.x, y: cRec.y, mode: 'lines', line: { width: 3, color: 'var(--blue)' } },
    { x: [RP90, RP50, RP10], y: [0.1, 0.5, 0.9], mode: 'markers+text', marker: { size: 10, color: '#ED1C24', symbol: 'circle' }, text: [`P90=${fmt(RP90)}`, `P50=${fmt(RP50)}`, `P10=${fmt(RP10)}`], textposition: ['right center', 'left center', 'right center'], textfont: { size: 12 }, hoverinfo: 'skip' },
    { x: [detRecMidCase], y: [pDetRec], mode: 'markers+text', marker: { size: 12, color: 'var(--mid)', symbol: 'diamond' }, text: [`Det. Mid Case=${fmt(detRecMidCase)}`], textposition: 'top right', textfont: { size: 12 }, hoverinfo: 'skip' }
  ], baseLayout(labelSet.cdfTitle + ' (Recoverable)', labelSet.xRec, 'Cumulative Probability (unitless)'), config);

  histogram(rec, 'hist-rec', labelSet.histTitle + ' (Recoverable)', labelSet.xRec, [RP90, RP50, RP10], detRecMidCase);

  return { P90, P50, P10, RP90, RP50, RP10, pValMain, pValRec };
}

/* ===== 14. TORNADO SENSITIVITY (REFACTORED) ===== */
function tornadoBars(dists, rfType, rfRaw, rfPerc, fluid, metric) {
  const hasGRV = dists.some(d => d.name === 'GRV');
  const baseParams = {};
  for (const d of dists) baseParams[d.name] = mostLikely(d.type, d.v, d.wPerc);
  const baseAH = hasGRV ? baseParams['GRV'] : ((baseParams['Area'] || 0) * (baseParams['Thickness'] || 0));
  const base = computeVolumeSingle(fluid, metric, baseAH, baseParams);

  const bars = [];
  for (const d of dists) {
    if (fluid === 'gasvo' && metric === 'giip' && d.name === 'Rv') continue;
    if (fluid === 'oilgas' && metric === 'stoiip' && d.name === 'Rs') continue;

    const { low, high } = lowHighFrom(d.type, d.raw);
    const conv = convTriplet(d.name, [low, NaN, high]);
    const bounds = boundsFor(d.name, fluid);
    const lowVal = Math.max(bounds.min, Math.min(bounds.max, conv[0]));
    const highVal = Math.max(bounds.min, Math.min(bounds.max, conv[2]));

    const paramsLow = { ...baseParams, [d.name]: lowVal };
    const ahLow = hasGRV ? paramsLow['GRV'] : ((paramsLow['Area'] || baseParams['Area'] || 0) * (paramsLow['Thickness'] || baseParams['Thickness'] || 0));
    const volLow = computeVolumeSingle(fluid, metric, ahLow, paramsLow);

    const paramsHigh = { ...baseParams, [d.name]: highVal };
    const ahHigh = hasGRV ? paramsHigh['GRV'] : ((paramsHigh['Area'] || baseParams['Area'] || 0) * (paramsHigh['Thickness'] || baseParams['Thickness'] || 0));
    const volHigh = computeVolumeSingle(fluid, metric, ahHigh, paramsHigh);

    bars.push({
      name: d.name, low: volLow, high: volHigh, base: base,
      lowDelta: volLow - base, highDelta: volHigh - base
    });
  }
  bars.sort((a, b) => Math.max(Math.abs(b.lowDelta), Math.abs(b.highDelta)) - Math.max(Math.abs(a.lowDelta), Math.abs(a.highDelta)));
  return bars;
}

function tornadoBarsMulti(reservoirResults) {
  let totalBase = 0;
  const perReservoirBase = [];
  for (const r of reservoirResults) {
    const mmboe = volumeToMBOE(r.detMidCase, r.fluid, r.metric);
    perReservoirBase.push(mmboe);
    totalBase += mmboe;
  }

  const bars = [];
  for (let rIdx = 0; rIdx < reservoirResults.length; rIdx++) {
    const r = reservoirResults[rIdx];
    const rName = (reservoirs[rIdx] && reservoirs[rIdx].name) || `Reservoir ${rIdx + 1}`;
    const hasGRV = r.dists.some(d => d.name === 'GRV');
    const baseParams = {};
    for (const d of r.dists) baseParams[d.name] = mostLikely(d.type, d.v, d.wPerc);

    for (const d of r.dists) {
      if (r.fluid === 'gasvo' && r.metric === 'giip' && d.name === 'Rv') continue;
      if (r.fluid === 'oilgas' && r.metric === 'stoiip' && d.name === 'Rs') continue;

      const { low, high } = lowHighFrom(d.type, d.raw);
      const conv = convTriplet(d.name, [low, NaN, high]);
      const bounds = boundsFor(d.name, r.fluid);
      const lowVal = Math.max(bounds.min, Math.min(bounds.max, conv[0]));
      const highVal = Math.max(bounds.min, Math.min(bounds.max, conv[2]));

      const paramsLow = { ...baseParams, [d.name]: lowVal };
      const ahLow = hasGRV ? paramsLow['GRV'] : ((paramsLow['Area'] || baseParams['Area'] || 0) * (paramsLow['Thickness'] || baseParams['Thickness'] || 0));
      const volLow = computeVolumeSingle(r.fluid, r.metric, ahLow, paramsLow);
      const totalLow = totalBase - perReservoirBase[rIdx] + volumeToMBOE(volLow, r.fluid, r.metric);

      const paramsHigh = { ...baseParams, [d.name]: highVal };
      const ahHigh = hasGRV ? paramsHigh['GRV'] : ((paramsHigh['Area'] || baseParams['Area'] || 0) * (paramsHigh['Thickness'] || baseParams['Thickness'] || 0));
      const volHigh = computeVolumeSingle(r.fluid, r.metric, ahHigh, paramsHigh);
      const totalHigh = totalBase - perReservoirBase[rIdx] + volumeToMBOE(volHigh, r.fluid, r.metric);

      bars.push({
        name: `${rName}: ${d.name}`, low: totalLow, high: totalHigh, base: totalBase,
        lowDelta: totalLow - totalBase, highDelta: totalHigh - totalBase
      });
    }
  }
  bars.sort((a, b) => Math.max(Math.abs(b.lowDelta), Math.abs(b.highDelta)) - Math.max(Math.abs(a.lowDelta), Math.abs(a.highDelta)));
  return bars;
}

function plotTornado(bars, unit) {
  const names = bars.map(b => b.name);
  const lowDeltas = bars.map(b => b.lowDelta);
  const highDeltas = bars.map(b => b.highDelta);
  const lowColors = lowDeltas.map(d => d >= 0 ? '#34D399' : '#F87171');
  const highColors = highDeltas.map(d => d >= 0 ? '#34D399' : '#F87171');

  const traceLow = {
    x: lowDeltas, y: names, orientation: 'h', type: 'bar', name: 'Low',
    offsetgroup: 'tornado', alignmentgroup: 'tornado', legendgroup: 'tornado',
    marker: { color: lowColors }, hovertemplate: '%{y}: %{x:.2f}<extra>Low</extra>'
  };
  const traceHigh = {
    x: highDeltas, y: names, orientation: 'h', type: 'bar', name: 'High',
    offsetgroup: 'tornado', alignmentgroup: 'tornado', legendgroup: 'tornado',
    marker: { color: highColors }, hovertemplate: '%{y}: %{x:.2f}<extra>High</extra>'
  };

  const layout = {
    title: { text: 'Tornado Sensitivity', font: { size: 19, color: '#111827' }, x: 0.02, xanchor: 'left' },
    barmode: 'relative',
    margin: { t: 60, l: 120, r: 40, b: 70 },
    xaxis: {
      title: { text: `Change from Base (${unit || ''})`, standoff: 10 },
      zeroline: true, zerolinewidth: 2, zerolinecolor: '#374151', gridcolor: '#EFEFEF',
      color: '#374151', titlefont: { size: 15 }, tickfont: { size: 13 }, automargin: true
    },
    yaxis: {
      automargin: true, title: '', tickfont: { size: 13 }, gridcolor: '#EFEFEF',
      color: '#374151', type: 'category', categoryorder: 'array', categoryarray: names,
      autorange: 'reversed'
    },
    paper_bgcolor: '#fff', plot_bgcolor: '#fff', showlegend: false,
    shapes: [{ type: 'line', x0: 0, x1: 0, y0: -0.5, y1: names.length - 0.5, yref: 'y', line: { color: '#374151', width: 2 } }]
  };
  Plotly.newPlot('tornado', [traceLow, traceHigh], layout, { displayModeBar: false, responsive: true });
}

/* ===== 15. SYNCED ZOOM ===== */
function wireSyncedZoom() {
  const ids = ['cdf-main', 'hist-main', 'cdf-rec', 'hist-rec'];
  ids.forEach(id => {
    const gd = document.getElementById(id);
    if (!gd || typeof gd.on !== 'function') return;
    if (gd.__syncedZoomAttached) return;
    gd.__syncedZoomAttached = true;
    gd.on('plotly_relayout', (ev) => {
      if (syncing) return;
      const hasR0 = Object.prototype.hasOwnProperty.call(ev, 'xaxis.range[0]');
      const hasR1 = Object.prototype.hasOwnProperty.call(ev, 'xaxis.range[1]');
      const hasAuto = Object.prototype.hasOwnProperty.call(ev, 'xaxis.autorange');
      if ((hasR0 && hasR1) || hasAuto) {
        syncing = true;
        const updates = ids.filter(x => x !== id).map(other => {
          if (hasAuto) return Plotly.relayout(other, { 'xaxis.autorange': ev['xaxis.autorange'] });
          else return Plotly.relayout(other, { 'xaxis.range': [ev['xaxis.range[0]'], ev['xaxis.range[1]']] });
        });
        Promise.all(updates).finally(() => syncing = false);
      }
    });
  });
}

/* ===== 16. CSV EXPORT ===== */
function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function generateSummaryCSV() {
  if (!lastSimulationData) return;
  const { P90, P50, P10, RP90, RP50, RP10, detMidCase, detRecMidCase, pValMain, pValRec, labelSet } = lastSimulationData;
  let csv = `RangeRover Summary Report\n`;
  csv += `Metric,${labelSet.primary}\nUnit,${labelSet.unit}\n\n`;
  csv += `In-Place Volume\nStatistic,Value (${labelSet.unit})\n`;
  csv += `P90,${P90.toFixed(2)}\nP50,${P50.toFixed(2)}\nP10,${P10.toFixed(2)}\n`;
  csv += `Deterministic Mid Case,${detMidCase.toFixed(2)}${pValMain ? ` (P${pValMain})` : ''}\n\n`;
  csv += `Recoverable Volume\nStatistic,Value (${labelSet.unit})\n`;
  csv += `P90,${RP90.toFixed(2)}\nP50,${RP50.toFixed(2)}\nP10,${RP10.toFixed(2)}\n`;
  csv += `Deterministic Mid Case,${detRecMidCase.toFixed(2)}${pValRec ? ` (P${pValRec})` : ''}\n`;

  // Multi-reservoir summary
  if (advancedMode && lastMultiResults) {
    csv += `\nPer-Reservoir Summary\nReservoir,Fluid,Unit,P90,P50,P10,Det Mid Case\n`;
    for (const r of lastMultiResults.perReservoir) {
      const [rP90, rP50, rP10] = computeQuantiles(r.primary);
      csv += `${r.name},${r.fluid},${r.labelSet.unit},${rP90.toFixed(2)},${rP50.toFixed(2)},${rP10.toFixed(2)},${r.detMidCase.toFixed(2)}\n`;
    }
  }
  downloadCSV('rangerover_summary.csv', csv);
}

function generateSamplesCSV() {
  if (!lastSimulationData) return;
  try {
    const { samplesData, labelSet, fluid } = lastSimulationData;
    if (!samplesData || samplesData.length === 0) { alert('No simulation data. Run a simulation first.'); return; }
    const geomMode = geometryMode();
    let headers = [];
    if (geomMode === 'grv') { headers.push('GRV (acre-ft)'); }
    else { headers.push('Area (acres)', 'Thickness (ft)'); }
    if (fluid === 'csg') { headers.push('Coal Density (g/cm³)', 'Gas Content (m³/ton)'); }
    else { headers.push('Net to Gross (frac)', 'Porosity (frac)', 'Water Saturation (frac)'); }
    if (fluid === 'oil' || fluid === 'oilgas') { headers.push('Bo (RB/STB)'); if (fluid === 'oilgas') headers.push('Rs (scf/STB)'); }
    else if (fluid === 'gas' || fluid === 'gasvo') { headers.push('Bg (scf/SCF)'); if (fluid === 'gasvo') headers.push('Rv (STB/MMscf)'); }
    headers.push('Recovery Factor (frac)');
    if (fluid === 'csg') { if (geomMode !== 'grv') headers.push('GRV (acre-ft)'); headers.push('Coal Mass (tons)'); }
    else { if (geomMode !== 'grv') headers.push('GRV (acre-ft)'); headers.push('NRV (acre-ft)', 'PV (acre-ft)', 'HCPV (acre-ft)'); }
    if (fluid === 'oilgas') { headers.push('STOIIP (oil) (MMBO)', 'GIIP (solution gas) (Bscf)', 'Total In-Place (MMBOE)'); }
    else if (fluid === 'gasvo') { headers.push('GIIP (gas) (Bscf)', 'STOIIP (vaporized oil) (MMBO)', 'Total In-Place (MMBOE)'); }
    else { headers.push(`In-Place (${labelSet.unit})`); }
    headers.push(`Recoverable (${labelSet.unit})`);

    const rows = [];
    for (let i = 0; i < samplesData.length; i++) {
      const row = samplesData[i];
      let values = [];
      if (geomMode === 'grv') { values.push(row.GRV.toFixed(2)); }
      else { values.push(row.Area.toFixed(2), row.Thickness.toFixed(2)); }
      if (fluid === 'csg') { values.push(row.CoalDensity.toFixed(2), row.GasContent.toFixed(2)); }
      else { values.push(row.NTG.toFixed(4), row.PHI.toFixed(4), row.SW.toFixed(4)); }
      if (fluid === 'oil' || fluid === 'oilgas') { values.push(row.FVF.toFixed(4)); if (fluid === 'oilgas') values.push(row.Rs.toFixed(2)); }
      else if (fluid === 'gas' || fluid === 'gasvo') { values.push(row.FVF.toFixed(4)); if (fluid === 'gasvo') values.push(row.Rv.toFixed(4)); }
      values.push(row.RF.toFixed(4));
      const grv = row.GRV;
      if (fluid === 'csg') {
        if (geomMode !== 'grv') values.push(grv.toFixed(2));
        values.push(row.CoalMass.toFixed(2));
      } else {
        const nrv = grv * row.NTG, pv = nrv * row.PHI, hcpv = pv * (1 - row.SW);
        if (geomMode !== 'grv') values.push(grv.toFixed(2));
        values.push(nrv.toFixed(2), pv.toFixed(2), hcpv.toFixed(2));
      }
      if (fluid === 'oilgas') {
        const stoiip = (7758 * grv * row.NTG * row.PHI * (1 - row.SW) / row.FVF) / 1e6;
        const giip = (7758 * grv * row.NTG * row.PHI * (1 - row.SW) * row.Rs / row.FVF) / 1e9;
        values.push(stoiip.toFixed(2), giip.toFixed(2), (stoiip + giip / 5.8).toFixed(2));
      } else if (fluid === 'gasvo') {
        const giip = (43560 * grv * row.NTG * row.PHI * (1 - row.SW) / row.FVF) / 1e9;
        const stoiip = (43560 * grv * row.NTG * row.PHI * (1 - row.SW) * row.Rv / row.FVF) / 1e6;
        values.push(giip.toFixed(2), stoiip.toFixed(2), (giip / 5.8 + stoiip).toFixed(2));
      } else { values.push(row.primary.toFixed(2)); }
      values.push(row.recoverable.toFixed(2));
      rows.push(values.join(','));
    }
    downloadCSV('rangerover_samples.csv', headers.join(',') + '\n' + rows.join('\n'));
  } catch (error) { alert('Error generating CSV: ' + error.message); }
}

/* ===== 17. UI: PARAMETER MOUNTING & PREVIEWS ===== */
function addWeightsRow(afterEl, idPrefix) {
  const div = document.createElement('div');
  div.className = 'weights-row hidden';
  div.id = idPrefix + '-weights';
  div.innerHTML = `<label>Weights (%)</label><div></div>
    <input class="w w0" type="number" step="any" placeholder="e.g. 33">
    <input class="w w1" type="number" step="any" placeholder="e.g. 33">
    <input class="w w2" type="number" step="any" placeholder="e.g. 34">`;
  afterEl.insertAdjacentElement('afterend', div);
  return div;
}

function mountParams() {
  const host = document.getElementById('params');
  host.innerHTML = '';
  PARAMS.forEach(p => {
    const unit = p.name === "Bo" ? "(RB/STB)" : p.name === "Bg" ? "(scf/SCF)" : p.name === "Rs" ? "(scf/bbl)"
      : p.name === "Rv" ? "(bbl/scf)" : p.name === "Coal Density" ? "(g/cm³)" : p.name === "Gas Content" ? "(m³/ton)"
      : isFrac(p.name) ? "(fraction)" : "";
    const row = document.createElement('div');
    row.className = 'dist-row';
    row.setAttribute('data-param', p.name);
    row.innerHTML = `
      <label>${p.name} ${unit}</label>
      <div class="field"><div class="slabel">Distribution</div>
      <select class="dist-type"><option>Discrete</option><option>Triangular</option><option>Uniform</option><option>PERT</option><option selected>Normal</option><option>Known Distribution</option></select></div>
      <div class="field"><div class="slabel l0">${DIST_LABELS['Normal'][0]}</div><input class="v v0" type="number" step="any"></div>
      <div class="field"><div class="slabel l1">${DIST_LABELS['Normal'][1]}</div><input class="v v1" type="number" step="any"></div>
      <div class="field"><div class="slabel l2">${DIST_LABELS['Normal'][2]}</div><input class="v v2" type="number" step="any"></div>`;
    host.appendChild(row);
    const weights = addWeightsRow(row, p.name.replace(/\s+/g, '_'));
    const sel = row.querySelector('.dist-type');
    const inputs = [...row.querySelectorAll('input.v')];
    const labs = [row.querySelector('.l0'), row.querySelector('.l1'), row.querySelector('.l2')];
    function refresh() {
      const L = DIST_LABELS[sel.value];
      labs.forEach((lab, i) => {
        lab.textContent = L[i];
        const ignore = L[i].includes('(ignore)');
        lab.classList.toggle('disabled', ignore);
        const fieldDiv = labs[i].closest('.field');
        if (ignore) { inputs[i].disabled = true; inputs[i].value = ''; fieldDiv && fieldDiv.classList.add('hidden-field'); }
        else { inputs[i].disabled = false; fieldDiv && fieldDiv.classList.remove('hidden-field'); }
      });
      const rowEl = sel.closest('.dist-row');
      if (sel.value === 'Discrete') { weights.classList.remove('hidden'); weights.classList.add('show-sep'); rowEl && rowEl.classList.add('with-weights'); }
      else { weights.classList.add('hidden'); weights.classList.remove('show-sep'); rowEl && rowEl.classList.remove('with-weights'); }
      renderDistPreviewsDebounced();
    }
    sel.addEventListener('change', refresh);
    inputs.forEach(inp => inp.addEventListener('input', renderDistPreviewsDebounced));
    weights.querySelectorAll('input').forEach(w => w.addEventListener('input', renderDistPreviewsDebounced));
    refresh();
  });

  // RF labels switch
  const rfSel = document.querySelector('.rf-type');
  const rfWeights = document.getElementById('rf-weights');
  const rfLabs = [document.querySelector('.rf-l0'), document.querySelector('.rf-l1'), document.querySelector('.rf-l2')];
  function rfRefresh() {
    const L = DIST_LABELS[rfSel.value];
    const rfInputs = [...document.querySelectorAll('.rf-v')];
    rfLabs.forEach((lab, i) => {
      lab.textContent = L[i];
      const ignore = L[i].includes('(ignore)');
      lab.classList.toggle('disabled', ignore);
      const fieldDiv = lab.closest('.field');
      if (ignore) { rfInputs[i].disabled = true; rfInputs[i].value = ''; fieldDiv && fieldDiv.classList.add('hidden-field'); }
      else { rfInputs[i].disabled = false; fieldDiv && fieldDiv.classList.remove('hidden-field'); }
    });
    if (rfSel.value === 'Discrete') { rfWeights.classList.remove('hidden'); rfWeights.classList.add('show-sep'); }
    else { rfWeights.classList.add('hidden'); rfWeights.classList.remove('show-sep'); }
    renderDistPreviewsDebounced();
  }
  rfSel.addEventListener('change', rfRefresh);
  rfWeights.querySelectorAll('input').forEach(w => w.addEventListener('input', renderDistPreviewsDebounced));
  document.querySelectorAll('.rf-v').forEach(inp => inp.addEventListener('input', renderDistPreviewsDebounced));
  rfRefresh();
  labelsAndFormula();
  renderDistPreviewsDebounced();
}

function labelsForUI() { return labelsFor(FLUID.value); }
function labelsAndFormula() {
  const L = labelsForUI();
  document.getElementById('results-title').innerHTML = `Results (${L.unit}) <span class="chip">P90 / P50 / P10</span>`;
  document.getElementById('metric-name').textContent = L.primary;
  document.getElementById('metric-name-rec').textContent = L.metricRec;
  document.getElementById('formula-note').innerHTML = L.formula;
}

function mountResultsTypeSelector() {
  const formGrid = document.querySelector('.form-grid');
  let oldSel = document.getElementById('resultType'); if (oldSel) oldSel.remove();
  let oldLabel = formGrid.querySelector('label[for="resultType"]'); if (oldLabel) oldLabel.remove();
  if (FLUID.value === 'oilgas' || FLUID.value === 'gasvo') {
    const label = document.createElement('label'); label.textContent = 'Results Metric'; label.setAttribute('for', 'resultType');
    const sel = document.createElement('select'); sel.id = 'resultType';
    sel.innerHTML = FLUID.value === 'oilgas'
      ? '<option value="stoiip">STOIIP (MMBO)</option><option value="giip">GIIP (BCF)</option><option value="total" selected>Total (MMBOE)</option>'
      : '<option value="giip">GIIP (BCF)</option><option value="vo">Vaporized Oil (MMBO)</option><option value="total" selected>Total (MMBOE)</option>';
    const thickUnit = document.getElementById('thicknessUnit');
    let insertAfter = thickUnit;
    if (thickUnit) { let next = thickUnit.nextElementSibling; if (next && next.classList.contains('note')) insertAfter = next; }
    if (insertAfter && insertAfter.parentElement === formGrid) { insertAfter.insertAdjacentElement('afterend', label); label.insertAdjacentElement('afterend', sel); }
    else { formGrid.appendChild(label); formGrid.appendChild(sel); }
    sel.addEventListener('change', runSimulation);
  }
}

function mountGeometrySelector() {
  const formGrid = document.querySelector('.form-grid');
  if (!formGrid) return;
  const existingGeomSel = document.getElementById('geometryMode');
  const prevMode = existingGeomSel ? existingGeomSel.value : null;
  const existingGrvSel = document.getElementById('grvUnit');
  const prevGrvUnit = existingGrvSel ? existingGrvSel.value : null;
  const oldGeomLabel = formGrid.querySelector('label[for="geometryMode"]'); if (oldGeomLabel) oldGeomLabel.remove();
  if (existingGeomSel) existingGeomSel.remove();
  const oldGrvLabel = formGrid.querySelector('label[for="grvUnit"]'); if (oldGrvLabel) oldGrvLabel.remove();
  if (existingGrvSel) existingGrvSel.remove();
  const label = document.createElement('label'); label.textContent = 'Geometry'; label.setAttribute('for', 'geometryMode');
  const sel = document.createElement('select'); sel.id = 'geometryMode'; sel.innerHTML = '<option value="area-thickness" selected>Area × Thickness</option><option value="grv">GRV</option>';
  const thickUnit = document.getElementById('thicknessUnit');
  let insertAfter = thickUnit;
  if (thickUnit) { let next = thickUnit.nextElementSibling; if (next && next.classList.contains('note')) insertAfter = next; }
  if (insertAfter && insertAfter.parentElement === formGrid) { insertAfter.insertAdjacentElement('afterend', label); label.insertAdjacentElement('afterend', sel); }
  else { formGrid.appendChild(label); formGrid.appendChild(sel); }
  const grvLabel = document.createElement('label'); grvLabel.textContent = 'GRV Units'; grvLabel.setAttribute('for', 'grvUnit');
  const grvSel = document.createElement('select'); grvSel.id = 'grvUnit'; grvSel.innerHTML = '<option value="acre-ft" selected>10^6 acre-ft</option><option value="ft^3">10^9 ft^3</option><option value="m^3">10^6 m^3</option>';
  sel.insertAdjacentElement('afterend', grvLabel); grvLabel.insertAdjacentElement('afterend', grvSel);
  if (prevMode) sel.value = prevMode;
  if (prevGrvUnit) grvSel.value = prevGrvUnit;
  function toggleGRVUnits() { const show = sel.value === 'grv'; grvLabel.style.display = show ? '' : 'none'; grvSel.style.display = show ? '' : 'none'; }
  sel.addEventListener('change', () => { toggleGRVUnits(); updateFluidUI(); });
  grvSel.addEventListener('change', () => { renderDistPreviewsDebounced(); });
  toggleGRVUnits();
}

function updateFluidUI() {
  mountGeometrySelector();
  PARAMS = paramsFor(FLUID.value);
  mountParams();
  labelsAndFormula();
  prefillDefaults();
  mountResultsTypeSelector();
  renderDistPreviewsDebounced();
  if (advancedMode) buildCorrelationMatrix();
}
FLUID.addEventListener('change', updateFluidUI);

function prefillDefaults() {
  let D;
  if (FLUID.value === 'gas') D = { "Area": [50, 10], "Thickness": [60, 10], "Net to Gross": [0.6, 0.15], "Porosity": [0.2, 0.05], "Water Saturation": [0.3, 0.1], "Bg": [0.005, 0.001], "__RF": [0.5, 0.05] };
  else if (FLUID.value === 'oilgas') D = { "Area": [50, 10], "Thickness": [50, 10], "Net to Gross": [0.6, 0.2], "Porosity": [0.2, 0.05], "Water Saturation": [0.3, 0.1], "Bo": [1.3, 0.1], "Rs": [800, 100], "__RF": [0.5, 0.05] };
  else if (FLUID.value === 'gasvo') D = { "Area": [50, 10], "Thickness": [60, 10], "Net to Gross": [0.6, 0.15], "Porosity": [0.2, 0.05], "Water Saturation": [0.3, 0.1], "Bg": [0.005, 0.001], "Rv": [0.001, 0.0002], "__RF": [0.5, 0.05] };
  else D = { "Area": [50, 10], "Thickness": [50, 10], "Net to Gross": [0.6, 0.2], "Porosity": [0.2, 0.05], "Water Saturation": [0.3, 0.1], "Bo": [1.3, 0.1], "__RF": [0.5, 0.05] };
  document.querySelectorAll('#params .dist-row').forEach(row => {
    const name = row.getAttribute('data-param'); const pair = D[name]; const sel = row.querySelector('.dist-type'); sel.value = 'Normal';
    const v0 = row.querySelector('.v0'), v1 = row.querySelector('.v1'), v2 = row.querySelector('.v2');
    if (pair) { v0.value = pair[0]; v1.value = pair[1]; } else { v0.value = ''; v1.value = ''; }
    v2.value = ''; sel.dispatchEvent(new Event('change'));
    const wrow = row.nextElementSibling;
    if (wrow && wrow.classList.contains('weights-row')) { const ws = wrow.querySelectorAll('input'); ws[0].value = '33'; ws[1].value = '33'; ws[2].value = '34'; }
  });
  document.querySelector('.rf-type').value = 'Normal';
  document.querySelector('.rf-v0').value = D['__RF'][0];
  document.querySelector('.rf-v1').value = D['__RF'][1];
  document.querySelector('.rf-v2').value = '';
  const rfws = document.querySelectorAll('#rf-weights input'); rfws[0].value = '33'; rfws[1].value = '33'; rfws[2].value = '34';
}

/* ===== 18. DISTRIBUTION PREVIEWS ===== */
function renderDistPreviewsDebounced() { clearTimeout(previewTimer); previewTimer = setTimeout(renderDistPreviews, 180); }
AREA.addEventListener('change', renderDistPreviewsDebounced);
THICK.addEventListener('change', renderDistPreviewsDebounced);
document.addEventListener('change', (e) => { if (e.target && e.target.id === 'grvUnit') renderDistPreviewsDebounced(); });

function renderDistPreviews() {
  const grid = document.getElementById('previewGrid'); grid.innerHTML = '';
  const rows = [...document.querySelectorAll('#params .dist-row')];
  const entries = rows.map(row => {
    const name = row.getAttribute('data-param');
    const type = row.querySelector('.dist-type').value;
    const raw = [...row.querySelectorAll('input.v')].map(el => el.value === "" ? NaN : Number(el.value));
    let wPerc = [NaN, NaN, NaN];
    const wrow = row.nextElementSibling;
    if (type === 'Discrete' && wrow && wrow.classList.contains('weights-row')) wPerc = [...wrow.querySelectorAll('input')].map(x => Number(x.value));
    return { name, type, rawVals: raw, wPerc };
  });
  const rfType = document.querySelector('.rf-type').value;
  const rfVals = [...document.querySelectorAll('.rf-v')].map(x => x.value === "" ? NaN : Number(x.value));
  let rfPerc = [NaN, NaN, NaN];
  if (rfType === 'Discrete') rfPerc = [...document.querySelectorAll('#rf-weights input')].map(x => Number(x.value));
  entries.push({ name: 'Recovery Factor', type: rfType, rawVals: rfVals, wPerc: rfPerc });

  entries.forEach((d, idx) => {
    const id = 'pv_' + idx + '_' + d.name.replace(/\s+/g, '_');
    const box = document.createElement('div'); box.className = 'mini'; box.id = id; grid.appendChild(box);
    const isPercent = isFrac(d.name);
    const xLabel = xLabelFor(d.name);
    const fluid = document.getElementById('fluid').value;
    const bounds = boundsFor(d.name, fluid);
    const X = [], Y = [];
    function pushXY(x, y) { if (Number.isFinite(x) && Number.isFinite(y) && x >= bounds.min && x <= bounds.max) { X.push(x); Y.push(y); } }
    function normalPDF(x, mu, sigma) { const z = (x - mu) / sigma; return (1 / (Math.sqrt(2 * Math.PI) * sigma)) * Math.exp(-0.5 * z * z); }
    function triangularPDF(x, a, c, b) { if (x < a || x > b || a === b) return 0; if (x === c) return 2 / (b - a); if (x < c) return 2 * (x - a) / ((b - a) * (c - a)); return 2 * (b - x) / ((b - a) * (b - c)); }
    function uniformPDF(x, a, b) { return (a < b && x >= a && x <= b) ? 1 / (b - a) : 0; }
    function logGamma(z) {
      const p = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
      z -= 1; let x = 0.99999999999980993;
      for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
      const t = z + p.length - 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
    }
    function betaPDF01(x, a, b) { if (x <= 0 || x >= 1) return 0; const logB = logGamma(a) + logGamma(b) - logGamma(a + b); return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logB); }
    const npts = 300;
    function addCurve(a, b, pdf, params) {
      const aa = Math.min(a, b), bb = Math.max(a, b), dx = (bb - aa) / (npts - 1 || 1);
      for (let i = 0; i < npts; i++) { const x = aa + i * dx; let y = pdf(x, ...params); if (!Number.isFinite(y)) y = 0; pushXY(x, y); }
    }

    let trace;
    if (d.type === 'Normal') {
      const mu = d.rawVals[0], sigma = Math.abs(d.rawVals[1]) || 1e-6;
      addCurve(mu - 4 * sigma, mu + 4 * sigma, normalPDF, [mu, sigma]);
      trace = { x: X, y: Y, mode: 'lines', type: 'scatter', fill: 'tozeroy', line: { width: 1.5 } };
    } else if (d.type === 'Triangular') {
      const a = d.rawVals[0], c = d.rawVals[1], b = d.rawVals[2];
      const aa = Math.min(a, b), bb = Math.max(a, b), cc = Math.max(aa, Math.min(c, bb));
      addCurve(aa, bb, (x, aaa, ccc, bbb) => triangularPDF(x, aaa, ccc, bbb), [aa, cc, bb]);
      trace = { x: X, y: Y, mode: 'lines', type: 'scatter', fill: 'tozeroy', line: { width: 1.5 } };
    } else if (d.type === 'Uniform') {
      const a = d.rawVals[0], b = d.rawVals[2];
      const aa = Math.min(a, b), bb = Math.max(a, b);
      addCurve(aa, bb, (x, aaa, bbb) => uniformPDF(x, aaa, bbb), [aa, bb]);
      trace = { x: X, y: Y, mode: 'lines', type: 'scatter', fill: 'tozeroy', line: { width: 1.5 } };
    } else if (d.type === 'Known Distribution') {
      const { mean, sigma } = normalFromP90P50P10(d.rawVals[0], d.rawVals[1], d.rawVals[2]);
      const s = Math.abs(sigma) || 1e-6;
      addCurve(mean - 4 * s, mean + 4 * s, normalPDF, [mean, s]);
      trace = { x: X, y: Y, mode: 'lines', type: 'scatter', fill: 'tozeroy', line: { width: 1.5 } };
    } else if (d.type === 'PERT') {
      const a = d.rawVals[0], m = d.rawVals[1], b = d.rawVals[2], lambda = 4;
      if (Number.isFinite(a) && Number.isFinite(m) && Number.isFinite(b) && a < b && a <= m && m <= b) {
        const alpha = 1 + lambda * (m - a) / (b - a), beta = 1 + lambda * (b - m) / (b - a);
        for (let i = 0; i < npts; i++) { const x = a + (b - a) * i / (npts - 1); pushXY(x, betaPDF01((x - a) / (b - a), alpha, beta) / (b - a)); }
        trace = { x: X, y: Y, mode: 'lines', type: 'scatter', fill: 'tozeroy', line: { width: 1.5 } };
      } else { trace = { x: [], y: [], mode: 'lines', type: 'scatter' }; }
    } else if (d.type === 'Discrete') {
      const { vals, weights } = discreteValsAndWeights(d.rawVals, d.wPerc);
      if (vals.length > 0) {
        const validItems = vals.map((v, i) => ({ v, w: weights[i] })).filter(item => item.v >= bounds.min && item.v <= bounds.max);
        if (validItems.length > 0) {
          let s = validItems.reduce((a, b) => a + b.w, 0);
          const ws = (s > 0) ? validItems.map(item => item.w / s) : validItems.map(_ => 1 / validItems.length);
          trace = { x: validItems.map(item => item.v), y: ws, type: 'bar', marker: { line: { width: 0.6 }, opacity: 0.9 } };
        } else { trace = { x: [], y: [], type: 'bar' }; }
      } else { trace = { x: [], y: [], type: 'bar' }; }
    }

    const layout = {
      autosize: true, margin: { t: 40, l: 56, r: 28, b: 74 },
      title: { text: d.name, font: { size: 14 }, x: 0.02, xanchor: 'left' },
      xaxis: { title: { text: xLabel, standoff: 10 }, gridcolor: "#F3F4F6", tickfont: { size: 11 }, nticks: 10, tickformat: isPercent ? '.0%' : undefined, autorange: true, automargin: true },
      yaxis: { title: '', gridcolor: "#F3F4F6", tickfont: { size: 11 }, nticks: 8, autorange: true },
      paper_bgcolor: '#fff', plot_bgcolor: '#fff', showlegend: false
    };
    Plotly.newPlot(id, [trace], layout, { displayModeBar: false, responsive: true });
  });
}

/* ===== 19. ADVANCED MODE: STATE & UI ===== */
function createDefaultReservoirState(idx) {
  return {
    id: idx,
    name: `Reservoir ${idx + 1}`,
    fluid: 'oil',
    dists: [],
    rfType: 'Normal',
    rfRaw: [0.5, 0.05, NaN],
    rfPerc: [NaN, NaN, NaN],
    correlationMatrix: null,
    sharedLinks: {}
  };
}

function saveReservoirToState() {
  const r = reservoirs[activeReservoirIdx];
  if (!r) return;
  r.fluid = FLUID.value;
  r.dists = [];
  const rows = [...document.querySelectorAll('#params .dist-row')];
  for (const row of rows) {
    const name = row.getAttribute('data-param');
    const type = row.querySelector('.dist-type').value;
    const raw = [...row.querySelectorAll('input.v')].map(el => el.value === "" ? NaN : Number(el.value));
    let wPerc = [NaN, NaN, NaN];
    const wrow = row.nextElementSibling;
    if (type === 'Discrete' && wrow && wrow.classList.contains('weights-row')) wPerc = [...wrow.querySelectorAll('input')].map(x => Number(x.value));
    const conv = convTriplet(name, raw);
    r.dists.push({ name, type, raw, v: conv, wPerc });
  }
  r.rfType = document.querySelector('.rf-type').value;
  r.rfRaw = [...document.querySelectorAll('.rf-v')].map(x => x.value === "" ? NaN : Number(x.value));
  r.rfPerc = [NaN, NaN, NaN];
  if (r.rfType === 'Discrete') r.rfPerc = [...document.querySelectorAll('#rf-weights input')].map(x => Number(x.value));
  r.correlationMatrix = readCorrelationMatrix();
  r.sharedLinks = readSharedLinks();
  const nameInput = document.getElementById('reservoirName');
  if (nameInput) r.name = nameInput.value || r.name;
}

function loadReservoirFromState(idx) {
  const r = reservoirs[idx];
  if (!r) return;
  FLUID.value = r.fluid;
  updateFluidUI();
  const rows = [...document.querySelectorAll('#params .dist-row')];
  for (const row of rows) {
    const name = row.getAttribute('data-param');
    const saved = r.dists.find(d => d.name === name);
    if (!saved) continue;
    const sel = row.querySelector('.dist-type'); sel.value = saved.type; sel.dispatchEvent(new Event('change'));
    const inputs = [...row.querySelectorAll('input.v')];
    inputs[0].value = Number.isFinite(saved.raw[0]) ? saved.raw[0] : '';
    inputs[1].value = Number.isFinite(saved.raw[1]) ? saved.raw[1] : '';
    inputs[2].value = Number.isFinite(saved.raw[2]) ? saved.raw[2] : '';
    if (saved.type === 'Discrete') {
      const wrow = row.nextElementSibling;
      if (wrow && wrow.classList.contains('weights-row')) {
        const ws = wrow.querySelectorAll('input');
        ws[0].value = Number.isFinite(saved.wPerc[0]) ? saved.wPerc[0] : '';
        ws[1].value = Number.isFinite(saved.wPerc[1]) ? saved.wPerc[1] : '';
        ws[2].value = Number.isFinite(saved.wPerc[2]) ? saved.wPerc[2] : '';
      }
    }
  }
  document.querySelector('.rf-type').value = r.rfType;
  document.querySelector('.rf-type').dispatchEvent(new Event('change'));
  const rfInputs = [...document.querySelectorAll('.rf-v')];
  rfInputs[0].value = Number.isFinite(r.rfRaw[0]) ? r.rfRaw[0] : '';
  rfInputs[1].value = Number.isFinite(r.rfRaw[1]) ? r.rfRaw[1] : '';
  rfInputs[2].value = Number.isFinite(r.rfRaw[2]) ? r.rfRaw[2] : '';
  if (r.rfType === 'Discrete') {
    const rfws = document.querySelectorAll('#rf-weights input');
    rfws[0].value = Number.isFinite(r.rfPerc[0]) ? r.rfPerc[0] : '';
    rfws[1].value = Number.isFinite(r.rfPerc[1]) ? r.rfPerc[1] : '';
    rfws[2].value = Number.isFinite(r.rfPerc[2]) ? r.rfPerc[2] : '';
  }
  const nameInput = document.getElementById('reservoirName');
  if (nameInput) nameInput.value = r.name || '';
  buildCorrelationMatrix();
  buildSharedLinksUI();
  renderDistPreviewsDebounced();
}

function renderReservoirTabs() {
  const tabBar = document.getElementById('reservoirTabs');
  if (!tabBar) return;
  tabBar.innerHTML = '';
  reservoirs.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (i === activeReservoirIdx ? ' active' : '');
    btn.textContent = r.name || `Reservoir ${i + 1}`;
    btn.addEventListener('click', () => switchReservoirTab(i));
    tabBar.appendChild(btn);
  });
  if (reservoirs.length < 5) {
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add';
    addBtn.textContent = '+ Add Reservoir';
    addBtn.addEventListener('click', addReservoir);
    tabBar.appendChild(addBtn);
  }
  if (reservoirs.length > 1) {
    const rmBtn = document.createElement('button');
    rmBtn.className = 'tab-remove';
    rmBtn.textContent = '× Remove Current';
    rmBtn.addEventListener('click', () => removeReservoir(activeReservoirIdx));
    tabBar.appendChild(rmBtn);
  }
}

function switchReservoirTab(idx) {
  if (idx === activeReservoirIdx) return;
  saveReservoirToState();
  activeReservoirIdx = idx;
  loadReservoirFromState(idx);
  renderReservoirTabs();
}

function addReservoir() {
  if (reservoirs.length >= 5) return;
  saveReservoirToState();
  saveCrossReservoirCorr();
  const newR = createDefaultReservoirState(reservoirs.length);
  reservoirs.push(newR);
  activeReservoirIdx = reservoirs.length - 1;
  loadReservoirFromState(activeReservoirIdx);
  renderReservoirTabs();
  updateResultsViewSelector();
  buildCrossReservoirCorrTable();
}

function removeReservoir(idx) {
  if (reservoirs.length <= 1) return;
  saveCrossReservoirCorr();
  // Re-key cross-reservoir correlations after removal
  const newCorr = {};
  for (const [pairKey, params] of Object.entries(crossReservoirCorr)) {
    const [a, b] = pairKey.split('-').map(Number);
    if (a === idx || b === idx) continue; // drop pairs involving removed reservoir
    const newA = a > idx ? a - 1 : a;
    const newB = b > idx ? b - 1 : b;
    newCorr[`${newA}-${newB}`] = params;
  }
  crossReservoirCorr = newCorr;
  reservoirs.splice(idx, 1);
  // Re-index
  reservoirs.forEach((r, i) => r.id = i);
  if (activeReservoirIdx >= reservoirs.length) activeReservoirIdx = reservoirs.length - 1;
  loadReservoirFromState(activeReservoirIdx);
  renderReservoirTabs();
  updateResultsViewSelector();
  buildCrossReservoirCorrTable();
}

function toggleAdvancedMode(enabled) {
  advancedMode = enabled;
  const advSections = document.querySelectorAll('.adv-section');
  advSections.forEach(el => { el.classList.toggle('show', enabled); });

  if (enabled) {
    if (reservoirs.length === 0) {
      reservoirs.push(createDefaultReservoirState(0));
      activeReservoirIdx = 0;
      saveReservoirToState();
    }
    renderReservoirTabs();
    buildCorrelationMatrix();
    buildSharedLinksUI();
    updateResultsViewSelector();
    buildCrossReservoirCorrTable();
  } else {
    // Switching back to basic: load reservoir 0 if it exists
    if (reservoirs.length > 0) {
      activeReservoirIdx = 0;
      loadReservoirFromState(0);
    }
  }
}

/* ===== 20. CORRELATION MATRIX UI ===== */
function buildCorrelationMatrix() {
  const container = document.getElementById('corrMatrix');
  if (!container) return;
  container.innerHTML = '';
  const paramNames = PARAMS.map(p => p.name);
  const k = paramNames.length;
  if (k < 2) { container.innerHTML = '<p style="color:var(--muted);font-size:12px">Need at least 2 parameters for correlations.</p>'; return; }

  const r = reservoirs[activeReservoirIdx];
  const existingCorr = (r && r.correlationMatrix) ? r.correlationMatrix : null;

  // Grid: k+1 columns (header + k params)
  container.style.gridTemplateColumns = `80px repeat(${k}, 52px)`;

  // Header row
  const spacer = document.createElement('div'); spacer.className = 'hdr'; spacer.textContent = '';
  container.appendChild(spacer);
  for (let j = 0; j < k; j++) {
    const hdr = document.createElement('div'); hdr.className = 'hdr';
    hdr.textContent = paramNames[j].replace('Net to Gross', 'NTG').replace('Water Saturation', 'Sw').replace('Porosity', 'φ').replace('Thickness', 'h').replace('Coal Density', 'ρ').replace('Gas Content', 'Gc');
    container.appendChild(hdr);
  }

  // Data rows
  for (let i = 0; i < k; i++) {
    const rowHdr = document.createElement('div'); rowHdr.className = 'hdr'; rowHdr.style.textAlign = 'right';
    rowHdr.textContent = paramNames[i].replace('Net to Gross', 'NTG').replace('Water Saturation', 'Sw').replace('Porosity', 'φ').replace('Thickness', 'h').replace('Coal Density', 'ρ').replace('Gas Content', 'Gc');
    container.appendChild(rowHdr);
    for (let j = 0; j < k; j++) {
      if (i === j) {
        const diag = document.createElement('div'); diag.className = 'diag'; diag.textContent = '1';
        container.appendChild(diag);
      } else if (j < i) {
        const inp = document.createElement('input'); inp.type = 'number'; inp.step = '0.1'; inp.min = '-1'; inp.max = '1';
        inp.setAttribute('data-row', i); inp.setAttribute('data-col', j);
        const val = existingCorr ? (existingCorr[i][j] || 0) : 0;
        inp.value = val;
        inp.addEventListener('input', validateCorrelationMatrixUI);
        container.appendChild(inp);
      } else {
        const empty = document.createElement('div'); empty.className = 'diag'; empty.textContent = '';
        container.appendChild(empty);
      }
    }
  }
  validateCorrelationMatrixUI();
}

function readCorrelationMatrix() {
  const container = document.getElementById('corrMatrix');
  if (!container) return null;
  const paramNames = PARAMS.map(p => p.name);
  const k = paramNames.length;
  if (k < 2) return null;
  const matrix = Array.from({ length: k }, (_, i) => {
    const row = new Array(k).fill(0);
    row[i] = 1;
    return row;
  });
  const inputs = container.querySelectorAll('input[data-row][data-col]');
  let hasNonZero = false;
  inputs.forEach(inp => {
    const i = parseInt(inp.getAttribute('data-row'));
    const j = parseInt(inp.getAttribute('data-col'));
    const val = parseFloat(inp.value) || 0;
    const clamped = Math.max(-1, Math.min(1, val));
    matrix[i][j] = clamped;
    matrix[j][i] = clamped;
    if (Math.abs(clamped) > 1e-10) hasNonZero = true;
  });
  return hasNonZero ? matrix : null;
}

function validateCorrelationMatrixUI() {
  const warn = document.getElementById('corrWarn');
  if (!warn) return;
  const matrix = readCorrelationMatrix();
  if (!matrix) { warn.textContent = ''; return; }
  if (isPositiveDefinite(matrix)) { warn.textContent = ''; warn.style.color = ''; }
  else { warn.textContent = '⚠ Correlation matrix is not positive definite. Adjust values or correlations will be ignored.'; warn.style.color = '#B91C1C'; }
}

function applyCorrelationPreset(preset) {
  const paramNames = PARAMS.map(p => p.name);
  const container = document.getElementById('corrMatrix');
  if (!container) return;
  const inputs = container.querySelectorAll('input[data-row][data-col]');

  if (preset === 'none') {
    inputs.forEach(inp => { inp.value = 0; });
  } else if (preset === 'typical') {
    // Typical clastic reservoir correlations
    const correlations = {
      'Net to Gross|Porosity': 0.5, 'Porosity|Net to Gross': 0.5,
      'Porosity|Water Saturation': -0.4, 'Water Saturation|Porosity': -0.4,
      'Net to Gross|Water Saturation': -0.3, 'Water Saturation|Net to Gross': -0.3,
      'Area|Thickness': 0.3, 'Thickness|Area': 0.3
    };
    inputs.forEach(inp => {
      const i = parseInt(inp.getAttribute('data-row'));
      const j = parseInt(inp.getAttribute('data-col'));
      const key = `${paramNames[i]}|${paramNames[j]}`;
      inp.value = correlations[key] || 0;
    });
  }
  validateCorrelationMatrixUI();
}
// Make preset function globally accessible
window.applyCorrelationPreset = applyCorrelationPreset;

/* ===== 21. SHARED PARAMETER LINKS UI ===== */
function buildSharedLinksUI() {
  const container = document.getElementById('sharedLinks');
  if (!container) return;
  container.innerHTML = '';
  if (activeReservoirIdx === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--muted)">First reservoir cannot have shared links. Add more reservoirs to enable linking.</p>';
    return;
  }

  const r = reservoirs[activeReservoirIdx];
  const paramNames = PARAMS.map(p => p.name);

  for (const pName of paramNames) {
    const label = document.createElement('label'); label.textContent = pName;
    const sel = document.createElement('select');
    sel.setAttribute('data-param', pName);
    sel.innerHTML = '<option value="">Independent</option>';
    for (let i = 0; i < activeReservoirIdx; i++) {
      const srcR = reservoirs[i];
      const srcParams = srcR.dists.map(d => d.name);
      if (srcParams.includes(pName)) {
        sel.innerHTML += `<option value="${i}">Same as ${srcR.name || 'Reservoir ' + (i + 1)}</option>`;
      }
    }
    if (r.sharedLinks && r.sharedLinks[pName] !== undefined && r.sharedLinks[pName] !== '') {
      sel.value = r.sharedLinks[pName];
    }
    container.appendChild(label);
    container.appendChild(sel);
  }
}

function readSharedLinks() {
  const container = document.getElementById('sharedLinks');
  if (!container) return {};
  const links = {};
  const selects = container.querySelectorAll('select[data-param]');
  selects.forEach(sel => {
    const pName = sel.getAttribute('data-param');
    if (sel.value !== '') links[pName] = parseInt(sel.value);
  });
  return links;
}

/* ===== 22. RESULTS VIEW SELECTOR ===== */
function updateResultsViewSelector() {
  const sel = document.getElementById('resultsView');
  if (!sel) return;
  sel.innerHTML = '<option value="total">Total (All Reservoirs)</option>';
  reservoirs.forEach((r, i) => {
    sel.innerHTML += `<option value="${i}">${r.name || 'Reservoir ' + (i + 1)}</option>`;
  });
}

/* ===== 22b. CROSS-RESERVOIR PARAMETER CORRELATIONS ===== */
let crossReservoirCorr = {}; // { "0-1": { "Area": 0.5, "Porosity": 0.3, ... }, ... }

function buildCrossReservoirCorrTable() {
  const container = document.getElementById('interResCorrMatrix');
  if (!container) return;
  // Save current values before rebuilding
  saveCrossReservoirCorr();
  container.innerHTML = '';
  const n = reservoirs.length;
  if (n < 2) {
    container.innerHTML = '<p style="color:var(--muted);font-size:12px">Add a second reservoir to define inter-reservoir dependencies.</p>';
    return;
  }

  // Collect each reservoir's param names (including RF)
  const allParamSets = reservoirs.map(r => {
    const params = paramsFor(r.fluid).map(p => p.name);
    params.push('Recovery Factor');
    return params;
  });

  // Build reservoir pairs
  const pairs = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push([i, j]);

  // Collect all unique param names that appear in at least one pair of reservoirs
  const allUniqueParams = [...new Set(allParamSets.flat())];

  // Build table
  const table = document.createElement('table');
  table.className = 'cross-res-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = '<th>Parameter</th>';
  for (const [i, j] of pairs) {
    const th = document.createElement('th');
    const ni = reservoirs[i].name || `R${i + 1}`;
    const nj = reservoirs[j].name || `R${j + 1}`;
    th.textContent = `${ni} ↔ ${nj}`;
    th.title = `${ni} ↔ ${nj}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  for (const param of allUniqueParams) {
    // Only show if param exists in at least 2 reservoirs
    const count = allParamSets.filter(ps => ps.includes(param)).length;
    if (count < 2) continue;

    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = param;
    tr.appendChild(tdName);

    for (const [i, j] of pairs) {
      const td = document.createElement('td');
      const existsInI = allParamSets[i].includes(param);
      const existsInJ = allParamSets[j].includes(param);
      if (existsInI && existsInJ) {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '0.1'; inp.min = '-1'; inp.max = '1';
        const pairKey = `${i}-${j}`;
        inp.setAttribute('data-pair', pairKey);
        inp.setAttribute('data-param', param);
        const saved = crossReservoirCorr[pairKey];
        inp.value = (saved && saved[param] !== undefined) ? saved[param] : 0;
        td.appendChild(inp);
      } else {
        td.textContent = '—';
        td.className = 'disabled-cell';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function saveCrossReservoirCorr() {
  const container = document.getElementById('interResCorrMatrix');
  if (!container) return;
  const inputs = container.querySelectorAll('input[data-pair][data-param]');
  if (inputs.length === 0) return; // nothing to save
  const newCorr = {};
  inputs.forEach(inp => {
    const pair = inp.getAttribute('data-pair');
    const param = inp.getAttribute('data-param');
    const val = parseFloat(inp.value) || 0;
    if (!newCorr[pair]) newCorr[pair] = {};
    newCorr[pair][param] = Math.max(-1, Math.min(1, val));
  });
  crossReservoirCorr = newCorr;
}

function readCrossReservoirCorr() {
  saveCrossReservoirCorr();
  return crossReservoirCorr;
}

/* ===== 22c. UNIFIED BLOCK CORRELATION MATRIX ===== */
function buildFullCorrelationMatrix(configs, crossCorr) {
  // Build flat list of { rIdx, name } for all params across all reservoirs
  const allParams = [];
  for (let rIdx = 0; rIdx < configs.length; rIdx++) {
    for (const d of configs[rIdx].dists) allParams.push({ rIdx, name: d.name });
    allParams.push({ rIdx, name: 'Recovery Factor' });
  }

  const m = allParams.length;
  const matrix = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) matrix[i][i] = 1;

  // Fill intra-reservoir blocks from per-reservoir correlation matrices
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      if (allParams[i].rIdx !== allParams[j].rIdx) continue;
      const rIdx = allParams[i].rIdx;
      const corrMatrix = configs[rIdx].corrMatrix;
      if (!corrMatrix) continue;
      const paramNames = configs[rIdx].dists.map(d => d.name);
      const iLocal = paramNames.indexOf(allParams[i].name);
      const jLocal = paramNames.indexOf(allParams[j].name);
      if (iLocal >= 0 && jLocal >= 0) {
        matrix[i][j] = corrMatrix[iLocal][jLocal];
        matrix[j][i] = corrMatrix[iLocal][jLocal];
      }
    }
  }

  // Fill cross-reservoir blocks (same parameter in different reservoirs)
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      if (allParams[i].rIdx === allParams[j].rIdx) continue;
      if (allParams[i].name !== allParams[j].name) continue;
      const lo = Math.min(allParams[i].rIdx, allParams[j].rIdx);
      const hi = Math.max(allParams[i].rIdx, allParams[j].rIdx);
      const pairKey = `${lo}-${hi}`;
      const pairCorr = crossCorr[pairKey];
      if (pairCorr && pairCorr[allParams[i].name] !== undefined) {
        const rho = pairCorr[allParams[i].name];
        matrix[i][j] = rho;
        matrix[j][i] = rho;
      }
    }
  }

  return { allParams, matrix };
}

/* ===== 23. MULTI-RESERVOIR SIMULATION ===== */
function runMultiReservoirSimulation() {
  const err = document.getElementById('error');
  err.textContent = '';
  const iters = parseInt(document.getElementById('iterations').value, 10);
  const nbins = Math.max(10, parseInt(document.getElementById('nbins').value, 10) || 100);
  if (!(iters > 0)) { err.textContent = "Iterations must be a positive number."; return; }
  const rng = seeded((document.getElementById('seed').value || "").trim());
  const useGRV = geometryMode() === 'grv';

  // Save current tab state
  saveReservoirToState();

  // Build configs for each reservoir
  const configs = [];
  for (let rIdx = 0; rIdx < reservoirs.length; rIdx++) {
    const r = reservoirs[rIdx];
    const fluid = r.fluid;
    const metric = (fluid === 'oilgas' || fluid === 'gasvo') ? 'total' : null;
    // Validate and build dists with unit conversion
    const dists = [];
    for (const d of r.dists) {
      const conv = convTriplet(d.name, d.raw);
      if (d.type === 'Triangular' && !(d.raw[0] <= d.raw[1] && d.raw[1] <= d.raw[2])) { err.textContent = `${r.name}: Invalid Triangular for ${d.name}.`; return; }
      if (d.type === 'PERT' && !(d.raw[0] <= d.raw[1] && d.raw[1] <= d.raw[2])) { err.textContent = `${r.name}: Invalid PERT for ${d.name}.`; return; }
      if (d.type === 'Uniform' && !(d.raw[0] <= d.raw[2])) { err.textContent = `${r.name}: Invalid Uniform for ${d.name}.`; return; }
      if (d.type !== 'Discrete') {
        for (let j = 0; j < 3; j++) {
          if (Number.isNaN(d.raw[j]) && !DIST_LABELS[d.type][j].includes('(ignore)')) {
            err.textContent = `${r.name}: Missing value for ${d.name} (${DIST_LABELS[d.type][j]}).`; return;
          }
        }
      }
      dists.push({ ...d, v: conv });
    }
    configs.push({ fluid, metric, dists, rfType: r.rfType, rfRaw: r.rfRaw, rfPerc: r.rfPerc, iterations: iters, useGRV, corrMatrix: r.correlationMatrix, sharedLinks: r.sharedLinks || {} });
  }

  // Phase 1: Sample all reservoirs
  const allSamples = [];
  for (const cfg of configs) {
    allSamples.push(sampleReservoir(cfg, rng));
  }

  // Phase 2: Apply shared parameter links
  for (let rIdx = 0; rIdx < configs.length; rIdx++) {
    const links = configs[rIdx].sharedLinks;
    for (const [paramName, srcIdx] of Object.entries(links)) {
      if (Number.isFinite(srcIdx) && srcIdx < rIdx && allSamples[srcIdx][paramName]) {
        allSamples[rIdx][paramName] = Float64Array.from(allSamples[srcIdx][paramName]);
      }
    }
  }

  // Phase 3: Unified Iman-Conover (intra-reservoir + cross-reservoir correlations)
  const crossCorr = readCrossReservoirCorr();
  const { allParams: icParams, matrix: fullCorrMatrix } = buildFullCorrelationMatrix(configs, crossCorr);
  const hasAnyCorrelation = fullCorrMatrix.some((row, i) => row.some((v, j) => i !== j && Math.abs(v) > 1e-10));
  if (hasAnyCorrelation) {
    if (isPositiveDefinite(fullCorrMatrix)) {
      const columns = icParams.map(p => allSamples[p.rIdx][p.name]);
      const reordered = imanConover(columns, fullCorrMatrix);
      for (let k = 0; k < icParams.length; k++) {
        allSamples[icParams[k].rIdx][icParams[k].name] = reordered[k];
      }
    } else {
      const warn = document.getElementById('interResCorrWarn');
      if (warn) { warn.textContent = '⚠ Combined correlation matrix is not positive definite. Running without correlations.'; warn.style.color = '#B91C1C'; }
    }
  }

  // Phase 4: Compute volumes per reservoir
  const perReservoir = [];
  for (let rIdx = 0; rIdx < configs.length; rIdx++) {
    const cfg = configs[rIdx];
    const { primary, rec } = computeReservoirVolumes(cfg.fluid, cfg.metric, allSamples[rIdx], cfg.dists, cfg.useGRV);
    const { detMidCase, detRecMidCase } = computeDetMidCase(cfg.dists, cfg.rfType, cfg.rfRaw, cfg.rfPerc, cfg.fluid, cfg.metric, cfg.useGRV);
    const labelSet = labelsForFluidMetric(cfg.fluid, cfg.metric);
    perReservoir.push({
      name: reservoirs[rIdx].name || `Reservoir ${rIdx + 1}`,
      fluid: cfg.fluid, metric: cfg.metric, primary, rec,
      detMidCase, detRecMidCase, labelSet, dists: cfg.dists,
      rfType: cfg.rfType, rfRaw: cfg.rfRaw, rfPerc: cfg.rfPerc,
      samples: allSamples[rIdx]
    });
  }

  // Phase 5: Aggregate (sum in common units)
  const allSameUnit = new Set(perReservoir.map(r => r.labelSet.unit)).size === 1;
  const totalUnit = allSameUnit ? perReservoir[0].labelSet.unit : 'MMBOE';
  const totalPrimary = new Float64Array(iters);
  const totalRec = new Float64Array(iters);
  let totalDet = 0, totalDetRec = 0;

  for (const r of perReservoir) {
    const toMBOE = !allSameUnit;
    for (let i = 0; i < iters; i++) {
      totalPrimary[i] += toMBOE ? volumeToMBOE(r.primary[i], r.fluid, r.metric) : r.primary[i];
      totalRec[i] += toMBOE ? volumeToMBOE(r.rec[i], r.fluid, r.metric) : r.rec[i];
    }
    totalDet += toMBOE ? volumeToMBOE(r.detMidCase, r.fluid, r.metric) : r.detMidCase;
    totalDetRec += toMBOE ? volumeToMBOE(r.detRecMidCase, r.fluid, r.metric) : r.detRecMidCase;
  }

  const totalLabelSet = {
    primary: `Total ${totalUnit === 'MMBOE' ? 'MMBOE' : perReservoir[0].labelSet.primary}`,
    unit: totalUnit,
    xMain: `Total (${totalUnit})`, xRec: `Recoverable (${totalUnit})`,
    cdfTitle: `Total ${totalUnit} CDF`, histTitle: `Total ${totalUnit} Histogram`,
    metricRec: `Recoverable Total`, formula: ''
  };

  // Store results
  lastMultiResults = { perReservoir, totalPrimary, totalRec, totalDet, totalDetRec, totalLabelSet, totalUnit };

  // Display results based on current view
  const viewSel = document.getElementById('resultsView');
  const view = viewSel ? viewSel.value : 'total';
  displayMultiReservoirView(view, nbins);

  // Multi-reservoir summary table
  displayMultiSummaryTable();

  // Tornado
  if (perReservoir.length > 1) {
    const bars = tornadoBarsMulti(perReservoir);
    plotTornado(bars, totalUnit);
  } else {
    const r = perReservoir[0];
    const bars = tornadoBars(r.dists, r.rfType, r.rfRaw, r.rfPerc, r.fluid, r.metric);
    plotTornado(bars, r.labelSet.unit);
  }

  wireSyncedZoom();

  // Build CSV data (simplified for multi-reservoir)
  const [tP90, tP50, tP10] = computeQuantiles(totalPrimary);
  const [tRP90, tRP50, tRP10] = computeQuantiles(totalRec);
  lastSimulationData = {
    P90: tP90, P50: tP50, P10: tP10, RP90: tRP90, RP50: tRP50, RP10: tRP10,
    detMidCase: totalDet, detRecMidCase: totalDetRec,
    pValMain: null, pValRec: null,
    labelSet: totalLabelSet, fluid: 'multi',
    samplesData: buildMultiSamplesData(perReservoir, iters)
  };

  document.getElementById('downloadCsv').disabled = false;
  document.getElementById('downloadSamples').disabled = false;
}

function displayMultiReservoirView(view, nbins) {
  if (!lastMultiResults) return;
  const { perReservoir, totalPrimary, totalRec, totalDet, totalDetRec, totalLabelSet } = lastMultiResults;
  if (view === 'total') {
    displayResults(totalPrimary, totalRec, totalDet, totalDetRec, totalLabelSet, nbins);
  } else {
    const idx = parseInt(view);
    if (idx >= 0 && idx < perReservoir.length) {
      const r = perReservoir[idx];
      displayResults(r.primary, r.rec, r.detMidCase, r.detRecMidCase, r.labelSet, nbins);
    }
  }
}

function displayMultiSummaryTable() {
  const tbody = document.getElementById('multiSummaryBody');
  if (!tbody || !lastMultiResults) return;
  tbody.innerHTML = '';
  const fmt = x => (Math.abs(x) >= 100) ? formatWithCommas(x, 0) : formatWithCommas(x, 2);

  for (const r of lastMultiResults.perReservoir) {
    const [P90, P50, P10] = computeQuantiles(r.primary);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.name}</td><td>${r.fluid}</td><td>${fmt(P90)}</td><td>${fmt(P50)}</td><td>${fmt(P10)}</td><td>${fmt(r.detMidCase)}</td><td>${r.labelSet.unit}</td>`;
    tbody.appendChild(tr);
  }

  // Total row
  const [tP90, tP50, tP10] = computeQuantiles(lastMultiResults.totalPrimary);
  const totalTr = document.createElement('tr');
  totalTr.className = 'total-row';
  totalTr.innerHTML = `<td><b>TOTAL</b></td><td>—</td><td>${fmt(tP90)}</td><td>${fmt(tP50)}</td><td>${fmt(tP10)}</td><td>${fmt(lastMultiResults.totalDet)}</td><td>${lastMultiResults.totalUnit}</td>`;
  tbody.appendChild(totalTr);
}

function buildMultiSamplesData(perReservoir, iters) {
  // Simplified: build samples for first reservoir for CSV compat
  if (perReservoir.length === 0) return [];
  const r = perReservoir[0];
  const data = [];
  for (let i = 0; i < iters; i++) {
    const row = { RF: r.samples['Recovery Factor'][i], primary: r.primary[i], recoverable: r.rec[i] };
    if (r.samples['Area']) { row.Area = r.samples['Area'][i]; row.Thickness = r.samples['Thickness'][i]; row.GRV = row.Area * row.Thickness; }
    else if (r.samples['GRV']) { row.GRV = r.samples['GRV'][i]; }
    if (r.samples['Net to Gross']) { row.NTG = r.samples['Net to Gross'][i]; row.PHI = r.samples['Porosity'][i]; row.SW = r.samples['Water Saturation'][i]; }
    if (r.samples['Bo']) row.FVF = r.samples['Bo'][i];
    else if (r.samples['Bg']) row.FVF = r.samples['Bg'][i];
    if (r.samples['Rs']) row.Rs = r.samples['Rs'][i];
    if (r.samples['Rv']) row.Rv = r.samples['Rv'][i];
    if (r.samples['Coal Density']) { row.CoalDensity = r.samples['Coal Density'][i]; row.GasContent = r.samples['Gas Content'][i]; row.CoalMass = (row.GRV || 0) * row.CoalDensity * 1359.7; }
    if (row.NTG) row.HCPV = (row.GRV || 0) * row.NTG * row.PHI * (1 - row.SW);
    data.push(row);
  }
  return data;
}

/* ===== 24. MAIN SIMULATION ENTRY POINT ===== */
function runSimulation() {
  if (advancedMode && reservoirs.length > 0) {
    runMultiReservoirSimulation();
    return;
  }

  // === BASIC MODE ===
  const err = document.getElementById('error');
  err.textContent = "";
  const iters = parseInt(document.getElementById('iterations').value, 10);
  const nbins = Math.max(10, parseInt(document.getElementById('nbins').value, 10) || 100);
  if (!(iters > 0)) { err.textContent = "Iterations must be a positive number."; return; }
  const rng = seeded((document.getElementById('seed').value || "").trim());
  const fluid = FLUID.value;
  const resultType = ((fluid === 'oilgas' || fluid === 'gasvo') && document.getElementById('resultType')) ? document.getElementById('resultType').value : null;
  const metric = (fluid === 'oilgas' || fluid === 'gasvo') ? (resultType || 'total') : null;
  const useGRV = geometryMode() === 'grv';

  // Read distributions from DOM
  const rows = [...document.querySelectorAll('#params .dist-row')];
  const dists = [];
  for (const row of rows) {
    const name = row.getAttribute('data-param');
    const type = row.querySelector('.dist-type').value;
    const raw = [...row.querySelectorAll('input.v')].map(el => el.value === "" ? NaN : Number(el.value));
    if (type === 'Triangular' && !(raw[0] <= raw[1] && raw[1] <= raw[2])) { err.textContent = `Invalid Triangular values for ${name}.`; return; }
    if (type === 'PERT' && !(raw[0] <= raw[1] && raw[1] <= raw[2])) { err.textContent = `Invalid PERT values for ${name}.`; return; }
    if (type === 'Uniform' && !(raw[0] <= raw[2])) { err.textContent = `Invalid Uniform values for ${name}.`; return; }
    if (type !== 'Discrete') {
      for (let j = 0; j < 3; j++) {
        if (Number.isNaN(raw[j]) && !DIST_LABELS[type][j].includes('(ignore)')) {
          err.textContent = `Please enter a valid number for ${name} (${DIST_LABELS[type][j]}).`; return;
        }
      }
    }
    const conv = convTriplet(name, raw);
    let wPerc = [NaN, NaN, NaN];
    const wrow = row.nextElementSibling;
    if (type === 'Discrete' && wrow && wrow.classList.contains('weights-row')) wPerc = [...wrow.querySelectorAll('input')].map(x => Number(x.value));
    dists.push({ name, type, raw, v: conv, wPerc });
  }

  // Recovery Factor
  const rfType = document.querySelector('.rf-type').value;
  const rfRaw = [...document.querySelectorAll('.rf-v')].map(x => x.value === "" ? NaN : Number(x.value));
  if (rfType === 'Triangular' && !(rfRaw[0] <= rfRaw[1] && rfRaw[1] <= rfRaw[2])) { err.textContent = 'Invalid Triangular values for RF.'; return; }
  if (rfType === 'PERT' && !(rfRaw[0] <= rfRaw[1] && rfRaw[1] <= rfRaw[2])) { err.textContent = 'Invalid PERT values for RF.'; return; }
  if (rfType === 'Uniform' && !(rfRaw[0] <= rfRaw[2])) { err.textContent = 'Invalid Uniform values for RF.'; return; }
  let rfPerc = [NaN, NaN, NaN];
  if (rfType === 'Discrete') rfPerc = [...document.querySelectorAll('#rf-weights input')].map(x => Number(x.value));

  // Sample
  const config = { dists, rfType, rfRaw, rfPerc, fluid, iterations: iters, useGRV, metric };
  const samples = sampleReservoir(config, rng);

  // Compute volumes
  const { primary, rec } = computeReservoirVolumes(fluid, metric, samples, dists, useGRV);
  const { detMidCase, detRecMidCase } = computeDetMidCase(dists, rfType, rfRaw, rfPerc, fluid, metric, useGRV);
  const labelSet = labelsForFluidMetric(fluid, metric);

  // Display
  const stats = displayResults(primary, rec, detMidCase, detRecMidCase, labelSet, nbins);

  // Tornado
  const tornadoData = tornadoBars(dists, rfType, rfRaw, rfPerc, fluid, metric);
  plotTornado(tornadoData, labelSet.unit);
  wireSyncedZoom();

  // Build samples data for CSV
  const n = iters;
  const samplesData = [];
  for (let i = 0; i < n; i++) {
    const row = { RF: samples['Recovery Factor'][i], primary: primary[i], recoverable: rec[i] };
    if (samples['Area']) { row.Area = samples['Area'][i]; row.Thickness = samples['Thickness'][i]; row.GRV = row.Area * row.Thickness; }
    else if (samples['GRV']) { row.GRV = samples['GRV'][i]; }
    if (samples['Net to Gross']) { row.NTG = samples['Net to Gross'][i]; row.PHI = samples['Porosity'][i]; row.SW = samples['Water Saturation'][i]; }
    if (samples['Bo']) row.FVF = samples['Bo'][i];
    else if (samples['Bg']) row.FVF = samples['Bg'][i];
    if (samples['Rs']) row.Rs = samples['Rs'][i];
    if (samples['Rv']) row.Rv = samples['Rv'][i];
    if (samples['Coal Density']) { row.CoalDensity = samples['Coal Density'][i]; row.GasContent = samples['Gas Content'][i]; row.CoalMass = (row.GRV || 0) * row.CoalDensity * 1359.7; }
    if (row.NTG) row.HCPV = (row.GRV || 0) * row.NTG * row.PHI * (1 - row.SW);
    samplesData.push(row);
  }

  lastSimulationData = {
    P90: stats.P90, P50: stats.P50, P10: stats.P10,
    RP90: stats.RP90, RP50: stats.RP50, RP10: stats.RP10,
    detMidCase, detRecMidCase, pValMain: stats.pValMain, pValRec: stats.pValRec,
    labelSet, fluid, samplesData
  };

  document.getElementById('downloadCsv').disabled = false;
  document.getElementById('downloadSamples').disabled = false;
}

/* ===== 25. EVENT LISTENERS & BOOTSTRAP ===== */
document.getElementById('run').addEventListener('click', runSimulation);
document.getElementById('reset').addEventListener('click', () => location.reload());
document.querySelectorAll('button[data-reset]').forEach(btn => {
  btn.addEventListener('click', () => { Plotly.relayout(btn.getAttribute('data-reset'), { 'xaxis.autorange': true }); });
});

// Help modal
const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const helpClose = document.getElementById('helpClose');
helpBtn.addEventListener('click', () => { helpModal.classList.add('open'); helpModal.setAttribute('aria-hidden', 'false'); });
helpClose.addEventListener('click', () => { helpModal.classList.remove('open'); helpModal.setAttribute('aria-hidden', 'true'); });
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpClose.click(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && helpModal.classList.contains('open')) helpClose.click(); });

// CSV buttons
document.getElementById('downloadCsv').addEventListener('click', generateSummaryCSV);
document.getElementById('downloadSamples').addEventListener('click', generateSamplesCSV);

// Advanced mode toggle
const advToggle = document.getElementById('advancedModeToggle');
if (advToggle) {
  advToggle.addEventListener('change', () => toggleAdvancedMode(advToggle.checked));
}

// Results view selector (for multi-reservoir)
const resultsViewSel = document.getElementById('resultsView');
if (resultsViewSel) {
  resultsViewSel.addEventListener('change', () => {
    const nbins = Math.max(10, parseInt(document.getElementById('nbins').value, 10) || 100);
    displayMultiReservoirView(resultsViewSel.value, nbins);
  });
}

// Reservoir name live update
const reservoirNameInput = document.getElementById('reservoirName');
if (reservoirNameInput) {
  reservoirNameInput.addEventListener('input', () => {
    if (reservoirs[activeReservoirIdx]) {
      reservoirs[activeReservoirIdx].name = reservoirNameInput.value;
      renderReservoirTabs();
      buildCrossReservoirCorrTable();
    }
  });
}

// Bootstrap
mountGeometrySelector();
mountParams();
labelsAndFormula();
prefillDefaults();
renderDistPreviews();
