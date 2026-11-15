/**
 * Ballistic Workbench - Guide view.
 *
 * Part 1 walks from planning a range day to a printed DOPE chart, one step per card, each with an
 * illustration (assets/guide-art.svg), what you need, what to do, tips, what to write down and a
 * button that opens the matching part of the app. Part 2 explains every view and tool, and a
 * glossary closes the page.
 *
 * Progress ("Mark as done" per step) is kept in localStorage under STORAGE_KEY and validated on
 * load. In-page links never change location.hash (the router only accepts view names): they call
 * showSection(id), which the app router also calls for navigate-view { view: 'guide', anchor }.
 *
 * All text below is static content written in this file (it may contain markup); nothing from
 * user input, storage or imports is put into the page, apart from step ids that are checked
 * against the list of known steps.
 */

import { icon } from './icons.js';
import { toast } from './notify.js';
import { RifleBuilderModal } from './rifleBuilderModal.js';

const STORAGE_KEY = 'ballistic_workbench_guide_v1';
const ART = './assets/guide-art.svg';

/** An illustration: decorative line art with a text alternative and a caption. */
function figure(id, label, caption, extraClass = '') {
  return `<figure class="guide-fig${extraClass ? ` ${extraClass}` : ''}">
      <svg class="guide-art" viewBox="0 0 240 160" role="img" aria-label="${label}" focusable="false"><use href="${ART}#${id}"></use></svg>
      ${caption ? `<figcaption class="lg-small lg-muted">${caption}</figcaption>` : ''}
    </figure>`;
}

const abbr = (short, long) => `<abbr title="${long}">${short}</abbr>`;
const KEY = '<span class="lg-kbd">⌘K</span> or <span class="lg-kbd">Ctrl K</span>';

/* ---------------------------------------------------------------------------------------------
 * Part 1: from range day to DOPE chart
 * Actions: { label, icon, view, tool?, panel?, format?, tab?, anchor?, rifle? }
 * ------------------------------------------------------------------------------------------- */
const STEPS = [
  {
    id: 'guide-plan',
    short: 'Plan',
    icon: 'calendar',
    title: 'Plan the range day',
    why: 'A DOPE chart is only as good as the data behind it. A plan keeps the day focused: one rifle, one ammunition lot, measured distances and time to write everything down.',
    art: ['plan', 'A checklist next to a range with flags at four measured distances and a sun', 'Pick measured distances and a calm day, and write the plan down.'],
    needs: [
      ['flag', 'A range with measured distances, ideally from 100 m to as far as you want to shoot (yards work the same way)'],
      ['ammo', 'Enough ammunition from <strong>one lot</strong>: about 60 to 100 rounds for zero, chronograph and long distances'],
      ['sun', 'A weather forecast: a calm, settled day is best'],
      ['notebook', 'A notebook, or this app on your phone'],
    ],
    steps: [
      'Decide what the chart is for and how far you will really shoot: hunting is often 100–400 m, target and match shooting 300–1,000 m or more.',
      'Choose distances to shoot: your zero (100 m or 100 yd) plus at least three longer ones, for example 300, 500, 700 and 1,000 m. Check each with a laser rangefinder; signs and berms are often off.',
      'Look at the Solver’s <strong>Supersonic to</strong> value for your rifle. Distances past it are less predictable, so plan the longest one inside it unless you want to test that zone.',
      'Buy or load all the ammunition for the day, and ideally for the season, from one lot. Write the lot number down.',
      'Plan the order: confirm zero, run the chronograph string, then shoot the long distances while conditions are calm. Mornings are often calmer than afternoons.',
      'Shoot with the setup you will use later: the same suppressor or brake, the same bipod and position. A suppressor changes both point of impact and velocity.',
    ],
    tips: ['If you clean the barrel before the trip, fire a few fouling shots before you check zero. Many barrels shoot differently clean.'],
    mistakes: ['Mixing ammunition lots or brands in one session. Velocity can differ by 5–15 m/s (15–50 fps) between lots, and the chart only fits the lot you used.'],
    record: ['Date and place', 'Rifle setup (suppressor, brake, barrel length)', 'Ammunition: maker, bullet, lot number', 'The distances you planned and how you checked them'],
    actions: [{ label: 'See how far it stays supersonic', icon: 'trajectory', view: 'workspace', panel: 'chart' }],
  },
  {
    id: 'guide-equipment',
    short: 'Equipment',
    icon: 'box',
    title: 'Gather the equipment',
    why: 'Most of the numbers in a DOPE chart come from a measurement. Bring the tools that make those measurements, and charge them the night before.',
    art: ['equipment', 'A chronograph, a laser rangefinder, a weather meter, calipers, a spirit level and a notebook', 'The measuring kit: chronograph, rangefinder, weather meter, calipers, level and notebook.'],
    needs: [
      ['chrono', 'A chronograph: a Doppler radar unit (for example Garmin Xero C1 Pro or LabRadar) or an optical one'],
      ['rangefinder', 'A laser rangefinder, to confirm every distance'],
      ['weather', 'A weather meter that shows temperature, <strong>station pressure</strong>, humidity and wind (for example a Kestrel)'],
      ['calipers', 'Calipers and a tape measure, for sight height and the tall-target test'],
      ['level', 'A spirit level and a plumb line (a weighted string works)'],
      ['target', 'Grid targets with 1 MOA or 0.1 MRAD squares, and a tall sheet (at least 1 m or 40 in) for the click test'],
      ['rifle', 'A solid rest: bipod and rear bag, plus a spotting scope or a partner to spot hits'],
      ['notebook', 'A notebook and pencil, or this app installed on your phone'],
    ],
    steps: [
      'Charge or replace the batteries in the chronograph, rangefinder and weather meter.',
      'Print or buy grid targets in the unit your scope uses: 0.1 MRAD squares (1 cm at 100 m) or 1 MOA squares (1.047 in at 100 yd).',
      'Set the weather meter to show station pressure (the actual pressure where you stand), not barometric pressure corrected to sea level.',
      'Install this app on your phone so it works with no signal at the range (see <a href="#guide" data-anchor="guide-offline">Offline and install as an app</a>).',
      'Pack hearing and eye protection, a torque wrench for scope rings, and tape for marking targets.',
    ],
    tips: ['Weather apps on phones usually give sea-level pressure. Use station pressure from a weather meter for the Solver’s <strong>Station pressure</strong> field.'],
    mistakes: ['Trusting the distance on a range sign. A 10 m error at 700 m changes the elevation you record by about one click.'],
    record: ['Which chronograph and weather meter you used, so later sessions can be compared'],
    actions: [{ label: 'Install as an app', icon: 'download', anchor: 'guide-offline' }],
  },
  {
    id: 'guide-measure',
    short: 'Measure rifle and scope',
    icon: 'ruler',
    title: 'Measure the rifle and scope',
    why: 'Four things about the rifle itself go into the model: sight height, barrel twist, the real value of a scope click and a level reticle. Measure them once at home or at the bench.',
    art: null,
    needs: [
      ['calipers', 'Calipers (or a steel rule)'],
      ['twist', 'A cleaning rod with a jag, a tight patch and a strip of tape'],
      ['level', 'A spirit level, a plumb line and a vice or bags to hold the rifle'],
      ['target', 'A tall target sheet and an exactly measured 100 m or 100 yd'],
    ],
    subs: [
      {
        id: 'guide-sight-height',
        title: 'Sight height',
        art: ['sight-height', 'Rear view of the scope tube above the bolt body. H is centre to centre; T is the outside measurement; G is the gap.', 'H, the sight height, is centre of bore to centre of scope. Measure T or G and work H out.'],
        why: 'The height of the scope’s centre line above the bore’s centre line. It matters most at short range and for the zero, so get it within 1–2 mm (0.05 in).',
        steps: [
          'Make sure the rifle is unloaded. Put it level on the bench with the bolt closed.',
          'Look up the scope’s main tube diameter: usually 30, 34 or 35 mm, or 1 in (25.4 mm). It is in the scope manual. Call it <em>scope Ø</em>.',
          'Measure the bolt body diameter with calipers (often about 17.8 mm or 0.700 in). The bolt body sits on the bore line. Call it <em>bolt Ø</em>.',
          'Measure <strong>T</strong>: from the top of the scope tube to the bottom of the bolt body, outside to outside, close to the rear ring.',
          'Work it out: <strong>sight height H = T − scope Ø ÷ 2 − bolt Ø ÷ 2</strong>.',
          'Or measure <strong>G</strong>, the gap between the bottom of the tube and the top of the bolt body: <strong>H = G + scope Ø ÷ 2 + bolt Ø ÷ 2</strong>.',
        ],
        example: 'Example: 34 mm tube, 17.8 mm bolt body, T = 75 mm. H = 75 − 17 − 8.9 = 49.1 mm, so enter 4.9 cm (1.93 in).',
        tip: 'Measure on the main tube near the turrets or rear ring, never on the objective bell or the turret caps.',
      },
      {
        id: 'guide-twist',
        title: 'Barrel twist',
        art: ['twist', 'A cleaning rod with a tape flag in the bore. The rod turns one full turn between two marks.', 'Push the rod until the flag turns once. The distance between the marks is the twist.'],
        why: 'The twist rate, for example 1 in 8 in, decides whether a bullet is stable and how much it drifts from spin. It is often stamped on the barrel; measure it if you are not sure.',
        steps: [
          'Make sure the rifle is unloaded and remove the bolt.',
          'Push a cleaning rod with a tight-fitting patch a few centimetres into the bore from the breech.',
          'Stick a tape flag on the rod near the handle and mark the rod where it enters the action.',
          'Push slowly and let the rod turn by itself until the flag has made one full turn.',
          'Mark the rod again at the same place. The distance between the marks is the twist: 8 in means 1 in 8 in.',
          'Note the direction: if the flag turns clockwise as the rod goes away from you, the twist is right hand (most barrels).',
        ],
        tip: 'Round to the nearest common value (7, 7.5, 8, 9, 10 in…). The Library’s <strong>Stability in this rifle</strong> card uses it to check your bullet.',
      },
      {
        id: 'guide-click-value',
        title: 'Scope click value (tall-target test)',
        art: ['click-value', 'A tall target with a plumb vertical line. One group sits at the bottom and one at the top after dialling up.', 'Dial a large known amount and measure how far the group really moved.'],
        why: 'Turrets do not always move exactly what they say. A 2% error is 0.2 MRAD when you dial 10 MRAD: about 20 cm (8 in) at 1,000 m.',
        steps: [
          'Measure exactly 100 m (or 100 yd) to the target with a tape. A 1 m error is already a 1% error.',
          'Hang a target at least 1 m (40 in) tall. Draw a vertical line and check it with a level or plumb line.',
          'Level the rifle on a solid rest and fire a group at an aim point at the bottom of the line.',
          'Dial up a large amount, for example 10 MRAD or 30 MOA. Keep the same aim point and fire a second group.',
          'Measure between the group centres. Expected: 10 MRAD at 100 m = 100 cm; 30 MOA at 100 yd = 31.4 in.',
          'Your correction factor is measured ÷ expected. Within about 1% is normal. If the top group is also left or right of the line, the reticle or the turret is not plumb (see Level the reticle).',
        ],
        tip: 'A quicker box test checks that the turret returns: shoot, dial 2 up, shoot, 2 right, shoot, 2 down, shoot, 2 left, shoot. The last shot should land on the first.',
        mistake: 'This app assumes exact clicks. If your scope is off by more than 1–2%, contact the maker rather than adjusting other inputs to hide it.',
      },
      {
        id: 'guide-cant',
        title: 'Level the reticle (cant)',
        art: ['cant', 'Rear view of the scope with the vertical reticle line on a plumb line, a bubble level on the side and a level on the action', 'Line the reticle up with a plumb line while the action is level, then set a bubble level.'],
        why: 'If the reticle is tilted, dialled elevation also moves shots sideways. With 1° of tilt and 10 MRAD dialled, shots move about 0.17 MRAD: 17 cm (7 in) at 1,000 m.',
        steps: [
          'Hold the rifle in a vice or on bags and put a spirit level on a flat part of the action or scope rail. Level it.',
          'Hang a plumb line 25–100 m away, or use a vertical line you have checked.',
          'Loosen the top ring screws a little and turn the scope until the vertical reticle line sits on the plumb line, while the action stays level.',
          'Tighten the ring screws evenly, crosswise, to the ring maker’s torque.',
          'Fit a bubble level to the scope and set it so the bubble is centred when the reticle is plumb. Check it before every long shot.',
        ],
        tip: 'The Solver’s <strong>Rifle cant</strong> field under Shot angle and cant shows how much a tilted rifle moves the shot.',
      },
    ],
    record: ['Sight height, in cm or in', 'Twist rate and direction', 'Click correction factor from the tall-target test', 'Ring torque and that the reticle is plumb'],
    actions: [
      { label: 'New rifle', icon: 'plus', rifle: true },
      { label: 'Check bullet stability', icon: 'bullet', view: 'libraryManager', tab: 'add' },
    ],
  },
  {
    id: 'guide-bullet',
    short: 'Bullet data',
    icon: 'bullet',
    title: 'Get the bullet data',
    why: `After muzzle velocity, the ballistic coefficient (${abbr('BC', 'Ballistic coefficient')}) does most to shape the trajectory. Use the right number for the right drag model.`,
    art: ['bullet', 'A bullet in profile with its boat-tail, ogive, diameter and length marked', 'Weight, diameter, length and a G7 BC describe the bullet.'],
    needs: [
      ['ammo', 'The exact bullet: maker, model and weight (on the box or the maker’s website)'],
      ['file', 'Its BC: a G7 value for boat-tail long-range bullets, G1 for flat-base bullets'],
      ['calipers', 'Its length and diameter, for the stability check'],
    ],
    steps: [
      'Find the exact bullet, for example “140 gr ELD Match”. Factory ammunition lists it on the box.',
      'Open Library → <strong>Bullets</strong>, choose your rifle under <strong>For rifle</strong> and search. Press <strong>Use</strong> to put the bullet in the rifle; G1 and G7 values come with it.',
      'Not in the list? Use <strong>Add a bullet</strong>: name, weight, diameter, length, drag model and G7 BC (G1 too if you have it).',
      'Prefer measured G7 values, for example from Applied Ballistics (Bryan Litz) or makers that publish G7 numbers. Many G1 values on boxes are averages over a velocity band and run optimistic at long range.',
      'Check the <strong>Stability in this rifle</strong> card: an Sg of 1.5 or more is stable. From 1.0 to 1.5 the BC may drop; below 1.0 the bullet may tumble.',
    ],
    tips: ['Don’t change the BC to make the model fit your drops until you have trued the muzzle velocity first (step 9).'],
    mistakes: ['Entering a G1 BC with the drag model set to G7, or the other way round. The label next to the BC field shows which one the rifle uses.'],
    record: ['Bullet maker, model and weight', 'BC and drag model (G7 or G1)', 'Length and diameter'],
    actions: [{ label: 'Find a bullet', icon: 'search', view: 'libraryManager', tab: 'bullets' }],
  },
  {
    id: 'guide-zero',
    short: 'Zero',
    icon: 'crosshair',
    title: 'Zero at 100 m or 100 yd',
    why: 'The zero is the distance where the bullet hits the point of aim with the turret at 0. Every number on the DOPE chart is counted from it.',
    art: ['zero', 'A grid target with a group low and right of the aim point, an arrow to the centre, and a turret set to 0', 'Correct from the centre of a group, then set the turret to 0.'],
    needs: [
      ['target', 'A grid target at exactly 100 m (MRAD scopes) or 100 yd (often MOA scopes)'],
      ['ammo', '10–15 rounds from your lot'],
      ['rifle', 'A solid rest'],
    ],
    steps: [
      'New scope? Bore-sight first: remove the bolt, look through the bore at the target and move the reticle onto the same spot.',
      'Fire a 3–5 shot group at the centre of the aim point with the turret at 0.',
      'Measure how far the group centre is from the aim point and dial the difference: at 100 m one 0.1 MRAD click is 1 cm; at 100 yd one 1/4 MOA click is about 0.26 in. Group low means dial up; group left means dial right.',
      'Fire a 5-shot confirmation group. Repeat until the group centre sits on the aim point.',
      'Set the turret cap to 0 without moving the adjustment (loosen the cap screws, turn the cap, tighten). Set the zero stop if the scope has one.',
      'Enter the distance you used as <strong>Zero distance</strong> in the rifle.',
    ],
    tips: ['The Group analysis tool tells you what to dial: mark the shots on a photo of the target and read the correction.'],
    mistakes: ['Chasing single shots. Correct from the centre of a group, never from the last hole.'],
    record: ['Zero distance', 'Temperature and pressure on the day', 'Group size'],
    actions: [{ label: 'Analyse a group', icon: 'group', view: 'tools', tool: 'group' }],
  },
  {
    id: 'guide-chrono',
    short: 'Chronograph',
    icon: 'chrono',
    title: 'Measure muzzle velocity with a chronograph',
    why: `Muzzle velocity (${abbr('MV', 'Muzzle velocity')}) is the most important input. The speed on the box is measured in a test barrel and can be far from yours.`,
    art: ['chrono', 'A Doppler chronograph beside and a little behind the muzzle, its beam pointing downrange, and a bar chart of readings', 'A Doppler unit sits beside the barrel, just behind the muzzle, aimed downrange.'],
    needs: [
      ['chrono', 'A chronograph and its manual'],
      ['ammo', '10–20 rounds from your lot'],
      ['thermometer', 'A thermometer for air and, if you can, the ammunition'],
    ],
    steps: [
      'Set up the chronograph as its manual says. A Doppler radar sits beside the barrel and points downrange: Garmin places the muzzle about 13–38 cm (5–15 in) in front of the Xero and to its side; LabRadar users put the unit beside the muzzle, about 15–30 cm (6–12 in) out, clear of any brake blast.',
      'An optical chronograph goes 3–5 m (10–15 ft) in front of the muzzle, so the blast doesn’t disturb it. It reads a little below true muzzle velocity, roughly 1 m/s per metre (1 fps per foot) of distance.',
      'Keep the ammunition in the shade. A round left in a hot chamber shoots faster.',
      'Fire at least 10 shots, 20 if you can, at your normal pace. An SD from 5 shots can be far off.',
      'Paste every reading into Tools → <strong>Chronograph</strong>. Read the average, SD and ES.',
      'Press <strong>Use … for</strong> your rifle to make the average the rifle’s muzzle velocity.',
    ],
    tips: [
      `How consistent is the load? An ${abbr('SD', 'Standard deviation')} under 3 m/s (10 fps) is very consistent; 3–5 m/s (10–16 fps) is usable; above that, expect vertical spread at long range.`,
      'Some powders change velocity with temperature. Measure again when the season changes (step 11).',
    ],
    mistakes: ['Using the velocity printed on the box, or a velocity from a different lot or barrel length.'],
    record: ['Average, SD and ES, and the number of shots', 'Air temperature and ammunition temperature', 'Chronograph type and where it stood'],
    actions: [{ label: 'Open the chronograph tool', icon: 'chrono', view: 'tools', tool: 'chrono' }],
  },
  {
    id: 'guide-enter',
    short: 'Enter in the app',
    icon: 'edit',
    title: 'Enter everything in the app',
    why: 'The DOPE chart is calculated from these numbers, so put them all into one rifle and check each one.',
    art: ['enter', 'The rifle dialog with two columns of fields and a save button', 'One rifle holds the rifle, bullet and scope data.'],
    needs: [['notebook', 'Your notes from steps 3 to 6']],
    steps: [
      'Open Library → <strong>New rifle</strong>, or press the + next to <strong>Rifle</strong> in the Solver.',
      '<strong>Rifle</strong>: Name, Caliber, Muzzle velocity (your chronograph average), Barrel twist, Twist direction, Sight height and Zero distance.',
      '<strong>Bullet</strong>: pick it from the list, or choose “Enter my own…” and fill in weight, diameter, length, drag model and BC.',
      '<strong>Scope</strong>: Scope model, Click value (0.1 MRAD, 0.05 MRAD, 1/4 MOA or 1/8 MOA), Reticle, Focal plane and the magnification range.',
      'Press <strong>Save rifle</strong>. It becomes the rifle in use in the Solver.',
      'In the Solver, open <strong>Atmosphere</strong> and enter the temperature, station pressure and humidity of the day, or pick a preset.',
      'Under <strong>Load and rifle</strong>, choose the <strong>Solver model</strong>: point mass with G7 drag suits most rifles; modified point mass adds spin drift, aerodynamic jump and Coriolis.',
    ],
    tips: ['Switch between metric and imperial in the sidebar at any time. Your data is stored in one unit system, so switching changes nothing.'],
    mistakes: ['Leaving the default sight height or zero. They are only examples.'],
    record: ['Export a backup once the rifle is set up: Library → Export'],
    actions: [
      { label: 'New rifle', icon: 'plus', rifle: true },
      { label: 'Open the Solver', icon: 'crosshair', view: 'workspace' },
    ],
  },
  {
    id: 'guide-shoot',
    short: 'Shoot known distances',
    icon: 'target',
    title: 'Shoot at known distances',
    why: 'The model predicts; the range tells you what really happens. Write down the elevation that actually centred a group at each distance.',
    art: ['shoot', 'A shooter on the left and steel plates at four distances, with the bullet’s arc to each', 'Work out from the closest distance and record what centred each group.'],
    needs: [
      ['target', 'Targets at measured distances, for example 300, 500, 700 and 1,000 m'],
      ['weather', 'The weather meter, to update conditions as the day goes on'],
      ['eye', 'A spotter or spotting scope'],
    ],
    steps: [
      'Measure the conditions first and enter them in the Solver’s Atmosphere, so its predictions are for today.',
      'Start at the closest distance. Dial the Solver’s elevation and fire 3 shots, 5 if you can.',
      'Correct from the group centre until a group is centred. Hold for wind rather than dialling it, so the turret only shows elevation.',
      'Write down the distance and the elevation that centred the group, for example “500 m: 3.4 MRAD”.',
      'Move out: 500, 700, then 1,000 m or more if your range allows.',
      'Shoot the longest distances in the calmest part of the day, and leave out groups spoiled by a gust.',
    ],
    tips: ['Wind mostly moves shots sideways, but a crosswind also lifts or drops the bullet a little (aerodynamic jump). In steady or no wind, your vertical data is cleanest.'],
    mistakes: ['Writing down where you aimed instead of where the group centred, or the first-shot elevation before you corrected.'],
    record: ['Distance, elevation that centred the group, and group size', 'Wind you held', 'Temperature, pressure and time'],
    actions: [{ label: 'Open reticle and turret', icon: 'reticle', view: 'workspace', panel: 'reticle' }],
  },
  {
    id: 'guide-true',
    short: 'True the model',
    icon: 'turret',
    title: 'True the model to your drops',
    why: 'If your recorded elevations differ from the Solver’s, adjust the model: first the muzzle velocity at a middle distance, then the drag at a long one.',
    art: ['true', 'A chart of elevation against distance: the model as a dashed line, measured points, a muzzle velocity zone in the middle and a drag zone at long range', 'True muzzle velocity in the middle zone first, then drag at long range.'],
    needs: [['notebook', 'Your recorded distances and elevations from step 8']],
    steps: [
      'Compare your notes with the Solver’s <strong>Range table</strong> at the same distances. A difference under one click is normal scatter.',
      'Open Tools → <strong>True your data</strong>. In <strong>Step 1: muzzle velocity</strong>, enter a distance between 500 and 800 m (550–875 yd), where the bullet is still well above the speed of sound, and the <strong>Elevation that hit</strong>.',
      'Press <strong>Calculate muzzle velocity</strong>, check the result, then <strong>Apply to</strong> your rifle.',
      'In <strong>Step 2: drag at long range</strong>, enter a distance of 1,000 m or more, where the bullet slows towards the speed of sound, and the elevation that hit. Press <strong>Calculate drag</strong> and then <strong>Apply BC to</strong> your rifle.',
      'Check the Range table against your other distances. If it is still off by more than a click, re-check sight height, zero distance, click value and the atmosphere before truing again.',
    ],
    tips: ['Always true velocity first. Changing the BC to fit middle distances hides a wrong velocity and makes long range worse.'],
    mistakes: ['Truing on data from one shot or a gusty day. Use centred groups.'],
    record: ['Trued muzzle velocity and BC', 'The distances and elevations you trued with'],
    actions: [{ label: 'Open True your data', icon: 'turret', view: 'tools', tool: 'truing' }],
  },
  {
    id: 'guide-dope',
    short: 'Build the DOPE chart',
    icon: 'card',
    title: 'Build and print the DOPE chart',
    why: `${abbr('DOPE', 'Data On Previous Engagement')} is your elevation and wind for each distance. Now that the model matches your rifle, print it where you can see it.`,
    art: ['dope', 'A printed table, a round scope cap insert with a dotted cut line, and a 50 mm scale bar', 'Print at 100% and check the 50 mm scale bar with a ruler.'],
    needs: [
      ['print', 'A printer, paper (or label paper) and a ruler'],
      ['scissors', 'Scissors and clear tape, or a laminator'],
    ],
    steps: [
      'Open the Solver’s <strong>Range table</strong>. Choose <strong>Every</strong> 25, 50 or 100 m and the <strong>Columns</strong> you want.',
      'Tick the distances you want on the card in the first column. The tick in the header selects all.',
      'Press <strong>Make DOPE card</strong>. The DOPE cards view opens with those distances.',
      'Pick a format: <strong>Scope cap</strong>, <strong>Wrist card</strong>, <strong>Stock tape</strong>, <strong>Turret tape</strong>, <strong>Stage card</strong> or <strong>Full page</strong>. Set its size if it asks (scope cap diameter, turret circumference and clicks per turn).',
      'Press <strong>Print</strong>. In the print dialog choose 100% scale and turn off “fit to page”.',
      'Measure the 50 mm scale bar on the paper. If it is not 50 mm, fix the print settings and print again.',
      'Cut along the marked line, then laminate the card or cover it with clear tape.',
    ],
    tips: ['Print a Full page sheet as your master copy and keep a small card on the rifle.'],
    mistakes: ['Printing with “fit to page” on: the scope cap insert and turret tape come out the wrong size.'],
    record: ['Which conditions the card is for (the Data from block shows rifle, conditions and units)'],
    actions: [
      { label: 'Open the Range table', icon: 'list', view: 'workspace', panel: 'table' },
      { label: 'Open DOPE cards', icon: 'card', view: 'dopeStudio', format: 'scope-cap' },
    ],
  },
  {
    id: 'guide-maintain',
    short: 'Verify and maintain',
    icon: 'refresh',
    title: 'Verify and keep it up to date',
    why: 'A DOPE chart drifts out of date as seasons, ammunition lots and the barrel change. A few checks keep it honest.',
    art: ['maintain', 'A calendar, refresh arrows, a thermometer and a file being saved', 'Re-check with the seasons and keep a backup.'],
    needs: [['notebook', 'Your notes from every session']],
    steps: [
      'Confirm zero after travel, a knock, or any change to the scope or mounts.',
      'Chronograph again with a new ammunition lot, when the temperature differs a lot from the day you trued (summer and winter), and every few hundred rounds as the barrel wears.',
      'Make separate cards for very different conditions: a hot summer day and a cold winter day, or low and high altitude. Thinner air means less drop at long range.',
      'Shoot a few known distances each season. If they no longer match, true again (step 9).',
      'Keep your notes: every session’s distances, elevations and conditions.',
      'Save a backup: Library → <strong>Export</strong> writes your rifles, bullets and settings to a file; <strong>Import…</strong> loads it on another device.',
    ],
    tips: ['Write the date and temperature on each printed card so you know when it was made.'],
    mistakes: ['Keeping the only copy of your data in one browser. Clearing site data deletes it.'],
    record: ['Date of each check and what changed'],
    actions: [{ label: 'Export a backup', icon: 'download', view: 'libraryManager', tab: 'rifles' }],
  },
];

/* ---------------------------------------------------------------------------------------------
 * Part 2: how each part works
 * ------------------------------------------------------------------------------------------- */
const TOPICS = [
  {
    id: 'guide-solver',
    group: 'Solver',
    icon: 'crosshair',
    title: 'Solver: inputs and firing solution',
    lead: 'The Solver is the main screen: set up on the left, the answer on the right.',
    art: ['solver', 'The Solver layout: setup sections on the left, the firing solution card and result tabs on the right', ''],
    body: `<ol class="guide-list">
        <li>Pick the <strong>Rifle</strong> at the top. The + button adds a new one.</li>
        <li>Open the sections you need. Each shows a short summary when closed:
          <ul>
            <li><strong>Target</strong>: Distance (slider or number), target type and its size.</li>
            <li><strong>Load and rifle</strong>: Muzzle velocity, Bullet weight, Drag model, BC, Solver model, Sight height, Zero distance and Twist rate.</li>
            <li><strong>Atmosphere</strong>: a Preset, or Temperature, Station pressure, Altitude and Humidity. The line underneath shows density altitude and air density.</li>
            <li><strong>Wind</strong>: Speed and the direction it comes <em>from</em> in degrees, where 90 is from the right (3 o’clock). The wind clock shows it.</li>
            <li><strong>Shot angle and cant</strong>: Inclination (+ uphill) and Rifle cant (+ right).</li>
          </ul>
        </li>
        <li>Read the <strong>Firing solution</strong>: Elevation and Windage in MRAD or MOA, with the clicks and direction to dial; Velocity with a Mach badge (supersonic, transonic or subsonic), Time of flight, Energy, and <strong>Supersonic to</strong>.</li>
      </ol>`,
    tip: 'Every change updates the answer straight away. Invalid numbers are marked under the field and not used.',
    actions: [{ label: 'Open the Solver', icon: 'crosshair', view: 'workspace' }],
  },
  {
    id: 'guide-solver-reticle',
    group: 'Solver',
    icon: 'reticle',
    title: 'Reticle and turret',
    lead: 'See the hold in your reticle and the turret as you would dial it.',
    art: ['reticle', 'A reticle with a hold point below the centre, and an elevation turret', ''],
    body: `<ul class="guide-list">
        <li>Choose the reticle and the focal plane. In a <strong>first focal plane</strong> (${abbr('FFP', 'First focal plane')}) scope the marks are right at every magnification. In a <strong>second focal plane</strong> (${abbr('SFP', 'Second focal plane')}) scope they are only right at one magnification, usually the highest; move the <strong>Magnification</strong> slider to see the effect.</li>
        <li><strong>Illuminated</strong> lights the centre of the reticle.</li>
        <li>The turret has two modes. <strong>Follow solution</strong> turns it to the elevation for the target. <strong>Manual</strong> lets you dial yourself: −1 and +1 move one whole MRAD or MOA, −1c and +1c one click, 0 returns to zero, and <strong>Dial</strong> jumps to the solution. The reticle shows where the shot lands with what you have dialled.</li>
      </ul>`,
    actions: [{ label: 'Open reticle and turret', icon: 'reticle', view: 'workspace', panel: 'reticle' }],
  },
  {
    id: 'guide-solver-chart',
    group: 'Solver',
    icon: 'trajectory',
    title: 'Trajectory chart',
    lead: 'The whole flight on one chart.',
    art: ['chart', 'A chart with a falling trajectory line and a dashed reference line', ''],
    body: `<ul class="guide-list">
        <li>Switch between <strong>Drop</strong>, <strong>Velocity</strong> (with the speed of sound as a dashed line), <strong>Wind drift</strong>, <strong>Time of flight</strong> and <strong>Energy</strong>.</li>
        <li>Hover, or focus the chart and use the arrow keys, to read the value at each distance.</li>
        <li>Where the velocity line meets the speed of sound the bullet goes transonic; past that point predictions are less reliable.</li>
      </ul>`,
    actions: [{ label: 'Open the chart', icon: 'trajectory', view: 'workspace', panel: 'chart' }],
  },
  {
    id: 'guide-solver-table',
    group: 'Solver',
    icon: 'list',
    title: 'Range table and CSV',
    lead: 'Your DOPE as a table, and the starting point for printed cards.',
    art: ['table', 'A table with ticked rows and an arrow to a card', ''],
    body: `<ul class="guide-list">
        <li><strong>Every</strong> sets the step between rows: 10, 25, 50 or 100.</li>
        <li><strong>Columns</strong> chooses what to show: Drop, Elevation, Elevation clicks, Wind drift, Windage, Windage clicks, Velocity, Mach, Energy, Time of flight and Danger space.</li>
        <li>The <em>Zero</em> and <em>Target</em> tags mark those rows.</li>
        <li>The ticks in the first column choose the distances for a card; every 100 m is ticked at first. <strong>Make DOPE card</strong> opens DOPE cards with them.</li>
        <li><strong>CSV</strong> downloads the table for a spreadsheet.</li>
      </ul>`,
    actions: [{ label: 'Open the Range table', icon: 'list', view: 'workspace', panel: 'table' }],
  },
  {
    id: 'guide-compare',
    group: 'Analyse',
    icon: 'compare',
    title: 'Compare models',
    lead: 'How G1, G7 and modified point mass differ for your rifle and today’s conditions.',
    art: ['compare', 'Three trajectory lines from different models drifting apart at long range', ''],
    body: `<ul class="guide-list">
        <li>The chart shows <strong>Elevation difference</strong> or <strong>Drift difference</strong> from G7, or the plain <strong>Elevation</strong> of each model. Turn models on and off under <strong>Models</strong>.</li>
        <li>Each model is zeroed on its own, so the lines meet at the zero distance.</li>
        <li><strong>About the models</strong> explains each one; <strong>Use in Solver</strong> makes it the Solver model.</li>
        <li>The <strong>Difference from G7</strong> table lists the numbers by range. Positive means more elevation, or more drift to the right, than G7.</li>
      </ul>`,
    tip: 'If G1 and G7 disagree a lot at your distances, the drag model matters for your bullet: true at long range (step 9).',
    actions: [{ label: 'Open Compare models', icon: 'compare', view: 'solverLab' }],
  },
  {
    id: 'guide-dope-cards',
    group: 'DOPE cards',
    icon: 'card',
    title: 'DOPE cards: the six formats',
    lead: 'Printable range cards from the Solver’s data, in six sizes.',
    art: ['formats', 'Six card shapes: a round scope cap insert, a wrist card, a full page, a stock strip, a turret tape and a stage card', ''],
    body: `<dl class="guide-defs">
        <div><dt>${icon('scope-cap')} Scope cap</dt><dd>A round insert for a clear flip-up scope cap: distance on the outer ring, elevation in the middle, clicks on the inner ring. Set the cap or its diameter.</dd></div>
        <div><dt>${icon('watch')} Wrist card</dt><dd>A 3 × 5 in table for a wrist sleeve: elevation, clicks, wind holds for three wind speeds and bullet speed.</dd></div>
        <div><dt>${icon('tape')} Stock tape</dt><dd>A 180 × 32 mm strip for the side of the stock, one column per distance.</dd></div>
        <div><dt>${icon('turret')} Turret tape</dt><dd>A strip around the elevation turret with each distance at the click it needs. Set the turret, its circumference, height and clicks per turn.</dd></div>
        <div><dt>${icon('stage')} Stage card</dt><dd>A plan for one match stage (see below).</dd></div>
        <div><dt>${icon('file')} Full page</dt><dd>The full table on A4 or Letter with drop, elevation, wind, speed and energy, reticle holds and space for notes.</dd></div>
      </dl>
      <p>The <strong>Distances</strong> block shows where the distances came from; <strong>Use the default distances</strong> resets them. <strong>Data from</strong> shows the rifle, conditions and units. Change them in the Solver and the sidebar. <strong>Copy as text</strong> copies the table; <strong>Save SVG</strong> or <strong>Save PNG</strong> saves an image.</p>`,
    actions: [
      { label: 'Scope cap', icon: 'scope-cap', view: 'dopeStudio', format: 'scope-cap' },
      { label: 'Wrist card', icon: 'watch', view: 'dopeStudio', format: 'wrist-coach' },
      { label: 'Stock tape', icon: 'tape', view: 'dopeStudio', format: 'stock-tape' },
      { label: 'Turret tape', icon: 'turret', view: 'dopeStudio', format: 'turret-tape' },
      { label: 'Full page', icon: 'file', view: 'dopeStudio', format: 'a4-sheet' },
    ],
  },
  {
    id: 'guide-stage',
    group: 'DOPE cards',
    icon: 'stage',
    title: 'Stage card builder',
    lead: 'Plan a match stage: targets in order with holds for lull, base and gust wind.',
    art: ['stage', 'A stage card with four numbered targets next to a barricade and two targets', ''],
    body: `<ol class="guide-list">
        <li>Choose <strong>Start from a preset</strong>, or set the <strong>Stage name</strong> and <strong>Time limit</strong>.</li>
        <li>Add the <strong>Positions, in order</strong> with the buttons (Tank trap, Barricade, Rooftop…).</li>
        <li>Set the <strong>Wind from</strong> direction and the wind speed for lull, base and gust.</li>
        <li>Under <strong>Targets, in shooting order</strong>, add targets with distance, size and rounds. Move, duplicate or remove them with the buttons on each row.</li>
        <li>Choose the card <strong>Size</strong> (3 × 5 in portrait, 5 × 3 in landscape or Full page) and <strong>Colour</strong>, then print.</li>
      </ol>`,
    actions: [{ label: 'Open the stage card', icon: 'stage', view: 'dopeStudio', format: 'prs-stage' }],
  },
  {
    id: 'guide-printing',
    group: 'DOPE cards',
    icon: 'print',
    title: 'Printing at the right size',
    lead: 'Cards print at their true size, so the printer settings matter.',
    art: ['printing', 'A printer with a sheet, a cut line with scissors and a 50 mm scale bar', ''],
    body: `<ol class="guide-list">
        <li>Press <strong>Print</strong>. Only the card is printed; the app around it is hidden.</li>
        <li>Set the scale to 100% and turn off “fit to page” or “shrink to fit”.</li>
        <li>Measure the <strong>50 mm scale bar</strong>. If it is not 50 mm, the card is the wrong size.</li>
        <li>Cut on the marked line: the dotted circle for a scope cap, the solid border for a wrist card, the dashed border for stock tape. Wrap turret tape with ZERO at your zero mark.</li>
      </ol>`,
    actions: [{ label: 'Open DOPE cards', icon: 'print', view: 'dopeStudio', format: 'scope-cap' }],
  },
  {
    id: 'guide-tool-truing',
    group: 'Tools',
    icon: 'turret',
    title: 'True your data',
    lead: 'Match the model to your real drops in two steps.',
    art: ['true', 'The model line against measured points, with a muzzle velocity zone and a drag zone', ''],
    body: `<ol class="guide-list">
        <li><strong>Step 1: muzzle velocity</strong>: enter a distance of 500–800 m and the <strong>Elevation that hit</strong> (what you dialled or held above zero). The hint shows what the model predicts. <strong>Calculate muzzle velocity</strong>, then apply it.</li>
        <li><strong>Step 2: drag at long range</strong>: at 1,000 m or more, the same again. <strong>Calculate drag</strong> gives a new BC to apply.</li>
      </ol>
      <p>A <em>Check</em> badge means the change is unusually large: look for a wrong input before applying it. Both steps use the Solver’s atmosphere and zero.</p>`,
    actions: [{ label: 'Open True your data', icon: 'turret', view: 'tools', tool: 'truing' }],
  },
  {
    id: 'guide-tool-wez',
    group: 'Tools',
    icon: 'dice',
    title: 'Hit probability',
    lead: `Simulates hundreds of shots with your error sources to estimate how often you hit (often called a ${abbr('WEZ', 'Hit probability analysis')} analysis).`,
    art: ['wez', 'A target with simulated impacts, a solid circle for half the shots and a dashed circle for 95%', ''],
    body: `<ul class="guide-list">
        <li>Choose the <strong>Target type</strong>, <strong>Distance</strong> and number of <strong>Simulated shots</strong>. Wind comes from the Solver.</li>
        <li>Enter the <strong>Error sources</strong> as one standard deviation: Muzzle velocity SD, Distance error, Wind speed error, Wind direction error, and Rifle and shooter precision.</li>
        <li>Read the hit chance, <strong>Half of shots within</strong>, <strong>95% of shots within</strong> and <strong>Average miss distance</strong>. <strong>What causes misses</strong> shows which error matters most, so you know what to improve.</li>
      </ul>`,
    actions: [{ label: 'Open Hit probability', icon: 'dice', view: 'tools', tool: 'wez' }],
  },
  {
    id: 'guide-tool-group',
    group: 'Tools',
    icon: 'group',
    title: 'Group analysis',
    lead: 'Measure a group from a photo or by clicking, and see what to dial.',
    art: ['group', 'A grid target with five holes up and right of the aim point, a spread ellipse and the group centre', ''],
    body: `<ol class="guide-list">
        <li><strong>Upload photo</strong> of the target (it stays on your device), or use the <strong>Sample target</strong>. Set the <strong>Distance</strong> and <strong>Bullet diameter</strong>.</li>
        <li>Click the target to add a shot; drag shots or the aim point to move them; right-click or long-press to delete. <strong>Find holes</strong> tries to find them for you; adjust <strong>Sensitivity</strong> if it misses some.</li>
        <li>For a photo, <strong>Set scale</strong>: click both ends of a 1 cm or 1 inch line on the target. Without it, sizes are not right.</li>
        <li>Read the <strong>Group size</strong>, Mean radius, Vertical SD and Horizontal SD, and the correction to dial. The <strong>Shots</strong> list lets you type positions with the keyboard.</li>
      </ol>`,
    actions: [{ label: 'Open Group analysis', icon: 'group', view: 'tools', tool: 'group' }],
  },
  {
    id: 'guide-tool-chrono',
    group: 'Tools',
    icon: 'chrono',
    title: 'Chronograph statistics',
    lead: 'Average velocity and consistency from your readings.',
    art: ['chrono-stats', 'Bars showing each shot’s difference from the average, between dashed lines one SD above and below', ''],
    body: `<ol class="guide-list">
        <li>Choose whether <strong>Readings are in</strong> m/s or fps.</li>
        <li>Paste the readings into <strong>Velocities</strong>: one per line, or separated by spaces, commas or semicolons. A comma between digits is a decimal mark.</li>
        <li>Read the <strong>Average muzzle velocity</strong> and its verdict, ${abbr('SD', 'Standard deviation')}, ${abbr('ES', 'Extreme spread')} and the number of shots. The chart shows each shot’s difference from the average.</li>
        <li>Press <strong>Use … for</strong> your rifle to save the average as its muzzle velocity.</li>
      </ol>`,
    actions: [{ label: 'Open Chronograph', icon: 'chrono', view: 'tools', tool: 'chrono' }],
  },
  {
    id: 'guide-tool-milling',
    group: 'Tools',
    icon: 'ranging',
    title: 'Range estimation',
    lead: 'Estimate distance from a target’s known size and its size in your reticle.',
    art: ['milling', 'A reticle with hash marks measuring the height of a target', ''],
    body: `<ol class="guide-list">
        <li>Pick a <strong>Known size</strong> (IPSC target, steel plate, car wheel…) or enter your own <strong>Target size</strong>.</li>
        <li>Choose the <strong>Reticle</strong> unit and enter the <strong>Size in reticle</strong>, measured in the same direction as the size.</li>
        <li>Read the <strong>Estimated distance</strong> and how much a small reading error changes it. The <strong>Formula</strong> card shows the sum: distance (m) = size (mm) ÷ reading (MRAD).</li>
      </ol>`,
    tip: 'In a second focal plane scope, read at the magnification the reticle is calibrated for. A laser rangefinder is far more exact when you have one.',
    actions: [{ label: 'Open Range estimation', icon: 'ranging', view: 'tools', tool: 'milling' }],
  },
  {
    id: 'guide-tool-recoil',
    group: 'Tools',
    icon: 'recoil',
    title: 'Recoil',
    lead: 'Free recoil energy: how hard the rifle pushes back if nothing holds it.',
    art: ['recoil', 'A rifle with an arrow pointing backwards', ''],
    body: `<ul class="guide-list">
        <li>Enter the <strong>Rifle weight with scope and bipod</strong>, <strong>Bullet weight</strong>, <strong>Powder charge</strong> and <strong>Muzzle velocity</strong>.</li>
        <li>Read the <strong>Free recoil energy</strong> (light, moderate or heavy), <strong>Recoil velocity</strong> and <strong>Recoil impulse</strong>. Lighter recoil makes it easier to see your own hits.</li>
        <li>Muzzle brakes and suppressors are not included.</li>
      </ul>`,
    actions: [{ label: 'Open Recoil', icon: 'recoil', view: 'tools', tool: 'recoil' }],
  },
  {
    id: 'guide-library',
    group: 'Library',
    icon: 'rifle',
    title: 'Library: your rifles',
    lead: 'Every rifle you set up, with its bullet and scope.',
    art: ['library', 'Two rifle cards and two bullets', ''],
    body: `<ul class="guide-list">
        <li><strong>New rifle</strong> opens the rifle dialog (rifle, bullet and scope).</li>
        <li><strong>Use this rifle</strong> makes it the rifle in the Solver; the rifle in use shows <strong>Open in Solver</strong>.</li>
        <li>The small buttons edit, duplicate or delete a rifle. A delete can be undone straight after.</li>
      </ul>`,
    actions: [
      { label: 'Open Library', icon: 'box', view: 'libraryManager', tab: 'rifles' },
      { label: 'New rifle', icon: 'plus', rifle: true },
    ],
  },
  {
    id: 'guide-library-bullets',
    group: 'Library',
    icon: 'bullet',
    title: 'Bullets, your own bullet and stability',
    lead: 'Find a bullet for a rifle, or add one that is not in the list.',
    art: ['stability', 'A spinning bullet and a stability gauge', ''],
    body: `<ul class="guide-list">
        <li><strong>Bullets</strong>: choose the rifle under <strong>For rifle</strong>, then search or filter by <strong>Bullet diameter</strong>. <strong>Use</strong> puts the bullet in that rifle.</li>
        <li><strong>Add a bullet</strong>: Name, Maker, Caliber, Weight, Diameter, Length, Drag model, G7 BC, G1 BC and Factory velocity. <strong>Save bullet</strong> adds it to the list.</li>
        <li><strong>Stability in this rifle</strong> shows the gyroscopic stability factor (Sg) of the bullet you are entering, for the rifle in use: 1.5 or more is stable, 1.0–1.5 marginal, below 1.0 unstable.</li>
      </ul>`,
    actions: [
      { label: 'Find a bullet', icon: 'search', view: 'libraryManager', tab: 'bullets' },
      { label: 'Add a bullet', icon: 'plus', view: 'libraryManager', tab: 'add' },
    ],
  },
  {
    id: 'guide-library-backup',
    group: 'Library',
    icon: 'save',
    title: 'Backup: export and import',
    lead: 'Your data lives in this browser only. Keep a copy.',
    art: ['backup', 'A backup file with arrows for saving and loading', ''],
    body: `<ul class="guide-list">
        <li><strong>Export</strong> saves your rifles, bullets and settings to a file.</li>
        <li><strong>Import…</strong> loads a backup file: it replaces your rifles and settings and adds its bullets. You can undo an import straight after.</li>
        <li>Imported files are checked before anything is used.</li>
      </ul>`,
    actions: [{ label: 'Open Library', icon: 'box', view: 'libraryManager', tab: 'rifles' }],
  },
  {
    id: 'guide-settings',
    group: 'App',
    icon: 'settings',
    title: 'Units and theme',
    lead: 'Two switches at the bottom of the sidebar.',
    art: ['settings', 'A units switch showing metric and imperial, and a theme switch', ''],
    body: `<ul class="guide-list">
        <li><strong>Units</strong>: Metric uses m, m/s, MRAD and cm; Imperial uses yd, fps, MOA and in. The click size always comes from your scope.</li>
        <li><strong>Theme</strong>: System follows your device; Dark and Light fix it. Use Light in bright sun.</li>
        <li>Both are remembered in this browser.</li>
      </ul>`,
    actions: [],
  },
  {
    id: 'guide-palette',
    group: 'App',
    icon: 'keyboard',
    title: 'Command palette',
    lead: `Press ${KEY}, or the Search button in the sidebar, to do almost anything by typing.`,
    art: ['palette', 'A search box with a list of commands below it', ''],
    body: `<ul class="guide-list">
        <li>Type a few letters: go to a view, open a tool, switch units or theme, change the drag model, or switch rifle.</li>
        <li>Use the arrow keys to move, <span class="lg-kbd">Enter</span> to run and <span class="lg-kbd">Esc</span> to close.</li>
      </ul>`,
    actions: [{ label: 'Open the palette', icon: 'search', palette: true }],
  },
  {
    id: 'guide-offline',
    group: 'App',
    icon: 'offline',
    title: 'Offline and install as an app',
    lead: 'The app works with no signal once it has been opened once.',
    art: ['offline', 'A phone with the app open next to a crossed-out cloud', ''],
    body: `<ul class="guide-list">
        <li>Chrome or Edge: choose <strong>Install app</strong> in the address bar or the browser menu.</li>
        <li>iPhone or iPad: in Safari choose <strong>Share → Add to Home Screen</strong>.</li>
        <li>Android: in Chrome choose <strong>Add to Home screen</strong> or <strong>Install app</strong> in the menu.</li>
        <li>Open it once with a connection; after that it starts offline. Nothing you enter leaves your device.</li>
      </ul>`,
    actions: [],
  },
];

const GLOSSARY = [
  ['DOPE', 'Data On Previous Engagement: your recorded or calculated elevation and wind for each distance.'],
  ['BC', 'Ballistic coefficient: how well a bullet keeps its speed compared with a reference shape. Higher is better.'],
  ['G1 and G7', 'Reference drag shapes. G1 is a flat-base bullet, G7 a long boat-tail bullet. Use the BC that matches the model; G7 fits modern long-range bullets better.'],
  ['MRAD and MOA', 'Angle units for elevation and wind. 1 MRAD is 10 cm at 100 m (3.6 in at 100 yd); 1 MOA is 1.047 in at 100 yd (2.9 cm at 100 m).'],
  ['Click', 'One step of the scope turret, usually 0.1 MRAD or 1/4 MOA.'],
  ['Zero', 'The distance where the bullet hits the point of aim with the turret at 0.'],
  ['Sight height', 'The height of the scope’s centre line above the bore’s centre line.'],
  ['Twist rate', 'How far the rifling takes to turn the bullet once, for example 1 in 8 in. Faster twist stabilises longer bullets.'],
  ['SD and ES', 'Standard deviation and extreme spread of velocities (or of a group). SD shows typical scatter; ES is fastest minus slowest.'],
  ['Density altitude', 'The altitude in a standard atmosphere with the same air density as now. It sums up temperature, pressure and humidity: higher means thinner air and less drop.'],
  ['Transonic', 'The speeds near the speed of sound (about Mach 1.2 to 0.9) where drag changes fast and the bullet can become unstable. Predictions are less exact here.'],
  ['Spin drift', 'The slow sideways drift caused by the bullet’s spin, to the right for a right-hand twist. It grows with distance.'],
  ['Coriolis', 'A small shift caused by the Earth turning under the bullet’s flight. It matters only at long range.'],
  ['Aerodynamic jump', 'A small vertical shift caused by a crosswind as the bullet leaves the muzzle.'],
  ['FFP and SFP', 'First and second focal plane. FFP reticle marks are right at every magnification; SFP marks only at one.'],
  ['WEZ', 'A hit probability analysis: how often you can expect to hit a target of a given size when all error sources (velocity, distance, wind, precision) are combined. Shown in the Hit probability tool.'],
  ['Danger space', 'The stretch of distance in which a bullet aimed at the target’s centre stays inside the target’s height. A bigger danger space forgives range errors.'],
  ['Station pressure', 'The real air pressure where you stand, not corrected to sea level. The Solver uses it.'],
];

const STEP_IDS = STEPS.map((s) => s.id);
const SUB_IDS = STEPS.flatMap((s) => (s.subs || []).map((x) => x.id));
const TOPIC_IDS = TOPICS.map((t) => t.id);
/** Every id showSection() accepts. */
const SECTION_IDS = new Set([...STEP_IDS, ...SUB_IDS, ...TOPIC_IDS, 'guide-part1', 'guide-part2', 'guide-glossary']);

/** Reads saved progress; anything that is not a list of known step ids is ignored. */
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    const list = data && typeof data === 'object' && Array.isArray(data.done) ? data.done : [];
    return new Set(list.filter((id) => typeof id === 'string' && STEP_IDS.includes(id)));
  } catch {
    return new Set();
  }
}

function saveProgress(done) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, done: STEP_IDS.filter((id) => done.has(id)) }));
  } catch {
    // Storage blocked (private mode): progress lasts for this visit only
  }
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class GuideView {
  constructor(container) {
    this.container = container;
    this.done = loadProgress();
    this.undoDone = null;
    this.observer = null;
    this._onClick = (e) => this._handleClick(e);
    this._onChange = (e) => this._handleChange(e);
    this.container.addEventListener('click', this._onClick);
    this.container.addEventListener('change', this._onChange);
    this.render();
  }

  /* ---- markup ---------------------------------------------------------------------------- */

  _actionsHtml(actions, extraClass = '') {
    if (!actions?.length) return '';
    const btn = (a, i) => {
      const data = [
        a.view ? `data-view="${a.view}"` : '',
        a.tool ? `data-tool="${a.tool}"` : '',
        a.panel ? `data-panel="${a.panel}"` : '',
        a.format ? `data-format="${a.format}"` : '',
        a.tab ? `data-tab="${a.tab}"` : '',
        a.anchor ? `data-anchor="${a.anchor}"` : '',
        a.rifle ? 'data-guide-action="new-rifle"' : '',
        a.palette ? 'data-guide-action="palette"' : '',
      ].filter(Boolean).join(' ');
      const primary = i === 0 && !a.anchor;
      return `<button type="button" class="lg-btn${primary ? ' lg-btn-primary' : ''}" ${data}>${icon(a.icon)}<span>${a.label}</span>${a.view ? icon('arrow-right', 'guide-go') : ''}</button>`;
    };
    return `<div class="guide-actions lg-row no-print${extraClass ? ` ${extraClass}` : ''}">${actions.map(btn).join('')}</div>`;
  }

  _alerts(tips = [], mistakes = []) {
    return [
      ...tips.map((t) => `<div class="lg-alert lg-alert-info guide-alert">${icon('bulb')}<div><strong>Tip</strong><p>${t}</p></div></div>`),
      ...mistakes.map((m) => `<div class="lg-alert lg-alert-warn guide-alert">${icon('alert')}<div><strong>Common mistake</strong><p>${m}</p></div></div>`),
    ].join('');
  }

  _subHtml(sub, stepNo, i) {
    return `
      <section class="guide-sub" id="${sub.id}" aria-labelledby="${sub.id}-h">
        <h4 class="guide-sub-title" id="${sub.id}-h" tabindex="-1"><span class="guide-sub-num">${stepNo}.${i + 1}</span>${sub.title}</h4>
        <div class="guide-split">
          ${figure(...sub.art)}
          <div class="guide-text">
            <p>${sub.why}</p>
            <ol class="guide-do">${sub.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
            ${sub.example ? `<p class="guide-example lg-small">${icon('calipers')}<span>${sub.example}</span></p>` : ''}
            ${this._alerts(sub.tip ? [sub.tip] : [], sub.mistake ? [sub.mistake] : [])}
          </div>
        </div>
      </section>`;
  }

  _stepHtml(step, n) {
    const done = this.done.has(step.id);
    const needs = `
      <h4 class="lg-label">You need</h4>
      <ul class="guide-needs">${step.needs.map(([ic, t]) => `<li>${icon(ic)}<span>${t}</span></li>`).join('')}</ul>`;
    const doThis = step.steps ? `
      <h4 class="lg-label">Do this</h4>
      <ol class="guide-do">${step.steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : '';
    const record = `
      <div class="guide-record">
        <h4 class="lg-label">${icon('notebook')} Write down</h4>
        <ul>${step.record.map((r) => `<li>${r}</li>`).join('')}</ul>
      </div>`;

    return `
      <section class="lg-card guide-step${done ? ' is-done' : ''}" id="${step.id}" aria-labelledby="${step.id}-h" data-step="${step.id}">
        <header class="guide-step-head">
          <span class="guide-step-num" aria-hidden="true"><span class="guide-n">${n}</span>${icon('check')}</span>
          <div class="guide-step-heading">
            <p class="lg-label">Step ${n} of ${STEPS.length}</p>
            <h3 class="guide-step-title" id="${step.id}-h" tabindex="-1">${step.title}</h3>
          </div>
          <label class="guide-done no-print"><input type="checkbox" class="lg-check" data-done="${step.id}" ${done ? 'checked' : ''} /> Mark as done</label>
        </header>
        <p class="guide-why">${step.why}</p>
        ${step.art ? `
        <div class="guide-split">
          ${figure(...step.art)}
          <div class="guide-text">${needs}${doThis}</div>
        </div>` : `<div class="guide-text">${needs}</div>`}
        ${(step.subs || []).map((s, i) => this._subHtml(s, n, i)).join('')}
        ${this._alerts(step.tips, step.mistakes)}
        ${record}
        ${this._actionsHtml(step.actions)}
      </section>`;
  }

  _topicHtml(t) {
    return `
      <section class="lg-card guide-topic" id="${t.id}" aria-labelledby="${t.id}-h">
        <div class="guide-split guide-split-sm">
          ${figure(t.art[0], t.art[1], t.art[2], 'guide-fig-sm')}
          <div class="guide-text">
            <p class="lg-label guide-topic-group">${t.group}</p>
            <h3 class="guide-topic-title" id="${t.id}-h" tabindex="-1">${icon(t.icon)}<span>${t.title}</span></h3>
            <p class="guide-lead">${t.lead}</p>
            ${t.body}
            ${t.tip ? this._alerts([t.tip]) : ''}
            ${this._actionsHtml(t.actions)}
          </div>
        </div>
      </section>`;
  }

  _tocHtml() {
    const link = (id, label, num, isStep) => `
      <a href="#guide" data-anchor="${id}"${isStep ? ` data-toc-step="${id}"` : ''} class="guide-toc-link${isStep && this.done.has(id) ? ' is-done' : ''}">
        ${isStep ? `<span class="guide-toc-num" aria-hidden="true"><span class="guide-n">${num}</span>${icon('check')}</span>` : icon(num)}
        <span class="guide-toc-text">${label}</span>${isStep ? `<span class="lg-sr-only guide-toc-state">${this.done.has(id) ? ', done' : ''}</span>` : ''}
      </a>`;
    return `
      <nav class="guide-toc lg-card no-print" aria-label="Guide contents">
        <p class="lg-label">From range day to DOPE chart</p>
        <div class="lg-nav">${STEPS.map((s, i) => link(s.id, s.short, i + 1, true)).join('')}</div>
        <p class="lg-label guide-toc-part">How each part works</p>
        <div class="lg-nav">${TOPICS.map((t) => link(t.id, t.title.split(':')[0], t.icon, false)).join('')}${link('guide-glossary', 'Glossary', 'guide', false)}</div>
      </nav>`;
  }

  _jumpHtml() {
    const opt = (id, label) => `<option value="${id}">${label}</option>`;
    return `
      <div class="guide-jump lg-card no-print">
        <label class="field-label" for="guide-jump-select">${icon('list')} Go to</label>
        <select id="guide-jump-select" class="lg-select">
          <option value="">Choose a section…</option>
          <optgroup label="From range day to DOPE chart">${STEPS.map((s, i) => opt(s.id, `${i + 1}. ${s.title}`)).join('')}</optgroup>
          <optgroup label="How each part works">${TOPICS.map((t) => opt(t.id, t.title)).join('')}${opt('guide-glossary', 'Glossary')}</optgroup>
        </select>
      </div>`;
  }

  _progressHtml() {
    const n = this.done.size;
    const total = STEPS.length;
    return `
      <div class="guide-progress no-print">
        <div class="guide-progress-head">
          <span class="lg-label" id="guide-progress-label">Your progress</span>
          <span class="lg-small lg-muted" id="guide-progress-text" aria-live="polite">${n} of ${total} steps done</span>
        </div>
        <progress class="lg-progress" id="guide-progress-bar" max="${total}" value="${n}" aria-labelledby="guide-progress-label" aria-describedby="guide-progress-text"></progress>
        <div class="lg-row guide-progress-actions">
          <button type="button" class="lg-btn lg-btn-ghost" data-guide-action="reset" ${n ? '' : 'disabled'}>${icon('refresh')} Reset progress</button>
          <button type="button" class="lg-btn" data-guide-action="undo-reset" ${this.undoDone ? '' : 'hidden'}>${icon('arrow-left')} Undo</button>
        </div>
      </div>`;
  }

  render() {
    const route = STEPS.map((s, i) => `
      <li><a href="#guide" data-anchor="${s.id}" data-route-step="${s.id}" class="guide-route-step${this.done.has(s.id) ? ' is-done' : ''}">
        <span class="guide-route-icon">${icon(s.icon)}</span><span class="guide-route-text"><span class="guide-route-n">${i + 1}</span> ${s.short}</span>
      </a></li>`).join('');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: static guide content and constants written in this file; no user, stored or imported strings
    this.container.innerHTML = `
      <div class="guide-view">
        <header class="lg-header view-header">
          <div>
            <h1 class="lg-title">Guide</h1>
            <p class="lg-muted">From planning a range day to a printed DOPE chart, step by step, and how each part of the app works.</p>
          </div>
          <div class="lg-row no-print">
            <button type="button" class="lg-btn btn-print">${icon('print')} Print the guide</button>
          </div>
        </header>

        <div class="guide-layout">
          ${this._tocHtml()}
          <div class="guide-content">
            ${this._jumpHtml()}

            <section class="lg-card guide-intro" id="guide-part1" aria-labelledby="guide-part1-h">
              <p class="lg-label">Part 1</p>
              <h2 class="guide-part-title" id="guide-part1-h" tabindex="-1">From range day to DOPE chart</h2>
              <p class="guide-lead">Eleven steps take you from an empty notebook to a chart you can trust: plan, measure, zero, chronograph, shoot, true the model, then print. Tick each step off as you go; your progress is saved in this browser.</p>
              <ol class="guide-route" aria-label="The eleven steps">${route}</ol>
              ${this._progressHtml()}
            </section>

            ${STEPS.map((s, i) => this._stepHtml(s, i + 1)).join('')}

            <section class="lg-card guide-intro" id="guide-part2" aria-labelledby="guide-part2-h">
              <p class="lg-label">Part 2</p>
              <h2 class="guide-part-title" id="guide-part2-h" tabindex="-1">How each part works</h2>
              <p class="guide-lead">What every screen and tool does, with the same names as in the app. Each card has a button that opens the part it describes.</p>
            </section>

            ${TOPICS.map((t) => this._topicHtml(t)).join('')}

            <section class="lg-card guide-glossary" id="guide-glossary" aria-labelledby="guide-glossary-h">
              <h2 class="guide-part-title" id="guide-glossary-h" tabindex="-1">${icon('guide')} Glossary</h2>
              <dl class="guide-terms">${GLOSSARY.map(([term, def]) => `<div><dt>${term}</dt><dd>${def}</dd></div>`).join('')}</dl>
            </section>

            <p class="guide-foot lg-small lg-muted">The measuring methods follow common practice in scope, chronograph and ballistics documentation. Always follow your equipment maker’s manual and your range’s safety rules.</p>
          </div>
        </div>
      </div>`;

    this._observeSections();
  }

  /* ---- progress -------------------------------------------------------------------------- */

  _syncProgress() {
    const n = this.done.size;
    const q = (s) => this.container.querySelector(s);
    const bar = q('#guide-progress-bar');
    if (bar) bar.value = n;
    const text = q('#guide-progress-text');
    if (text) text.textContent = `${n} of ${STEPS.length} steps done`;
    const reset = q('[data-guide-action="reset"]');
    if (reset) reset.disabled = n === 0;
    const undo = q('[data-guide-action="undo-reset"]');
    if (undo) undo.hidden = !this.undoDone;
    for (const id of STEP_IDS) {
      const on = this.done.has(id);
      this.container.querySelector(`.guide-step[data-step="${id}"]`)?.classList.toggle('is-done', on);
      const box = this.container.querySelector(`[data-done="${id}"]`);
      if (box) box.checked = on;
      const toc = this.container.querySelector(`[data-toc-step="${id}"]`);
      if (toc) {
        toc.classList.toggle('is-done', on);
        const st = toc.querySelector('.guide-toc-state');
        if (st) st.textContent = on ? ', done' : '';
      }
      this.container.querySelector(`[data-route-step="${id}"]`)?.classList.toggle('is-done', on);
    }
  }

  _handleChange(e) {
    const box = e.target.closest?.('[data-done]');
    if (box && STEP_IDS.includes(box.dataset.done)) {
      if (box.checked) this.done.add(box.dataset.done);
      else this.done.delete(box.dataset.done);
      this.undoDone = null;
      saveProgress(this.done);
      this._syncProgress();
      return;
    }
    if (e.target.id === 'guide-jump-select' && e.target.value) {
      this.showSection(e.target.value);
      e.target.value = '';
    }
  }

  /* ---- clicks: in-page links, open-in-app buttons, progress ------------------------------- */

  _handleClick(e) {
    const link = e.target.closest?.('[data-anchor]');
    if (link && !link.dataset.view) {
      e.preventDefault();
      this.showSection(link.dataset.anchor);
      return;
    }
    const action = e.target.closest?.('[data-guide-action]');
    if (action) {
      switch (action.dataset.guideAction) {
        case 'new-rifle':
          new RifleBuilderModal().open();
          break;
        case 'palette':
          document.getElementById('btn-cmd-palette-trigger')?.click();
          break;
        case 'reset':
          if (!this.done.size) return;
          this.undoDone = new Set(this.done);
          this.done.clear();
          saveProgress(this.done);
          this._syncProgress();
          toast('Progress reset', 'info', 'Press Undo to bring your ticks back.');
          this.container.querySelector('[data-guide-action="undo-reset"]')?.focus();
          break;
        case 'undo-reset':
          if (this.undoDone) this.done = this.undoDone;
          this.undoDone = null;
          saveProgress(this.done);
          this._syncProgress();
          this.container.querySelector('[data-guide-action="reset"]')?.focus();
          break;
        default:
          break;
      }
      return;
    }
    const go = e.target.closest?.('button[data-view]');
    if (go) {
      const { view, tool, panel, format, tab } = go.dataset;
      const detail = { view };
      if (tool) detail.tool = tool;
      if (panel) detail.panel = panel;
      if (format) detail.format = format;
      if (tab) detail.tab = tab;
      window.dispatchEvent(new CustomEvent('navigate-view', { detail }));
      // The Library has no router hook for its tabs yet: press the tab once the view is open
      if (view === 'libraryManager' && tab) {
        const t = document.getElementById(`lib-tab-${tab}`);
        if (t && t.getAttribute('aria-selected') !== 'true') t.click();
      }
    }
  }

  /* ---- sections -------------------------------------------------------------------------- */

  /**
   * Scrolls to a guide section and moves focus to its heading. Called by in-page links and by the
   * router (navigate-view { view: 'guide', anchor }). Unknown ids are ignored. Returns whether the
   * section exists.
   */
  showSection(id) {
    if (typeof id !== 'string' || !SECTION_IDS.has(id)) return false;
    const el = this.container.querySelector(`#${id}`);
    if (!el) return false;
    // Open anything collapsed around it
    for (let p = el; p && p !== this.container; p = p.parentElement) {
      if (p.tagName === 'DETAILS') p.open = true;
    }
    const heading = el.querySelector('[tabindex="-1"]') || el;
    // After the frame, so the router's own scroll-to-top for a view switch has already run
    const go = () => {
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      heading.focus({ preventScroll: true });
      this._setCurrent(id);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    else go();
    return true;
  }

  _setCurrent(id) {
    const top = STEP_IDS.includes(id) || TOPIC_IDS.includes(id) || id === 'guide-glossary'
      ? id
      : STEPS.find((s) => (s.subs || []).some((x) => x.id === id))?.id;
    this.container.querySelectorAll('.guide-toc-link').forEach((a) => {
      if (a.dataset.anchor === top) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }

  /** Highlights the contents entry of the section at the top of the screen. */
  _observeSections() {
    this.observer?.disconnect();
    const IO = typeof window !== 'undefined' ? window.IntersectionObserver : undefined;
    if (!IO) return;
    const sections = [...this.container.querySelectorAll('.guide-step, .guide-topic, .guide-glossary')];
    // Whenever a section crosses the line at 35% of the screen height, the current one is the last
    // section whose top is above that line
    this.observer = new IO(() => {
      const line = window.innerHeight * 0.35;
      let current = null;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) current = s;
        else break;
      }
      if (current) this._setCurrent(current.id);
    }, { rootMargin: '0px 0px -65% 0px' });
    sections.forEach((s) => this.observer.observe(s));
  }

  refresh() {
    this.render();
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    this.container.removeEventListener('click', this._onClick);
    this.container.removeEventListener('change', this._onChange);
  }
}
