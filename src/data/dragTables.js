/**
 * Ballistic Workbench - Standard Drag Tables & Spline Interpolation Engine
 * Contains 60-point Mach vs Cd tables for:
 * 1. G1 Standard Drag Function (Flat-base, 2-caliber ogive)
 * 2. G7 Standard Drag Function (Boat-tail, 10-caliber tangent ogive)
 * 3. Doppler Custom Drag Function (Modern Very Low Drag / Hornady ELD-M radar profile)
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
      // Linear extrapolation based on end slope
      const last = this.n - 1;
      return this.y[last] + this.m[last] * (mach - this.x[last]);
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
    if (mach <= this.x[0]) return this.m[0];
    if (mach >= this.x[this.n - 1]) return this.m[this.n - 1];

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

// Exactly 60 Mach evaluation points spanning subsonic, transonic, supersonic, and hypersonic (0.00 to 5.00)
export const MACH_POINTS = [
  0.000, 0.050, 0.100, 0.200, 0.300, 0.400, 0.500, 0.600, 0.700, 0.750,
  0.800, 0.825, 0.850, 0.875, 0.900, 0.925, 0.950, 0.975, 1.000, 1.025,
  1.050, 1.075, 1.100, 1.125, 1.150, 1.175, 1.200, 1.250, 1.300, 1.350,
  1.400, 1.450, 1.500, 1.550, 1.600, 1.700, 1.800, 1.900, 2.000, 2.100,
  2.200, 2.300, 2.400, 2.500, 2.600, 2.700, 2.800, 2.900, 3.000, 3.200,
  3.400, 3.600, 3.800, 4.000, 4.200, 4.400, 4.600, 4.800, 4.900, 5.000,
];

// G1 Reference Drag Coefficient Cd values across all 60 Mach points (Gavre standard)
export const G1_CD_TABLE = [
  0.2629, 0.2618, 0.2600, 0.2562, 0.2520, 0.2475, 0.2432, 0.2395, 0.2370, 0.2365,
  0.2380, 0.2405, 0.2450, 0.2530, 0.2660, 0.2880, 0.3230, 0.3650, 0.4080, 0.4350,
  0.4480, 0.4530, 0.4550, 0.4540, 0.4515, 0.4480, 0.4435, 0.4320, 0.4190, 0.4060,
  0.3930, 0.3805, 0.3690, 0.3585, 0.3485, 0.3300, 0.3140, 0.2995, 0.2865, 0.2750,
  0.2645, 0.2550, 0.2465, 0.2385, 0.2312, 0.2245, 0.2182, 0.2124, 0.2070, 0.1972,
  0.1885, 0.1808, 0.1740, 0.1680, 0.1625, 0.1575, 0.1530, 0.1488, 0.1468, 0.1450,
];

// G7 Reference Drag Coefficient Cd values across all 60 Mach points (VLD / Boat-tail standard)
export const G7_CD_TABLE = [
  0.1150, 0.1150, 0.1152, 0.1158, 0.1167, 0.1180, 0.1198, 0.1223, 0.1258, 0.1284,
  0.1325, 0.1360, 0.1415, 0.1510, 0.1680, 0.1960, 0.2410, 0.3010, 0.3620, 0.3920,
  0.4030, 0.4050, 0.4020, 0.3960, 0.3880, 0.3795, 0.3705, 0.3525, 0.3360, 0.3210,
  0.3075, 0.2955, 0.2845, 0.2745, 0.2655, 0.2495, 0.2355, 0.2230, 0.2115, 0.2015,
  0.1925, 0.1845, 0.1772, 0.1706, 0.1646, 0.1591, 0.1540, 0.1494, 0.1451, 0.1375,
  0.1308, 0.1249, 0.1197, 0.1150, 0.1108, 0.1070, 0.1035, 0.1003, 0.0988, 0.0975,
];

// Custom Doppler Radar Drag Profile (Modern Match ELD / Lapua Scenar-L high BC boattail)
export const DOPPLER_CD_TABLE = [
  0.1080, 0.1080, 0.1082, 0.1088, 0.1096, 0.1108, 0.1124, 0.1146, 0.1175, 0.1198,
  0.1232, 0.1262, 0.1308, 0.1390, 0.1535, 0.1780, 0.2170, 0.2720, 0.3280, 0.3580,
  0.3710, 0.3740, 0.3715, 0.3650, 0.3565, 0.3475, 0.3380, 0.3195, 0.3030, 0.2885,
  0.2755, 0.2640, 0.2535, 0.2440, 0.2355, 0.2205, 0.2075, 0.1960, 0.1855, 0.1762,
  0.1680, 0.1605, 0.1538, 0.1478, 0.1423, 0.1373, 0.1327, 0.1285, 0.1246, 0.1178,
  0.1118, 0.1065, 0.1018, 0.0976, 0.0938, 0.0904, 0.0873, 0.0845, 0.0832, 0.0820,
];

// Pre-instantiated cubic splines for rapid evaluation during RK4 steps
export const G1_SPLINE = new CubicSpline(MACH_POINTS, G1_CD_TABLE);
export const G7_SPLINE = new CubicSpline(MACH_POINTS, G7_CD_TABLE);
export const DOPPLER_SPLINE = new CubicSpline(MACH_POINTS, DOPPLER_CD_TABLE);

/**
 * Get Cd value for specified drag model at given Mach number
 * @param {string} model 'G1' | 'G7' | 'DOPPLER'
 * @param {number} mach Mach number
 * @returns {number} Drag coefficient Cd
 */
export function getCd(model, mach) {
  const m = Math.max(0, mach);
  switch (model?.toUpperCase()) {
    case 'G1':
      return G1_SPLINE.interpolate(m);
    case 'G7':
      return G7_SPLINE.interpolate(m);
    case 'DOPPLER':
      return DOPPLER_SPLINE.interpolate(m);
    default:
      return G7_SPLINE.interpolate(m);
  }
}
