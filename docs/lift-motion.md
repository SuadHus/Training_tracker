# The motion model of the six lifts

Notes on `src/lib/lift-motion.ts`, which moves the lifter on the home page (`DESIGN.md` describes what the reader sees). Numbers are the model's as tested in `tests/lift-motion.test.ts`.

`makeLiftSet(kind, { reps })` in `src/lib/lift-motion.ts` returns a `LiftSet` (see `src/lib/lift-set.ts`): `duration`, `heroTime`, `timeline`, `scene`, `pose(t)`, `phase(t)` and `repAt(t)`.
It is pure TypeScript with no DOM, clock or randomness, memoised per (kind, reps), and costs about 30 microseconds a frame. Reps are 1 to 30 (`MAX_DRAWN_REPS`): fewer than one or not a
number counts as one, infinity as thirty, a kind that is none of the six throws `unknown lift <kind>`.

## How it is made

- **One rig** serves all six lifts (`rig()`): pelvis, a two-segment spine (lumbar 0.22 m, thorax 0.28 m), head at `BODY.neck` (0.255 m) from the chest, legs by a two-bone solve with the knee
  placed sideways, arms by a two-bone solve with the elbow's swivel, feet with yaw, pitch and lift. Segment lengths are `BODY` in `src/lib/lift-pose.ts` and are constant in every frame.
- **One table per lift kind and one planner per family** (`lift-motion-tables.ts`: `SQUAT`, `BENCH`, `DEADLIFT` rows, and the numbers they share, `SQ`, `BN`, `DL`). A planner (`planSquat`,
  `planBench`, `planDeadlift`) writes a script: a list of phases, each of which moves some channels (bar height, arm, foot x, ...) from the value the previous phase ended in to a new one.
  Because every phase starts where the last ended, the pose is continuous by construction. The calibration (depth, rack height, bar path against the legs) is solved once per kind into small
  tables; `pose(t)` is a binary search, a few lookups and one pass of the rig. A seventh lift is a table row and, at most, a planner.
- `lift-math.ts` holds the vectors and easings, `lift-motion-tables.ts` the numbers. The tables are exported as plain objects only so that the mutation tests can change a number and see the
  suite notice; nothing else writes to them.

## The six lifts (two reps; timelines in seconds)

- **Squat, low bar and high bar.** under the bar 0.6, unrack 0.5, walkout 1.79 (three short steps R, L, R of 0.24, 0.46 and 0.22 m with double support between them), settle 0.7, each rep 2.81
  (descent 1.24, pause 0.08, ascent 1.31, lockout 0.17), walk in 1.87 (the same three steps back, as slow as the walkout), rack 0.4, let go 1.3, step out 0.91. 13.7 s for 2 reps, 32 s for 8.
  The bar rides over the midfoot (ankle + 0.07 m) in every frame of every rep. Low bar: bar 0.126 m behind the torso axis on the rear delts, lean 48 degrees and shank 26 at the bottom, heels
  0.42 m apart, hands 0.72 m, elbows back and down beside the ribs. High bar: bar on the traps, lean 33, shank 37.5, heels 0.37, hands 0.585, elbows down and out. The elbows are under
  the bar in both, in every frame the hands hold it. Hip crease 4 cm below the top of the knee at the bottom.
  heroTime: the bottom.
- **Bench, regular and close grip.** under the bar 0.5, lift-off 1.1, settle 0.15, each rep 2.68 (close grip 2.79: descent 1.22, touch 0.1, press 1.05, lockout 0.31), rerack 1.1 and rack
  0.4 (1.5 together), let go 1.4. 10.0 s for 2 reps, 27.4 s for 8. The body does not move (head, shoulders and pelvis within 5 mm, feet planted). The lifter is set up the way benchers set
  up: the shoulder joints lie 4.5 cm below the chest point, pulled back onto the pad, and the bar lies on the heel of the palm, 5.5 cm above the wrist. The bar then travels 0.40 m (close
  grip 0.43), which is what was measured on lifters (0.41 and 0.43). Hands 0.76 m apart (the grip trained lifters choose, 175% of the shoulder width between the forefingers) against 0.50
  (105%, among the narrow grips that were studied). The bar rests on the drawn chest, 13.5 cm toward the feet from the shoulders (close grip 17.5) and 20 cm above the shoulder joints.
  Lockout at 171 degrees.
  *The elbows.* Seen from the side they stay under the bar: at most 2.6 cm toward the feet of it (close grip 7.3), so the forearm is within 6 degrees of upright (close grip 21). Seen
  from above they point out to the sides at lockout (91 degrees from the line of the body), close steadily to 59 degrees at the chest (close grip 36) and open again on the way up,
  never turning back. At the chest the upper arm is 53 degrees from the plane that halves the body (close grip 34), the elbow joints are 12 cm below the shoulder joints (10), the elbow
  is bent to 57 degrees (47) and the forearms lean in 12 degrees seen from the front (26). *The bar's path.* Down along a line that drifts toward the feet early (59% of the sideways travel
  done at half height); up toward the head from the first centimetres (61 degrees to the horizontal off the chest, 66% of the way back at half height). The elbows follow only half of
  that early return, so that they are not rotated all the way out before lockout: half way up the flare is 77 degrees (65), 3 to 5 more than half way down.
  What was measured on lifters, what coaches say and what is this model's own judgement is told apart, number by number, in `docs/bench-press-elbows.md`. The set ends with the hands
  resting on the ribs beside the chest (y 0.66, z 0.22) and the elbows hanging over the edge of the pad (z 0.28). heroTime: the touch.
- **Deadlift, conventional and sumo.** approach 3.1 (conventional) and 3.9 (sumo, in five steps that widen the stance, the last two 15% longer), grip 1.6 (hinge 1.35, slack 0.25), each rep
  3.55 (lead 0.1, pull 1.6, hold 0.3, lowering 1.2, floor 0.3), let go 2.0 (hands off, then the torso rises at an even pace, then the legs finish straight). 13.9 and 14.5 s for 2 reps. Conventional:
  heels 0.23 m apart, hands just outside the legs; sumo: 0.82 m, toe-out 44 degrees, hands inside the knees, torso upright, shorter bar travel. heroTime: the bar at the knees (0.27 m up), the back
  angle still held.

## The targets, and where they are tested

The reference figures for each lift (timings, joint angles, bar speeds and paths, where the bar meets the chest or the thigh) and every invariant of the model are a `Check` in `tests/helpers/lift-motion/`: `squat.ts`,
`bench.ts`, `deadlift.ts` (each with the checks of its family: tempo, stillness of the feet, bar over the midfoot, the arms against the drawn trunk and thighs, acceleration and jerk, the
recorded numbers that the reference figures cannot hold), `general.ts` (bone lengths, no NaN, joints bend the anatomical way, hands on the bar, feet planted, continuity at 240 Hz for 1, 2, 5 and 30
reps: no joint moves more than 1 cm between two samples), `pairs.ts` (low bar against high bar, bench against close grip, conventional against sumo), `measure.ts` (the measurements, taken from 240 Hz samples).
`tests/lift-motion.test.ts` runs them for every lift, and a table of 67 deliberate mutations (a knee bent backwards, a foot sliding, a jump at a boundary, low bar and high bar swapped, sumo hands
outside the knees, a rushed rep, a brisk walk in, hands held in the air, a novice's press straight up off the chest, elbows thrown out before lockout, ...), each of which must make the suite fail, with `LIFT_MUTATIONS=1` (six minutes; not in `npm test`; `MUTATION_REPORT=1` prints how many checks each mutation breaks). `LIFT_SWEEP=1` makes the drawing sweeps of `tests/lift-draw.test.ts` four times as dense.

Where a reference figure cannot be held, the check records what the model does and says so in its id ("recorded"): the squat's lean and shank at the top, the low bar's upper arm along the ribs, the
bar behind the torso axis, the middle step of the walkout, the deadlift's bar to the hip-knee line, the sumo's shin and back angle, the bench's forearms seen from the front.

Headline numbers, two reps: squat peak bar speed 0.65 (low) and 0.66 m/s (high); bench 0.67 and 0.74; deadlift 0.72 and 0.66; planted feet move 0.00 cm in the reps (heel and toe at 0 mm);
no joint moves more than 1 cm in 1/240 s anywhere; bar over the midfoot to 0.0 cm in every frame of every squat rep.

## What is still weak

- **The squat's top is short of upright**: lean 11.5 degrees (low bar) and 9.5 (high bar), shank about 10, knee about 173, pelvis 10 cm ahead of the ankle. The reference figures are lean 6 to 8,
  shank at most 6 and a knee of 176 to 178. The rule that the bar stays over the midfoot, with the bar 0.126 m behind the torso axis (the drawn ribs are 0.118 m wide and the bar must clear
  them by a centimetre), puts the pelvis there; a lean of 8 degrees puts it further ahead, not nearer. A bar 2 cm behind the midfoot at the top would gain about a degree of shank and
  make the knee jump (bar acceleration 94 m/s2), and straighter legs (reach 0.9994) turn a millimetre of hip height into a large swing of the knee (the knee's acceleration is 69 m/s2
  against the 25 allowed). A real lifter has thinner ribs, a bar closer to the spine, or a bar behind the midfoot.
- **The bench's forearms lean in more than lifters' were measured to.** Averaged over a rep they lean in 8.5 degrees (bench) and 26 (close grip), and up to 23 and 45 in mid-rep; the
  one study that measured it found means of about 1 (medium grip), 12.5 the other way (wide) and 8.5 to 16.5 (narrow), with a sign convention it does not state. The cause is the
  mannequin's build. A two-bone arm whose hand is over its shoulder has its elbow 0.2 m off the line between the two at mid-height; the model puts that distance out to the side, where
  lifters' elbows were seen half way up, not toward the feet, where the forearm would lean back under the bar instead. And the mannequin's chest is 20 cm above its shoulder joints: a
  lifter with a big arch has more, bends the elbow less (the elbow here bends to 57 and 47 degrees at the chest; lifters' were measured at 55 to 68 and 51 by one method, 79 to 93 and
  66 to 70 by another) and drops it less (12 and 10 cm below the shoulder joints here).
- **The close grip's elbows are ahead of the bar** by 6 cm at the chest and 5 half way up (the forearm leans back 14 degrees at the chest, 21 at most). A coach wants them back under the
  bar by the midrange; the one measurement there is has the bar's moment arm about the elbow at 8 cm with a narrow grip.
- **The bench's elbows on the way down are a mirror of the way up.** Nobody has measured the flare during the descent.
- **The bench's shoulder joints do not move** in the press. A lifter's shoulder blades slide a little near lockout.
- **The bench's tempo is a working set's** (descent 1.06 s and press 0.94 s, each by 1 mm bands). World-class lifters lowering a maximum took 1.7 to 2.3 s.
- **In the let go the forearms pass through level, out to the sides**, before the arms hang, and the high bar's forearm swings forward 0.16 m: an arm that drops from a bar has to turn over somewhere.
- **The squat's sticking region and the bench's are shapes, not physics**: the model does not know the load.
- **A 5-rep set and a 30-rep set have the same grind curve** (the square of the place in the set).
- The walk-up of the deadlift starts 1.06 m (sumo 0.96) left of the bar, standing, 0.2 s; the stage keeps 10 px of air to the left of it.
- The deadlift's approach is 4.7 s before rep 1 for the conventional, a little over the reference 4.5.
- The eight-rep squat takes 32 s (the reference 28 to 31 plus the grind).
- The mannequin's thighs are drawn 0.092 m thick: arms clear them by 14 cm or more (squat) and 26 cm (bench), but a hand at the hip is close to the drawn thigh.
