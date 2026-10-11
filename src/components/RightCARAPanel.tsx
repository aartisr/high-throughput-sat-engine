/**
 * Right CARA & COLA Maneuver Executive Panel
 * Performs Conjunction Assessment Risk Analysis, Foster 2D Pc calculation,
 * 2D B-Plane visualization, automated Delta-V maneuver planning,
 * and CCSDS Conjunction Data Message (CDM) export.
 */

import React, { useState, useMemo } from 'react';
import { ConjunctionEvent, ManeuverPlan, WhatIfDeltaV } from '../astrodynamics/types.ts';
import { planCollisionAvoidanceManeuver, computeWhatIfManeuver } from '../astrodynamics/maneuverPlanner.ts';
import {
  AlertTriangle,
  ShieldCheck,
  Zap,
  Download,
  Crosshair,
  Flame,
  CheckCircle2,
  ChevronRight,
  Info,
  Sliders,
  RotateCcw,
  Sparkles
} from 'lucide-react';

interface RightCARAPanelProps {
  conjunctions: ConjunctionEvent[];
  selectedConjunction: ConjunctionEvent | null;
  onSelectConjunction: (conj: ConjunctionEvent) => void;
  onExecuteManeuver: (plan: ManeuverPlan, updatedConjunction: ConjunctionEvent) => void;
  whatIfDeltaV?: WhatIfDeltaV;
  onWhatIfDeltaVChange?: (deltaV: WhatIfDeltaV) => void;
}

export const RightCARAPanel: React.FC<RightCARAPanelProps> = ({
  conjunctions,
  selectedConjunction,
  onSelectConjunction,
  onExecuteManeuver,
  whatIfDeltaV,
  onWhatIfDeltaVChange
}) => {
  const [thrusterType, setThrusterType] = useState<'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION'>('MONOPROPELLANT_HYDRAZINE');
  const [safetyMarginKm, setSafetyMarginKm] = useState<number>(14.0);
  const [lastExecutedManeuver, setLastExecutedManeuver] = useState<ManeuverPlan | null>(null);
  const [colaTab, setColaTab] = useState<'AUTO' | 'WHAT_IF'>('WHAT_IF');

  const [localWhatIf, setLocalWhatIf] = useState<WhatIfDeltaV>({
    alongTrackMs: 1.45,
    radialMs: 0.0,
    crossTrackMs: 0.0,
    thrusterType: 'MONOPROPELLANT_HYDRAZINE',
    isActive: false
  });

  const currentWhatIf = whatIfDeltaV || localWhatIf;
  const active = selectedConjunction || conjunctions[0] || null;

  // Plan recommendation for active conjunction
  const recommendation = active
    ? planCollisionAvoidanceManeuver(active, { thrusterType, safetyMarginKm })
    : null;

  // Compute live What-If impact
  const whatIfResult = useMemo(() => {
    if (!active) return null;
    return computeWhatIfManeuver(
      active.primaryObject,
      {
        alongTrackMs: currentWhatIf.alongTrackMs,
        radialMs: currentWhatIf.radialMs,
        crossTrackMs: currentWhatIf.crossTrackMs
      },
      active,
      thrusterType
    );
  }, [active, currentWhatIf, thrusterType]);

  const handleDeltaVChange = (field: 'alongTrackMs' | 'radialMs' | 'crossTrackMs', val: number) => {
    const updated: WhatIfDeltaV = {
      ...currentWhatIf,
      [field]: parseFloat(val.toFixed(2)),
      thrusterType,
      isActive: true
    };
    if (onWhatIfDeltaVChange) {
      onWhatIfDeltaVChange(updated);
    } else {
      setLocalWhatIf(updated);
    }
  };

  // Handle Maneuver Execution
  const handleExecute = () => {
    if (!active) return;
    const isCustomWhatIf = colaTab === 'WHAT_IF' && whatIfResult && currentWhatIf.isActive;

    const planToExecute: ManeuverPlan | undefined = isCustomWhatIf
      ? {
          id: `MNV-WHATIF-${active.primaryObject.noradId}-${Date.now()}`,
          conjunctionId: active.id,
          targetObjectId: active.primaryObject.id,
          burnEpochUtc: new Date(whatIfResult.burnEpochMs).toISOString(),
          burnEpochTimestampMs: whatIfResult.burnEpochMs,
          burnType: currentWhatIf.alongTrackMs >= 0 ? 'ALONG_TRACK_PROGRADE' : 'ALONG_TRACK_RETROGRADE',
          deltaVVectorMs: [currentWhatIf.radialMs, currentWhatIf.alongTrackMs, currentWhatIf.crossTrackMs],
          deltaVMagnitudeMs: whatIfResult.deltaV.totalMs,
          thrusterType,
          ispSeconds: thrusterType === 'MONOPROPELLANT_HYDRAZINE' ? 220 : 1600,
          propellantMassKg: whatIfResult.propellantMassKg,
          dryMassKg: (active.primaryObject.massKg || 500) - whatIfResult.propellantMassKg,
          postBurnMissDistanceKm: whatIfResult.predictedMissDistanceKm,
          postBurnPc: whatIfResult.predictedPc,
          burnDurationSeconds: whatIfResult.burnDurationSeconds
        }
      : recommendation?.plan;

    const revisedKep = isCustomWhatIf
      ? whatIfResult.revisedKeplerian
      : recommendation?.revisedKeplerian;

    if (!planToExecute || !revisedKep) return;

    const updatedConjunction: ConjunctionEvent = {
      ...active,
      missDistanceKm: planToExecute.postBurnMissDistanceKm,
      probabilityOfCollisionPc: planToExecute.postBurnPc,
      riskLevel: 'NOMINAL',
      maneuverExecuted: true,
      primaryObject: {
        ...active.primaryObject,
        keplerian: revisedKep
      }
    };

    setLastExecutedManeuver(planToExecute);
    onExecuteManeuver(planToExecute, updatedConjunction);
    if (onWhatIfDeltaVChange) {
      onWhatIfDeltaVChange({ ...currentWhatIf, isActive: false });
    }
  };

  // Handle CDM Download
  const handleDownloadCdm = () => {
    if (!active) return;
    const blob = new Blob([active.cdmMessage], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CDM_${active.primaryObject.noradId}_${active.secondaryObject.noradId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatCountdown = (totalSec: number) => {
    if (totalSec <= 0) return 'TCA OCCURRED';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = Math.floor(totalSec % 60);
    return `T - ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <aside className="w-80 md:w-96 flex flex-col bg-[#0B0E17] border-l border-slate-800 text-slate-100 h-full select-none">
      {/* Header */}
      <div className="p-3 border-b border-slate-800 bg-[#07090E] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-rose-400" />
          <h2 className="text-xs font-mono font-bold tracking-wider text-rose-400 uppercase">
            CONJUNCTION ASSESSMENT (CARA)
          </h2>
        </div>
        <span className="text-xs font-mono text-slate-400">
          {conjunctions.length} Events
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Ranked Conjunction Watchlist */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-mono text-slate-400 block uppercase">
            Active Close Approaches Watchlist:
          </span>
          <div className="space-y-1.5">
            {conjunctions.map(conj => {
              const isSelected = active?.id === conj.id;
              return (
                <div
                  key={conj.id}
                  onClick={() => onSelectConjunction(conj)}
                  className={`p-2.5 rounded border cursor-pointer transition-colors text-xs font-mono ${
                    isSelected
                      ? 'bg-rose-950/80 border-rose-500 text-rose-100'
                      : conj.riskLevel === 'CRITICAL'
                      ? 'bg-[#18111A] border-rose-900/80 text-rose-300 hover:border-rose-700'
                      : 'bg-[#0F172A] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold">
                      {conj.maneuverExecuted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : conj.riskLevel === 'CRITICAL' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      )}
                      <span className="truncate max-w-[160px]">{conj.primaryObject.name}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
                      conj.maneuverExecuted
                        ? 'bg-emerald-900 text-emerald-300'
                        : conj.riskLevel === 'CRITICAL'
                        ? 'bg-rose-900 text-rose-200'
                        : 'bg-amber-900 text-amber-200'
                    }`}>
                      {conj.maneuverExecuted ? 'RESOLVED' : conj.riskLevel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                    <span>Target: {conj.secondaryObject.name}</span>
                    <span className="text-cyan-300 font-semibold">
                      Miss: {conj.missDistanceKm.toFixed(2)} km
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>Pc: {conj.probabilityOfCollisionPc.toExponential(2)}</span>
                    <span className="text-rose-400 font-bold">{formatCountdown(conj.timeToTcaSeconds)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {active && (
          <>
            {/* Encounter Telemetry & Foster Pc Inspector */}
            <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-mono font-bold text-slate-200">
                  ENCOUNTER PARAMETERS
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  TCA: {active.tcaUtc.substring(11, 19)} UTC
                </span>
              </div>

              {/* Miss Distance & Relative Speed */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 bg-[#0B0E17] rounded border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">TOTAL MISS DISTANCE:</span>
                  <span className="text-base font-bold text-cyan-300 tabular-nums">
                    {active.missDistanceKm.toFixed(3)}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-1">km</span>
                </div>

                <div className="p-2 bg-[#0B0E17] rounded border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">RELATIVE VELOCITY:</span>
                  <span className="text-base font-bold text-amber-300 tabular-nums">
                    {active.ric.relativeVelocityKmS.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-1">km/s</span>
                </div>
              </div>

              {/* RIC Components Breakdown */}
              <div className="p-2 bg-[#0B0E17] rounded border border-slate-800 space-y-1 text-xs font-mono">
                <span className="text-[10px] text-slate-400 block font-semibold mb-1">
                  RIC ENCOUNTER FRAME DECOMPOSITION:
                </span>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Radial Miss (ΔR):</span>
                  <span className="text-slate-200 tabular-nums">
                    {(active.ric.radialMissKm * 1000).toFixed(1)} m
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">In-Track Miss (ΔI):</span>
                  <span className="text-slate-200 tabular-nums">
                    {(active.ric.inTrackMissKm * 1000).toFixed(1)} m
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Cross-Track Miss (ΔC):</span>
                  <span className="text-slate-200 tabular-nums">
                    {(active.ric.crossTrackMissKm * 1000).toFixed(1)} m
                  </span>
                </div>
              </div>

              {/* Probability of Collision Gauge */}
              <div className="p-2 bg-[#0B0E17] rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-400">Probability of Collision (Pc):</span>
                  <span className={`font-bold tabular-nums ${
                    active.probabilityOfCollisionPc >= 1e-4 ? 'text-rose-400 text-sm' : 'text-emerald-400'
                  }`}>
                    {active.probabilityOfCollisionPc.toExponential(3)}
                  </span>
                </div>

                {/* Logarithmic Gauge Bar */}
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    className={`h-full ${
                      active.probabilityOfCollisionPc >= 1e-4
                        ? 'bg-rose-500'
                        : active.probabilityOfCollisionPc >= 1e-7
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          5,
                          ((Math.log10(Math.max(1e-10, active.probabilityOfCollisionPc)) + 10) / 10) * 100
                        )
                      )}%`
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-slate-500">
                  <span>10⁻¹⁰ (Clear)</span>
                  <span>10⁻⁷ (Warning)</span>
                  <span>10⁻⁴ (Critical)</span>
                </div>
              </div>

              {/* 2D B-Plane Encounter Geometry Visualizer */}
              <div className="p-2 bg-[#0B0E17] rounded border border-slate-800">
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>2D ENCOUNTER B-PLANE:</span>
                  <span className="text-cyan-400">HBR: {active.combinedHardBodyRadiusM}m</span>
                </div>
                <svg viewBox="-60 -60 120 120" className="w-full h-28 bg-[#060A12] rounded border border-slate-900">
                  {/* Grid Lines */}
                  <line x1="-55" y1="0" x2="55" y2="0" stroke="#1E293B" strokeWidth="0.5" strokeDasharray="2,2" />
                  <line x1="0" y1="-55" x2="0" y2="55" stroke="#1E293B" strokeWidth="0.5" strokeDasharray="2,2" />
                  
                  {/* Primary 3-sigma error ellipse */}
                  <ellipse
                    cx="0"
                    cy="0"
                    rx="35"
                    ry="18"
                    fill="rgba(6, 182, 212, 0.08)"
                    stroke="#06B6D4"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  {/* Primary Centroid */}
                  <circle cx="0" cy="0" r="2.5" fill="#06B6D4" />

                  {/* Secondary Threat Position at TCA */}
                  {(() => {
                    const scale = 25 / Math.max(0.5, active.missDistanceKm);
                    const tx = Math.max(-50, Math.min(50, active.ric.radialMissKm * scale));
                    const ty = Math.max(-50, Math.min(50, active.ric.crossTrackMissKm * scale));
                    return (
                      <>
                        <line x1="0" y1="0" x2={tx} y2={ty} stroke="#EF4444" strokeWidth="1" strokeDasharray="3,2" />
                        <circle cx={tx} cy={ty} r="3" fill="#EF4444" className="animate-pulse" />
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>

            {/* Automated COLA Maneuver Planner & What-If Trajectory Executive */}
            <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-mono font-bold text-amber-300">
                    COLA MANEUVER EXECUTIVE
                  </span>
                </div>
                {/* Tab Switcher: AUTO vs WHAT-IF */}
                <div className="flex items-center p-0.5 bg-[#07090E] rounded border border-slate-800 text-[10px]">
                  <button
                    onClick={() => setColaTab('AUTO')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      colaTab === 'AUTO'
                        ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    AUTO
                  </button>
                  <button
                    onClick={() => {
                      setColaTab('WHAT_IF');
                      if (!currentWhatIf.isActive && recommendation) {
                        handleDeltaVChange('alongTrackMs', recommendation.plan.deltaVVectorMs[1]);
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                      colaTab === 'WHAT_IF'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    <span>WHAT-IF</span>
                  </button>
                </div>
              </div>

              {/* Thruster Selection */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    setThrusterType('MONOPROPELLANT_HYDRAZINE');
                    if (onWhatIfDeltaVChange) onWhatIfDeltaVChange({ ...currentWhatIf, thrusterType: 'MONOPROPELLANT_HYDRAZINE' });
                  }}
                  className={`flex-1 py-1 text-[11px] rounded border transition-colors ${
                    thrusterType === 'MONOPROPELLANT_HYDRAZINE'
                      ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Hydrazine (220s)
                </button>
                <button
                  onClick={() => {
                    setThrusterType('HALL_EFFECT_ION');
                    if (onWhatIfDeltaVChange) onWhatIfDeltaVChange({ ...currentWhatIf, thrusterType: 'HALL_EFFECT_ION' });
                  }}
                  className={`flex-1 py-1 text-[11px] rounded border transition-colors ${
                    thrusterType === 'HALL_EFFECT_ION'
                      ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Hall Ion (1600s)
                </button>
              </div>

              {colaTab === 'WHAT_IF' ? (
                /* Interactive What-If Delta-V Sliders Section */
                <div className="space-y-2.5 text-xs font-mono">
                  {/* Active Indicator & Live Globe Sync status */}
                  <div className="flex items-center justify-between text-[10px] bg-[#07090E] p-1.5 rounded border border-amber-500/30 text-amber-300">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3 animate-pulse text-amber-400" />
                      <span>GLOBE 'WHAT-IF' TRAJECTORY ACTIVE</span>
                    </span>
                    <span className="font-bold tabular-nums">
                      |ΔV|: {whatIfResult ? whatIfResult.deltaV.totalMs.toFixed(2) : 0} m/s
                    </span>
                  </div>

                  {/* Slider 1: Along-Track / Transverse (Prograde / Retrograde) */}
                  <div className="space-y-1 bg-[#0B0E17] p-2 rounded border border-slate-800">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-300 font-semibold">Along-Track (ΔV_T):</span>
                      <span className="font-bold text-amber-300 tabular-nums">
                        {currentWhatIf.alongTrackMs >= 0 ? '+' : ''}{currentWhatIf.alongTrackMs.toFixed(2)} m/s
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          ({currentWhatIf.alongTrackMs > 0 ? '+V Prograde' : currentWhatIf.alongTrackMs < 0 ? '-V Retrograde' : 'Neutral'})
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeltaVChange('alongTrackMs', Math.max(-5, currentWhatIf.alongTrackMs - 0.25))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        -0.25
                      </button>
                      <input
                        type="range"
                        min="-5.0"
                        max="5.0"
                        step="0.05"
                        value={currentWhatIf.alongTrackMs}
                        onChange={(e) => handleDeltaVChange('alongTrackMs', parseFloat(e.target.value))}
                        className="flex-1 accent-amber-400 bg-slate-800 h-1.5 rounded cursor-pointer"
                      />
                      <button
                        onClick={() => handleDeltaVChange('alongTrackMs', Math.min(5, currentWhatIf.alongTrackMs + 0.25))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        +0.25
                      </button>
                    </div>
                  </div>

                  {/* Slider 2: Radial (Out / In) */}
                  <div className="space-y-1 bg-[#0B0E17] p-2 rounded border border-slate-800">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-300 font-semibold">Radial (ΔV_R):</span>
                      <span className="font-bold text-cyan-300 tabular-nums">
                        {currentWhatIf.radialMs >= 0 ? '+' : ''}{currentWhatIf.radialMs.toFixed(2)} m/s
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          ({currentWhatIf.radialMs > 0 ? 'Radial Out' : currentWhatIf.radialMs < 0 ? 'Radial In' : 'Neutral'})
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeltaVChange('radialMs', Math.max(-2, currentWhatIf.radialMs - 0.2))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        -0.2
                      </button>
                      <input
                        type="range"
                        min="-2.0"
                        max="2.0"
                        step="0.05"
                        value={currentWhatIf.radialMs}
                        onChange={(e) => handleDeltaVChange('radialMs', parseFloat(e.target.value))}
                        className="flex-1 accent-cyan-400 bg-slate-800 h-1.5 rounded cursor-pointer"
                      />
                      <button
                        onClick={() => handleDeltaVChange('radialMs', Math.min(2, currentWhatIf.radialMs + 0.2))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        +0.2
                      </button>
                    </div>
                  </div>

                  {/* Slider 3: Cross-Track / Normal */}
                  <div className="space-y-1 bg-[#0B0E17] p-2 rounded border border-slate-800">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-300 font-semibold">Cross-Track (ΔV_N):</span>
                      <span className="font-bold text-purple-300 tabular-nums">
                        {currentWhatIf.crossTrackMs >= 0 ? '+' : ''}{currentWhatIf.crossTrackMs.toFixed(2)} m/s
                        <span className="text-[10px] text-slate-400 font-normal ml-1">
                          (Plane Change)
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeltaVChange('crossTrackMs', Math.max(-2, currentWhatIf.crossTrackMs - 0.2))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        -0.2
                      </button>
                      <input
                        type="range"
                        min="-2.0"
                        max="2.0"
                        step="0.05"
                        value={currentWhatIf.crossTrackMs}
                        onChange={(e) => handleDeltaVChange('crossTrackMs', parseFloat(e.target.value))}
                        className="flex-1 accent-purple-400 bg-slate-800 h-1.5 rounded cursor-pointer"
                      />
                      <button
                        onClick={() => handleDeltaVChange('crossTrackMs', Math.min(2, currentWhatIf.crossTrackMs + 0.2))}
                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                      >
                        +0.2
                      </button>
                    </div>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {recommendation && (
                      <button
                        onClick={() => {
                          const v = recommendation.plan.deltaVVectorMs[1];
                          const preset: WhatIfDeltaV = {
                            alongTrackMs: parseFloat(v.toFixed(2)),
                            radialMs: 0,
                            crossTrackMs: 0,
                            thrusterType,
                            isActive: true
                          };
                          if (onWhatIfDeltaVChange) onWhatIfDeltaVChange(preset);
                          setLocalWhatIf(preset);
                        }}
                        className="px-2 py-0.5 bg-amber-950/60 border border-amber-500/50 hover:bg-amber-900 text-amber-200 rounded transition-colors"
                      >
                        Auto COLA ({recommendation.plan.deltaVMagnitudeMs.toFixed(2)}m/s)
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const preset: WhatIfDeltaV = {
                          alongTrackMs: 1.0,
                          radialMs: 0,
                          crossTrackMs: 0,
                          thrusterType,
                          isActive: true
                        };
                        if (onWhatIfDeltaVChange) onWhatIfDeltaVChange(preset);
                        setLocalWhatIf(preset);
                      }}
                      className="px-2 py-0.5 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded transition-colors"
                    >
                      +1.0m/s +V
                    </button>
                    <button
                      onClick={() => {
                        const preset: WhatIfDeltaV = {
                          alongTrackMs: -1.0,
                          radialMs: 0,
                          crossTrackMs: 0,
                          thrusterType,
                          isActive: true
                        };
                        if (onWhatIfDeltaVChange) onWhatIfDeltaVChange(preset);
                        setLocalWhatIf(preset);
                      }}
                      className="px-2 py-0.5 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded transition-colors"
                    >
                      -1.0m/s -V
                    </button>
                    <button
                      onClick={() => {
                        const resetState: WhatIfDeltaV = {
                          alongTrackMs: 0,
                          radialMs: 0,
                          crossTrackMs: 0,
                          thrusterType,
                          isActive: false
                        };
                        if (onWhatIfDeltaVChange) onWhatIfDeltaVChange(resetState);
                        setLocalWhatIf(resetState);
                      }}
                      className="px-2 py-0.5 bg-slate-900 border border-slate-700 hover:bg-rose-950 hover:text-rose-300 text-slate-400 rounded transition-colors"
                    >
                      Reset 0m/s
                    </button>
                  </div>

                  {/* Live What-If Impact Calculation Card */}
                  {whatIfResult && (
                    <div className="p-2.5 bg-[#0B0E17] rounded border border-amber-500/40 space-y-1.5 shadow-inner">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Total Magnitude |ΔV|:</span>
                        <span className="text-amber-300 font-bold tabular-nums">
                          {whatIfResult.deltaV.totalMs.toFixed(2)} m/s
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Propellant Expenditure:</span>
                        <span className="text-amber-200 font-bold tabular-nums">
                          {whatIfResult.propellantMassKg.toFixed(2)} kg
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Predicted Miss Distance:</span>
                        <span className={`font-bold tabular-nums ${
                          whatIfResult.predictedMissDistanceKm >= 10.0
                            ? 'text-emerald-400'
                            : whatIfResult.predictedMissDistanceKm >= 5.0
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}>
                          {whatIfResult.predictedMissDistanceKm.toFixed(2)} km
                          {active && (
                            <span className="text-[10px] text-slate-400 font-normal ml-1">
                              (+{(whatIfResult.predictedMissDistanceKm - active.missDistanceKm).toFixed(2)}km)
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Predicted Collision Pc:</span>
                        <span className="text-cyan-300 font-bold tabular-nums">
                          {whatIfResult.predictedPc.toExponential(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                        <span>Δa: <strong className="text-slate-300">{whatIfResult.deltaApogeeKm >= 0 ? '+' : ''}{((whatIfResult.deltaApogeeKm + whatIfResult.deltaPerigeeKm) / 2).toFixed(1)} km</strong></span>
                        <span>ΔPeriod: <strong className="text-slate-300">{whatIfResult.deltaPeriodSeconds >= 0 ? '+' : ''}{whatIfResult.deltaPeriodSeconds.toFixed(1)} s</strong></span>
                      </div>
                    </div>
                  )}

                  {/* Execute Button */}
                  <button
                    onClick={handleExecute}
                    disabled={active.maneuverExecuted}
                    className={`w-full py-2 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
                      active.maneuverExecuted
                        ? 'bg-emerald-950 border border-emerald-500/80 text-emerald-300 cursor-default'
                        : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    }`}
                  >
                    {active.maneuverExecuted ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>MANEUVER EXECUTED &amp; VERIFIED</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>EXECUTE WHAT-IF MANEUVER</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Auto Recommendation View */
                recommendation && (
                  <div className="space-y-2 text-xs font-mono">
                    {/* Delta-V and Mass Cost */}
                    <div className="p-2 bg-[#0B0E17] rounded border border-slate-800 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Required ΔV:</span>
                        <span className="text-cyan-300 font-bold tabular-nums">
                          {recommendation.plan.deltaVMagnitudeMs.toFixed(3)} m/s
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Burn Vector:</span>
                        <span className="text-slate-200">
                          {recommendation.plan.burnType === 'ALONG_TRACK_PROGRADE' ? '+V (Prograde)' : '-V (Retrograde)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Propellant Cost:</span>
                        <span className="text-amber-300 font-bold tabular-nums">
                          {recommendation.plan.propellantMassKg.toFixed(2)} kg
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Post-Burn Miss Distance:</span>
                        <span className="text-emerald-400 font-bold tabular-nums">
                          &gt; {recommendation.plan.postBurnMissDistanceKm.toFixed(1)} km
                        </span>
                      </div>
                    </div>

                    {/* Execute Button */}
                    <button
                      onClick={handleExecute}
                      disabled={active.maneuverExecuted}
                      className={`w-full py-2 rounded text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-colors ${
                        active.maneuverExecuted
                          ? 'bg-emerald-950 border border-emerald-500/80 text-emerald-300 cursor-default'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                      }`}
                    >
                      {active.maneuverExecuted ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>MANEUVER EXECUTED &amp; VERIFIED</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>EXECUTE COLA MANEUVER</span>
                        </>
                      )}
                    </button>
                  </div>
                )
              )}
            </div>

            {/* CCSDS CDM Export */}
            <button
              onClick={handleDownloadCdm}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded text-xs font-mono flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>EXPORT CCSDS CDM (508.0-B-1)</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
};
