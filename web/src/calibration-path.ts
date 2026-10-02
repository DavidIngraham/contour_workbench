export type CalibrationPoint=readonly [number,number];

// A compact trail centerline with close parallel runs, tight hairpins, and an
// angled jog. It exercises the same narrow-wall and small-turn behavior as a
// dense switchback network without creating disconnected test pieces.
export const calibrationSwitchbackCenterlineMm:readonly CalibrationPoint[]=[
 [-7,-5.2],[6,-5.2],[6,-2.6],[-5,-2.6],[-2.1,-.2],
 [6,-.2],[6,2.4],[-6,2.4],[-6,5],[3.5,5]
];
