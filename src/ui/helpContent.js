/**
 * Ballistic Workbench - help content for the "i" buttons (src/ui/help.js).
 *
 * Keyed by the element id of the input, select, slider or control group. Static text only: every
 * field is rendered with textContent, never as HTML.
 *
 * Fields: title (short, sentence case), text (what it is and why it matters), how (optional steps),
 * typical (optional typical values, metric first), tip (optional), guide (optional guide section id).
 *
 * A few keys are not element ids because the control has no single id; help.js maps them:
 * - radio groups by their name: wez-shots, chrono-unit, milling-ang, lab-mode, stage-size, card-theme
 * - repeated rows: stage-field-<field> (DOPE stage targets, ids tgt-<i>-<field>),
 *   shot-field-x / shot-field-y (Group analysis shots, ids shot-x-<i> / shot-y-<i>),
 *   range-row-select (Solver range table, checkboxes .chk-range-select)
 */

// ---- shared pieces (the same setting appears in the Solver, the rifle dialog and the library) ----

const MV = {
  title: 'Muzzle velocity',
  text: 'How fast the bullet leaves the muzzle. With the BC it is the biggest driver of drop at long range: 10 m/s (33 fps) off moves the impact about 0.1–0.2 MRAD at 600 m. The app treats it as the velocity at 15 °C (59 °F) and adjusts it for the air temperature, about 0.8–0.9 m/s per °C.',
  how: [
    'Shoot 10 or more rounds of one load over a chronograph.',
    'Paste the readings into Tools → Chronograph and enter the average here.',
    'If the drops at 500–800 m still disagree, true it in Tools → True your data.',
  ],
  typical: 'Typical: 6.5 Creedmoor 810–850 m/s (2,650–2,800 fps); .308 Win 790–820 m/s (2,600–2,700 fps).',
  tip: 'Box velocities come from long test barrels. Measure your own.',
  guide: 'guide-chrono',
};

const WEIGHT = {
  title: 'Bullet weight',
  text: 'The bullet\'s mass in grains (1 gr = 0.0648 g). The drag itself comes from the BC, so weight mainly affects energy, stability (with length and twist) and spin drift.',
  typical: 'Typical: 6.5 mm 120–147 gr, .308 155–185 gr, 6 mm 95–115 gr.',
  tip: 'Use the weight printed on the bullet box, not a weighed loaded round.',
  guide: 'guide-bullet',
};

const DRAG_MODEL = {
  title: 'Drag model',
  text: 'The reference bullet shape the BC is measured against. G7 is a long boat-tail shape and fits modern match bullets across all speeds. G1 is a flat-base shape; with boat-tail bullets its BC changes with velocity, so G1 predictions drift past about 600 m.',
  how: [
    'Boat-tail match or long-range hunting bullet: choose G7.',
    'Flat-base, round-nose or short hunting bullet, or only a G1 BC is published: choose G1.',
  ],
  tip: 'The BC must match the model: a G7 BC is roughly half the G1 number for the same bullet.',
  guide: 'guide-bullet',
};

const BC = {
  title: 'Ballistic coefficient (BC)',
  text: 'How well the bullet keeps its speed, relative to the chosen drag model. Higher means less drop and drift. Enter the BC for the model selected next to it (G7 or G1).',
  how: [
    'Look up the G7 BC from the bullet maker (Berger, Hornady and Lapua publish G7 values) or from Applied Ballistics / Bryan Litz measured data.',
    'Library values marked "est." were converted from the other model; treat them as a starting point.',
    'Fine-tune it with long-range drops in Tools → True your data.',
  ],
  typical: 'Typical G7: 0.25–0.35 for 6.5 mm and .308 match bullets; G1 is about 1.9–2× the G7 figure.',
  tip: 'Advertised G1 BCs are often optimistic. Prefer measured G7 numbers.',
  guide: 'guide-bullet',
};

const SIGHT_HEIGHT = {
  title: 'Sight height',
  text: 'Distance from the centre of the bore to the centre of the scope. It sets the angle between line of sight and bore, so it matters most at short range and when you are closer than your zero.',
  how: [
    'Measure from the top of the bolt body (or barrel) to the top of the scope tube with a calliper.',
    'Subtract half the scope tube diameter (30 mm tube: 15 mm).',
    'Add half the bolt or barrel diameter where you measured.',
  ],
  typical: 'Typical: 38–55 mm (1.5–2.2 in) on a bolt rifle; about 65–70 mm (2.6–2.8 in) on an AR-15.',
  tip: 'An error of 5 mm shifts close-range impacts by about the same 5 mm; long range barely changes.',
  guide: 'guide-sight-height',
};

const ZERO = {
  title: 'Zero distance',
  text: 'The distance where your sights, with the turrets on zero, hit point of aim. All elevations are given relative to this zero. The app solves the zero level, with no wind or cant, in the current atmosphere.',
  how: [
    'Shoot a group at this distance on a calm day.',
    'Adjust the turrets until the group centres on the aim point, then reset the turret caps to zero.',
  ],
  typical: 'Typical: 100 m (100 yd) for precision rifles; 200 m for some hunters.',
  tip: 'The number must be the distance you really zeroed at, or every elevation is off by a constant.',
  guide: 'guide-zero',
};

const TWIST = {
  title: 'Twist rate',
  text: 'How far the rifling takes to turn the bullet one full turn, as "1 in X inches". Faster twist (smaller number) spins the bullet faster. It sets stability (the Sg number) and spin drift.',
  how: [
    'Check the barrel stamp or the maker\'s spec sheet.',
    'Or: push a cleaning rod with a tight patch into the bore, mark the rod at the action, push until the handle has turned once, mark again and measure between the marks.',
  ],
  typical: 'Typical: 6.5 Creedmoor 1:8, .308 Win 1:10–1:11.25, 6 mm 1:7.5–1:8, .223 Rem 1:7–1:9.',
  tip: 'Long, heavy bullets need a faster twist. Sg below 1.5 can lower the real BC.',
  guide: 'guide-twist',
};

const FOCAL_PLANE = {
  title: 'Focal plane',
  text: 'Where the reticle sits in the scope. First focal plane (FFP): the reticle grows with zoom, so its marks are true at every magnification. Second focal plane (SFP): the reticle stays the same size, so its marks are only true at one magnification, usually the highest.',
  how: ['Check the scope\'s name or manual: most precision scopes say FFP or SFP.', 'Or zoom in and out: if the reticle changes size against the target, it is FFP.'],
  tip: 'With SFP, hold or range only at the calibrated power; the reticle view warns when you are off it.',
  guide: 'guide-solver-reticle',
};

const RETICLE = {
  title: 'Reticle',
  text: 'The pattern in your scope. The reticle view draws it with the hold for the current target, so pick the one in your scope or the nearest match with the same unit (MRAD or MOA).',
  tip: 'Holds are only meaningful when the reticle unit matches your turret and display unit.',
  guide: 'guide-solver-reticle',
};

const STAGE_SHAPES = 'Round gong, IPSC torso, square or diamond plate, or a KYL rack of shrinking plates.';

// ---- the registry ----------------------------------------------------------------------------------

/** Help for every input, keyed by the input/select/slider element id. Static text only (rendered with textContent). */
export const HELP = {
  // ===== Header =====
  'units-switch': {
    title: 'Units',
    text: 'Metric shows metres, m/s, cm, °C and hPa; imperial shows yards, fps, inches, °F and inHg. The calculation is the same either way. Your scope\'s clicks come from the rifle\'s click value, not from this switch.',
    tip: 'Switching converts the numbers already entered; nothing is lost.',
    guide: 'guide-settings',
  },
  'theme-switch': {
    title: 'Theme',
    text: 'System follows your device\'s light or dark setting; Light and Dark force one. Printed DOPE cards always use their own paper colours.',
    tip: 'Dark is easier on night vision when you check data in low light.',
    guide: 'guide-settings',
  },

  // ===== Solver: rifle and target =====
  'profile-select': {
    title: 'Rifle',
    text: 'The rifle profile the Solver uses: its load, bullet, sight height, zero, twist and scope. Switching rifles updates the whole solution, the DOPE cards and the tools.',
    how: ['Pick a saved rifle here.', 'Press + to add one, or edit rifles in the Library.'],
    tip: 'Make one profile per rifle and load; a new load needs its own muzzle velocity and BC.',
    guide: 'guide-enter',
  },
  'target-range-slider': {
    title: 'Target distance',
    text: 'Drag to set the distance to the target. The firing solution, the reticle hold and the turret all follow it. The slider moves in steps of 25; type in the box next to it for an exact value.',
    typical: 'Slider range: 50–1,500 m (50–1,600 yd).',
    tip: 'Use a laser rangefinder: at 800 m a 20 m error moves the impact about 0.3 MRAD.',
    guide: 'guide-solver',
  },
  'target-range-input': {
    title: 'Target distance',
    text: 'The exact line-of-sight distance to the target, in the current distance unit. Enter what your rangefinder reads; the inclination field accounts for uphill and downhill shots.',
    typical: 'Accepts 10–2,000 m (10–2,200 yd).',
    tip: 'Range errors matter more the further out you are, as the trajectory gets steeper.',
    guide: 'guide-solver',
  },
  'target-shape-select': {
    title: 'Target type',
    text: 'The target drawn in the reticle view, so you can see how the hold and your spread compare to its size. Picking one fills in its standard width and height.',
    typical: 'IPSC 45 × 75 cm, NATO E-type 50 × 100 cm, plates 30 cm.',
    tip: 'It only changes the picture and the hit chance, not the elevation or wind hold.',
    guide: 'guide-solver-reticle',
  },
  'target-w-input': {
    title: 'Target width',
    text: 'The width of the target (the diameter for a round plate), in cm or inches. Used to draw it to scale in the reticle and to judge how much wind error the target forgives.',
    typical: 'Typical steel: 20–50 cm (8–20 in).',
    guide: 'guide-solver-reticle',
  },
  'target-h-input': {
    title: 'Target height',
    text: 'The height of the target, in cm or inches. Used to draw it to scale and to show how much elevation error it allows: a 30 cm plate at 600 m is 0.5 MRAD tall.',
    guide: 'guide-solver-reticle',
  },

  // ===== Solver: load and rifle =====
  'mv-input': MV,
  'weight-input': WEIGHT,
  'drag-model-select': DRAG_MODEL,
  'bc-input': BC,
  'algorithm-select': {
    title: 'Solver model',
    text: 'How the trajectory is calculated. Point mass with G7 or G1 drag gives drop and wind drift. Modified point mass (MPM) adds spin drift, aerodynamic jump from crosswind and Coriolis, which matter mostly past 600 m.',
    how: ['Use MPM for long range (it uses the bullet\'s own drag model).', 'Use Compare models to see how far the models differ for your rifle.'],
    tip: 'Spin drift with a right-hand twist pushes impacts right, about 0.2–0.3 MRAD at 1,000 m.',
    guide: 'guide-compare',
  },
  'sh-input': SIGHT_HEIGHT,
  'zero-input': ZERO,
  'twist-input': TWIST,

  // ===== Solver: atmosphere =====
  'env-select': {
    title: 'Atmosphere preset',
    text: 'A saved set of conditions: temperature, pressure, altitude, humidity, wind and latitude (for Coriolis). Editing the fields below changes the selected preset.',
    how: ['Pick the preset closest to where you shoot.', 'Enter today\'s readings from a weather meter (such as a Kestrel) over it.'],
    tip: 'Air density, not altitude alone, decides the drop. The line under the fields shows the resulting density altitude.',
    guide: 'guide-measure',
  },
  'temp-input': {
    title: 'Temperature',
    text: 'Air temperature at the firing point. Warm air is thinner, so bullets drop a little less. It also changes powder burn: the app shifts muzzle velocity by about 0.8–0.9 m/s per °C away from 15 °C.',
    how: ['Read it in the shade, at chest height, not in the sun or from a car.', 'Use the temperature your ammunition has actually been at.'],
    typical: 'From 15 °C to 30 °C a 6.5 Creedmoor needs roughly 0.3 MRAD less at 800 m, mostly from the faster powder.',
    tip: 'Ammunition left in the sun can be much hotter than the air and shoot faster.',
    guide: 'guide-measure',
  },
  'press-input': {
    title: 'Station pressure',
    text: 'The actual, unadjusted air pressure where you are standing. Not the sea-level pressure from a weather report: that is corrected to sea level and is 10–25% higher at 1,000–2,000 m. Lower pressure means thinner air and less drop.',
    how: [
      'Kestrel: read "Station pressure", or set the reference altitude to 0 and read the barometric pressure.',
      'Phone barometers usually show station pressure too.',
      'No meter: the preset\'s value, or about 12 hPa less per 100 m above sea level.',
    ],
    typical: 'Typical: 1,013 hPa (29.92 inHg) at sea level; about 900 hPa at 1,000 m.',
    guide: 'guide-measure',
  },
  'alt-input': {
    title: 'Altitude',
    text: 'Height above sea level of the firing point. The air density comes from station pressure and temperature, so altitude is saved with the preset for reference and is not needed for the solution when you enter station pressure.',
    tip: 'Don\'t "correct" for altitude twice: if the pressure is station pressure, it already includes it.',
    guide: 'guide-measure',
  },
  'hum-input': {
    title: 'Humidity',
    text: 'Relative humidity in percent. Humid air is slightly less dense than dry air, but the effect is small: from 0% to 100% moves the impact at 1,000 m by only a few centimetres.',
    typical: 'Typical: 30–80%. 50% is a safe default if you don\'t know.',
    tip: 'Temperature and pressure matter far more; don\'t spend time on humidity.',
    guide: 'guide-measure',
  },

  // ===== Solver: wind =====
  'wind-speed-input': {
    title: 'Wind speed',
    text: 'Average wind speed between you and the target. Enter the full speed; the app takes the crosswind part from the direction. Wind is the largest source of misses at long range.',
    how: ['Read a wind meter at the firing point, facing into the wind.', 'Then judge the wind downrange from flags, grass and mirage, and adjust.'],
    typical: 'Typical: 0–4 m/s calm to light (0–9 mph), 5–8 m/s fresh (11–18 mph).',
    tip: 'A 1 m/s (2 mph) error in a full crosswind is about 0.4 MRAD at 800 m for a 6.5 Creedmoor.',
    guide: 'guide-solver',
  },
  'wind-dir-input': {
    title: 'Wind direction',
    text: 'Where the wind comes FROM, in degrees clockwise, with the target at 12 o\'clock. 0 = headwind, 90 = from the right (3 o\'clock), 180 = tailwind, 270 = from the left (9 o\'clock). Each clock hour is 30°.',
    how: ['Face the target and find where the wind comes from on a clock face.', 'Multiply the hour by 30: 2 o\'clock = 60°, 10 o\'clock = 300°.'],
    tip: 'Full value at 3 and 9, about 87% at 2, 4, 8 and 10, and half at 1, 5, 7 and 11.',
    guide: 'guide-solver',
  },

  // ===== Solver: shot angle and cant =====
  'inc-input': {
    title: 'Inclination',
    text: 'The angle of the shot above or below level, in degrees: + uphill, − downhill. Gravity acts on the horizontal part of the distance, so both uphill and downhill shots need less elevation than a level shot at the same line-of-sight distance.',
    how: ['Read the angle from a rangefinder with angle display, a cosine indicator, or a phone inclinometer held along the barrel.'],
    typical: 'Below 10° the change is small; at 30° it is about 13% of the drop.',
    tip: 'Enter the line-of-sight distance as the target distance, not the horizontal distance.',
    guide: 'guide-cant',
  },
  'cant-input': {
    title: 'Rifle cant',
    text: 'How far the rifle is tilted around the line of sight, in degrees: + right (clockwise as you see it), − left. A canted rifle throws the shot low and towards the side it leans, and the error grows with the elevation dialled.',
    how: ['Fit a scope level (bubble) and check it before every shot.', 'Enter a cant here only to see what it costs.'],
    typical: '2° of cant with 10 MRAD dialled moves the impact about 0.35 MRAD sideways.',
    tip: 'Level the reticle, not the rifle\'s action, when you mount the scope.',
    guide: 'guide-cant',
  },

  // ===== Solver: reticle and turret =====
  'reticle-type-select': RETICLE,
  'focal-plane-select': FOCAL_PLANE,
  'illum-check': {
    title: 'Illuminated',
    text: 'Shows the reticle lit up, as with the illumination switched on. It only changes the picture, not the solution.',
    tip: 'In poor light a lit centre makes the aim point easier to see; keep it dim so it doesn\'t flare.',
    guide: 'guide-solver-reticle',
  },
  'mag-slider': {
    title: 'Magnification',
    text: 'The zoom shown in the reticle view, within the scope\'s range from the rifle profile. In an FFP scope it only changes the picture size. In an SFP scope the holds are only true at the calibrated magnification.',
    tip: 'Higher zoom gives a clearer picture of the hold; lower zoom a wider field to spot splash.',
    guide: 'guide-solver-reticle',
  },
  'turret-mode': {
    title: 'Turret mode',
    text: 'Follow solution turns the turret picture to the elevation for the current target. Manual lets you dial click by click with the buttons to practise or check how many clicks a correction is.',
    how: ['In Manual, use −1c / +1c for one click and −1 / +1 for a whole MRAD or MOA.', 'Press Dial to jump to the solution.'],
    guide: 'guide-click-value',
  },

  // ===== Solver: range table =====
  'step-select': {
    title: 'Table step',
    text: 'The distance between rows in the range table, and the step used in the CSV export. Smaller steps give more rows.',
    typical: 'Typical: 25 or 50 m for a DOPE card; 100 m for a quick overview.',
    guide: 'guide-solver-table',
  },
  'col-picker-details': {
    title: 'Columns',
    text: 'Choose which values the range table shows: drop, elevation and clicks, wind drift and windage, velocity, Mach, energy, time of flight and danger space.',
    tip: 'Mach below about 1.2 means the bullet is nearing the speed of sound, where predictions get less certain.',
    guide: 'guide-solver-table',
  },
  'chk-select-all-ranges': {
    title: 'Include all ranges',
    text: 'Ticks or clears every row of the range table for the DOPE card. Ticked rows are the distances that go on the card when you press Make DOPE card.',
    guide: 'guide-dope-cards',
  },
  'range-row-select': {
    title: 'Include this distance',
    text: 'Tick a row to put that distance on your DOPE card. Choose the distances you will actually shoot; small cards only have room for 10–20 rows.',
    guide: 'guide-dope-cards',
  },

  // ===== Compare models =====
  'lab-mode': {
    title: 'What the chart shows',
    text: 'Elevation difference and drift difference show how far G1 and MPM differ from the G7 point-mass solution at each distance. Elevation shows each model\'s total elevation.',
    tip: 'Differences under about 0.1 MRAD are smaller than most shooters can hold.',
    guide: 'guide-compare',
  },
  'lab-show-g7': {
    title: 'Show G7',
    text: 'Shows the point-mass G7 model: the reference the differences are measured from. It fits modern boat-tail match bullets best.',
    guide: 'guide-compare',
  },
  'lab-show-g1': {
    title: 'Show G1',
    text: 'Shows the point-mass G1 model. With boat-tail bullets it usually drifts away from G7 past about 600 m and through the transonic zone.',
    guide: 'guide-compare',
  },
  'lab-show-mpm': {
    title: 'Show MPM',
    text: 'Shows modified point mass: G7 drag plus spin drift, aerodynamic jump and Coriolis. In calm air its elevation matches G7; the difference shows in drift.',
    guide: 'guide-compare',
  },

  // ===== DOPE cards: scope cap and turret tape =====
  'scope-cap-preset-select': {
    title: 'Scope cap',
    text: 'The flip-up scope cap the round insert is printed for. Picking a size fills in its diameter.',
    how: ['Find the size number on the cap, or measure the inside of the clear lid.', 'Choose Other size and type the diameter if yours isn\'t listed.'],
    guide: 'guide-dope-cards',
  },
  'scope-cap-diameter-input': {
    title: 'Cap diameter',
    text: 'The inside diameter of the clear cap lid, in millimetres. The printed circle is cut to this size.',
    how: ['Measure across the inside of the lid with a calliper.', 'Print once and check the 50 mm scale bar with a ruler.'],
    typical: 'Typical: 40–58 mm.',
    tip: 'Print at 100% (no "fit to page"), or the size will be wrong.',
    guide: 'guide-printing',
  },
  'turret-tape-preset-select': {
    title: 'Turret size',
    text: 'The elevation turret the tape is printed for. Picking a size fills in the length around the turret.',
    tip: 'The presets are approximate; measure your turret for the exact length.',
    guide: 'guide-dope-cards',
  },
  'tape-circ-input': {
    title: 'Length around',
    text: 'The circumference of the elevation turret, in millimetres. The tape must be exactly this long for the distance marks to line up with the clicks.',
    how: ['Wrap a thin strip of paper once around the turret.', 'Mark where it overlaps and measure the length.'],
    typical: 'Typical: 95–110 mm (about π × the turret diameter).',
    guide: 'guide-printing',
  },
  'tape-height-input': {
    title: 'Tape height',
    text: 'The height of the strip, in millimetres. Make it fit the smooth band of the turret below the click numbers.',
    typical: 'Typical: 10–15 mm.',
    guide: 'guide-printing',
  },
  'tape-clicks-input': {
    title: 'Clicks per turn',
    text: 'How many clicks one full turn of the elevation turret has. It sets the spacing of the marks; distances that need more than one turn are left out.',
    how: ['Check the scope manual (for example "10 MRAD per turn" = 100 clicks of 0.1 MRAD).', 'Or count clicks for one full turn from zero.'],
    typical: 'Typical: 100–150 for 0.1 MRAD turrets; 60–100 for 1/4 MOA.',
    guide: 'guide-click-value',
  },

  // ===== DOPE cards: stage card =====
  'stage-preset-select': {
    title: 'Stage preset',
    text: 'Fills in a sample match stage (targets, distances, positions and wind) to start from. It replaces the current stage; you can undo it right after.',
    guide: 'guide-stage',
  },
  'input-stage-name': {
    title: 'Stage name',
    text: 'The name printed at the top of the stage card, such as the match stage number or title.',
    guide: 'guide-stage',
  },
  'input-stage-timer': {
    title: 'Time limit',
    text: 'The stage par time in seconds. The card shows it with the time per shot, so you can plan your pace.',
    typical: 'Typical PRS stage: 90–120 s for 8–10 shots.',
    guide: 'guide-stage',
  },
  'input-stage-props': {
    title: 'Positions',
    text: 'The positions or props you shoot from, in order, printed on the card. Use the buttons below to add common ones.',
    how: ['Write the order and the shots from each, for example "Tank trap (2), then barricade (3)".'],
    guide: 'guide-stage',
  },
  'wind-dir-select': {
    title: 'Wind from',
    text: 'The direction the wind comes FROM, as a clock position with the targets at 12 o\'clock. The card works out the crosswind for each target.',
    tip: 'From the right (3 o\'clock) pushes impacts left; hold into the wind, towards the right.',
    guide: 'guide-stage',
  },
  'input-wind-direction': {
    title: 'Wind angle',
    text: 'The same wind direction in degrees, clockwise from the targets: 0 = headwind, 90 = from the right, 180 = tailwind, 270 = from the left. Use it for directions between the clock positions.',
    guide: 'guide-stage',
  },
  'input-wind-lull': {
    title: 'Wind lull',
    text: 'The lowest wind speed you expect on the stage. The card prints a wind hold for the lull, base and gust speeds, so you can adjust without a calculator.',
    typical: 'Typical: base speed minus 1–2 m/s (2–4 mph).',
    guide: 'guide-stage',
  },
  'input-wind-base': {
    title: 'Base wind',
    text: 'The wind speed you expect most of the time, as read from your wind meter or estimated from flags and mirage.',
    guide: 'guide-stage',
  },
  'input-wind-gust': {
    title: 'Wind gust',
    text: 'The strongest wind you expect on the stage. If a gust hits while you shoot, use this column.',
    typical: 'Typical: base speed plus 2–4 m/s (4–9 mph).',
    guide: 'guide-stage',
  },
  'stage-size': {
    title: 'Card size',
    text: '3 × 5 in portrait or landscape fits a wrist coach sleeve; Full page prints on A4 or Letter. If the targets don\'t fit, a warning appears; remove targets or choose a bigger size.',
    guide: 'guide-printing',
  },
  'card-theme': {
    title: 'Card colour',
    text: 'The colour scheme of the printed card. Light uses the least ink; Dark and Green can be easier to read in some light.',
    guide: 'guide-printing',
  },
  'stage-field-name': {
    title: 'Target name',
    text: 'A short name for the target, printed on the card, such as "Far gong" or "IPSC left".',
    guide: 'guide-stage',
  },
  'stage-field-shape': {
    title: 'Target shape',
    text: `The kind of target, for the drawing on the card: ${STAGE_SHAPES}`,
    guide: 'guide-stage',
  },
  'stage-field-distanceM': {
    title: 'Target distance',
    text: 'The distance to this target from the firing position. The card prints the elevation and wind holds for it.',
    tip: 'Range every target in the stage walk-through; a guessed distance is the most common stage miss.',
    guide: 'guide-stage',
  },
  'stage-field-rounds': {
    title: 'Shots',
    text: 'How many shots go on this target. The card adds them up and works out your time per shot.',
    guide: 'guide-stage',
  },
  'stage-field-widthCm': {
    title: 'Target width',
    text: 'The target\'s width (the diameter for a gong). The card shows it in MRAD or MOA at that distance, so you know how much wind error it forgives.',
    guide: 'guide-stage',
  },
  'stage-field-heightCm': {
    title: 'Target height',
    text: 'The target\'s height. The card shows it in MRAD or MOA at that distance, so you know how much elevation error it allows.',
    guide: 'guide-stage',
  },
  'stage-field-offsetM': {
    title: 'Left / right',
    text: 'Where the target sits sideways from the centre of the stage: − left, + right. Used only to draw the stage map in order.',
    guide: 'guide-stage',
  },
  'stage-field-prop': {
    title: 'Position',
    text: 'The prop or position you shoot this target from, such as barricade or tank trap.',
    guide: 'guide-stage',
  },
  'stage-field-notes': {
    title: 'Note',
    text: 'A short reminder printed with the target: a hold, an order note or "watch the splash".',
    guide: 'guide-stage',
  },

  // ===== Tools: true your data =====
  'true-mv-dist': {
    title: 'Truing distance (velocity)',
    text: 'The distance where you shot to true the muzzle velocity. At this range drop depends mostly on velocity, while the bullet is still well above the speed of sound.',
    typical: 'Typical: 500–800 m (550–875 yd).',
    tip: 'Use the exact lasered distance; a range error looks like a velocity error.',
    guide: 'guide-tool-truing',
  },
  'true-mv-dial': {
    title: 'Elevation that hit',
    text: 'The elevation above your zero (dialled or held) that put the group centre on the aim point at that distance. The hint below shows what the current model predicts.',
    how: ['Shoot a group of 3–5 at a known distance on a calm day.', 'Adjust until the group centre is on target and enter the total elevation.'],
    tip: 'Use the centre of a group, not a single shot, and check your zero first.',
    guide: 'guide-tool-truing',
  },
  'true-dsf-dist': {
    title: 'Truing distance (drag)',
    text: 'The far distance used to true the drag (BC), where the bullet slows towards the speed of sound. Do step 1 first, so velocity and drag errors are not mixed up.',
    typical: 'Typical: 1,000 m (1,100 yd) or more, or where velocity drops to about Mach 1.2.',
    guide: 'guide-tool-truing',
  },
  'true-dsf-dial': {
    title: 'Elevation that hit',
    text: 'The elevation above zero that centred your group at the far distance. The app adjusts the BC until the model matches it.',
    tip: 'Shoot in steady, light wind and record the atmosphere at the time in the Solver.',
    guide: 'guide-tool-truing',
  },

  // ===== Tools: hit probability =====
  'wez-shape': {
    title: 'Target type',
    text: 'The target the simulated shots are scored against. Its size sets how much error you can afford.',
    guide: 'guide-tool-wez',
  },
  'wez-dist': {
    title: 'Distance',
    text: 'The distance to the target for the simulation. Every error source grows with distance, wind most of all.',
    guide: 'guide-tool-wez',
  },
  'wez-shots': {
    title: 'Simulated shots',
    text: 'How many random shots the simulation fires. More shots give a steadier hit percentage but take a moment longer.',
    tip: 'Run again a few times: if the percentage jumps a lot, use more shots.',
    guide: 'guide-tool-wez',
  },
  'wez-mv-sd': {
    title: 'Muzzle velocity SD',
    text: 'The standard deviation of your muzzle velocity: how much it varies shot to shot. It spreads shots vertically, more at long range.',
    how: ['Get it from Tools → Chronograph with 10 or more shots.'],
    typical: 'Typical: 2–3 m/s (6–10 fps) for good handloads; 4–6 m/s (12–20 fps) for factory ammunition.',
    guide: 'guide-tool-wez',
  },
  'wez-range-sd': {
    title: 'Distance error',
    text: 'How far off your range reading usually is (1 SD). Spreads shots vertically.',
    typical: 'Typical: 1–2 m with a good laser rangefinder; 10–20 m or more when estimating.',
    guide: 'guide-tool-wez',
  },
  'wez-wind-sd': {
    title: 'Wind speed error',
    text: 'How far off your wind speed call usually is (1 SD). Usually the biggest error at long range and spreads shots sideways.',
    typical: 'Typical: 0.5–1 m/s (1–2 mph) for an experienced shooter; 1.5–2 m/s for a beginner.',
    guide: 'guide-tool-wez',
  },
  'wez-dir-sd': {
    title: 'Wind direction error',
    text: 'How far off your wind direction call usually is, in degrees (1 SD). It matters most when the wind is near head or tail, where a small angle change makes a big crosswind change.',
    typical: 'Typical: 10–20°.',
    guide: 'guide-tool-wez',
  },
  'wez-shooter-moa': {
    title: 'Rifle and shooter precision',
    text: 'How much your shots spread around the aim point on a calm day, in each direction (1 SD), from rifle, ammunition and you together.',
    how: ['Shoot several groups at 100 m from the position you\'ll use.', 'Use Tools → Group analysis: its SD is this number.'],
    typical: 'Typical: 0.15 MRAD (0.5 MOA) for a good precision rifle and shooter.',
    guide: 'guide-tool-wez',
  },

  // ===== Tools: group analysis =====
  'group-distance': {
    title: 'Distance',
    text: 'The distance the group was shot at. Needed to give group size as an angle (MRAD or MOA) so groups at different distances compare.',
    guide: 'guide-tool-group',
  },
  'group-caliber-select': {
    title: 'Bullet diameter',
    text: 'The bullet calibre. Used to find the hole centres in a photo and to measure centre to centre rather than edge to edge.',
    guide: 'guide-tool-group',
  },
  'cv-sensitivity-slider': {
    title: 'Hole-finding sensitivity',
    text: 'How eagerly Find holes marks dark spots in the photo as bullet holes. Higher finds faint holes but may mark target print; lower misses some holes.',
    how: ['Start around the middle and press Find holes.', 'Raise it if holes are missed, lower it if print is marked, then fix single shots by hand.'],
    guide: 'guide-tool-group',
  },
  'cv-scale-unit-select': {
    title: 'Scale reference',
    text: 'The length you mark on the photo to set its scale: 1 inch or 1 cm. Without a scale, sizes in a photo are only estimates.',
    how: ['Choose the length, press Set scale and click both ends of a line of that length on the target (grid squares work well).'],
    tip: 'Take the photo straight on, so the scale is the same across the target.',
    guide: 'guide-tool-group',
  },
  'shot-field-x': {
    title: 'Shot right',
    text: 'How far the shot is to the right of the aim point (negative = left), in cm or inches. Edit to correct a mark.',
    guide: 'guide-tool-group',
  },
  'shot-field-y': {
    title: 'Shot up',
    text: 'How far the shot is above the aim point (negative = below), in cm or inches. Edit to correct a mark.',
    guide: 'guide-tool-group',
  },

  // ===== Tools: chronograph =====
  'chrono-unit': {
    title: 'Readings unit',
    text: 'The unit your chronograph shows: m/s or fps. Choose it before pasting, so the average is converted correctly.',
    guide: 'guide-tool-chrono',
  },
  'chrono-input': {
    title: 'Velocities',
    text: 'Your chronograph readings, one per shot. The tool gives the average (your muzzle velocity), the standard deviation (SD) and the extreme spread (ES).',
    how: ['Shoot 10 or more rounds of one load.', 'Paste one reading per line or separated by spaces, commas or semicolons.', 'Put the average into the rifle\'s muzzle velocity.'],
    typical: 'Good SD: under 3 m/s (10 fps). Under 2 m/s (6 fps) is excellent.',
    tip: 'Five shots give an unreliable SD; use at least 10.',
    guide: 'guide-tool-chrono',
  },

  // ===== Tools: range estimation =====
  'milling-preset': {
    title: 'Known size',
    text: 'A target of standard size, so you only need to read it in the reticle. Picking one fills in its size.',
    guide: 'guide-tool-milling',
  },
  'milling-size-mm': {
    title: 'Target size',
    text: 'The real size of what you measure in the reticle, in the same direction you read it. Distance (m) = size (mm) ÷ reading (MRAD).',
    tip: 'A 10% error in the size gives a 10% error in the distance.',
    guide: 'guide-tool-milling',
  },
  'milling-ang': {
    title: 'Reticle unit',
    text: 'The unit of your reticle marks: MRAD (mil) or MOA. Pick what your reticle is, not what your turrets are.',
    guide: 'guide-tool-milling',
  },
  'milling-mils': {
    title: 'Size in reticle',
    text: 'How big the target looks in your reticle, in MRAD or MOA. Read edge to edge as precisely as you can.',
    how: ['Brace the rifle, put one edge on a reticle mark and read the other edge.', 'In an SFP scope, read at the calibrated magnification.'],
    tip: 'At 3 MRAD, a 0.1 MRAD reading error is a 3% distance error; small or far targets are hard to range this way.',
    guide: 'guide-tool-milling',
  },

  // ===== Tools: recoil =====
  'recoil-rifle-kg': {
    title: 'Rifle weight',
    text: 'The total weight that recoils: rifle, scope, mount, bipod and anything else attached. Heavier rigs recoil less.',
    typical: 'Typical: precision rifles 6–9 kg (13–20 lb); hunting rifles 3.5–4.5 kg (8–10 lb).',
    guide: 'guide-tool-recoil',
  },
  'recoil-bullet-gr': {
    title: 'Bullet weight',
    text: 'The bullet weight in grains. Filled in from the active rifle.',
    guide: 'guide-tool-recoil',
  },
  'recoil-powder-gr': {
    title: 'Powder charge',
    text: 'The powder charge in grains. The burnt gas leaving the muzzle adds a large share of the recoil.',
    how: ['Use your load data, or the maker\'s data for factory ammunition.'],
    typical: 'Typical: 6.5 Creedmoor 40–43 gr; .308 Win 42–46 gr.',
    guide: 'guide-tool-recoil',
  },
  'recoil-mv-ms': {
    title: 'Muzzle velocity',
    text: 'The muzzle velocity of the load. Filled in from the active rifle.',
    tip: 'Brakes and suppressors are not included; a brake can cut felt recoil by half.',
    guide: 'guide-tool-recoil',
  },

  // ===== Library: bullets =====
  'lib-rifle-select': {
    title: 'For rifle',
    text: 'The rifle that "Use" puts a bullet into, and whose twist and velocity the stability check uses. Until you pick a diameter yourself, the list shows bullets of this rifle\'s diameter.',
    guide: 'guide-library-bullets',
  },
  'proj-search': {
    title: 'Search',
    text: 'Find bullets by name, maker or weight. Several words narrow the list, for example "ELD 140" or "Berger 6.5".',
    guide: 'guide-library-bullets',
  },
  'caliber-filter': {
    title: 'Bullet diameter',
    text: 'Show only bullets of one diameter, with the calibres that use it (for example .264 in for 6.5 Creedmoor and 6.5 PRC).',
    tip: 'Diameter, not cartridge name, decides whether a bullet fits your barrel.',
    guide: 'guide-library-bullets',
  },
  'use-factory-mv': {
    title: 'Also set factory velocity',
    text: 'When ticked, "Use" also copies the bullet\'s factory muzzle velocity into the rifle. Leave it off if you have measured your own velocity.',
    tip: 'Factory velocities come from test barrels and are often 10–30 m/s off a real rifle.',
    guide: 'guide-library-bullets',
  },

  // ===== Library: add a bullet =====
  'cust-name': {
    title: 'Bullet name',
    text: 'The name shown in the library and on cards. Include maker, weight and model so you can find it, for example "Lapua 136 gr Scenar-L".',
    guide: 'guide-library',
  },
  'cust-mfg': {
    title: 'Maker',
    text: 'The bullet manufacturer. Optional, used for search.',
    guide: 'guide-library',
  },
  'cust-caliber': {
    title: 'Caliber',
    text: 'The cartridge or calibre name, such as 6.5 Creedmoor. Optional, shown in the diameter filter.',
    guide: 'guide-library',
  },
  'cust-weight': { ...WEIGHT, guide: 'guide-library' },
  'cust-dia': {
    title: 'Bullet diameter',
    text: 'The bullet\'s diameter, from the maker\'s data. Used for stability and to group bullets by calibre.',
    typical: 'Examples: 6.5 mm = 0.264 in (6.71 mm), .308 = 0.308 in (7.82 mm), 6 mm = 0.243 in (6.17 mm).',
    guide: 'guide-library',
  },
  'cust-len': {
    title: 'Bullet length',
    text: 'The length of the bare bullet, tip to base, not the loaded round. Longer bullets need a faster twist, so it drives the stability check.',
    how: ['Use the maker\'s data, or measure a bullet with a calliper.'],
    typical: 'Typical: 6.5 mm 140 gr about 35–36 mm (1.38–1.42 in).',
    guide: 'guide-twist',
  },
  'cust-drag-model': { ...DRAG_MODEL, guide: 'guide-library' },
  'cust-bc-g7': {
    title: 'G7 BC',
    text: 'The ballistic coefficient against the G7 shape, the best fit for boat-tail match bullets. If you only have G1, leave this as is and enter the G1; a missing one is estimated and flagged "est." in the list.',
    how: ['Use the maker\'s G7 number, or Applied Ballistics (Litz) measured data if available.'],
    typical: 'Typical: 0.25–0.35 for 6.5 mm and .308 match bullets.',
    guide: 'guide-library',
  },
  'cust-bc-g1': {
    title: 'G1 BC',
    text: 'The ballistic coefficient against the flat-base G1 shape, the number most boxes print. Optional: enter it for flat-base bullets or when no G7 is published.',
    tip: 'A G1 BC for a boat-tail bullet often varies with velocity; makers may quote the highest one.',
    guide: 'guide-library',
  },
  'cust-mv': {
    title: 'Factory velocity',
    text: 'The muzzle velocity the maker lists for factory ammunition with this bullet. Optional: used only when "Also set the factory muzzle velocity" is ticked.',
    guide: 'guide-library',
  },

  // ===== Rifle dialog =====
  'rf-name': {
    title: 'Rifle name',
    text: 'The name shown in the rifle list and on DOPE cards. Include what tells your setups apart, for example "Tikka T3x 6.5 CM, 140 ELD-M".',
    guide: 'guide-enter',
  },
  'rf-caliber': {
    title: 'Caliber',
    text: 'The cartridge the rifle is chambered in, such as 6.5 Creedmoor or .308 Win. Shown with the rifle and used to suggest bullets.',
    guide: 'guide-enter',
  },
  'rf-desc': {
    title: 'Notes',
    text: 'Anything worth remembering: barrel length, load recipe, lot number, suppressor on or off.',
    tip: 'A suppressor can change velocity and zero; note which one the data is for.',
    guide: 'guide-enter',
  },
  'rf-mv': { ...MV, guide: 'guide-chrono' },
  'rf-twist': TWIST,
  'rf-twist-dir': {
    title: 'Twist direction',
    text: 'Which way the rifling turns, seen from behind. Almost all factory barrels are right hand. It sets the direction of spin drift: right hand drifts right, left hand drifts left.',
    tip: 'If the barrel stamp doesn\'t say, it is almost certainly right hand.',
    guide: 'guide-twist',
  },
  'rf-sh': SIGHT_HEIGHT,
  'rf-zero': ZERO,
  'rf-bullet-select': {
    title: 'Bullet',
    text: 'Pick a bullet from the library to fill in name, weight, dimensions and BC, or choose "Enter my own" to type them.',
    guide: 'guide-bullet',
  },
  'rf-bullet-name': {
    title: 'Bullet name',
    text: 'The name of the bullet, shown with the rifle, for example "Hornady 140 gr ELD Match".',
    guide: 'guide-bullet',
  },
  'rf-weight': WEIGHT,
  'rf-dia': {
    title: 'Bullet diameter',
    text: 'The bullet\'s diameter, from the maker\'s data. Used with length and twist to check stability.',
    typical: 'Examples: 6.5 mm = 0.264 in (6.71 mm), .308 = 0.308 in (7.82 mm).',
    guide: 'guide-bullet',
  },
  'rf-len': {
    title: 'Bullet length',
    text: 'The length of the bare bullet, tip to base. Used for stability (Sg) and aerodynamic jump.',
    how: ['Use the maker\'s data, or measure a bullet with a calliper.'],
    typical: 'Typical: 6.5 mm 140 gr about 35–36 mm (1.38–1.42 in).',
    guide: 'guide-bullet',
  },
  'rf-drag-model': DRAG_MODEL,
  'rf-bc': BC,
  'rf-optic-model': {
    title: 'Scope model',
    text: 'Your scope\'s make and model, for reference. The settings below decide how the scope behaves in the app.',
    guide: 'guide-equipment',
  },
  'rf-click-value': {
    title: 'Click value',
    text: 'How much one turret click moves the impact. Every click count in the app comes from this, so it must match your scope.',
    how: ['Read it on the turret cap or in the manual (for example "0.1 MRAD" or "1/4 MOA").', 'Check it with a tall-target test: dial 10 MRAD and measure the shift on a target at a known distance.'],
    typical: 'Typical: 0.1 MRAD = 1 cm at 100 m; 1/4 MOA = 0.73 cm at 100 m (0.26 in at 100 yd).',
    guide: 'guide-click-value',
  },
  'rf-reticle': {
    ...RETICLE,
    text: 'The pattern in your scope, used to draw holds in the reticle view. Only reticles in the same unit as the click value are offered.',
  },
  'rf-focal-plane': FOCAL_PLANE,
  'rf-mag-min': {
    title: 'Lowest magnification',
    text: 'The scope\'s lowest power, the first number in its name (5 in 5–25×56). It sets the low end of the magnification slider.',
    guide: 'guide-equipment',
  },
  'rf-mag-max': {
    title: 'Highest magnification',
    text: 'The scope\'s highest power, the second number in its name (25 in 5–25×56). SFP scopes are usually calibrated at this power.',
    guide: 'guide-equipment',
  },
};
