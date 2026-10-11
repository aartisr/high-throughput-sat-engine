/**
 * Subsystem Health Heatmap Widget
 * Displays a real-time matrix heatmap of battery (EPS), thermal (TCS),
 * attitude determination (ADCS), communications (COMM), and propulsion (PROP)
 * across all tracked spacecraft and orbital assets.
 * 
 * Supports both:
 * 1. Compact Dashboard Widget mode (fits cleanly into BottomTelemetryTray cards)
 * 2. Full Fleet Matrix mode (searchable, filterable high-density table)
 */

import React, { useState, useMemo } from 'react';
import { OrbitalObject } from '../astrodynamics/types.ts';
import { calculateSunPositionEci, calculateSatelliteEclipse } from '../astrodynamics/solarCalculator.ts';
import { getJulianDate } from '../astrodynamics/coordinates.ts';
import {
  Battery,
  Thermometer,
  Compass,
  Radio,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Maximize2,
  Zap,
  Activity
} from 'lucide-react';

export interface SubsystemTelemetry {
  objectId: string;
  noradId: number;
  name: string;
  classification: string;
  regime: string;
  isEclipse: boolean;
  batterySocPct: number;
  batteryVoltageV: number;
  thermalTempC: number;
  adcsPointingDeg: number;
  adcsStatus: 'LOCKED' | 'SLEWING' | 'TUMBLING';
  commSnrDb: number;
  commStatus: 'LOCKED' | 'RELAY' | 'OFFLINE';
  propPressureBar: number;
  overallScore: number;
}

interface SubsystemHeatmapWidgetProps {
  objects?: OrbitalObject[];
  selectedObject?: OrbitalObject | null;
  onSelectObject?: (obj: OrbitalObject) => void;
  currentTimeMs: number;
  compact?: boolean;
  onExpandMatrix?: () => void;
}

export const SubsystemHeatmapWidget: React.FC<SubsystemHeatmapWidgetProps> = ({
  objects = [],
  selectedObject,
  onSelectObject,
  currentTimeMs,
  compact = false,
  onExpandMatrix
}) => {
  const [filterRegime, setFilterRegime] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [compactMetric, setCompactMetric] = useState<'OVERALL' | 'BATTERY' | 'THERMAL'>('OVERALL');
  const [hoveredObject, setHoveredObject] = useState<SubsystemTelemetry | null>(null);

  // Compute live subsystem telemetry for each satellite based on orbital physics
  const telemetryData: SubsystemTelemetry[] = useMemo(() => {
    const jd = getJulianDate(currentTimeMs);
    const sunPos = calculateSunPositionEci(jd);
    const tSec = currentTimeMs / 1000;

    return (objects || []).slice(0, 48).map((obj, idx) => {
      const isDebris = obj.classification === 'DEBRIS' || obj.classification === 'ROCKET_BODY';
      const eclipse = calculateSatelliteEclipse(obj.currentState.positionEci, sunPos.sunVectorEci);
      const inEclipse = eclipse.state === 'UMBRA';

      // Battery State of Charge (EPS)
      let batterySocPct = 96.0;
      let batteryVoltageV = 48.2;
      if (isDebris) {
        batterySocPct = 0;
        batteryVoltageV = 0;
      } else if (inEclipse) {
        // Battery discharge during umbra pass
        const discharge = ((idx * 7) % 18) + 12;
        batterySocPct = Math.max(55, 96 - discharge);
        batteryVoltageV = 44.5;
      } else {
        // Full sunlight charge with slight sinusoidal solar array fluctuation
        const jitter = Math.sin(tSec * 0.2 + idx) * 3.5;
        batterySocPct = Math.min(100, Math.max(88, 95 + jitter));
        batteryVoltageV = 51.4;
      }

      // Thermal Control Subsystem (TCS)
      let thermalTempC = 21.0;
      if (isDebris) {
        thermalTempC = inEclipse ? -45.0 : 75.0;
      } else if (inEclipse) {
        thermalTempC = Math.round(11.0 + Math.sin(idx) * 4);
      } else {
        thermalTempC = Math.round(26.0 + Math.sin(tSec * 0.15 + idx) * 6);
      }

      // ADCS Pointing
      let adcsPointingDeg = 0.02;
      let adcsStatus: 'LOCKED' | 'SLEWING' | 'TUMBLING' = 'LOCKED';
      if (isDebris) {
        adcsPointingDeg = 18.5;
        adcsStatus = 'TUMBLING';
      } else if (idx % 8 === 0) {
        adcsPointingDeg = 0.45;
        adcsStatus = 'SLEWING';
      } else {
        adcsPointingDeg = parseFloat((0.01 + ((idx % 5) * 0.01)).toFixed(2));
      }

      // COMM Transponder
      let commSnrDb = 19.5;
      let commStatus: 'LOCKED' | 'RELAY' | 'OFFLINE' = 'LOCKED';
      if (isDebris) {
        commSnrDb = 0;
        commStatus = 'OFFLINE';
      } else if (idx % 6 === 0) {
        commSnrDb = 11.2;
        commStatus = 'RELAY';
      } else {
        commSnrDb = parseFloat((18.0 + Math.sin(tSec * 0.3 + idx) * 4).toFixed(1));
      }

      // Propulsion Tank Pressure
      let propPressureBar = 18.5;
      if (isDebris) {
        propPressureBar = 0;
      } else {
        propPressureBar = parseFloat((19.5 - (idx * 0.12)).toFixed(1));
      }

      // Overall health score (0 to 100)
      let overallScore = isDebris ? 15 : Math.round((batterySocPct * 0.4) + (Math.max(0, 100 - thermalTempC) * 0.2) + (commSnrDb * 1.5) + (propPressureBar * 1.2));
      overallScore = Math.min(100, Math.max(0, overallScore));

      return {
        objectId: obj.id,
        noradId: obj.noradId,
        name: obj.name,
        classification: obj.classification,
        regime: obj.regime,
        isEclipse: inEclipse,
        batterySocPct: parseFloat(batterySocPct.toFixed(1)),
        batteryVoltageV,
        thermalTempC,
        adcsPointingDeg,
        adcsStatus,
        commSnrDb,
        commStatus,
        propPressureBar,
        overallScore
      };
    });
  }, [objects, currentTimeMs]);

  // Filter list
  const filteredTelemetry = useMemo(() => {
    return telemetryData.filter(d => {
      const q = searchFilter.trim().toLowerCase();
      if (q && !d.name.toLowerCase().includes(q) && !d.noradId.toString().includes(q)) {
        return false;
      }
      if (filterRegime === 'ALL') return true;
      if (filterRegime === 'PAYLOAD') return d.classification === 'ACTIVE_PAYLOAD';
      if (filterRegime === 'DEBRIS') return d.classification === 'DEBRIS';
      return d.regime === filterRegime;
    });
  }, [telemetryData, searchFilter, filterRegime]);

  // Summary counts
  const { nominalCount, warningCount, eclipseCount, avgHealth } = useMemo(() => {
    let nom = 0;
    let warn = 0;
    let ecl = 0;
    let sumScore = 0;
    telemetryData.forEach(d => {
      if (d.overallScore >= 75) nom++;
      else warn++;
      if (d.isEclipse) ecl++;
      sumScore += d.overallScore;
    });
    return {
      nominalCount: nom,
      warningCount: warn,
      eclipseCount: ecl,
      avgHealth: telemetryData.length > 0 ? Math.round(sumScore / telemetryData.length) : 100
    };
  }, [telemetryData]);

  // Color mapping helper for discrete heatmap ramp
  const getBatteryColorClass = (soc: number, isDebris: boolean) => {
    if (isDebris) return 'bg-slate-800 text-slate-500';
    if (soc >= 88) return 'bg-emerald-500/80 text-emerald-950 font-bold';
    if (soc >= 70) return 'bg-cyan-500/80 text-cyan-950 font-bold';
    if (soc >= 50) return 'bg-amber-500/80 text-amber-950 font-bold';
    return 'bg-rose-500/80 text-rose-950 font-bold';
  };

  const getThermalColorClass = (temp: number, isDebris: boolean) => {
    if (isDebris) return 'bg-slate-800 text-slate-500';
    if (temp >= 14 && temp <= 32) return 'bg-emerald-500/80 text-emerald-950 font-bold';
    if (temp < 14) return 'bg-cyan-500/80 text-cyan-950 font-bold';
    if (temp <= 45) return 'bg-amber-500/80 text-amber-950 font-bold';
    return 'bg-rose-500/80 text-rose-950 font-bold';
  };

  const getAdcsColorClass = (status: string, deg: number) => {
    if (status === 'TUMBLING') return 'bg-slate-800 text-slate-500';
    if (deg <= 0.05) return 'bg-emerald-500/80 text-emerald-950 font-bold';
    if (deg <= 0.2) return 'bg-cyan-500/80 text-cyan-950 font-bold';
    return 'bg-amber-500/80 text-amber-950 font-bold';
  };

  const getCommColorClass = (status: string, snr: number) => {
    if (status === 'OFFLINE') return 'bg-slate-800 text-slate-500';
    if (snr >= 16) return 'bg-emerald-500/80 text-emerald-950 font-bold';
    if (snr >= 10) return 'bg-amber-500/80 text-amber-950 font-bold';
    return 'bg-rose-500/80 text-rose-950 font-bold';
  };

  const getPropColorClass = (pressure: number, isDebris: boolean) => {
    if (isDebris) return 'bg-slate-800 text-slate-500';
    if (pressure >= 15) return 'bg-emerald-500/80 text-emerald-950 font-bold';
    if (pressure >= 10) return 'bg-cyan-500/80 text-cyan-950 font-bold';
    if (pressure > 0) return 'bg-amber-500/80 text-amber-950 font-bold';
    return 'bg-slate-800 text-slate-500';
  };

  const getCompactCellColor = (d: SubsystemTelemetry) => {
    const isDebris = d.classification === 'DEBRIS' || d.classification === 'ROCKET_BODY';
    if (isDebris) return 'bg-slate-800 border-slate-700/60 text-slate-600';

    if (compactMetric === 'BATTERY') {
      if (d.batterySocPct >= 88) return 'bg-emerald-500/80 hover:bg-emerald-400 border-emerald-500/60 text-emerald-950';
      if (d.batterySocPct >= 70) return 'bg-cyan-500/80 hover:bg-cyan-400 border-cyan-500/60 text-cyan-950';
      if (d.batterySocPct >= 50) return 'bg-amber-500/80 hover:bg-amber-400 border-amber-500/60 text-amber-950';
      return 'bg-rose-500/80 hover:bg-rose-400 border-rose-500/60 text-rose-950';
    }

    if (compactMetric === 'THERMAL') {
      if (d.thermalTempC >= 14 && d.thermalTempC <= 32) return 'bg-emerald-500/80 hover:bg-emerald-400 border-emerald-500/60 text-emerald-950';
      if (d.thermalTempC < 14) return 'bg-cyan-500/80 hover:bg-cyan-400 border-cyan-500/60 text-cyan-950';
      if (d.thermalTempC <= 45) return 'bg-amber-500/80 hover:bg-amber-400 border-amber-500/60 text-amber-950';
      return 'bg-rose-500/80 hover:bg-rose-400 border-rose-500/60 text-rose-950';
    }

    // OVERALL
    if (d.overallScore >= 80) return 'bg-emerald-500/80 hover:bg-emerald-400 border-emerald-500/60 text-emerald-950';
    if (d.overallScore >= 65) return 'bg-cyan-500/80 hover:bg-cyan-400 border-cyan-500/60 text-cyan-950';
    if (d.overallScore >= 45) return 'bg-amber-500/80 hover:bg-amber-400 border-amber-500/60 text-amber-950';
    return 'bg-rose-500/80 hover:bg-rose-400 border-rose-500/60 text-rose-950';
  };

  // Currently selected object's live telemetry if matched
  const selectedTelemetry = useMemo(() => {
    if (!selectedObject) return null;
    return telemetryData.find(d => d.objectId === selectedObject.id) || null;
  }, [telemetryData, selectedObject]);

  // --------------------------------------------------------------------------
  // COMPACT WIDGET MODE (Fits inside BottomTelemetryTray card)
  // --------------------------------------------------------------------------
  if (compact) {
    return (
      <div className="w-full h-full flex flex-col justify-between select-none">
        {/* Compact Widget Header */}
        <div className="flex items-center justify-between text-[11px] mb-1">
          <div className="flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-300 font-semibold truncate">FLEET HEALTH HEATMAP</span>
          </div>

          <div className="flex items-center gap-1">
            {/* Metric Mode Selector */}
            <div className="flex items-center p-0.5 bg-[#07090E] rounded border border-slate-800 text-[9px]">
              <button
                onClick={() => setCompactMetric('OVERALL')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  compactMetric === 'OVERALL'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Overall Subsystem Health"
              >
                ALL
              </button>
              <button
                onClick={() => setCompactMetric('BATTERY')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  compactMetric === 'BATTERY'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Battery State of Charge (EPS)"
              >
                BAT
              </button>
              <button
                onClick={() => setCompactMetric('THERMAL')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  compactMetric === 'THERMAL'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Thermal Temperature (TCS)"
              >
                TEMP
              </button>
            </div>

            {/* Expand to Full Matrix Button */}
            {onExpandMatrix && (
              <button
                onClick={onExpandMatrix}
                className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                title="Expand to Full Fleet Matrix View"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Real-Time Interactive Heatmap Matrix Grid */}
        <div className="relative w-full h-16 flex items-center justify-center bg-[#07090E]/60 rounded border border-slate-800/80 p-1 overflow-hidden">
          <div className="grid grid-cols-12 gap-1 w-full h-full">
            {telemetryData.slice(0, 36).map((item) => {
              const isSelected = selectedObject?.id === item.objectId;
              const colorClass = getCompactCellColor(item);

              return (
                <div
                  key={item.objectId}
                  onClick={() => {
                    const matchedObj = objects.find(o => o.id === item.objectId);
                    if (matchedObj && onSelectObject) onSelectObject(matchedObj);
                  }}
                  onMouseEnter={() => setHoveredObject(item)}
                  onMouseLeave={() => setHoveredObject(null)}
                  className={`relative rounded-xs border cursor-pointer transition-all duration-150 ${colorClass} ${
                    isSelected ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-[#07090E] scale-110 z-10' : ''
                  }`}
                  title={`${item.name} (#${item.noradId})\nBattery: ${item.batterySocPct}%\nThermal: ${item.thermalTempC}°C\nADCS: ${item.adcsStatus}\nCOMM: ${item.commSnrDb}dB\nHealth: ${item.overallScore}%`}
                />
              );
            })}
          </div>

          {/* Floating Hover Tooltip overlay */}
          {hoveredObject && (
            <div className="absolute top-1 left-2 right-2 bg-[#0B0E17]/95 border border-cyan-500/60 rounded px-2 py-1 text-[10px] font-mono shadow-xl flex items-center justify-between pointer-events-none z-20">
              <span className="text-cyan-300 font-bold truncate max-w-[120px]">
                {hoveredObject.name}
              </span>
              <div className="flex items-center gap-2 text-slate-300">
                <span>SoC: <strong className="text-emerald-400">{hoveredObject.batterySocPct}%</strong></span>
                <span>TCS: <strong className="text-cyan-400">{hoveredObject.thermalTempC}°C</strong></span>
                <span>Score: <strong className="text-amber-300">{hoveredObject.overallScore}%</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Sub-bar Status */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
          <span className="truncate">
            {selectedTelemetry ? (
              <>
                <strong className="text-cyan-300">{selectedTelemetry.name}</strong>: {selectedTelemetry.batterySocPct}% SoC · {selectedTelemetry.thermalTempC}°C
              </>
            ) : (
              <span>Nom: <strong className="text-emerald-400">{nominalCount}</strong> · Warn: <strong className="text-amber-400">{warningCount}</strong></span>
            )}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <span>Eclipse: <strong className="text-cyan-300">{eclipseCount}</strong></span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-400 font-bold">{avgHealth}% avg</span>
          </span>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // FULL EXPANDED MATRIX MODE (Searchable, filterable high-density table)
  // --------------------------------------------------------------------------
  return (
    <div className="w-full flex flex-col justify-between bg-[#0F172A] border border-slate-800 rounded-lg p-2.5 text-xs font-mono select-none">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-bold text-slate-200">FLEET SUBSYSTEM TELEMETRY HEATMAP</span>
          <span className="text-[10px] text-slate-400">({filteredTelemetry.length} Assets Tracked)</span>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          {/* Search bar inside heatmap */}
          <input
            type="text"
            placeholder="Filter satellite..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="w-28 sm:w-36 px-2 py-0.5 text-[10px] bg-[#07090E] border border-slate-700 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />

          {/* Regime Filter */}
          <div className="flex gap-1 text-[10px]">
            {['ALL', 'PAYLOAD', 'LEO', 'GEO', 'DEBRIS'].map(r => (
              <button
                key={r}
                onClick={() => setFilterRegime(r)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  filterRegime === r
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Color Scale Legend */}
          <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-slate-400 pl-2 border-l border-slate-800">
            <span className="w-2 h-2 rounded-sm bg-emerald-500/80" />
            <span>Nominal</span>
            <span className="w-2 h-2 rounded-sm bg-cyan-500/80" />
            <span>Optimal</span>
            <span className="w-2 h-2 rounded-sm bg-amber-500/80" />
            <span>Warning</span>
            <span className="w-2 h-2 rounded-sm bg-rose-500/80" />
            <span>Critical</span>
          </div>
        </div>
      </div>

      {/* Heatmap Matrix Table */}
      <div className="w-full overflow-x-auto max-h-40 overflow-y-auto pr-1">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-slate-400 text-[10px] border-b border-slate-800/80">
              <th className="text-left font-semibold py-1 px-1.5 w-44">SPACECRAFT / NORAD</th>
              <th className="text-center font-semibold py-1 px-1">REGIME</th>
              <th className="text-center font-semibold py-1 px-1">EPS (BATTERY)</th>
              <th className="text-center font-semibold py-1 px-1">TCS (THERMAL)</th>
              <th className="text-center font-semibold py-1 px-1">ADCS (POINTING)</th>
              <th className="text-center font-semibold py-1 px-1">COMM (RF SNR)</th>
              <th className="text-center font-semibold py-1 px-1">PROP (PRESSURE)</th>
              <th className="text-right font-semibold py-1 px-1.5">HEALTH</th>
            </tr>
          </thead>
          <tbody>
            {filteredTelemetry.map(row => {
              const isSelected = selectedObject?.id === row.objectId;
              const isDebris = row.classification === 'DEBRIS' || row.classification === 'ROCKET_BODY';

              return (
                <tr
                  key={row.objectId}
                  onClick={() => {
                    const matchedObj = objects.find(o => o.id === row.objectId);
                    if (matchedObj && onSelectObject) onSelectObject(matchedObj);
                  }}
                  className={`border-b border-slate-800/40 hover:bg-slate-800/50 cursor-pointer transition-colors ${
                    isSelected ? 'bg-cyan-950/60 border-cyan-500/40' : ''
                  }`}
                >
                  {/* Spacecraft Name */}
                  <td className="py-1 px-1.5 text-slate-200 font-medium truncate max-w-[170px]">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'}`} />
                      <span className="truncate">{row.name}</span>
                      <span className="text-[9px] text-slate-500">#{row.noradId}</span>
                    </div>
                  </td>

                  {/* Regime */}
                  <td className="text-center py-1 px-1 text-[10px] text-slate-400">
                    {row.regime}
                  </td>

                  {/* Battery Cell (EPS) */}
                  <td className="text-center py-1 px-1">
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${getBatteryColorClass(
                        row.batterySocPct,
                        isDebris
                      )}`}
                      title={`Battery SoC: ${row.batterySocPct}% (${row.batteryVoltageV}V)${row.isEclipse ? ' - IN UMBRA DISCHARGE' : ''}`}
                    >
                      {isDebris ? 'N/A' : `${row.batterySocPct}%`}
                    </div>
                  </td>

                  {/* Thermal Cell (TCS) */}
                  <td className="text-center py-1 px-1">
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${getThermalColorClass(
                        row.thermalTempC,
                        isDebris
                      )}`}
                      title={`Thermal: ${row.thermalTempC}°C`}
                    >
                      {`${row.thermalTempC}°C`}
                    </div>
                  </td>

                  {/* ADCS Cell */}
                  <td className="text-center py-1 px-1">
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${getAdcsColorClass(
                        row.adcsStatus,
                        row.adcsPointingDeg
                      )}`}
                      title={`ADCS: ${row.adcsStatus} (${row.adcsPointingDeg}° error)`}
                    >
                      {row.adcsStatus === 'TUMBLING' ? 'TUMBLE' : `${row.adcsPointingDeg}°`}
                    </div>
                  </td>

                  {/* COMM Transponder Cell */}
                  <td className="text-center py-1 px-1">
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${getCommColorClass(
                        row.commStatus,
                        row.commSnrDb
                      )}`}
                      title={`COMM: ${row.commStatus} (${row.commSnrDb} dB)`}
                    >
                      {row.commStatus === 'OFFLINE' ? 'OFF' : `${row.commSnrDb}dB`}
                    </div>
                  </td>

                  {/* Propulsion Cell */}
                  <td className="text-center py-1 px-1">
                    <div
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-all ${getPropColorClass(
                        row.propPressureBar,
                        isDebris
                      )}`}
                      title={`Propulsion: ${row.propPressureBar} bar`}
                    >
                      {isDebris ? '0 bar' : `${row.propPressureBar}b`}
                    </div>
                  </td>

                  {/* Health Score */}
                  <td className="text-right py-1 px-1.5 font-bold tabular-nums">
                    <span className={row.overallScore >= 80 ? 'text-emerald-400' : row.overallScore >= 50 ? 'text-amber-400' : 'text-slate-500'}>
                      {row.overallScore}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Status Summary */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 mt-1 border-t border-slate-800/80">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>Active EPS Power Bus: Nominal · Autonomous Battery Charge Cycle Online</span>
        </span>
        <span className="text-slate-500">
          Click any satellite row to inspect trajectory and focus 3D camera
        </span>
      </div>
    </div>
  );
};
