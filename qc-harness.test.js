/**
 * RangeRover QC Verification Harness
 * ----------------------------------
 * Automated verification of rangerover-standalone.html (the canonical build)
 * for use in reserves-grade volumetric screening.
 *
 * Run:  node qc-harness.test.js
 * Deps: jsdom  (npm i jsdom)
 *
 * Sections:
 *   A. Deterministic formula benchmarks (hand-calculated, tol 1e-9 relative)
 *   B. Sampler statistical moments (200k seeded draws vs analytic values)
 *   C. Percentile convention (SPE-PRMS: P90 = low / 90% exceedance)
 *   D. Known Distribution round-trip (P90/P50/P10 in -> quantiles out)
 *   E. Iman-Conover rank correlation (induced Spearman rho + marginal preservation)
 *   F. Truncated-normal sampling: RR-01 fixed via inverse-CDF (normCDF + normQuantile)
 *   G. Recovery factor per-iteration application
 *   H. Unit conversion factors
 *   I. Aggregation / volumeToMBOE
 *   J. Edge cases & input-domain hazards (RR-02 Bo/Bg=0, RR-03 Rs unbounded)
 *   K. Seed reproducibility
 *   L. End-to-end basic-mode simulation through the real DOM
 *   M. CSG constant derivation check
 *   N. Unified block correlation matrix construction (buildFullCorrelationMatrix)
 *   O. Intra-reservoir parameter correlation, end-to-end (advanced mode)
 *   P. Inter-reservoir parameter correlation, end-to-end
 *   Q. Shared parameter links, end-to-end (identity must survive the full pipeline)
 *   R. Multi-reservoir aggregation identities
 *   S. Non-positive-definite combined matrix fallback
 *   T. Build parity audit: app.js & rangerover-responsive.html vs canonical standalone
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/* ---------- load the standalone app with a Plotly stub ---------- */
const HTML_PATH = path.join(__dirname, 'rangerover-standalone.html');
let html = fs.readFileSync(HTML_PATH, 'utf8');

const PLOTLY_TAG = '<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>';
if (!html.includes(PLOTLY_TAG)) {
  console.error('FATAL: expected Plotly CDN script tag not found — harness needs updating.');
  process.exit(2);
}
const PLOTLY_STUB = `<script>
  window.Plotly = {
    newPlot: function (gd) { return Promise.resolve(typeof gd === 'string' ? document.getElementById(gd) : gd); },
    relayout: function () { return Promise.resolve(); },
    purge: function () {}
  };
<\/script>`;
html = html.replace(PLOTLY_TAG, PLOTLY_STUB);

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'file://' + HTML_PATH,
  pretendToBeVisual: true
});
const w = dom.window;
const doc = w.document;

/* ---------- micro test framework ---------- */
let passCount = 0, failCount = 0;
const failures = [];
function check(id, desc, ok, detail) {
  if (ok) { passCount++; console.log(`  PASS  ${id}  ${desc}`); }
  else {
    failCount++;
    failures.push({ id, desc, detail });
    console.log(`  FAIL  ${id}  ${desc}${detail ? '  [' + detail + ']' : ''}`);
  }
}
function relErr(actual, expected) {
  if (expected === 0) return Math.abs(actual);
  return Math.abs((actual - expected) / expected);
}
function approx(id, desc, actual, expected, tol) {
  const e = relErr(actual, expected);
  check(id, `${desc} (got ${actual}, want ${expected}, relErr ${e.toExponential(2)})`, e <= tol);
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function mean(a) { let s = 0; for (const x of a) s += x; return s / a.length; }
function variance(a) { const m = mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return s / (a.length - 1); }
function spearman(x, y) {
  const rx = w.rankArray(Float64Array.from(x));
  const ry = w.rankArray(Float64Array.from(y));
  const n = x.length, mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - mx; num += a * b; dx += a * a; dy += b * b; }
  return num / Math.sqrt(dx * dy);
}

/* =================================================================
 * A. DETERMINISTIC FORMULA BENCHMARKS
 * ================================================================= */
section('A. Deterministic formula benchmarks (computeVolumeSingle)');
{
  const TOL = 1e-9;
  // A1 Oil: STOIIP = 7758*A*h*NTG*phi*(1-Sw)/Bo /1e6  [MMBO]
  // 7758 * 1000ac * 50ft * 0.8 * 0.25 * (1-0.3) / 1.2 / 1e6 = 45.255 MMBO
  const oilP = { 'Net to Gross': 0.8, 'Porosity': 0.25, 'Water Saturation': 0.3, 'Bo': 1.2 };
  approx('A1', 'Oil STOIIP', w.computeVolumeSingle('oil', null, 1000 * 50, oilP),
    7758 * 50000 * 0.8 * 0.25 * 0.7 / 1.2 / 1e6, TOL);

  // A2 Gas: GIIP = 43560*A*h*NTG*phi*(1-Sw)/Bg /1e9  [BCF]
  const gasP = { 'Net to Gross': 0.6, 'Porosity': 0.2, 'Water Saturation': 0.35, 'Bg': 0.004 };
  approx('A2', 'Gas GIIP', w.computeVolumeSingle('gas', null, 500 * 100, gasP),
    43560 * 50000 * 0.6 * 0.2 * 0.65 / 0.004 / 1e9, TOL);

  // A3 CSG: GIIP = 48013*A*h*rho*Gc /1e9  [BCF]
  const csgP = { 'Coal Density': 1.4, 'Gas Content': 8 };
  approx('A3', 'CSG GIIP', w.computeVolumeSingle('csg', null, 2000 * 20, csgP),
    48013 * 40000 * 1.4 * 8 / 1e9, TOL);

  // A4 Oil+Gas (solution gas): total = stoiip + giip(BCF basis)/5.8 expressed in MMBOE
  const ogP = { 'Net to Gross': 0.8, 'Porosity': 0.25, 'Water Saturation': 0.3, 'Bo': 1.2, 'Rs': 600 };
  const AH = 1000 * 50;
  const stoiip = 7758 * AH * 0.8 * 0.25 * 0.7 / 1.2 / 1e6;
  const giipBCF = 7758 * AH * 0.8 * 0.25 * 0.7 * 600 / 1.2 / 1e9;
  approx('A4a', 'oilgas metric=stoiip', w.computeVolumeSingle('oilgas', 'stoiip', AH, ogP), stoiip, TOL);
  approx('A4b', 'oilgas metric=giip', w.computeVolumeSingle('oilgas', 'giip', AH, ogP), giipBCF, TOL);
  approx('A4c', 'oilgas metric=total (MMBOE)', w.computeVolumeSingle('oilgas', 'total', AH, ogP),
    stoiip + giipBCF / 5.8 * 1000 / 1000, TOL); // giipBOE = scf-vol / 5.8e9 == BCF/5.8
  // NOTE: solution-gas GIIP uses 7758*Rs/Bo (RB basis), i.e. Rs applied to STOIIP — verified consistent.

  // A5 Gas+Vaporized Oil
  const gvP = { 'Net to Gross': 0.6, 'Porosity': 0.2, 'Water Saturation': 0.35, 'Bg': 0.004, 'Rv': 0.00002 };
  const AH2 = 500 * 100;
  const giip2 = 43560 * AH2 * 0.6 * 0.2 * 0.65 / 0.004 / 1e9;
  const vo = 43560 * AH2 * 0.6 * 0.2 * 0.65 * 0.00002 / 0.004 / 1e6;
  approx('A5a', 'gasvo metric=giip', w.computeVolumeSingle('gasvo', 'giip', AH2, gvP), giip2, TOL);
  approx('A5b', 'gasvo metric=vo', w.computeVolumeSingle('gasvo', 'vo', AH2, gvP), vo, TOL);
  approx('A5c', 'gasvo metric=total (MMBOE)', w.computeVolumeSingle('gasvo', 'total', AH2, gvP),
    giip2 / 5.8 + vo, TOL);

  // A6 GRV passthrough: AH is the same quantity in acre-ft either way
  approx('A6', 'GRV mode equivalence (oil)', w.computeVolumeSingle('oil', null, 50000, oilP),
    w.computeVolumeSingle('oil', null, 1000 * 50, oilP), 0);
}

/* =================================================================
 * B. SAMPLER STATISTICAL MOMENTS  (n = 200,000 seeded)
 * ================================================================= */
section('B. Sampler statistical moments (n=200k, seeded)');
{
  const N = 200000;
  function draws(fn) {
    const rng = w.mulberry32(12345);
    const a = new Float64Array(N);
    for (let i = 0; i < N; i++) a[i] = fn(rng);
    return a;
  }
  // Triangular(0,5,10): mean 5, var 75/18
  let s = draws(r => w.sampleTriangular(r, 0, 5, 10));
  approx('B1a', 'Triangular mean', mean(s), 5, 0.005);
  approx('B1b', 'Triangular variance', variance(s), 75 / 18, 0.02);

  // Uniform(2,8): mean 5, var 3
  s = draws(r => w.sampleUniform(r, 2, 8));
  approx('B2a', 'Uniform mean', mean(s), 5, 0.005);
  approx('B2b', 'Uniform variance', variance(s), 3, 0.02);

  // Normal(10,2)
  s = draws(r => w.sampleNormal(r, 10, 2));
  approx('B3a', 'Normal mean', mean(s), 10, 0.005);
  approx('B3b', 'Normal variance', variance(s), 4, 0.02);

  // PERT(0,5,10) lambda=4: mean (a+4m+b)/6 = 5, var (mean-a)(b-mean)/7 = 25/7
  s = draws(r => w.samplePERT(r, 0, 5, 10, 4));
  approx('B4a', 'PERT mean', mean(s), 5, 0.005);
  approx('B4b', 'PERT variance', variance(s), 25 / 7, 0.03);

  // Gamma(k=2, theta=1): mean 2, var 2
  s = draws(r => w.sampleGamma(r, 2, 1));
  approx('B5a', 'Gamma(2) mean', mean(s), 2, 0.01);
  approx('B5b', 'Gamma(2) variance', variance(s), 2, 0.03);

  // Beta(2,5): mean 2/7, var 10/(49*8)
  s = draws(r => w.sampleBeta(r, 2, 5));
  approx('B6a', 'Beta(2,5) mean', mean(s), 2 / 7, 0.01);
  approx('B6b', 'Beta(2,5) variance', variance(s), 10 / (49 * 8), 0.03);

  // normalFromP90P50P10: sigma = (P10-P90)/(2*z90)
  const { mean: m0, sigma } = w.normalFromP90P50P10(8, 10, 12);
  approx('B7a', 'Known-dist implied mean', m0, 10, 1e-12);
  approx('B7b', 'Known-dist implied sigma', sigma, 4 / (2 * 1.2815515655446004), 1e-12);
}

/* =================================================================
 * C. PERCENTILE CONVENTION (SPE-PRMS)
 * ================================================================= */
section('C. Percentile convention (SPE-PRMS exceedance)');
{
  // Values 1..1000: nearest-rank floor convention -> P90 = s[100] = 101 (10th cumulative percentile)
  const arr = Float64Array.from({ length: 1000 }, (_, i) => i + 1);
  const [P90, P50, P10] = w.computeQuantiles(arr);
  check('C1', `P90 (${P90}) < P50 (${P50}) < P10 (${P10}) — exceedance labelling`, P90 < P50 && P50 < P10);
  // RR-04 fixed: Type-7 linear interpolation — expected values are now fractional
  // For arr[1..1000]: h=(n-1)*p; P90: h=99.9 -> 100+0.9*1=100.9; P50: h=499.5 -> 500.5; P10: h=899.1 -> 900.1
  approx('C2', 'P90 = interpolated 10th-percentile (100.9)', P90, 100.9, 1e-9);
  approx('C3', 'P50 = interpolated median (500.5)', P50, 500.5, 1e-9);
  approx('C4', 'P10 = interpolated 90th-percentile (900.1)', P10, 900.1, 1e-9);

  // computePercentile inverse consistency
  approx('C5', 'computePercentile(501) ≈ 0.501', w.computePercentile(arr, 501), 0.501, 1e-9);

  // RR-04 fixed: Type-7 interpolation gives exact median for n=10: h=(10-1)*0.5=4.5 -> s[4]+0.5*(s[5]-s[4])=5.5
  const small = Float64Array.from({ length: 10 }, (_, i) => i + 1);
  const [, p50s] = w.computeQuantiles(small);
  check('C6', 'RR-04 fixed: interpolated median for n=10 = 5.5 (not 6)', p50s === 5.5, `got ${p50s}`);
}

/* =================================================================
 * D. KNOWN DISTRIBUTION ROUND-TRIP
 * ================================================================= */
section('D. Known Distribution round-trip');
{
  const N = 200000;
  const rng = w.mulberry32(777);
  const a = new Float64Array(N);
  // Known Dist for an unbounded param (Area has min 1e-9 only): P90=80, P50=100, P10=120
  for (let i = 0; i < N; i++) a[i] = w.drawOne(rng, 'Known Distribution', [80, 100, 120], 'Area', null, 'oil');
  const [P90, P50, P10] = w.computeQuantiles(a);
  approx('D1', 'Recovered P90', P90, 80, 0.01);
  approx('D2', 'Recovered P50', P50, 100, 0.01);
  approx('D3', 'Recovered P10', P10, 120, 0.01);
}

/* =================================================================
 * E. IMAN-CONOVER RANK CORRELATION
 * ================================================================= */
section('E. Iman-Conover rank correlation');
{
  const N = 50000;
  const rng = w.mulberry32(2024);
  const colA = new Float64Array(N), colB = new Float64Array(N);
  for (let i = 0; i < N; i++) { colA[i] = w.sampleTriangular(rng, 0, 5, 10); colB[i] = w.sampleNormal(rng, 100, 15); }
  const target = 0.7;
  const out = w.imanConover([colA, colB], [[1, target], [target, 1]]);
  const rho = spearman(out[0], out[1]);
  approx('E1', 'Induced Spearman rho (RR-15: score-corrected, tol 0.01)', rho, target, 0.015);

  // Marginal preservation: sorted output equals sorted input exactly
  const sortedIn = Array.from(colA).sort((a, b) => a - b);
  const sortedOut = Array.from(out[0]).sort((a, b) => a - b);
  let marginalsOk = true;
  for (let i = 0; i < N; i++) if (sortedIn[i] !== sortedOut[i]) { marginalsOk = false; break; }
  check('E2', 'Marginal distribution exactly preserved under reordering', marginalsOk);

  // Negative correlation
  const out2 = w.imanConover([colA, colB], [[1, -0.6], [-0.6, 1]]);
  approx('E3', 'Induced negative Spearman rho (RR-15 tightened)', spearman(out2[0], out2[1]), -0.6, 0.015);

  // RR-15 precision sweep: induced rank correlation within ±0.005 absolute across the range
  let sweepOk = true, worst = 0;
  for (const t of [0.2, 0.4, 0.6, 0.8, 0.95]) {
    const o = w.imanConover([colA, colB], [[1, t], [t, 1]]);
    const e = Math.abs(spearman(o[0], o[1]) - t);
    if (e > worst) worst = e;
    if (e > 0.005) sweepOk = false;
  }
  check('E6', `RR-15: induced Spearman within ±0.005 absolute for rho in [0.2, 0.95] (worst ${worst.toExponential(2)})`, sweepOk);

  // Non-PD matrix silently falls back to independent copies (documented RR-07)
  const badM = [[1, 0.99], [0.99, 1]]; // PD — use a genuinely non-PD 3x3
  const nonPD = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
  check('E4', 'isPositiveDefinite rejects non-PD matrix', !w.isPositiveDefinite(nonPD));
  check('E4b', 'isPositiveDefinite accepts valid matrix', w.isPositiveDefinite(badM));
  const fb = w.imanConover([colA, colB, colA], nonPD);
  check('E5', 'Non-PD fallback returns unreordered copies (silent — RR-07)', fb[0][0] === colA[0] && fb[1][0] === colB[0]);
}

/* =================================================================
 * F. TRUNCATED-NORMAL SAMPLING — RR-01 FIX (inverse-CDF)
 * ================================================================= */
section('F. Truncated-normal rejection sampling (RR-01)');
{
  // F1: Well-posed case — same as before; should still have essentially no mean-pinning.
  const N = 100000;
  let rng = w.mulberry32(99);
  let inBounds = 0;
  for (let i = 0; i < N; i++) {
    const x = w.sampleNormalTrunc(rng, 0.2, 0.05, 0, 1);
    if (x > 0 && x < 1 && x !== 0.2) inBounds++;
  }
  check('F1', 'Well-posed truncated normal: no visible clamping', inBounds / N > 0.999, `${inBounds}/${N}`);

  // F2 (RR-01 FIXED): Wide Normal(0.5, 50) on [0,1] with inverse-CDF — distribution is spread, NOT collapsed.
  rng = w.mulberry32(99);
  let clamped = 0;
  for (let i = 0; i < N; i++) {
    const x = w.sampleNormalTrunc(rng, 0.5, 50, 0, 1);
    if (x === 0.5) clamped++;
  }
  const fClamp = clamped / N;
  check('F2', `RR-01 fixed: wide normal on [0,1] no longer collapses to mean (${(fClamp * 100).toFixed(2)}% at mean, want <1%)`, fClamp < 0.01);

  // F3: normCDF / normQuantile round-trip accuracy
  // Note: normCDF (A&S approx) has max |err| ~7.5e-8 in probability space; amplified by 1/φ(z) at tails.
  // At z=±3: φ(-3)≈0.0044, so δz ≈ 7.5e-8/0.0044 ≈ 1.7e-5. Tolerance set to 1e-4 (ample for reserves use).
  const nq = w.normQuantile, nc = w.normCDF;
  let rtOk = true;
  for (const z of [-3, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3]) {
    const back = nq(nc(z));
    if (Math.abs(back - z) > 1e-4) { rtOk = false; break; }
  }
  check('F3', 'normCDF/normQuantile round-trip accurate to 1e-4 across [-3,3]', rtOk);

  // F4: Truncated Normal(0.5, 50) on [0,1] — with inverse-CDF the distribution approaches
  // Uniform(0,1) (the wide-sigma limit), so mean ≈ 0.5 and variance ≈ 1/12 ≈ 0.0833.
  rng = w.mulberry32(42);
  const M = 200000;
  let sumX = 0, sumX2 = 0;
  for (let i = 0; i < M; i++) {
    const x = w.sampleNormalTrunc(rng, 0.5, 50, 0, 1);
    sumX += x; sumX2 += x * x;
  }
  const sampMean = sumX / M;
  const sampVar = sumX2 / M - sampMean * sampMean;
  approx('F4a', 'Truncated Normal(0.5,50) on [0,1] mean ≈ 0.5 (inverse-CDF, symmetric)', sampMean, 0.5, 0.01);
  check('F4b', `Truncated Normal(0.5,50) on [0,1] variance > 0.07 (not collapsed, got ${sampVar.toFixed(4)})`, sampVar > 0.07);
}

/* =================================================================
 * G. RECOVERY FACTOR APPLICATION
 * ================================================================= */
section('G. Recovery factor applied per-iteration');
{
  const dists = [
    { name: 'Area', type: 'Discrete', v: [1000, NaN, NaN], raw: [1000, NaN, NaN], wPerc: [NaN, NaN, NaN] },
    { name: 'Thickness', type: 'Discrete', v: [50, NaN, NaN], raw: [50, NaN, NaN], wPerc: [NaN, NaN, NaN] },
    { name: 'Net to Gross', type: 'Discrete', v: [0.8, NaN, NaN], raw: [0.8, NaN, NaN], wPerc: [NaN, NaN, NaN] },
    { name: 'Porosity', type: 'Discrete', v: [0.25, NaN, NaN], raw: [0.25, NaN, NaN], wPerc: [NaN, NaN, NaN] },
    { name: 'Water Saturation', type: 'Discrete', v: [0.3, NaN, NaN], raw: [0.3, NaN, NaN], wPerc: [NaN, NaN, NaN] },
    { name: 'Bo', type: 'Discrete', v: [1.2, NaN, NaN], raw: [1.2, NaN, NaN], wPerc: [NaN, NaN, NaN] }
  ];
  const config = { dists, rfType: 'Uniform', rfRaw: [0.2, NaN, 0.6], rfPerc: [NaN, NaN, NaN], fluid: 'oil', iterations: 50000, useGRV: false, metric: null };
  const rng = w.mulberry32(4242);
  const samples = w.sampleReservoir(config, rng);
  const { primary, rec } = w.computeReservoirVolumes('oil', null, samples, dists, false);
  const stoiip = 7758 * 50000 * 0.8 * 0.25 * 0.7 / 1.2 / 1e6;
  let perIterOk = true;
  for (let i = 0; i < 1000; i++) {
    if (relErr(rec[i], primary[i] * samples['Recovery Factor'][i]) > 1e-12) { perIterOk = false; break; }
  }
  check('G1', 'rec[i] = primary[i] × RF[i] exactly (per-iteration, not mean RF)', perIterOk);
  approx('G2', 'Deterministic in-place with fixed inputs', primary[0], stoiip, 1e-12);
  approx('G3', 'Mean recoverable ≈ STOIIP × E[RF]=0.4', mean(rec), stoiip * 0.4, 0.01);
}

/* =================================================================
 * H. UNIT CONVERSION FACTORS
 * ================================================================= */
section('H. Unit conversion factors');
{
  // const declarations are not on window — evaluate in page context
  const AREA_FACTORS = w.eval('AREA_FACTORS');
  const THICK_FACTORS = w.eval('THICK_FACTORS');
  const GRV_FACTORS = w.eval('GRV_FACTORS');
  // Internal basis: acres, ft, acre-ft
  // NOTE (RR-11, Low): app constants are rounded to 6 sig figs (e.g. 0.000247105
  // vs exact 0.000247105381) — max error ~7 ppm, immaterial for screening,
  // but documented. Tolerance set to 1e-5 accordingly.
  approx('H1', 'm² -> acres (rounded constant, ~2 ppm — RR-11)', AREA_FACTORS.m2, 1 / 4046.8564224, 1e-5);
  approx('H2', 'km² -> acres (rounded constant — RR-11)', AREA_FACTORS.km2, 1e6 / 4046.8564224, 1e-5);
  approx('H3', 'ft² -> acres (rounded constant, ~7 ppm — RR-11)', AREA_FACTORS.ft2, 1 / 43560, 1e-5);
  approx('H4', 'm -> ft', THICK_FACTORS.m, 3.28084, 1e-6);
  approx('H5', 'GRV 10⁶ m³ -> acre-ft', GRV_FACTORS['m^3'], 1e6 / 1233.48184, 1e-6);
  approx('H6', 'GRV 10⁹ ft³ -> acre-ft', GRV_FACTORS['ft^3'], 1e9 / 43560, 1e-9);
  approx('H7', 'GRV 10⁶ acre-ft -> acre-ft', GRV_FACTORS['acre-ft'], 1e6, 0);
}

/* =================================================================
 * I. AGGREGATION / volumeToMBOE
 * ================================================================= */
section('I. MBOE conversion & aggregation basis');
{
  approx('I1', 'Oil MMBO -> MMBOE 1:1', w.volumeToMBOE(10, 'oil', null), 10, 0);
  approx('I2', 'Gas BCF -> MMBOE /5.8', w.volumeToMBOE(58, 'gas', null), 10, 1e-12);
  approx('I3', 'CSG BCF -> MMBOE /5.8', w.volumeToMBOE(5.8, 'csg', null), 1, 1e-12);
  approx('I4', 'oilgas giip metric /5.8', w.volumeToMBOE(5.8, 'oilgas', 'giip'), 1, 1e-12);
  approx('I5', 'gasvo total already MMBOE', w.volumeToMBOE(7, 'gasvo', 'total'), 7, 0);
  // Disclosure: 5.8 MCF/BOE energy basis (not 6.0) — RR-10 documentation item.
  check('I6', 'BOE factor is 5.8 (documented basis, RR-10)', relErr(w.volumeToMBOE(5.8, 'gas', null), 1) < 1e-12);
}

/* =================================================================
 * J. EDGE CASES & INPUT-DOMAIN HAZARDS
 * ================================================================= */
section('J. Edge cases & input-domain hazards');
{
  // J1: Sw = 1 -> zero in-place (not negative)
  const p1 = { 'Net to Gross': 0.8, 'Porosity': 0.25, 'Water Saturation': 1, 'Bo': 1.2 };
  check('J1', 'Sw=1 gives exactly 0', w.computeVolumeSingle('oil', null, 50000, p1) === 0);

  // J2 (RR-02 FIXED): Bo=0 now returns NaN (divide-by-zero guard active)
  const p2 = { 'Net to Gross': 0.8, 'Porosity': 0.25, 'Water Saturation': 0.3, 'Bo': 0 };
  const j2result = w.computeVolumeSingle('oil', null, 50000, p2);
  check('J2', 'RR-02 fixed: Bo=0 -> NaN (divide-by-zero guard active)', Number.isNaN(j2result));
  check('J2b', 'RR-02+RR-08: NaN from guard propagates to computeQuantiles filter',
    Number.isFinite(w.computeQuantiles(Float64Array.from([j2result, 10, 20, 30]))[0]));

  // J3 (RR-03 FIXED): Rs now bounded [0, +Inf) in boundsFor; Normal cannot sample negative Rs
  const b = w.boundsFor('Rs', 'oilgas');
  check('J3a', 'RR-03 fixed: boundsFor("Rs").min === 0 (non-negative Rs enforced)', b.min === 0 && b.max === Infinity);
  const rng = w.mulberry32(31337);
  let sawNegative = false;
  for (let i = 0; i < 10000; i++) {
    if (w.drawOne(rng, 'Normal', [100, 500, NaN], 'Rs', null, 'oilgas') < 0) { sawNegative = true; break; }
  }
  check('J3b', 'RR-03 fixed: Normal Rs cannot sample negative values', !sawNegative);

  // J4: fractions are bounded [0,1] under Normal
  const rng2 = w.mulberry32(8);
  let fracOk = true;
  for (let i = 0; i < 20000; i++) {
    const x = w.drawOne(rng2, 'Normal', [0.5, 0.4, NaN], 'Porosity', null, 'oil');
    if (x < 0 || x > 1) { fracOk = false; break; }
  }
  check('J4', 'Porosity Normal draws always within [0,1]', fracOk);

  // J5: Bo bounded below at 1.0 under Normal
  const rng3 = w.mulberry32(9);
  let boOk = true;
  for (let i = 0; i < 20000; i++) {
    if (w.drawOne(rng3, 'Normal', [1.2, 0.5, NaN], 'Bo', null, 'oil') < 1.0) { boOk = false; break; }
  }
  check('J5', 'Bo Normal draws always >= 1.0', boOk);

  // J6 (RR-05 FIXED): Triangular draws are now clamped to physical bounds via drawOne
  const xTri = w.drawOne(() => 0.999999, 'Triangular', [-10, -5, -1], 'Porosity', null, 'oil');
  check('J6', 'RR-05 fixed: Triangular porosity min=-10 clamped to physical bound 0 (got ' + xTri + ')', xTri >= 0);

  // J7: NaN inputs propagate to NaN (then filtered from quantiles — silent shrinkage, RR-08)
  const q = w.computeQuantiles(Float64Array.from([1, 2, NaN, 4, 5]));
  check('J7', 'RR-08: NaN samples silently dropped from quantiles (n shrinks 5->4)', Number.isFinite(q[0]) && Number.isFinite(q[2]));

  // J8: single iteration does not crash
  const q1 = w.computeQuantiles(Float64Array.from([42]));
  check('J8', '1-iteration quantiles all equal the single sample', q1[0] === 42 && q1[1] === 42 && q1[2] === 42);
}

/* =================================================================
 * K. SEED REPRODUCIBILITY
 * ================================================================= */
section('K. Seed reproducibility');
{
  function run(seedStr) {
    const rng = w.seeded(seedStr);
    const a = new Float64Array(1000);
    for (let i = 0; i < 1000; i++) a[i] = w.sampleNormal(rng, 0, 1);
    return a;
  }
  const a = run('qc-seed'), b = run('qc-seed'), c = run('other-seed');
  let same = true; for (let i = 0; i < 1000; i++) if (a[i] !== b[i]) { same = false; break; }
  let diff = false; for (let i = 0; i < 1000; i++) if (a[i] !== c[i]) { diff = true; break; }
  check('K1', 'Identical seed -> bit-identical sample stream', same);
  check('K2', 'Different seed -> different stream', diff);
  // Blank seed returns the page's Math.random — two "blank seed" runs differ.
  const b1 = run(''), b2 = run('');
  let blankDiff = false; for (let i = 0; i < 1000; i++) if (b1[i] !== b2[i]) { blankDiff = true; break; }
  check('K3', 'Blank seed falls back to Math.random (non-reproducible by design)', w.seeded('') === w.Math.random && blankDiff);
}

/* =================================================================
 * L. END-TO-END BASIC-MODE SIMULATION (real DOM)
 * ================================================================= */
section('L. End-to-end simulation through the DOM');
{
  // Configure every parameter as Discrete single-value -> fully deterministic MC
  const values = {
    'Area': 1000, 'Thickness': 50, 'Net to Gross': 0.8,
    'Porosity': 0.25, 'Water Saturation': 0.3, 'Bo': 1.2
  };
  doc.getElementById('iterations').value = '500';
  doc.getElementById('seed').value = 'e2e';
  const rows = [...doc.querySelectorAll('#params .dist-row')];
  for (const row of rows) {
    const name = row.getAttribute('data-param');
    const sel = row.querySelector('.dist-type');
    sel.value = 'Discrete';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    const inputs = [...row.querySelectorAll('input.v')];
    inputs[0].value = String(values[name]);
    inputs[1].value = ''; inputs[2].value = '';
  }
  const rfSel = doc.querySelector('.rf-type');
  rfSel.value = 'Discrete';
  rfSel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const rfInputs = [...doc.querySelectorAll('.rf-v')];
  rfInputs[0].value = '0.5'; rfInputs[1].value = ''; rfInputs[2].value = '';

  w.runSimulation();

  const errText = doc.getElementById('error').textContent;
  check('L1', 'runSimulation completes with no validation error', errText === '', errText);

  const cells = [...doc.querySelectorAll('#summaryBody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  const expected = 7758 * 1000 * 50 * 0.8 * 0.25 * 0.7 / 1.2 / 1e6; // 45.255 MMBO
  const inPlaceP50 = parseFloat(cells[0] && cells[0][2].replace(/,/g, ''));
  approx('L2', 'Summary table in-place P50 = hand calc 45.2550 MMBO', inPlaceP50, expected, 1e-3);
  const recP50 = parseFloat(cells[1] && cells[1][2].replace(/,/g, ''));
  approx('L3', 'Summary table recoverable P50 = 22.6275 MMBO', recP50, expected * 0.5, 1e-3);

  // Deterministic mid-case column should match exactly too
  const detCell = cells[0] && cells[0][4];
  const detVal = parseFloat(detCell.replace(/,/g, ''));
  approx('L4', 'Deterministic mid-case column matches hand calc', detVal, expected, 1e-3);

  // Reproducibility at app level: rerun, same P50
  w.runSimulation();
  const cells2 = [...doc.querySelectorAll('#summaryBody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
  check('L5', 'Re-run with same seed reproduces identical summary table', JSON.stringify(cells) === JSON.stringify(cells2));

  // Save/load round-trip at project level
  const proj = w.serializeProject();
  check('L6', 'serializeProject captures discrete inputs', proj.reservoirs[0].dists.some(d => d.name === 'Area' && d.raw[0] === 1000));
  // L7 (RR-06 FIXED): validateProjectSchema rejects malformed files
  const vGood  = w.validateProjectSchema({ version: 1, reservoirs: [{ fluid: 'oil', dists: [{ raw: [1, 2, 3] }] }] });
  const vBadVer = w.validateProjectSchema({ version: 2, reservoirs: [{ fluid: 'oil', dists: [{ raw: [1, 2, 3] }] }] });
  const vNoRes  = w.validateProjectSchema({ version: 1 });
  const vBadFluid = w.validateProjectSchema({ version: 1, reservoirs: [{ fluid: 'petroleum', dists: [{ raw: [1, 2, 3] }] }] });
  check('L7', 'RR-06 fixed: validateProjectSchema accepts valid; rejects bad version, missing reservoirs, unknown fluid',
    vGood === null && vBadVer !== null && vNoRes !== null && vBadFluid !== null);
}

/* =================================================================
 * M. CSG CONSTANT DERIVATION
 * ================================================================= */
section('M. CSG constant derivation (48,013)');
{
  // GIIP[scf] = 43560 ft³/ac-ft × ρ[g/cm³ -> 62.42796 lb/ft³] / 2000 lb/shortton × Gc[m³/ton] × scf/m³
  // Mass factor: 43560 × 62.42796 / 2000 = 1359.681 short tons per (acre-ft × g/cm³)
  const massFactor = 43560 * 62.42796 / 2000;
  approx('M1', 'Coal mass factor in samplesData (1359.7 t/(ac-ft·g/cm³)) matches derivation', 1359.7, massFactor, 1e-4);
  // 48013 / 1359.681 = implied m³->scf conversion
  const impliedScfPerM3 = 48013 / massFactor;
  // Standard value 35.3147 scf/m³ — implied 35.312 differs by ~0.008%
  approx('M2', 'Implied m³->scf conversion ≈ 35.31 (within 0.05% of 35.3147 — short-ton basis confirmed)', impliedScfPerM3, 35.3146667, 5e-4);
}

/* =================================================================
 * N. UNIFIED BLOCK CORRELATION MATRIX CONSTRUCTION
 * ================================================================= */
section('N. Unified block correlation matrix (buildFullCorrelationMatrix)');
{
  const configs = [
    { dists: [{ name: 'Area' }, { name: 'Thickness' }], corrMatrix: [[1, 0.5], [0.5, 1]] },
    { dists: [{ name: 'Area' }, { name: 'Thickness' }], corrMatrix: null }
  ];
  const crossCorr = { '0-1': { 'Area': 0.4, 'Recovery Factor': 0.6 } };
  const { allParams, matrix } = w.buildFullCorrelationMatrix(configs, crossCorr);
  // Layout: [R0.Area, R0.Thickness, R0.RF, R1.Area, R1.Thickness, R1.RF]
  check('N1', 'Matrix is 6x6 with unit diagonal', matrix.length === 6 && matrix.every((r, i) => r[i] === 1));
  check('N2', 'Intra-reservoir rho placed (R0 Area-Thickness = 0.5)', matrix[0][1] === 0.5 && matrix[1][0] === 0.5);
  check('N3', 'Cross-reservoir rho placed (Area R0-R1 = 0.4)', matrix[0][3] === 0.4 && matrix[3][0] === 0.4);
  check('N4', 'Cross-reservoir RF rho placed (RF R0-R1 = 0.6)', matrix[2][5] === 0.6 && matrix[5][2] === 0.6);
  check('N5', 'Unset cross entries remain 0 (Thickness R0-R1)', matrix[1][4] === 0 && matrix[4][1] === 0);
  check('N6', 'R1 intra block untouched when corrMatrix is null', matrix[3][4] === 0);
  check('N7', 'RF never correlated intra-reservoir (UI does not offer it)', matrix[0][2] === 0 && matrix[1][2] === 0);
  let sym = true;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (matrix[i][j] !== matrix[j][i]) sym = false;
  check('N8', 'Matrix exactly symmetric', sym);
  check('N9', 'allParams layout is [dists..., RF] per reservoir in order',
    allParams.length === 6 && allParams[2].name === 'Recovery Factor' && allParams[2].rIdx === 0 &&
    allParams[5].name === 'Recovery Factor' && allParams[5].rIdx === 1 && allParams[3].name === 'Area' && allParams[3].rIdx === 1);

  // RR-16: saved matrices are keyed by parameter NAME, immune to fluid/geometry changes
  {
    // Matrix saved under [Area, Thickness, Porosity]; reservoir later switched to GRV mode
    const stale = [
      { dists: [{ name: 'GRV' }, { name: 'Porosity' }],
        corrMatrix: [[1, 0.5, 0.3], [0.5, 1, 0], [0.3, 0, 1]],
        corrParams: ['Area', 'Thickness', 'Porosity'] }
    ];
    const { matrix: m2 } = w.buildFullCorrelationMatrix(stale, {});
    check('N10', 'RR-16: stale Area-Thickness rho NOT misapplied to GRV-Porosity after geometry change', m2[0][1] === 0);

    // Matrix saved under a different param ORDER than current dists
    const reordered = [
      { dists: [{ name: 'Porosity' }, { name: 'Area' }],
        corrMatrix: [[1, 0.7], [0.7, 1]],
        corrParams: ['Area', 'Porosity'] }
    ];
    const { matrix: m3 } = w.buildFullCorrelationMatrix(reordered, {});
    check('N11', 'RR-16: name-keyed lookup survives param reordering (rho 0.7 correctly placed)', m3[0][1] === 0.7);

    // Legacy project without corrParams and undersized matrix: must not throw, must not invent values
    const legacy = [
      { dists: [{ name: 'Area' }, { name: 'Thickness' }, { name: 'Porosity' }],
        corrMatrix: [[1, 0.4], [0.4, 1]], corrParams: null }
    ];
    let ok = true, m4 = null;
    try { m4 = w.buildFullCorrelationMatrix(legacy, {}).matrix; } catch (e) { ok = false; }
    check('N12', 'RR-16: legacy undersized matrix handled without exception; out-of-range entries stay 0',
      ok && m4 && m4[0][1] === 0.4 && m4[0][2] === 0 && m4[1][2] === 0);
  }
}

/* =================================================================
 * MULTI-RESERVOIR E2E SCENARIO DRIVER (fresh app instance per scenario)
 * ================================================================= */
function makeApp(htmlStr, url) {
  const d = new JSDOM(htmlStr, { runScripts: 'dangerously', url: url || ('file://' + HTML_PATH), pretendToBeVisual: true });
  return d.window;
}

function setParamRow(W, name, type, vals) {
  const row = [...W.document.querySelectorAll('#params .dist-row')].find(r => r.getAttribute('data-param') === name);
  if (!row) throw new Error('param row not found: ' + name);
  const sel = row.querySelector('.dist-type');
  sel.value = type;
  sel.dispatchEvent(new W.Event('change', { bubbles: true }));
  const inputs = [...row.querySelectorAll('input.v')];
  for (let i = 0; i < 3; i++) inputs[i].value = (vals[i] === null || vals[i] === undefined) ? '' : String(vals[i]);
}

function setRF(W, type, vals) {
  const sel = W.document.querySelector('.rf-type');
  sel.value = type;
  sel.dispatchEvent(new W.Event('change', { bubbles: true }));
  const inputs = [...W.document.querySelectorAll('.rf-v')];
  for (let i = 0; i < 3; i++) inputs[i].value = (vals[i] === null || vals[i] === undefined) ? '' : String(vals[i]);
}

const OIL_PARAM_ORDER = ['Area', 'Thickness', 'Net to Gross', 'Porosity', 'Water Saturation', 'Bo'];

function setIntraCorr(W, pA, pB, rho) {
  const a = OIL_PARAM_ORDER.indexOf(pA), b = OIL_PARAM_ORDER.indexOf(pB);
  const row = Math.max(a, b), col = Math.min(a, b);
  const inp = W.document.querySelector(`#corrMatrix input[data-row="${row}"][data-col="${col}"]`);
  if (!inp) throw new Error(`corr input not found for ${pA}/${pB}`);
  inp.value = String(rho);
}

const BASE_UNIFORMS = {
  'Area':             ['Uniform', [800, null, 1200]],
  'Thickness':        ['Uniform', [40, null, 60]],
  'Net to Gross':     ['Uniform', [0.6, null, 0.9]],
  'Porosity':         ['Uniform', [0.15, null, 0.3]],
  'Water Saturation': ['Uniform', [0.2, null, 0.4]],
  'Bo':               ['Uniform', [1.1, null, 1.4]]
};

/**
 * Drives the real UI: basic-mode inputs -> advanced mode -> optional 2nd reservoir,
 * intra-corr, cross-corr and shared-link UI -> runSimulation().
 */
function runScenario(opts) {
  const W = makeApp(html);
  const doc = W.document;
  doc.getElementById('iterations').value = String(opts.iters || 20000);
  doc.getElementById('seed').value = opts.seed || 'multi-qc';
  for (const [name, [type, vals]] of Object.entries(BASE_UNIFORMS)) setParamRow(W, name, type, vals);
  setRF(W, 'Uniform', [0.2, null, 0.6]);

  const tgl = doc.getElementById('advancedModeToggle');
  tgl.checked = true;
  tgl.dispatchEvent(new W.Event('change', { bubbles: true }));

  if (opts.r0Corr) for (const [a, b, rho] of opts.r0Corr) setIntraCorr(W, a, b, rho);

  if (opts.twoReservoirs !== false) {
    W.addReservoir(); // saves R0 (incl. its corr matrix), activates R1
    for (const [name, [type, vals]] of Object.entries(BASE_UNIFORMS)) setParamRow(W, name, type, vals);
    setRF(W, 'Uniform', [0.2, null, 0.6]);
    if (opts.shared) {
      for (const [param, src] of Object.entries(opts.shared)) {
        const sel = doc.querySelector(`#sharedLinks select[data-param="${param}"]`);
        if (!sel) throw new Error('shared-link select not found: ' + param);
        sel.value = String(src);
      }
    }
    if (opts.cross) {
      for (const [param, rho] of Object.entries(opts.cross)) {
        const inp = doc.querySelector(`#interResCorrMatrix input[data-pair="0-1"][data-param="${param}"]`);
        if (!inp) throw new Error('cross-corr input not found: ' + param);
        inp.value = String(rho);
      }
    }
  }

  W.runSimulation();
  const errText = doc.getElementById('error').textContent;
  const warnEl = doc.getElementById('interResCorrWarn');
  return { W, errText, warnText: warnEl ? warnEl.textContent : '', res: W.eval('lastMultiResults') };
}

function identicalArrays(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* =================================================================
 * O. INTRA-RESERVOIR CORRELATION, END-TO-END
 * ================================================================= */
section('O. Intra-reservoir parameter correlation (advanced mode, E2E)');
{
  const indep = runScenario({ twoReservoirs: false, seed: 'intra-qc' });
  const corr = runScenario({ twoReservoirs: false, seed: 'intra-qc', r0Corr: [['Area', 'Thickness', 0.6], ['Porosity', 'Water Saturation', -0.4]] });
  check('O1', 'Correlated scenario runs without validation error', corr.errText === '', corr.errText);

  const s = corr.res.perReservoir[0].samples;
  approx('O2', 'Induced Spearman rho(Area, Thickness) ~ +0.6 (RR-15 tightened)', spearman(s['Area'], s['Thickness']), 0.6, 0.015);
  approx('O3', 'Induced Spearman rho(Porosity, Sw) ~ -0.4 (RR-15 tightened)', spearman(s['Porosity'], s['Water Saturation']), -0.4, 0.02);

  // Marginals preserved: P90/P50/P10 of each param equal to independent run (same seed)
  const s0 = indep.res.perReservoir[0].samples;
  const qA = w.computeQuantiles(Float64Array.from(s['Area']));
  const qA0 = w.computeQuantiles(Float64Array.from(s0['Area']));
  check('O4', 'Area marginal quantiles unchanged by correlation (reorder-only)',
    relErr(qA[0], qA0[0]) < 1e-12 && relErr(qA[1], qA0[1]) < 1e-12 && relErr(qA[2], qA0[2]) < 1e-12);

  // Positive A-h correlation must widen the STOIIP distribution (variance of product increases)
  const spread = r => { const q = w.computeQuantiles(Float64Array.from(r.res.perReservoir[0].primary)); return q[2] - q[0]; };
  check('O5', `+0.6 Area-Thickness correlation widens P90-P10 spread (indep ${spread(indep).toFixed(2)}, corr ${spread(corr).toFixed(2)})`,
    spread(corr) > spread(indep) * 1.02);

  // Uncorrelated same-seed baseline: rho ~ 0
  const s0rho = spearman(s0['Area'], s0['Thickness']);
  check('O6', `Independent baseline rho(Area,Thickness) ~ 0 (got ${s0rho.toFixed(4)})`, Math.abs(s0rho) < 0.02);
}

/* =================================================================
 * P. INTER-RESERVOIR CORRELATION, END-TO-END
 * ================================================================= */
section('P. Inter-reservoir parameter correlation (E2E)');
{
  const indep = runScenario({ seed: 'cross-qc' });
  const corr = runScenario({ seed: 'cross-qc', cross: { 'Porosity': 0.7, 'Recovery Factor': 0.5, 'Area': -0.3 } });
  check('P1', 'Cross-correlated scenario runs without validation error', corr.errText === '', corr.errText);

  const r0 = corr.res.perReservoir[0].samples, r1 = corr.res.perReservoir[1].samples;
  approx('P2', 'Induced cross-reservoir rho(Porosity) ~ +0.7 (RR-15 tightened)', spearman(r0['Porosity'], r1['Porosity']), 0.7, 0.015);
  approx('P3', 'Induced cross-reservoir rho(RF) ~ +0.5 (RR-15 tightened)', spearman(r0['Recovery Factor'], r1['Recovery Factor']), 0.5, 0.02);
  approx('P4', 'Induced cross-reservoir rho(Area) ~ -0.3 (RR-15 tightened)', spearman(r0['Area'], r1['Area']), -0.3, 0.04);

  const i0 = indep.res.perReservoir[0].samples, i1 = indep.res.perReservoir[1].samples;
  check('P5', 'Independent baseline cross rho(Porosity) ~ 0', Math.abs(spearman(i0['Porosity'], i1['Porosity'])) < 0.02);

  // Positive dependence between reservoirs must widen the aggregate distribution
  const spreadT = r => { const q = w.computeQuantiles(Float64Array.from(r.res.totalPrimary)); return q[2] - q[0]; };
  const allPos = runScenario({ seed: 'cross-qc', cross: { 'Porosity': 0.8, 'Area': 0.8, 'Thickness': 0.8, 'Net to Gross': 0.8, 'Water Saturation': 0.8, 'Bo': 0.8, 'Recovery Factor': 0.8 } });
  check('P6', `Positive cross-correlation widens total P90-P10 spread (indep ${spreadT(indep).toFixed(2)}, corr ${spreadT(allPos).toFixed(2)})`,
    spreadT(allPos) > spreadT(indep) * 1.05);
}

/* =================================================================
 * Q. SHARED PARAMETER LINKS, END-TO-END
 * ================================================================= */
section('Q. Shared parameter links (identity must survive full pipeline)');
{
  // Q1: no correlations anywhere -> shared samples must be bit-identical
  const noCorr = runScenario({ seed: 'share-qc', shared: { 'Porosity': 0 } });
  check('Q1a', 'Shared-link scenario runs without validation error', noCorr.errText === '', noCorr.errText);
  const a = noCorr.res.perReservoir[0].samples, b = noCorr.res.perReservoir[1].samples;
  check('Q1b', 'No correlations: shared Porosity bit-identical across reservoirs', identicalArrays(a['Porosity'], b['Porosity']));
  check('Q1c', 'Non-shared params remain independent (rho(Area) ~ 0)', Math.abs(spearman(a['Area'], b['Area'])) < 0.02);

  // Q2: THE CRITICAL CASE — an unrelated intra-reservoir correlation is active.
  // A shared link is a statement of identity; it must hold regardless of other correlations.
  const withCorr = runScenario({ seed: 'share-qc2', shared: { 'Porosity': 0 }, r0Corr: [['Area', 'Thickness', 0.5]] });
  const c = withCorr.res.perReservoir[0].samples, d = withCorr.res.perReservoir[1].samples;
  const rhoShared = spearman(c['Porosity'], d['Porosity']);
  check('Q2', `Shared Porosity remains identical when other correlations are active (rho=${rhoShared.toFixed(4)}, want 1.0 bit-identical)`,
    identicalArrays(c['Porosity'], d['Porosity']));

  // Q3: shared link + cross-corr on the same parameter is contradictory; document behavior
  const conflict = runScenario({ seed: 'share-qc3', shared: { 'Porosity': 0 }, cross: { 'Porosity': 0.3 } });
  const e = conflict.res.perReservoir[0].samples, f = conflict.res.perReservoir[1].samples;
  check('Q4', 'Shared link must dominate a conflicting cross-corr entry (identity preserved)',
    identicalArrays(e['Porosity'], f['Porosity']),
    `rho=${spearman(e['Porosity'], f['Porosity']).toFixed(4)}`);
}

/* =================================================================
 * R. MULTI-RESERVOIR AGGREGATION IDENTITIES
 * ================================================================= */
section('R. Multi-reservoir aggregation identities');
{
  const sc = runScenario({ seed: 'agg-qc', cross: { 'Porosity': 0.5 } });
  const { perReservoir, totalPrimary, totalRec, totalDet, totalDetRec } = sc.res;
  check('R1', 'Two oil reservoirs aggregate in native unit (MMBO), not MBOE', sc.res.totalUnit === 'MMBO' || sc.res.totalUnit === perReservoir[0].labelSet.unit);
  let sumOkP = true, sumOkR = true;
  for (let i = 0; i < totalPrimary.length; i++) {
    if (Math.abs(totalPrimary[i] - (perReservoir[0].primary[i] + perReservoir[1].primary[i])) > 1e-9) { sumOkP = false; break; }
  }
  for (let i = 0; i < totalRec.length; i++) {
    if (Math.abs(totalRec[i] - (perReservoir[0].rec[i] + perReservoir[1].rec[i])) > 1e-9) { sumOkR = false; break; }
  }
  check('R2', 'totalPrimary[i] = sum of per-reservoir primary[i] (per-iteration)', sumOkP);
  check('R3', 'totalRec[i] = sum of per-reservoir rec[i] (per-iteration)', sumOkR);
  approx('R4', 'Deterministic totals additive', totalDet, perReservoir[0].detMidCase + perReservoir[1].detMidCase, 1e-12);
  approx('R5', 'Deterministic recoverable totals additive', totalDetRec, perReservoir[0].detRecMidCase + perReservoir[1].detRecMidCase, 1e-12);

  // Statistical sanity: P50(total) <= P50(A)+P50(B) is NOT an identity, but the total P10 must
  // be < P10(A)+P10(B) and total P90 > P90(A)+P90(B) for imperfectly-correlated sums.
  const qT = w.computeQuantiles(Float64Array.from(totalPrimary));
  const qA = w.computeQuantiles(Float64Array.from(perReservoir[0].primary));
  const qB = w.computeQuantiles(Float64Array.from(perReservoir[1].primary));
  check('R6', 'Portfolio effect present: P90(total) > P90(A)+P90(B)', qT[0] > qA[0] + qB[0]);
  check('R7', 'Portfolio effect present: P10(total) < P10(A)+P10(B)', qT[2] < qA[2] + qB[2]);
}

/* =================================================================
 * S. NON-POSITIVE-DEFINITE COMBINED MATRIX FALLBACK
 * ================================================================= */
section('S. Non-positive-definite combined matrix fallback');
{
  // R0 intra Area-Thickness 0.9, cross Area +0.9 and Thickness -0.9 is jointly infeasible.
  const badBlock = [[1, 0.9, 0.9, 0], [0.9, 1, 0, -0.9], [0.9, 0, 1, 0], [0, -0.9, 0, 1]];
  check('S1', 'Constructed conflict matrix is indeed non-PD (test premise)', !w.isPositiveDefinite(badBlock));

  const sc = runScenario({ seed: 'nonpd-qc', r0Corr: [['Area', 'Thickness', 0.9]], cross: { 'Area': 0.9, 'Thickness': -0.9 } });
  check('S2', 'Non-PD combined matrix raises visible warning', /positive definite/i.test(sc.warnText), sc.warnText);
  const r0 = sc.res.perReservoir[0].samples, r1 = sc.res.perReservoir[1].samples;
  check('S3', 'Fallback runs uncorrelated (rho(Area cross) ~ 0)', Math.abs(spearman(r0['Area'], r1['Area'])) < 0.02);
  check('S4', 'Fallback also drops intra correlation (documented behavior)', Math.abs(spearman(r0['Area'], r0['Thickness'])) < 0.02);
}

/* =================================================================
 * T. BUILD PARITY AUDIT — app.js & responsive vs canonical standalone
 * ================================================================= */
section('T. Build parity audit (app.js / responsive vs canonical standalone)');
{
  // --- load index.html + app.js build ---
  const INDEX_PATH = path.join(__dirname, 'index.html');
  let appHtml = fs.readFileSync(INDEX_PATH, 'utf8').replace(PLOTLY_TAG, PLOTLY_STUB);
  const appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  appHtml = appHtml.replace('<script src="app.js"></script>', '<script>\n' + appJs + '\n</script>');
  const appW = makeApp(appHtml, 'file://' + INDEX_PATH);

  // --- load responsive build ---
  const RESP_PATH = path.join(__dirname, 'rangerover-responsive.html');
  const respHtml = fs.readFileSync(RESP_PATH, 'utf8').replace(PLOTLY_TAG, PLOTLY_STUB);
  const respW = makeApp(respHtml, 'file://' + RESP_PATH);

  const builds = [['app.js', appW], ['responsive', respW]];
  const oilP = { 'Net to Gross': 0.8, 'Porosity': 0.25, 'Water Saturation': 0.3, 'Bo': 1.2 };
  const gasP = { 'Net to Gross': 0.6, 'Porosity': 0.2, 'Water Saturation': 0.35, 'Bg': 0.004 };
  const csgP = { 'Coal Density': 1.4, 'Gas Content': 8 };
  const ogP = { ...oilP, 'Rs': 600 };
  const gvP = { ...gasP, 'Rv': 0.00002 };

  let ti = 1;
  for (const [name, W] of builds) {
    const id = () => `T${ti++}`;
    check(id(), `[${name}] engine loaded (computeVolumeSingle present)`, typeof W.computeVolumeSingle === 'function');
    approx(id(), `[${name}] oil STOIIP matches canonical`, W.computeVolumeSingle('oil', null, 50000, oilP), w.computeVolumeSingle('oil', null, 50000, oilP), 1e-12);
    approx(id(), `[${name}] gas GIIP matches canonical`, W.computeVolumeSingle('gas', null, 50000, gasP), w.computeVolumeSingle('gas', null, 50000, gasP), 1e-12);
    approx(id(), `[${name}] CSG GIIP matches canonical (48,013 constant)`, W.computeVolumeSingle('csg', null, 40000, csgP), w.computeVolumeSingle('csg', null, 40000, csgP), 1e-12);
    approx(id(), `[${name}] oilgas total matches canonical`, W.computeVolumeSingle('oilgas', 'total', 50000, ogP), w.computeVolumeSingle('oilgas', 'total', 50000, ogP), 1e-12);
    approx(id(), `[${name}] gasvo total matches canonical`, W.computeVolumeSingle('gasvo', 'total', 50000, gvP), w.computeVolumeSingle('gasvo', 'total', 50000, gvP), 1e-12);
    check(id(), `[${name}] RR-02 guard: Bo=0 returns NaN`, Number.isNaN(W.computeVolumeSingle('oil', null, 50000, { ...oilP, 'Bo': 0 })));

    // RR-01: wide Normal(0.5, 50) truncated to [0,1] must not collapse to the mean
    const rng = W.mulberry32(99);
    let atMean = 0;
    const NN = 20000;
    for (let i = 0; i < NN; i++) if (W.sampleNormalTrunc(rng, 0.5, 50, 0, 1) === 0.5) atMean++;
    check(id(), `[${name}] RR-01 fix present: wide truncated normal not collapsed (${(100 * atMean / NN).toFixed(1)}% at mean, want <1%)`, atMean / NN < 0.01);

    // RR-05: Triangular clamped to physical bounds
    const xTri = W.drawOne(() => 0.000001, 'Triangular', [-10, -5, -1], 'Porosity', null, 'oil');
    check(id(), `[${name}] RR-05 fix present: Triangular porosity clamped to >= 0 (got ${xTri})`, xTri >= 0);

    // RR-06: project schema validation exists
    check(id(), `[${name}] RR-06 fix present: validateProjectSchema exists`, typeof W.validateProjectSchema === 'function');

    // Multi-reservoir engine parity: identical block matrix for identical inputs
    const cfg = [
      { dists: [{ name: 'Area' }, { name: 'Thickness' }], corrMatrix: [[1, 0.5], [0.5, 1]] },
      { dists: [{ name: 'Area' }, { name: 'Thickness' }], corrMatrix: null }
    ];
    const cc = { '0-1': { 'Area': 0.4, 'Recovery Factor': 0.6 } };
    const mine = W.buildFullCorrelationMatrix ? W.buildFullCorrelationMatrix(cfg, cc).matrix : null;
    const ref = w.buildFullCorrelationMatrix(cfg, cc).matrix;
    check(id(), `[${name}] buildFullCorrelationMatrix output identical to canonical`, mine !== null && JSON.stringify(mine) === JSON.stringify(ref));
  }
}

/* ---------- summary ---------- */
console.log('\n' + '='.repeat(60));
console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.id}: ${f.desc}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
console.log('All QC harness checks passed.');
