/**
 * Ground Station Tracking Networks & Line-of-Sight (LOS) Downlink Geometry
 * Conforms to USSF Satellite Control Network (AFSCN) & NASA Space Network specifications.
 */

import { DEG2RAD, R_EARTH_EQUATORIAL_KM, RAD2DEG } from './constants.ts';
import { eciToEcef, dotProduct, vectorNorm } from './coordinates.ts';

export interface GroundStation {
  id: string;
  name: string;
  callsign: string;
  network: 'USSF_AFSCN' | 'NASA_DSN' | 'SVALSAT' | 'ESA_ESTRACK';
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeMeters: number;
  minElevationDeg: number; // Mask angle (typically 5 to 10 degrees)
  maxRangeKm: number;      // Maximum operational tracking range (LEO/MEO horizon)
  positionEcef: [number, number, number]; // [X, Y, Z] in km
  zenithNormalEcef: [number, number, number]; // Unit vector normal to surface
}

export interface DownlinkPassState {
  station: GroundStation;
  inView: boolean;
  elevationDeg: number;
  azimuthDeg: number;
  rangeKm: number;
  signalStrengthDbm: number;
  dataRateMbps: number;
}

// Global Ground Tracking Stations
export const GROUND_STATIONS_CATALOG: GroundStation[] = [
  {
    id: 'GS-THULE',
    name: 'Thule Tracking Station (TTS)',
    callsign: 'POGO',
    network: 'USSF_AFSCN',
    latitudeDeg: 76.5312,
    longitudeDeg: -68.7032,
    altitudeMeters: 65,
    minElevationDeg: 5.0,
    maxRangeKm: 2800,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-SCHRIEVER',
    name: 'Schriever Space Force Base',
    callsign: 'COLORADO',
    network: 'USSF_AFSCN',
    latitudeDeg: 38.8021,
    longitudeDeg: -104.5262,
    altitudeMeters: 1910,
    minElevationDeg: 7.0,
    maxRangeKm: 2500,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-VANDENBERG',
    name: 'Vandenberg Tracking Station',
    callsign: 'COOK',
    network: 'USSF_AFSCN',
    latitudeDeg: 34.7420,
    longitudeDeg: -120.5724,
    altitudeMeters: 112,
    minElevationDeg: 5.0,
    maxRangeKm: 2600,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-DIEGO-GARCIA',
    name: 'Diego Garcia Tracking Station',
    callsign: 'REEF',
    network: 'USSF_AFSCN',
    latitudeDeg: -7.3134,
    longitudeDeg: 72.4111,
    altitudeMeters: 3,
    minElevationDeg: 5.0,
    maxRangeKm: 2700,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-GUAM',
    name: 'Guam Tracking Station',
    callsign: 'GUAM',
    network: 'USSF_AFSCN',
    latitudeDeg: 13.5841,
    longitudeDeg: 144.9245,
    altitudeMeters: 160,
    minElevationDeg: 5.0,
    maxRangeKm: 2600,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-KAENA-POINT',
    name: 'Kaena Point Satellite Station',
    callsign: 'HULA',
    network: 'USSF_AFSCN',
    latitudeDeg: 21.5742,
    longitudeDeg: -158.2691,
    altitudeMeters: 380,
    minElevationDeg: 5.0,
    maxRangeKm: 2600,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-SVALBARD',
    name: 'Svalbard Satellite Station (SvalSat)',
    callsign: 'SVALBARD',
    network: 'SVALSAT',
    latitudeDeg: 78.2311,
    longitudeDeg: 15.4082,
    altitudeMeters: 450,
    minElevationDeg: 5.0,
    maxRangeKm: 3000,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  },
  {
    id: 'GS-NEW-BOSTON',
    name: 'New Boston Space Force Station',
    callsign: 'BOSS',
    network: 'USSF_AFSCN',
    latitudeDeg: 42.9912,
    longitudeDeg: -71.6421,
    altitudeMeters: 220,
    minElevationDeg: 6.0,
    maxRangeKm: 2500,
    positionEcef: [0, 0, 0],
    zenithNormalEcef: [0, 0, 0]
  }
];

// Initialize ECEF positions and zenith normals
GROUND_STATIONS_CATALOG.forEach(gs => {
  const phiRad = gs.latitudeDeg * DEG2RAD;
  const lambdaRad = gs.longitudeDeg * DEG2RAD;
  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);
  const cosLambda = Math.cos(lambdaRad);
  const sinLambda = Math.sin(lambdaRad);

  // Surface radius in km
  const rKm = R_EARTH_EQUATORIAL_KM + gs.altitudeMeters / 1000.0;
  
  gs.positionEcef = [
    rKm * cosPhi * cosLambda,
    rKm * cosPhi * sinLambda,
    rKm * sinPhi
  ];

  gs.zenithNormalEcef = [
    cosPhi * cosLambda,
    cosPhi * sinLambda,
    sinPhi
  ];
});

/**
 * Checks Line-of-Sight (LOS) for a satellite relative to a ground station
 * Satellite position is provided in ECI coordinates [X, Y, Z] in km.
 */
export function checkStationLineOfSight(
  station: GroundStation,
  satPositionEci: [number, number, number],
  gmstRad: number
): DownlinkPassState {
  // Convert station ECEF position to ECI at current GMST
  // ECEF -> ECI is rotation around Z by +GMST:
  // x_eci = x_ecef * cosT - y_ecef * sinT
  // y_eci = x_ecef * sinT + y_ecef * cosT
  const cosT = Math.cos(gmstRad);
  const sinT = Math.sin(gmstRad);

  const [xEcef, yEcef, zEcef] = station.positionEcef;
  const gsEci: [number, number, number] = [
    xEcef * cosT - yEcef * sinT,
    xEcef * sinT + yEcef * cosT,
    zEcef
  ];

  const [nxEcef, nyEcef, nzEcef] = station.zenithNormalEcef;
  const zenithEci: [number, number, number] = [
    nxEcef * cosT - nyEcef * sinT,
    nxEcef * sinT + nyEcef * cosT,
    nzEcef
  ];

  // Range vector rho = sat - gs
  const rho: [number, number, number] = [
    satPositionEci[0] - gsEci[0],
    satPositionEci[1] - gsEci[1],
    satPositionEci[2] - gsEci[2]
  ];
  const rangeKm = vectorNorm(rho);

  // Elevation angle: sin(el) = (rho . zenith) / |rho|
  const dotZenith = dotProduct(rho, zenithEci);
  const sinElevation = Math.max(-1.0, Math.min(1.0, dotZenith / rangeKm));
  const elevationDeg = Math.asin(sinElevation) * RAD2DEG;

  // Azimuth calculation
  // Local East: [-sinLambda, cosLambda, 0] in ECEF
  // Local North: [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi] in ECEF
  const phiRad = station.latitudeDeg * DEG2RAD;
  const lambdaRad = station.longitudeDeg * DEG2RAD;

  const eastEcef: [number, number, number] = [-Math.sin(lambdaRad), Math.cos(lambdaRad), 0];
  const northEcef: [number, number, number] = [
    -Math.sin(phiRad) * Math.cos(lambdaRad),
    -Math.sin(phiRad) * Math.sin(lambdaRad),
    Math.cos(phiRad)
  ];

  const eastEci: [number, number, number] = [
    eastEcef[0] * cosT - eastEcef[1] * sinT,
    eastEcef[0] * sinT + eastEcef[1] * cosT,
    eastEcef[2]
  ];
  const northEci: [number, number, number] = [
    northEcef[0] * cosT - northEcef[1] * sinT,
    northEcef[0] * sinT + northEcef[1] * cosT,
    northEcef[2]
  ];

  const rhoEast = dotProduct(rho, eastEci);
  const rhoNorth = dotProduct(rho, northEci);
  let azimuthDeg = Math.atan2(rhoEast, rhoNorth) * RAD2DEG;
  if (azimuthDeg < 0) azimuthDeg += 360.0;

  // In view if elevation exceeds minimum mask and within operational range
  const inView = elevationDeg >= station.minElevationDeg && rangeKm <= station.maxRangeKm;

  // Telemetry Link Budget Estimation
  let signalStrengthDbm = -110;
  let dataRateMbps = 0;
  if (inView) {
    // Higher elevation -> shorter path -> higher SNR
    const pathLoss = 20 * Math.log10(Math.max(1, rangeKm)) + 140;
    signalStrengthDbm = Math.max(-95, -60 - (pathLoss / 5));
    dataRateMbps = Math.max(10, Math.round(150 * (elevationDeg / 90)));
  }

  return {
    station,
    inView,
    elevationDeg,
    azimuthDeg,
    rangeKm,
    signalStrengthDbm,
    dataRateMbps
  };
}
