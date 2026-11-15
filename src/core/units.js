/**
 * Ballistic Workbench - Central Unit Conversion Engine
 * All physics modules strictly calculate in canonical SI units:
 * - Distance: meters (m)
 * - Velocity: meters per second (m/s)
 * - Mass: kilograms (kg)
 * - Pressure: Pascals (Pa)
 * - Temperature: Kelvin (K)
 * - Angle: radians (rad)
 * - Energy: Joules (J)
 */

export const UNIT_TYPES = {
  DISTANCE: 'distance',
  OFFSET: 'offset',
  VELOCITY: 'velocity',
  MASS: 'mass',
  PRESSURE: 'pressure',
  TEMPERATURE: 'temperature',
  ANGLE: 'angle',
  ENERGY: 'energy',
  DIMENSION: 'dimension',
};

export const CONVERSIONS = {
  // Distance (canonical: m)
  m: 1.0,
  yd: 0.9144,
  ft: 0.3048,
  km: 1000.0,
  mi: 1609.344,

  // Offset / Small Dimension (canonical: m)
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,

  // Velocity (canonical: m/s)
  'm/s': 1.0,
  fps: 0.3048,
  mph: 0.44704,
  'km/h': 1.0 / 3.6,
  knots: 0.514444,

  // Mass (canonical: kg)
  kg: 1.0,
  g: 0.001,
  gr: 0.00006479891, // grains
  lb: 0.45359237,
  oz: 0.028349523125,

  // Pressure (canonical: Pa)
  Pa: 1.0,
  hPa: 100.0,
  mbar: 100.0,
  bar: 100000.0,
  inHg: 3386.3886666667,
  mmHg: 133.322387415,
  psi: 6894.757293168,
  atm: 101325.0,

  // Energy (canonical: J)
  J: 1.0,
  kJ: 1000.0,
  'ft-lb': 1.3558179483314,

  // Angles (canonical: rad)
  rad: 1.0,
  deg: Math.PI / 180.0,
  MRAD: 0.001,
  mil: 0.001,
  MOA: (Math.PI / 180.0) / 60.0, // ~0.0002908882086657216
  SMOA: 0.01 / 36.0, // Shooter's MOA: 1 inch at 100 yds = 0.0254 / 91.44 rad = 1/3600 rad
  'click-0.1mrad': 0.0001,
  'click-0.05mrad': 0.00005,
  'click-0.25moa': ((Math.PI / 180.0) / 60.0) * 0.25,
  'click-0.125moa': ((Math.PI / 180.0) / 60.0) * 0.125,
};

// Imperial BC (lb/in^2) to SI BC (kg/m^2)
export const BC_LB_IN2_TO_KG_M2 = 0.45359237 / (0.0254 * 0.0254); // ~703.069579639148

export class UnitConverter {
  /**
   * Convert any supported unit to canonical SI
   */
  static toSI(val, unit) {
    if (val === null || val === undefined || isNaN(val)) return 0;
    const v = Number(val);
    switch (unit) {
      case 'C':
        return v + 273.15;
      case 'F':
        return ((v - 32) * 5) / 9 + 273.15;
      case 'K':
        return v;
      default:
        if (CONVERSIONS[unit] !== undefined) {
          return v * CONVERSIONS[unit];
        }
        return v;
    }
  }

  /**
   * Convert canonical SI to target unit
   */
  static fromSI(val, unit) {
    if (val === null || val === undefined || isNaN(val)) return 0;
    const v = Number(val);
    switch (unit) {
      case 'C':
        return v - 273.15;
      case 'F':
        return ((v - 273.15) * 9) / 5 + 32;
      case 'K':
        return v;
      default:
        if (CONVERSIONS[unit] !== undefined) {
          return v / CONVERSIONS[unit];
        }
        return v;
    }
  }

  /**
   * Direct conversion between any two units of the same dimension
   */
  static convert(val, fromUnit, toUnit) {
    if (fromUnit === toUnit) return Number(val);
    const si = this.toSI(val, fromUnit);
    return this.fromSI(si, toUnit);
  }

  /**
   * Format value with target unit and precision
   */
  static format(val, unit, decimals = 2) {
    const v = Number(val);
    if (isNaN(v)) return '--';
    return v.toFixed(decimals);
  }

  /**
   * Get default UI units based on system mode: 'metric' | 'imperial'
   */
  static getSystemDefaults(system = 'metric') {
    if (system === 'imperial') {
      return {
        distance: 'yd',
        targetDistance: 'yd',
        sightHeight: 'in',
        bulletDiameter: 'in',
        bulletLength: 'in',
        bulletWeight: 'gr',
        velocity: 'fps',
        windSpeed: 'mph',
        dropOffset: 'in',
        windDriftOffset: 'in',
        elevationAngle: 'MOA',
        windageAngle: 'MOA',
        temperature: 'F',
        pressure: 'inHg',
        energy: 'ft-lb',
        clicks: 'click-0.25moa',
        clickName: '1/4 MOA',
        twistRate: 'in',
      };
    }
    // Metric default
    return {
      distance: 'm',
      targetDistance: 'm',
      sightHeight: 'cm',
      bulletDiameter: 'mm',
      bulletLength: 'mm',
      bulletWeight: 'gr', // standard even in metric ballistics, with 'g' option
      velocity: 'm/s',
      windSpeed: 'm/s',
      dropOffset: 'cm',
      windDriftOffset: 'cm',
      elevationAngle: 'MRAD',
      windageAngle: 'MRAD',
      temperature: 'C',
      pressure: 'hPa',
      energy: 'J',
      clicks: 'click-0.1mrad',
      clickName: '0.1 MRAD',
      twistRate: 'in', // twist commonly expressed in 1:8" even internationally, or cm
    };
  }

  /**
   * Calculate clicks given angle in radians and click size in radians
   */
  static toClicks(angleRad, clickUnit = 'click-0.1mrad') {
    const clickRad = CONVERSIONS[clickUnit] || 0.0001;
    return Math.round(angleRad / clickRad);
  }

  /**
   * Convert angle in MRAD or MOA to linear dimension at a given distance
   * @param {number} angleRad Angle in radians
   * @param {number} distanceM Distance in meters
   * @returns {number} Linear offset in meters
   */
  static angleToSubtension(angleRad, distanceM) {
    return Math.tan(angleRad) * distanceM;
  }

  /**
   * Convert linear offset at distance into angular radian
   */
  static subtensionToAngle(offsetM, distanceM) {
    if (distanceM <= 0) return 0;
    return Math.atan2(offsetM, distanceM);
  }
}
