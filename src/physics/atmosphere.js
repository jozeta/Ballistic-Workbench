/**
 * Ballistic Workbench - Atmosphere & Gas Dynamics Engine
 * All calculations operate strictly in canonical SI units:
 * - Temperature: Kelvin (K)
 * - Pressure: Pascals (Pa)
 * - Density: kg/m^3
 * - Speed of Sound: m/s
 * - Altitude: meters (m)
 */

export const ICAO = {
  P0: 101325.0, // Standard sea level pressure (Pa)
  T0: 288.15, // Standard sea level temperature (15 deg C in K)
  RHO0: 1.2250, // Standard sea level dry air density (kg/m^3)
  L: 0.0065, // Standard troposphere lapse rate (K/m)
  G: 9.80665, // Gravitational acceleration (m/s^2)
  RD: 287.058, // Specific gas constant for dry air (J/(kg*K))
  RV: 461.495, // Specific gas constant for water vapor (J/(kg*K))
  GAMMA: 1.40, // Ratio of specific heats for air (Cp/Cv)
};

/**
 * Saturation vapor pressure of water using enhanced CIPM/Tetens equation
 * @param {number} tempK Temperature in Kelvin
 * @returns {number} Saturation vapor pressure in Pascals (Pa)
 */
export function getSaturationVaporPressure(tempK) {
  const tc = tempK - 273.15;
  // Valid for -50 deg C to +50 deg C
  if (tc >= 0) {
    return 610.78 * Math.exp((17.27 * tc) / (tc + 237.3));
  } else {
    // Over ice
    return 610.78 * Math.exp((21.875 * tc) / (tc + 265.5));
  }
}

/**
 * Compute humid air density using CIPM formula
 * @param {number} pressurePa Total atmospheric pressure in Pascals
 * @param {number} tempK Ambient temperature in Kelvin
 * @param {number} relativeHumidity Relative humidity fraction [0.0 to 1.0]
 * @returns {number} Air density in kg/m^3
 */
export function getAirDensity(pressurePa, tempK, relativeHumidity = 0.5) {
  const p = Math.max(10000, pressurePa);
  const t = Math.max(150, tempK);
  const rh = Math.max(0, Math.min(1.0, relativeHumidity));

  const es = getSaturationVaporPressure(t);
  const pv = rh * es; // Partial pressure of water vapor
  const pd = Math.max(0, p - pv); // Partial pressure of dry air

  const rho = (pd / (ICAO.RD * t)) + (pv / (ICAO.RV * t));
  return rho;
}

/**
 * Compute Virtual Temperature Tv (the temperature dry air would have to match the humid air density)
 * @param {number} pressurePa Pressure in Pascals
 * @param {number} tempK Temperature in Kelvin
 * @param {number} relativeHumidity Relative humidity fraction [0.0 to 1.0]
 * @returns {number} Virtual temperature in Kelvin
 */
export function getVirtualTemperature(pressurePa, tempK, relativeHumidity = 0.5) {
  const es = getSaturationVaporPressure(tempK);
  const pv = Math.max(0, Math.min(1.0, relativeHumidity)) * es;
  const eps = ICAO.RD / ICAO.RV; // ~0.622
  const tv = tempK / (1 - (pv / pressurePa) * (1 - eps));
  return tv;
}

/**
 * Compute speed of sound in humid air
 * a = sqrt(gamma * P / rho)
 * @param {number} pressurePa Atmospheric pressure in Pascals
 * @param {number} densityKgM3 Air density in kg/m^3
 * @returns {number} Speed of sound in m/s
 */
export function getSpeedOfSound(pressurePa, densityKgM3) {
  if (densityKgM3 <= 0 || pressurePa <= 0) return 340.29;
  return Math.sqrt((ICAO.GAMMA * pressurePa) / densityKgM3);
}

/**
 * Compute Density Altitude (DA) in meters
 * The altitude in the standard ICAO atmosphere where density equals the current density
 * @param {number} currentDensityKgM3 Current air density in kg/m^3
 * @returns {number} Density altitude in meters
 */
export function getDensityAltitude(currentDensityKgM3) {
  if (currentDensityKgM3 <= 0) return 0;
  // Exponent alpha = (g / (Rd * L)) - 1 approx 4.25588
  const alpha = (ICAO.G / (ICAO.RD * ICAO.L)) - 1.0;
  const ratio = currentDensityKgM3 / ICAO.RHO0;
  if (ratio <= 0) return 30000;
  const daMeters = (ICAO.T0 / ICAO.L) * (1.0 - Math.pow(ratio, 1.0 / alpha));
  return daMeters;
}

/**
 * Compute standard barometric pressure at a given geometric altitude (meters) in ICAO atmosphere
 * @param {number} altitudeM Altitude above sea level in meters
 * @returns {number} Standard pressure in Pascals
 */
export function getStandardPressureAtAltitude(altitudeM) {
  const h = Math.max(-500, Math.min(11000, altitudeM));
  const tRatio = 1.0 - (ICAO.L * h) / ICAO.T0;
  const exponent = ICAO.G / (ICAO.RD * ICAO.L); // ~5.25588
  return ICAO.P0 * Math.pow(tRatio, exponent);
}

/**
 * Adjust muzzle velocity based on powder temperature (linear model)
 * @param {number} refMuzzleVelocityMs Muzzle velocity at the reference powder temperature (m/s)
 * @param {number} powderTempK Powder temperature in Kelvin
 * @param {number} refTempK Reference powder temperature in Kelvin (default 15 C / 288.15 K)
 * @param {number} sensitivityMsPerK Sensitivity in m/s per kelvin, i.e. m/s per °C (typical rifle
 *   loads 0.1-1.5 m/s per °C; temperature-stable powders are at the low end)
 * @returns {number} Temperature-corrected muzzle velocity in m/s
 */
export function adjustMuzzleVelocityForPowderTemp(
  refMuzzleVelocityMs,
  powderTempK,
  refTempK = 288.15,
  sensitivityMsPerK = 0.08
) {
  const deltaT = powderTempK - refTempK;
  return refMuzzleVelocityMs + deltaT * sensitivityMsPerK;
}

/**
 * Complete atmospheric telemetry bundle
 */
export function getAtmosphericConditions({
  pressurePa,
  tempK,
  relativeHumidity = 0.5,
  altitudeM = 0,
}) {
  // If pressure is omitted or 0, calculate from altitude
  const p = pressurePa > 0 ? pressurePa : getStandardPressureAtAltitude(altitudeM);
  const density = getAirDensity(p, tempK, relativeHumidity);
  const speedOfSound = getSpeedOfSound(p, density);
  const densityAltitude = getDensityAltitude(density);
  const virtualTemp = getVirtualTemperature(p, tempK, relativeHumidity);

  return {
    pressurePa: p,
    tempK,
    relativeHumidity,
    altitudeM,
    densityKgM3: density,
    speedOfSoundMs: speedOfSound,
    densityAltitudeM: densityAltitude,
    virtualTempK: virtualTemp,
  };
}
