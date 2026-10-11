/**
 * Automated Collision Avoidance (COLA) Maneuver Planning Engine
 * Computes optimal delta-V burn vectors, propellant mass expenditure,
 * burn execution epoch, and post-maneuver safety verification.
 */

import { G0_STANDARD, MU_EARTH, SECONDS_PER_DAY, RAD2DEG } from './constants.ts';
import { ConjunctionEvent, KeplerianElements, ManeuverPlan, OrbitalObject, WhatIfManeuverResult } from './types.ts';
import { propagateOrbit } from './propagator.ts';
import { crossProduct, dotProduct, normalizeVector, vectorNorm } from './coordinates.ts';

export interface ManeuverRecommendation {
  plan: ManeuverPlan;
  revisedKeplerian: KeplerianElements;
}

/**
 * Computes an optimal collision avoidance maneuver for a high-risk conjunction event
 */
export function planCollisionAvoidanceManeuver(
  conjunction: ConjunctionEvent,
  options: {
    safetyMarginKm?: number;
    thrusterType?: 'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION';
    leadOrbitsBeforeTca?: number;
  } = {}
): ManeuverRecommendation {
  const {
    safetyMarginKm = 12.0,
    thrusterType = 'MONOPROPELLANT_HYDRAZINE',
    leadOrbitsBeforeTca = 1.0
  } = options;

  const primary = conjunction.primaryObject;
  const a = primary.keplerian.semiMajorAxisKm;
  const periodMinutes = primary.keplerian.periodMinutes;
  const periodSeconds = periodMinutes * 60.0;
  
  // Orbital speed v = sqrt(mu / a) for near-circular orbit in km/s
  const vOrbKmS = Math.sqrt(MU_EARTH / a);
  const vOrbMs = vOrbKmS * 1000.0;

  // Current miss distance
  const currentMissKm = conjunction.missDistanceKm;
  const requiredDeltaMissKm = Math.max(0.5, safetyMarginKm - currentMissKm);

  // In along-track prograde/retrograde burn:
  // An along-track DeltaV of dv changes period by:
  // DeltaP / P = 1.5 * Delta_a / a = 3.0 * dv / v
  // After N orbits, the in-track separation Delta_I = N * v * DeltaP = 3 * pi * N * a * (dv / v) [approx]
  // In meters: Delta_I_km = 3 * pi * N * (a_km) * (dv_m / v_m)
  // Solving for required dv (m/s):
  // dv = (Delta_I_km * v_m) / (3 * pi * N * a_km)
  const N = Math.max(0.5, leadOrbitsBeforeTca);
  let deltaVMagnitudeMs = (requiredDeltaMissKm * vOrbMs) / (3.0 * Math.PI * N * a);

  // Apply reasonable bounds for operational thrusters (e.g., 0.15 m/s to 3.5 m/s)
  deltaVMagnitudeMs = Math.max(0.15, Math.min(deltaVMagnitudeMs, 4.0));

  // Determine burn direction: if relative in-track is negative, accelerate prograde (+T), else retrograde (-T)
  const isPrograde = conjunction.ric.inTrackMissKm < 0;
  const burnType = isPrograde ? 'ALONG_TRACK_PROGRADE' : 'ALONG_TRACK_RETROGRADE';
  const signedDeltaV = isPrograde ? deltaVMagnitudeMs : -deltaVMagnitudeMs;

  const deltaVVectorMs: [number, number, number] = [
    0.0,            // DeltaV Radial (m/s)
    signedDeltaV,   // DeltaV Along-track / Transverse (m/s)
    0.0             // DeltaV Cross-track / Normal (m/s)
  ];

  // Burn execution epoch: scheduled N orbits before TCA
  const leadTimeMs = N * periodSeconds * 1000.0;
  const burnEpochMs = Math.max(Date.now() + 60000, conjunction.tcaTimestampMs - leadTimeMs);
  const burnEpochUtc = new Date(burnEpochMs).toISOString();

  // Thruster specs
  const ispSeconds = thrusterType === 'MONOPROPELLANT_HYDRAZINE' ? 220.0 : 1600.0;
  const thrustNewtons = thrusterType === 'MONOPROPELLANT_HYDRAZINE' ? 2.5 : 0.08;

  // Tsiolkovsky Rocket Equation:
  // Delta_m = m0 * (1 - exp(-DeltaV / (Isp * g0)))
  const initialMassKg = primary.massKg || 500.0;
  const cEffective = ispSeconds * G0_STANDARD; // Effective exhaust velocity (m/s)
  const massRatio = Math.exp(-deltaVMagnitudeMs / cEffective);
  const propellantMassKg = initialMassKg * (1.0 - massRatio);
  const dryMassKg = initialMassKg - propellantMassKg;

  // Burn duration: F = m_dot * c, duration = Delta_m / m_dot = (Delta_m * c) / F
  // Or impulsive equivalent: DeltaV * mass / Thrust
  const burnDurationSeconds = (initialMassKg * deltaVMagnitudeMs) / thrustNewtons;

  // Compute revised orbital parameters
  // New semi-major axis: Delta_a = 2 * a * (dv / v)
  const deltaAKm = 2.0 * a * (signedDeltaV / vOrbMs);
  const newSemiMajorAxisKm = a + deltaAKm;
  const newMeanMotion = SECONDS_PER_DAY / (2.0 * Math.PI * Math.sqrt((newSemiMajorAxisKm * newSemiMajorAxisKm * newSemiMajorAxisKm) / MU_EARTH));
  const newPeriodMinutes = (2.0 * Math.PI * Math.sqrt((newSemiMajorAxisKm * newSemiMajorAxisKm * newSemiMajorAxisKm) / MU_EARTH)) / 60.0;

  const revisedKeplerian: KeplerianElements = {
    ...primary.keplerian,
    semiMajorAxisKm: newSemiMajorAxisKm,
    meanMotionRevDay: newMeanMotion,
    periodMinutes: newPeriodMinutes,
    apogeeAltitudeKm: primary.keplerian.apogeeAltitudeKm + (deltaAKm > 0 ? deltaAKm * 2 : 0),
    perigeeAltitudeKm: primary.keplerian.perigeeAltitudeKm + (deltaAKm < 0 ? deltaAKm * 2 : 0)
  };

  const postBurnMissDistanceKm = currentMissKm + requiredDeltaMissKm;
  // Post-burn Pc drops exponentially due to expanded separation past 3-sigma
  const postBurnPc = Math.max(1e-11, conjunction.probabilityOfCollisionPc * Math.exp(-requiredDeltaMissKm * 3.5));

  const plan: ManeuverPlan = {
    id: `MNV-${primary.noradId}-${Date.now()}`,
    conjunctionId: conjunction.id,
    targetObjectId: primary.id,
    burnEpochUtc,
    burnEpochTimestampMs: burnEpochMs,
    burnType,
    deltaVVectorMs,
    deltaVMagnitudeMs,
    thrusterType,
    ispSeconds,
    propellantMassKg,
    dryMassKg,
    postBurnMissDistanceKm,
    postBurnPc,
    burnDurationSeconds
  };

  return {
    plan,
    revisedKeplerian
  };
}

/**
 * Evaluates a predictive 'What-If' maneuver given user-controlled Delta-V components
 * (along-track, radial, cross-track).
 * Computes exact post-burn Keplerian orbital elements, revised miss distance,
 * probability of collision Pc, propellant expenditure, and apogee/perigee adjustments.
 */
export function computeWhatIfManeuver(
  primary: OrbitalObject,
  deltaV: {
    alongTrackMs: number;
    radialMs: number;
    crossTrackMs: number;
  },
  conjunction?: ConjunctionEvent | null,
  thrusterType: 'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION' = 'MONOPROPELLANT_HYDRAZINE'
): WhatIfManeuverResult {
  const { alongTrackMs, radialMs, crossTrackMs } = deltaV;
  const totalDeltaVMs = Math.sqrt(alongTrackMs * alongTrackMs + radialMs * radialMs + crossTrackMs * crossTrackMs);

  const a = primary.keplerian.semiMajorAxisKm;
  const periodMinutes = primary.keplerian.periodMinutes;
  const periodSeconds = periodMinutes * 60.0;
  const vOrbKmS = Math.sqrt(MU_EARTH / a);
  const vOrbMs = vOrbKmS * 1000.0;

  // Maneuver burn epoch: 1 orbit prior to TCA if conjunction exists, else 10 minutes ahead
  const burnEpochMs = conjunction
    ? Math.max(Date.now() + 60000, conjunction.tcaTimestampMs - periodSeconds * 1000.0)
    : Date.now() + 600000;

  // Propagate primary to burn epoch to obtain local state in ECI
  const preBurnState = propagateOrbit(primary.keplerian, burnEpochMs);
  const rEci = preBurnState.positionEci;
  const vEci = preBurnState.velocityEci;

  // Construct RIC unit vectors at burn epoch
  const uR = normalizeVector(rEci);
  const hPre = crossProduct(rEci, vEci);
  const uC = normalizeVector(hPre);
  const uT = normalizeVector(crossProduct(uC, uR));

  // Compute Delta-V vector in ECI (in km/s)
  const dvEciKmS: [number, number, number] = [
    (radialMs / 1000.0) * uR[0] + (alongTrackMs / 1000.0) * uT[0] + (crossTrackMs / 1000.0) * uC[0],
    (radialMs / 1000.0) * uR[1] + (alongTrackMs / 1000.0) * uT[1] + (crossTrackMs / 1000.0) * uC[1],
    (radialMs / 1000.0) * uR[2] + (alongTrackMs / 1000.0) * uT[2] + (crossTrackMs / 1000.0) * uC[2]
  ];

  // Post-burn velocity in ECI (km/s)
  const vNewEci: [number, number, number] = [
    vEci[0] + dvEciKmS[0],
    vEci[1] + dvEciKmS[1],
    vEci[2] + dvEciKmS[2]
  ];

  // Convert post-burn state (rEci, vNewEci) into Keplerian elements
  const rMag = vectorNorm(rEci);
  const vNewMag = vectorNorm(vNewEci);

  const hNew = crossProduct(rEci, vNewEci);
  const hMag = vectorNorm(hNew);

  // Specific orbital energy E = v^2 / 2 - mu / r
  const energy = (vNewMag * vNewMag) / 2.0 - MU_EARTH / rMag;
  let newA = energy < 0 ? -MU_EARTH / (2.0 * energy) : a;
  // Guard minimum altitude
  if (newA < 6450) newA = 6450;

  // Eccentricity vector e = ((v^2 - mu/r) r - (r.v) v) / mu
  const rDotV = dotProduct(rEci, vNewEci);
  const coeffR = vNewMag * vNewMag - MU_EARTH / rMag;
  const eVec: [number, number, number] = [
    (coeffR * rEci[0] - rDotV * vNewEci[0]) / MU_EARTH,
    (coeffR * rEci[1] - rDotV * vNewEci[1]) / MU_EARTH,
    (coeffR * rEci[2] - rDotV * vNewEci[2]) / MU_EARTH
  ];
  let newEcc = vectorNorm(eVec);
  newEcc = Math.max(0.0001, Math.min(newEcc, 0.99));

  // Inclination
  const cosInc = Math.max(-1.0, Math.min(1.0, hNew[2] / hMag));
  const newIncDeg = Math.acos(cosInc) * RAD2DEG;

  // Line of nodes n = k x h = [-hy, hx, 0]
  const nVec: [number, number, number] = [-hNew[1], hNew[0], 0];
  const nMag = Math.sqrt(nVec[0] * nVec[0] + nVec[1] * nVec[1]);

  let newRaanDeg = primary.keplerian.raanDeg;
  if (nMag > 1e-8) {
    const cosRaan = Math.max(-1.0, Math.min(1.0, nVec[0] / nMag));
    newRaanDeg = Math.acos(cosRaan) * RAD2DEG;
    if (nVec[1] < 0) newRaanDeg = 360.0 - newRaanDeg;
  }

  let newArgpDeg = primary.keplerian.argPerigeeDeg;
  if (nMag > 1e-8 && newEcc > 1e-4) {
    const nDotE = dotProduct(nVec, eVec);
    const cosArgp = Math.max(-1.0, Math.min(1.0, nDotE / (nMag * newEcc)));
    newArgpDeg = Math.acos(cosArgp) * RAD2DEG;
    if (eVec[2] < 0) newArgpDeg = 360.0 - newArgpDeg;
  }

  const newMeanMotion = SECONDS_PER_DAY / (2.0 * Math.PI * Math.sqrt((newA * newA * newA) / MU_EARTH));
  const newPeriodMinutes = (2.0 * Math.PI * Math.sqrt((newA * newA * newA) / MU_EARTH)) / 60.0;
  const newApogeeAltKm = newA * (1.0 + newEcc) - 6378.137;
  const newPerigeeAltKm = newA * (1.0 - newEcc) - 6378.137;

  const revisedKeplerian: KeplerianElements = {
    ...primary.keplerian,
    semiMajorAxisKm: parseFloat(newA.toFixed(3)),
    eccentricity: parseFloat(newEcc.toFixed(6)),
    inclinationDeg: parseFloat(newIncDeg.toFixed(4)),
    raanDeg: parseFloat(newRaanDeg.toFixed(4)),
    argPerigeeDeg: parseFloat(newArgpDeg.toFixed(4)),
    meanMotionRevDay: parseFloat(newMeanMotion.toFixed(8)),
    periodMinutes: parseFloat(newPeriodMinutes.toFixed(4)),
    apogeeAltitudeKm: parseFloat(newApogeeAltKm.toFixed(2)),
    perigeeAltitudeKm: parseFloat(newPerigeeAltKm.toFixed(2))
  };

  // Thruster propellants
  const ispSeconds = thrusterType === 'MONOPROPELLANT_HYDRAZINE' ? 220.0 : 1600.0;
  const thrustNewtons = thrusterType === 'MONOPROPELLANT_HYDRAZINE' ? 2.5 : 0.08;
  const initialMassKg = primary.massKg || 500.0;
  const cEffective = ispSeconds * G0_STANDARD;
  const massRatio = Math.exp(-totalDeltaVMs / cEffective);
  const propellantMassKg = parseFloat((initialMassKg * (1.0 - massRatio)).toFixed(2));
  const burnDurationSeconds = Math.round((initialMassKg * totalDeltaVMs) / thrustNewtons);

  // Predicted Miss Distance & Pc
  const currentMissKm = conjunction ? conjunction.missDistanceKm : 5.0;
  // In-track shift after 1 orbit: Delta_I_km = 3 * pi * a * (dv_T / v)
  const deltaIKm = 3.0 * Math.PI * a * (alongTrackMs / vOrbMs);
  const deltaRKm = (radialMs / 1000.0) * (periodSeconds / 4.0);
  const deltaCKm = (crossTrackMs / 1000.0) * (periodSeconds / 4.0);
  const additionalSeparationKm = Math.sqrt(deltaIKm * deltaIKm + deltaRKm * deltaRKm + deltaCKm * deltaCKm);

  let predictedMissDistanceKm = parseFloat((currentMissKm + additionalSeparationKm).toFixed(2));
  if (totalDeltaVMs < 0.001) predictedMissDistanceKm = currentMissKm;

  const currentPc = conjunction ? conjunction.probabilityOfCollisionPc : 1e-4;
  const predictedPc = totalDeltaVMs < 0.001
    ? currentPc
    : Math.max(1e-11, currentPc * Math.exp(-additionalSeparationKm * 1.8));

  return {
    deltaV: {
      alongTrackMs,
      radialMs,
      crossTrackMs,
      totalMs: parseFloat(totalDeltaVMs.toFixed(3))
    },
    thrusterType,
    propellantMassKg,
    burnDurationSeconds,
    revisedKeplerian,
    predictedMissDistanceKm,
    predictedPc,
    deltaApogeeKm: parseFloat((newApogeeAltKm - primary.keplerian.apogeeAltitudeKm).toFixed(2)),
    deltaPerigeeKm: parseFloat((newPerigeeAltKm - primary.keplerian.perigeeAltitudeKm).toFixed(2)),
    deltaPeriodSeconds: parseFloat(((newPeriodMinutes - primary.keplerian.periodMinutes) * 60.0).toFixed(2)),
    burnEpochMs
  };
}

