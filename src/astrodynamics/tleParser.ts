/**
 * High-Precision TLE (Two-Line Element Set) Parser
 * Conforms to NORAD / Space-Track format specification.
 */

import { DEG2RAD, MINUTES_PER_DAY, MU_EARTH, R_EARTH_EQUATORIAL_KM, SECONDS_PER_DAY } from './constants.ts';
import { KeplerianElements, ObjectClassification, OrbitRegime } from './types.ts';

export interface ParsedTLE {
  name: string;
  noradId: number;
  classification: ObjectClassification;
  intlDesignator: string;
  keplerian: KeplerianElements;
  line1: string;
  line2: string;
}

/**
 * Parses scientific notation in TLE format (e.g. " 12345-4" -> 0.12345e-4)
 */
function parseExpField(field: string): number {
  const trimmed = field.trim();
  if (!trimmed || trimmed === '00000-0' || trimmed === '00000+0' || trimmed === '0') {
    return 0;
  }
  
  // Format is usually Mantissa sign Exponent, e.g. "12345-4" or "-12345-4"
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const unsigned = trimmed.replace(/^[-+]/, '');
  
  // Find exponent sign (+ or -)
  const expMatch = unsigned.match(/([0-9]+)([+-])([0-9]+)/);
  if (expMatch) {
    const mantissa = parseFloat('0.' + expMatch[1]);
    const expSign = expMatch[2] === '-' ? -1 : 1;
    const exp = parseInt(expMatch[3], 10) * expSign;
    return sign * mantissa * Math.pow(10, exp);
  }
  
  return parseFloat(trimmed) || 0;
}

/**
 * Validates TLE modulo 10 checksum
 */
export function validateTLEChecksum(line: string): boolean {
  if (line.length < 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const char = line[i];
    if (char >= '0' && char <= '9') {
      sum += parseInt(char, 10);
    } else if (char === '-') {
      sum += 1;
    }
  }
  const expectedChecksum = parseInt(line[68], 10);
  return (sum % 10) === expectedChecksum;
}

/**
 * Classifies orbit regime (LEO, MEO, GEO, HEO) based on semi-major axis and eccentricity
 */
export function determineOrbitRegime(semiMajorAxisKm: number, eccentricity: number): OrbitRegime {
  const perigeeAlt = semiMajorAxisKm * (1 - eccentricity) - R_EARTH_EQUATORIAL_KM;
  const apogeeAlt = semiMajorAxisKm * (1 + eccentricity) - R_EARTH_EQUATORIAL_KM;
  
  if (eccentricity > 0.25) {
    return 'HEO'; // Highly Elliptical Orbit (Molniya, Tundra)
  }
  if (apogeeAlt <= 2000) {
    return 'LEO'; // Low Earth Orbit (< 2,000 km)
  }
  if (perigeeAlt >= 35500 && apogeeAlt <= 36500 && eccentricity < 0.05) {
    return 'GEO'; // Geostationary / Geosynchronous (~35,786 km)
  }
  return 'MEO'; // Medium Earth Orbit (e.g. GPS, Galileo, GLONASS)
}

/**
 * Parses raw 2-line or 3-line TLE strings
 */
export function parseTLE(rawInput: string, defaultName?: string): ParsedTLE {
  const lines = rawInput
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let name = defaultName || 'TRACKED_OBJECT';
  let line1 = '';
  let line2 = '';

  if (lines.length === 1) {
    throw new Error('TLE requires at least 2 lines of data.');
  } else if (lines.length === 2) {
    line1 = lines[0];
    line2 = lines[1];
  } else {
    name = lines[0].replace(/^0\s+/, '').trim();
    line1 = lines[1];
    line2 = lines[2];
  }

  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw new Error('Invalid TLE format: Line 1 must start with "1 " and Line 2 with "2 "');
  }

  // Parse Line 1
  const noradId = parseInt(line1.substring(2, 7).trim(), 10);
  const classChar = line1.substring(7, 8).trim();
  const intlDesignator = line1.substring(9, 17).trim();
  const epochYear2Digit = parseInt(line1.substring(18, 20).trim(), 10);
  const epochYear = epochYear2Digit < 57 ? 2000 + epochYear2Digit : 1900 + epochYear2Digit;
  const epochDay = parseFloat(line1.substring(20, 32).trim());
  const bstarDrag = parseExpField(line1.substring(53, 61));

  // Parse Line 2
  const inclinationDeg = parseFloat(line2.substring(8, 16).trim());
  const raanDeg = parseFloat(line2.substring(17, 25).trim());
  const eccRaw = line2.substring(26, 33).trim();
  const eccentricity = parseFloat('0.' + eccRaw);
  const argPerigeeDeg = parseFloat(line2.substring(34, 42).trim());
  const meanAnomalyDeg = parseFloat(line2.substring(43, 51).trim());
  const meanMotionRevDay = parseFloat(line2.substring(52, 63).trim());

  // Derive semi-major axis from mean motion using Kepler's 3rd Law:
  // n (rad/s) = meanMotionRevDay * 2*pi / SECONDS_PER_DAY
  // a = (mu / n^2)^(1/3)
  const nRadPerSec = (meanMotionRevDay * 2.0 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH / (nRadPerSec * nRadPerSec));
  const periodMinutes = MINUTES_PER_DAY / meanMotionRevDay;

  const perigeeAltitudeKm = semiMajorAxisKm * (1.0 - eccentricity) - R_EARTH_EQUATORIAL_KM;
  const apogeeAltitudeKm = semiMajorAxisKm * (1.0 + eccentricity) - R_EARTH_EQUATORIAL_KM;

  let classification: ObjectClassification = 'ACTIVE_PAYLOAD';
  const upperName = name.toUpperCase();
  if (upperName.includes('DEB') || upperName.includes('DEBRIS') || classChar === 'D') {
    classification = 'DEBRIS';
  } else if (upperName.includes('R/B') || upperName.includes('ROCKET') || upperName.includes('STAGE')) {
    classification = 'ROCKET_BODY';
  }

  const keplerian: KeplerianElements = {
    semiMajorAxisKm,
    eccentricity,
    inclinationDeg,
    raanDeg,
    argPerigeeDeg,
    meanAnomalyDeg,
    meanMotionRevDay,
    epochYear,
    epochDay,
    bstarDrag,
    periodMinutes,
    apogeeAltitudeKm,
    perigeeAltitudeKm
  };

  return {
    name,
    noradId,
    classification,
    intlDesignator,
    keplerian,
    line1,
    line2
  };
}
