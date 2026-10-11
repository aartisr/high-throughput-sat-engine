/**
 * Solar Position & Satellite Eclipse Calculator
 * Computes the Sun's position in ECI J2000 coordinates using the Astronomical Almanac standard,
 * calculates Earth shadow geometry (Umbra & Penumbra cones), and detects satellite eclipse events.
 */

import { DEG2RAD, R_EARTH_EQUATORIAL_KM, RAD2DEG } from './constants.ts';
import { dotProduct, vectorNorm } from './coordinates.ts';
import { KeplerianElements } from './types.ts';
import { propagateOrbit } from './propagator.ts';

// Solar physical constants
export const R_SUN_KM = 696340.0;
export const AU_KM = 149597870.7;

export type EclipseState = 'SUNLIGHT' | 'PENUMBRA' | 'UMBRA';

export interface SolarPosition {
  sunVectorEci: [number, number, number]; // Unit vector towards Sun in ECI
  subSolarPoint: { latitudeDeg: number; longitudeDeg: number };
  distanceKm: number;
  declinationDeg: number;
  rightAscensionDeg: number;
}

export interface SatelliteEclipseResult {
  state: EclipseState;
  illuminationFraction: number; // 1.0 = full sun, 0.0 = total eclipse
  umbraDistanceKm: number;      // Distance from shadow axis
  penumbraRadiusKm: number;
}

/**
 * Computes the Sun's position in ECI (J2000) from Julian Date
 * Reference: Montenbruck & Gill, "Satellite Orbits", Section 3.3.2
 */
export function calculateSunPositionEci(julianDate: number): SolarPosition {
  // Centuries since J2000.0
  const T = (julianDate - 2451545.0) / 36525.0;

  // Geometric mean longitude of the Sun (deg)
  let L0 = 280.46646 + 36000.76983 * T;
  L0 = ((L0 % 360.0) + 360.0) % 360.0;

  // Mean anomaly of the Sun (deg)
  let M = 357.52911 + 35999.05029 * T;
  M = ((M % 360.0) + 360.0) % 360.0;
  const mRad = M * DEG2RAD;

  // Sun's Equation of the Center (deg)
  const C = (1.914602 - 0.004817 * T) * Math.sin(mRad) +
            (0.019993 - 0.000101 * T) * Math.sin(2.0 * mRad) +
            0.000289 * Math.sin(3.0 * mRad);

  // True longitude of the Sun (deg)
  const trueLonDeg = L0 + C;
  const trueLonRad = trueLonDeg * DEG2RAD;

  // Obliquity of the ecliptic (deg)
  const epsDeg = 23.439291 - 0.0130042 * T;
  const epsRad = epsDeg * DEG2RAD;

  // Unit vector towards the Sun in ECI J2000
  const Sx = Math.cos(trueLonRad);
  const Sy = Math.sin(trueLonRad) * Math.cos(epsRad);
  const Sz = Math.sin(trueLonRad) * Math.sin(epsRad);

  // Sun distance in km (taking eccentricity into account)
  const eSun = 0.016708634 - 0.000042037 * T;
  const rAu = (1.000001018 * (1.0 - eSun * eSun)) / (1.0 + eSun * Math.cos(mRad));
  const distanceKm = rAu * AU_KM;

  const declinationDeg = Math.asin(Sz) * RAD2DEG;
  let rightAscensionDeg = Math.atan2(Sy, Sx) * RAD2DEG;
  if (rightAscensionDeg < 0) rightAscensionDeg += 360.0;

  return {
    sunVectorEci: [Sx, Sy, Sz],
    subSolarPoint: {
      latitudeDeg: declinationDeg,
      longitudeDeg: rightAscensionDeg > 180 ? rightAscensionDeg - 360 : rightAscensionDeg
    },
    distanceKm,
    declinationDeg,
    rightAscensionDeg
  };
}

/**
 * Determines whether a satellite in ECI position is in sunlight, penumbra, or umbra (eclipse)
 * Uses conical shadow model with Earth radius R_E and Sun radius R_sun.
 */
export function calculateSatelliteEclipse(
  satPositionEci: [number, number, number],
  sunVectorEci: [number, number, number]
): SatelliteEclipseResult {
  // Projection of satellite position along Sun vector
  const sDotR = dotProduct(satPositionEci, sunVectorEci);

  // If satellite is on the daytime side of Earth, it is in full sunlight
  if (sDotR >= 0) {
    return {
      state: 'SUNLIGHT',
      illuminationFraction: 1.0,
      umbraDistanceKm: 0,
      penumbraRadiusKm: R_EARTH_EQUATORIAL_KM
    };
  }

  // Distance along shadow axis behind Earth
  const zShadow = Math.abs(sDotR);

  // Perpendicular distance from shadow axis
  const rNormSq = satPositionEci[0] * satPositionEci[0] +
                  satPositionEci[1] * satPositionEci[1] +
                  satPositionEci[2] * satPositionEci[2];
  const rPerpSq = Math.max(0, rNormSq - sDotR * sDotR);
  const dPerp = Math.sqrt(rPerpSq);

  // Umbra cone radius at distance zShadow behind Earth:
  // R_umbra = R_E - zShadow * tan(theta_umbra)
  // tan(theta_umbra) = (R_sun - R_E) / AU_KM
  const tanUmbra = (R_SUN_KM - R_EARTH_EQUATORIAL_KM) / AU_KM;
  const rUmbra = Math.max(0, R_EARTH_EQUATORIAL_KM - zShadow * tanUmbra);

  // Penumbra cone radius at distance zShadow behind Earth:
  // R_penumbra = R_E + zShadow * tan(theta_penumbra)
  // tan(theta_penumbra) = (R_sun + R_E) / AU_KM
  const tanPenumbra = (R_SUN_KM + R_EARTH_EQUATORIAL_KM) / AU_KM;
  const rPenumbra = R_EARTH_EQUATORIAL_KM + zShadow * tanPenumbra;

  if (dPerp <= rUmbra) {
    // Inside Umbra: total eclipse (no direct sunlight)
    return {
      state: 'UMBRA',
      illuminationFraction: 0.0,
      umbraDistanceKm: dPerp,
      penumbraRadiusKm: rPenumbra
    };
  } else if (dPerp <= rPenumbra) {
    // Inside Penumbra: partial eclipse
    const fraction = (dPerp - rUmbra) / Math.max(1.0, rPenumbra - rUmbra);
    return {
      state: 'PENUMBRA',
      illuminationFraction: Math.max(0.05, Math.min(0.95, fraction)),
      umbraDistanceKm: dPerp,
      penumbraRadiusKm: rPenumbra
    };
  }

  return {
    state: 'SUNLIGHT',
    illuminationFraction: 1.0,
    umbraDistanceKm: dPerp,
    penumbraRadiusKm: rPenumbra
  };
}

/**
 * Computes segmented orbit points categorized into sunlight vs eclipse (umbra/penumbra)
 * for dual-color trail visualization.
 */
export function segmentOrbitEclipsePath(
  keplerian: KeplerianElements,
  timestampMs: number,
  sunVectorEci: [number, number, number],
  samples: number = 96
): {
  sunlightPoints: [number, number, number][];
  eclipsePoints: [number, number, number][];
} {
  const sunlightPoints: [number, number, number][] = [];
  const eclipsePoints: [number, number, number][] = [];

  const periodSec = keplerian.periodMinutes * 60.0;
  const dt = periodSec / samples;

  for (let i = 0; i <= samples; i++) {
    const t = timestampMs + i * dt * 1000.0;
    const state = propagateOrbit(keplerian, t);
    const eclipse = calculateSatelliteEclipse(state.positionEci, sunVectorEci);

    if (eclipse.state === 'UMBRA' || eclipse.state === 'PENUMBRA') {
      eclipsePoints.push(state.positionEci);
    } else {
      sunlightPoints.push(state.positionEci);
    }
  }

  return {
    sunlightPoints,
    eclipsePoints
  };
}
