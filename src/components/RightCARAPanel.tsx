/**
 * Right CARA & COLA Maneuver Executive Panel
 * Performs Conjunction Assessment Risk Analysis, Foster 2D Pc calculation,
 * 2D B-Plane visualization, automated Delta-V maneuver planning,
 * and CCSDS Conjunction Data Message (CDM) export.
 */

import React, { useState } from 'react';
import { ConjunctionEvent, ManeuverPlan } from '../astrodynamics/types.ts';
import { planCollisionAvoidanceManeuver } from '../astrodynamics/maneuverPlanner.ts';
import {
  AlertTriangle,
  ShieldCheck,
  Zap,
  Download,
  Crosshair,
  Flame,
  CheckCircle2,
  ChevronRight,
  Info
} from 'lucide-react';

interface RightCARAPanelProps {
  conjunctions: ConjunctionEvent[];
  selectedConjunction: ConjunctionEvent | null;
  onSelectConjunction: (conj: ConjunctionEvent) => void;
  onExecuteManeuver: (plan: ManeuverPlan, updatedConjunction: ConjunctionEvent) => void;
}

export const RightCARAPanel: React.FC<RightCARAPanelProps> = ({
  conjunctions,
  selectedConjunction,
  onSelectConjunction,
  onExecuteManeuver
}) => {
  const [thrusterType, setThrusterType] = useState<'MONOPROPELLANT_HYDRAZINE' | 'HALL_EFFECT_ION'>('MONOPROPELLANT_HYDRAZINE');
  const [safetyMarginKm, setSafetyMarginKm] = useState<number>(14.0);
  const [lastExecutedManeuver, setLastExecutedManeuver] = useState<ManeuverPlan | null>(null);

  const active = selectedConjunction || conjunctions[0] || null;

  // Plan recommendation for active conjunction
  const recommendation = active
    ? planCollisionAvoidanceManeuver(active, { thrusterType, safetyMarginKm })
    : null;

  // Handle Maneuver Execution
  const handleExecute = () => {
    if (!recommendation || !active) return;
    const { plan, revisedKeplerian } = recommendation;

    const updatedConjunction: ConjunctionEvent = {
      ...active,
      missDistanceKm: plan.postBurnMissDistanceKm,
      probabilityOfCollisionPc: plan.postBurnPc,
      riskLevel: 'NOMINAL',
      maneuverExecuted: true,
      primaryObject: {
        ...active.primaryObject,
        keplerian: revisedKeplerian
      }
    };

    setLastExecutedManeuver(plan);
    onExecuteManeuver(plan, updatedConjunction);
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

            {/* Automated COLA Maneuver Planner */}
            <div className="p-3 bg-[#0F172A] border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-mono font-bold text-amber-300">
                    AUTOMATED COLA MANEUVER
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">OPTIMIZED BURN</span>
              </div>

              {recommendation && (
                <div className="space-y-2 text-xs font-mono">
                  {/* Thruster Selection */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setThrusterType('MONOPROPELLANT_HYDRAZINE')}
                      className={`flex-1 py-1 text-[11px] rounded border transition-colors ${
                        thrusterType === 'MONOPROPELLANT_HYDRAZINE'
                          ? 'bg-amber-950/80 border-amber-500 text-amber-200 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      Hydrazine (220s)
                    </button>
                    <button
                      onClick={() => setThrusterType('HALL_EFFECT_ION')}
                      className={`flex-1 py-1 text-[11px] rounded border transition-colors ${
                        thrusterType === 'HALL_EFFECT_ION'
                          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      Hall Ion (1600s)
                    </button>
                  </div>

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
