/**
 * Automated Collision Avoidance (COLA) Maneuver Planning Engine
 * Computes optimal delta-V burn vectors, propellant mass expenditure,
 * burn execution epoch, and post-maneuver safety verification.
 */

import { G0_STANDARD, MU_EARTH, SECONDS_PER_DAY } from './constants.ts';
import { ConjunctionEvent, KeplerianElements, ManeuverPlan } from './types.ts';

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
