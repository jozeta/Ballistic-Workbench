/**
 * Ballistic Workbench - Standard drag functions and their interpolation
 *
 * G1 (flat base, 2-calibre ogive) and G7 (boat tail, 10-calibre tangent ogive) reference drag
 * functions, Cd against Mach number. The numbers are the standard BRL / McCoy tables as published by
 * JBM Ballistics (jbmballistics.com, mcg1.txt with 79 points and mcg7.txt with 84 points). They are
 * identical, point for point, to the G1/G7 tables in py-ballisticcalc (drag_tables.py).
 *
 * A ballistic coefficient is only meaningful together with the drag function it was measured against,
 * so a bullet's G1 BC must be used with the G1 table and its G7 BC with the G7 table.
 *
 * Between table points the curve is a monotone cubic (Fritsch-Carlson / PCHIP): it passes through
 * every table point and never overshoots between them. Below Mach 0 and above Mach 5 the end value
 * is held.
 */

export class CubicSpline {
  /**
   * Precomputes cubic spline coefficients (Monotone Cubic / PCHIP or Natural Spline)
   * Prevents overshoots and non-physical oscillations in drag curves.
   * @param {number[]} x Monotonically increasing independent variables (Mach)
   * @param {number[]} y Dependent variables (Cd)
   */
  constructor(x, y) {
    if (x.length !== y.length || x.length < 2) {
      throw new Error('Spline requires arrays of equal length >= 2');
    }
    this.x = [...x];
    this.y = [...y];
    this.n = x.length;
    this.h = new Array(this.n - 1);
    this.m = new Array(this.n);

    // Compute intervals and finite differences
    const delta = new Array(this.n - 1);
    for (let i = 0; i < this.n - 1; i++) {
      this.h[i] = this.x[i + 1] - this.x[i];
      delta[i] = (this.y[i + 1] - this.y[i]) / this.h[i];
    }

    // Fritsch-Carlson Monotone Cubic Spline tangents
    this.m[0] = delta[0];
    this.m[this.n - 1] = delta[this.n - 2];

    for (let i = 1; i < this.n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) {
        this.m[i] = 0;
      } else {
        // Weighted harmonic mean of neighboring slopes
        const w1 = 2 * this.h[i] + this.h[i - 1];
        const w2 = this.h[i] + 2 * this.h[i - 1];
        this.m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
      }
    }

    // Compute cubic polynomial coefficients: S_i(t) = a_i + b_i*t + c_i*t^2 + d_i*t^3 where t = (x - x_i)
    this.c1 = new Array(this.n - 1);
    this.c2 = new Array(this.n - 1);
    this.c3 = new Array(this.n - 1);

    for (let i = 0; i < this.n - 1; i++) {
      const h = this.h[i];
      const d = delta[i];
      const m0 = this.m[i];
      const m1 = this.m[i + 1];

      this.c1[i] = m0;
      this.c2[i] = (3 * d - 2 * m0 - m1) / h;
      this.c3[i] = (m0 + m1 - 2 * d) / (h * h);
    }
  }

  /**
   * Evaluate spline value at Mach x
   */
  interpolate(mach) {
    if (mach <= this.x[0]) {
      return this.y[0];
    }
    if (mach >= this.x[this.n - 1]) {
      // Hold the last table value: the standard tables end at Mach 5
      return this.y[this.n - 1];
    }

    // Binary search for interval
    let low = 0;
    let high = this.n - 2;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (mach < this.x[mid]) {
        high = mid - 1;
      } else if (mach > this.x[mid + 1]) {
        low = mid + 1;
      } else {
        const dx = mach - this.x[mid];
        return this.y[mid] + dx * (this.c1[mid] + dx * (this.c2[mid] + dx * this.c3[mid]));
      }
    }
    return this.y[this.n - 1];
  }

  /**
   * Evaluate first derivative dCd/dMach at Mach x
   */
  derivative(mach) {
    if (mach <= this.x[0] || mach >= this.x[this.n - 1]) return 0;

    let low = 0;
    let high = this.n - 2;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (mach < this.x[mid]) {
        high = mid - 1;
      } else if (mach > this.x[mid + 1]) {
        low = mid + 1;
      } else {
        const dx = mach - this.x[mid];
        return this.c1[mid] + dx * (2 * this.c2[mid] + 3 * dx * this.c3[mid]);
      }
    }
    return 0;
  }
}

/** Standard G1 drag function (JBM mcg1.txt, 79 points). */
export const G1_TABLE = Object.freeze({
  mach: [
      0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45,
      0.50, 0.55, 0.60, 0.70, 0.725, 0.75, 0.775, 0.80, 0.825, 0.85,
      0.875, 0.90, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.10,
      1.125, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 1.55,
      1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.95, 2.00, 2.05,
      2.10, 2.15, 2.20, 2.25, 2.30, 2.35, 2.40, 2.45, 2.50, 2.60,
      2.70, 2.80, 2.90, 3.00, 3.10, 3.20, 3.30, 3.40, 3.50, 3.60,
      3.70, 3.80, 3.90, 4.00, 4.20, 4.40, 4.60, 4.80, 5.00,
  ],
  cd: [
      0.2629, 0.2558, 0.2487, 0.2413, 0.2344, 0.2278, 0.2214, 0.2155, 0.2104, 0.2061,
      0.2032, 0.2020, 0.2034, 0.2165, 0.2230, 0.2313, 0.2417, 0.2546, 0.2706, 0.2901,
      0.3136, 0.3415, 0.3734, 0.4084, 0.4448, 0.4805, 0.5136, 0.5427, 0.5677, 0.5883,
      0.6053, 0.6191, 0.6393, 0.6518, 0.6589, 0.6621, 0.6625, 0.6607, 0.6573, 0.6528,
      0.6474, 0.6413, 0.6347, 0.6280, 0.6210, 0.6141, 0.6072, 0.6003, 0.5934, 0.5867,
      0.5804, 0.5743, 0.5685, 0.5630, 0.5577, 0.5527, 0.5481, 0.5438, 0.5397, 0.5325,
      0.5264, 0.5211, 0.5168, 0.5133, 0.5105, 0.5084, 0.5067, 0.5054, 0.5040, 0.5030,
      0.5022, 0.5016, 0.5010, 0.5006, 0.4998, 0.4995, 0.4992, 0.4990, 0.4988,
  ],
});

/** Standard G7 drag function (JBM mcg7.txt, 84 points). */
export const G7_TABLE = Object.freeze({
  mach: [
      0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45,
      0.50, 0.55, 0.60, 0.65, 0.70, 0.725, 0.75, 0.775, 0.80, 0.825,
      0.85, 0.875, 0.90, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075,
      1.10, 1.125, 1.15, 1.20, 1.25, 1.30, 1.35, 1.40, 1.50, 1.55,
      1.60, 1.65, 1.70, 1.75, 1.80, 1.85, 1.90, 1.95, 2.00, 2.05,
      2.10, 2.15, 2.20, 2.25, 2.30, 2.35, 2.40, 2.45, 2.50, 2.55,
      2.60, 2.65, 2.70, 2.75, 2.80, 2.85, 2.90, 2.95, 3.00, 3.10,
      3.20, 3.30, 3.40, 3.50, 3.60, 3.70, 3.80, 3.90, 4.00, 4.20,
      4.40, 4.60, 4.80, 5.00,
  ],
  cd: [
      0.1198, 0.1197, 0.1196, 0.1194, 0.1193, 0.1194, 0.1194, 0.1194, 0.1193, 0.1193,
      0.1194, 0.1193, 0.1194, 0.1197, 0.1202, 0.1207, 0.1215, 0.1226, 0.1242, 0.1266,
      0.1306, 0.1368, 0.1464, 0.1660, 0.2054, 0.2993, 0.3803, 0.4015, 0.4043, 0.4034,
      0.4014, 0.3987, 0.3955, 0.3884, 0.3810, 0.3732, 0.3657, 0.3580, 0.3440, 0.3376,
      0.3315, 0.3260, 0.3209, 0.3160, 0.3117, 0.3078, 0.3042, 0.3010, 0.2980, 0.2951,
      0.2922, 0.2892, 0.2864, 0.2835, 0.2807, 0.2779, 0.2752, 0.2725, 0.2697, 0.2670,
      0.2643, 0.2615, 0.2588, 0.2561, 0.2533, 0.2506, 0.2479, 0.2451, 0.2424, 0.2368,
      0.2313, 0.2258, 0.2205, 0.2154, 0.2106, 0.2060, 0.2017, 0.1975, 0.1935, 0.1861,
      0.1793, 0.1730, 0.1672, 0.1618,
  ],
});

// Pre-built splines for fast evaluation during the RK4 steps
export const G1_SPLINE = new CubicSpline(G1_TABLE.mach, G1_TABLE.cd);
export const G7_SPLINE = new CubicSpline(G7_TABLE.mach, G7_TABLE.cd);

/**
 * Which standard table a bullet's drag model uses. Only G1 and G7 exist; anything else (including
 * the old 'DOPPLER' value saved by earlier versions, which pointed at an invented curve) uses G7.
 * @param {string} model
 * @returns {'G1'|'G7'}
 */
export function normalizeDragModel(model) {
  return String(model || '').toUpperCase() === 'G1' ? 'G1' : 'G7';
}

/**
 * Drag coefficient of the standard drag function at a Mach number
 * @param {string} model 'G1' | 'G7' (anything else is treated as G7)
 * @param {number} mach Mach number
 * @returns {number} Drag coefficient Cd
 */
export function getCd(model, mach) {
  const m = Number.isFinite(mach) ? Math.max(0, mach) : 0;
  return normalizeDragModel(model) === 'G1' ? G1_SPLINE.interpolate(m) : G7_SPLINE.interpolate(m);
}
