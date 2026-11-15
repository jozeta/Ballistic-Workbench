/**
 * Ballistic Workbench - Default Pre-configured Rifle, Optic, Ammo, and Environment Profiles
 */

export const DEFAULT_PROFILES = [
  {
    id: 'profile-65cm-prs',
    name: 'Bergara Premier HMR Pro - 6.5 Creedmoor',
    description: 'Precision Rifle Series (PRS) Competition Setup',
    caliber: '6.5mm / .264',
    bullet: {
      id: 'hornady-65-140-eldm',
      name: 'Hornady 6.5mm 140gr ELD Match',
      weightGr: 140,
      diameterIn: 0.264,
      lengthIn: 1.378,
      bcG1: 0.646,
      bcG7: 0.326,
      dragModel: 'G7',
    },
    muzzleVelocityMs: 825.0, // 2707 fps
    powderTempSensitivity: 0.8, // m/s per 10 deg C change
    powderRefTempC: 15.0,
    sightHeightM: 0.048, // 1.89 inches (4.8 cm above bore)
    zeroDistanceM: 100.0, // 100m zero
    zeroAngleRad: null, // solved dynamically
    twistRateIn: 8.0, // 1:8" twist
    twistDirection: 'right', // right-hand spin
    optic: {
      model: 'Vortex Razor HD Gen III 6-36x56 FFP',
      focalPlane: 'FFP',
      reticle: 'EBR-8 MRAD',
      clickValueRad: 0.0001, // 0.1 MRAD
      clickName: '0.1 MRAD',
      currentMagnification: 18,
      minMagnification: 6,
      maxMagnification: 36,
      zeroElevationClicks: 0,
      zeroWindageClicks: 0,
    },
    rifleWeightKg: 6.8, // 15 lbs with optic & bipod
  },
  {
    id: 'profile-300prc-elr',
    name: 'Accuracy International AXSR - .300 PRC',
    description: 'Extreme Long Range (ELR) 2000m Anti-Materiel / Match Platform',
    caliber: '.300 Mag / .300 PRC',
    bullet: {
      id: 'hornady-308-230-atip',
      name: 'Hornady .308 230gr A-TIP Match',
      weightGr: 230,
      diameterIn: 0.308,
      lengthIn: 1.765,
      bcG1: 0.823,
      bcG7: 0.415,
      dragModel: 'DOPPLER',
    },
    muzzleVelocityMs: 885.0, // 2904 fps
    powderTempSensitivity: 0.9,
    powderRefTempC: 15.0,
    sightHeightM: 0.052, // 5.2 cm
    zeroDistanceM: 100.0,
    zeroAngleRad: null,
    twistRateIn: 8.5,
    twistDirection: 'right',
    optic: {
      model: 'Schmidt & Bender 5-25x56 PM II',
      focalPlane: 'FFP',
      reticle: 'Mil-XT',
      clickValueRad: 0.0001,
      clickName: '0.1 MRAD',
      currentMagnification: 20,
      minMagnification: 5,
      maxMagnification: 25,
      zeroElevationClicks: 0,
      zeroWindageClicks: 0,
    },
    rifleWeightKg: 8.4,
  },
  {
    id: 'profile-308-tactical',
    name: 'Tikka T3x TAC A1 - .308 Winchester',
    description: 'Tactical Law Enforcement / Military Precision Scout',
    caliber: '.308 / 7.62mm',
    bullet: {
      id: 'sierra-308-175-smk',
      name: 'Sierra .308 175gr MatchKing HPBT',
      weightGr: 175,
      diameterIn: 0.308,
      lengthIn: 1.240,
      bcG1: 0.505,
      bcG7: 0.252,
      dragModel: 'G7',
    },
    muzzleVelocityMs: 790.0, // 2592 fps
    powderTempSensitivity: 1.1,
    powderRefTempC: 15.0,
    sightHeightM: 0.045,
    zeroDistanceM: 100.0,
    zeroAngleRad: null,
    twistRateIn: 11.0,
    twistDirection: 'right',
    optic: {
      model: 'Nightforce ATACR 4-16x42 FFP',
      focalPlane: 'FFP',
      reticle: 'Mil-Dot',
      clickValueRad: 0.0001,
      clickName: '0.1 MRAD',
      currentMagnification: 12,
      minMagnification: 4,
      maxMagnification: 16,
      zeroElevationClicks: 0,
      zeroWindageClicks: 0,
    },
    rifleWeightKg: 5.6,
  },
  {
    id: 'profile-223-match',
    name: 'Remington 700 Varmint - .223 Remington',
    description: 'Mid-Range Precision & Varmint Precision Rig',
    caliber: '5.56mm / .224',
    bullet: {
      id: 'sierra-224-77-smk',
      name: 'Sierra 77gr MatchKing HPBT',
      weightGr: 77,
      diameterIn: 0.224,
      lengthIn: 0.990,
      bcG1: 0.372,
      bcG7: 0.190,
      dragModel: 'G7',
    },
    muzzleVelocityMs: 840.0, // 2756 fps
    powderTempSensitivity: 0.7,
    powderRefTempC: 15.0,
    sightHeightM: 0.042,
    zeroDistanceM: 100.0,
    zeroAngleRad: null,
    twistRateIn: 8.0,
    twistDirection: 'right',
    optic: {
      model: 'Leupold Mark 5HD 5-25x56',
      focalPlane: 'FFP',
      reticle: 'Tremor3',
      clickValueRad: 0.0001,
      clickName: '0.1 MRAD',
      currentMagnification: 15,
      minMagnification: 5,
      maxMagnification: 25,
      zeroElevationClicks: 0,
      zeroWindageClicks: 0,
    },
    rifleWeightKg: 4.8,
  },
];

export const DEFAULT_ENVIRONMENTS = [
  {
    id: 'env-icao-sea-level',
    name: 'ICAO Standard Atmosphere (Sea Level)',
    altitudeM: 0,
    temperatureC: 15.0,
    pressureHpa: 1013.25,
    humidityPercent: 50.0,
    windSpeedMs: 4.0, // 4 m/s (approx 9 mph)
    windDirectionDeg: 90.0, // 3 o'clock full crosswind
    windZones: [
      { startM: 0, endM: 1200, speedMs: 4.0, directionDeg: 90.0 },
    ],
    inclinationDeg: 0.0,
    cantDeg: 0.0,
    latitudeDeg: 45.0,
    shootingAzimuthDeg: 0.0, // North
  },
  {
    id: 'env-alpine-high',
    name: 'Alpine High Altitude (1,950m)',
    altitudeM: 1950,
    temperatureC: 4.0,
    pressureHpa: 805.0,
    humidityPercent: 25.0,
    windSpeedMs: 5.5,
    windDirectionDeg: 60.0, // 2 o'clock
    windZones: [
      { startM: 0, endM: 500, speedMs: 3.5, directionDeg: 45.0 },
      { startM: 500, endM: 1200, speedMs: 6.0, directionDeg: 75.0 },
      { startM: 1200, endM: 2000, speedMs: 8.0, directionDeg: 90.0 },
    ],
    inclinationDeg: 12.0, // Uphill angle
    cantDeg: 0.0,
    latitudeDeg: 46.5,
    shootingAzimuthDeg: 45.0,
  },
  {
    id: 'env-desert-heat',
    name: 'Desert High Temperature & Mirage (38°C)',
    altitudeM: 800,
    temperatureC: 38.0,
    pressureHpa: 925.0,
    humidityPercent: 12.0,
    windSpeedMs: 7.0,
    windDirectionDeg: 270.0, // 9 o'clock full left crosswind
    windZones: [
      { startM: 0, endM: 600, speedMs: 5.0, directionDeg: 260.0 },
      { startM: 600, endM: 1500, speedMs: 8.5, directionDeg: 280.0 },
    ],
    inclinationDeg: -3.0, // slight downhill
    cantDeg: 0.0,
    latitudeDeg: 32.0,
    shootingAzimuthDeg: 180.0, // South
  },
  {
    id: 'env-subzero-winter',
    name: 'Sub-Zero Winter Hunt (-12°C)',
    altitudeM: 350,
    temperatureC: -12.0,
    pressureHpa: 1025.0,
    humidityPercent: 80.0,
    windSpeedMs: 3.0,
    windDirectionDeg: 135.0, // quartering tailwind
    windZones: [
      { startM: 0, endM: 1000, speedMs: 3.0, directionDeg: 135.0 },
    ],
    inclinationDeg: 0.0,
    cantDeg: 0.0,
    latitudeDeg: 55.0,
    shootingAzimuthDeg: 90.0,
  },
];
