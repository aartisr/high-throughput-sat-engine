/**
 * TLE Ingest Modal
 * Allows operators to paste custom NORAD Two-Line Element (TLE) ephemeris
 * or select authentic aerospace presets to ingest into the live streaming engine.
 */

import React, { useState } from 'react';
import { parseTLE } from '../astrodynamics/tleParser.ts';
import { OrbitalObject } from '../astrodynamics/types.ts';
import { propagateOrbit } from '../astrodynamics/propagator.ts';
import { X, UploadCloud, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';

interface TLEIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngest: (newObj: OrbitalObject) => void;
}

const TLE_PRESETS = [
  {
    name: 'ENVISAT (CRITICAL DEBRIS HAZARD)',
    raw: `ENVISAT
1 27386U 02009A   24095.45120000  .00000045  00000-0  21450-4 0  9991
2 27386  98.4124 120.4512 0001245  85.4512 274.6512 14.37124511251240`
  },
  {
    name: 'NOAA-20 (POLAR LEO)',
    raw: `NOAA-20
1 43013U 17073A   24095.39583333  .00000072  00000-0  34120-4 0  9994
2 43013  98.7124  45.1245 0001452  72.4512 287.6512 14.19561241321450`
  },
  {
    name: 'STARLINK-5012',
    raw: `STARLINK-5012
1 55000U 23001A   24095.50000000  .00002845  00000-0  18451-4 0  9998
2 55000  53.2189 240.1245 0001845  95.4125 264.7125 15.06412451564120`
  }
];

export const TLEIngestModal: React.FC<TLEIngestModalProps> = ({
  isOpen,
  onClose,
  onIngest
}) => {
  const [tleText, setTleText] = useState<string>(TLE_PRESETS[0].raw);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<OrbitalObject | null>(null);

  if (!isOpen) return null;

  const handleValidate = () => {
    try {
      const parsed = parseTLE(tleText);
      const now = Date.now();
      const state = propagateOrbit(parsed.keplerian, now);

      const obj: OrbitalObject = {
        id: `SSN-${parsed.noradId}`,
        noradId: parsed.noradId,
        name: parsed.name,
        intlDesignator: parsed.intlDesignator,
        classification: parsed.classification,
        regime: parsed.keplerian.apogeeAltitudeKm > 2000 ? 'MEO' : 'LEO',
        keplerian: parsed.keplerian,
        tleLine1: parsed.line1,
        tleLine2: parsed.line2,
        currentState: state,
        massKg: 1000,
        crossSectionM2: 12.0,
        hardBodyRadiusM: 4.0,
        covarianceSigmaKm: [0.3, 0.8, 0.25],
        isProtectedAsset: false
      };

      setParsedPreview(obj);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to parse TLE');
      setParsedPreview(null);
    }
  };

  const handleSubmit = () => {
    if (!parsedPreview) {
      handleValidate();
    }
    if (parsedPreview) {
      onIngest(parsedPreview);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-xl bg-[#0B0E17] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col text-slate-100 font-mono">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#07090E] border-b border-slate-800">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
              INGEST ORBITAL TLE EPHEMERIS
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Preset Buttons */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-slate-400">Quick Aerospace Presets:</span>
            <div className="flex flex-wrap gap-1.5">
              {TLE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setTleText(preset.raw);
                    setParsedPreview(null);
                    setErrorMsg(null);
                  }}
                  className="px-2.5 py-1 text-[11px] bg-[#0F172A] hover:bg-slate-800 border border-slate-700 rounded text-slate-200 transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Text Area */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-slate-400">Paste Two-Line Element (2LE / 3LE) Set:</span>
            <textarea
              rows={5}
              value={tleText}
              onChange={e => {
                setTleText(e.target.value);
                setParsedPreview(null);
              }}
              className="w-full p-2.5 bg-[#0F172A] border border-slate-800 rounded text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500 selection:bg-cyan-500/30"
              placeholder="Paste NORAD TLE lines here..."
            />
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-2.5 bg-rose-950/80 border border-rose-500/80 rounded text-xs text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Parsed Preview */}
          {parsedPreview && (
            <div className="p-3 bg-[#0F172A] border border-cyan-500/40 rounded space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>TLE VALIDATED: {parsedPreview.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-300 text-[11px]">
                <div>NORAD ID: <span className="text-slate-100 font-bold">{parsedPreview.noradId}</span></div>
                <div>Inclination: <span className="text-slate-100 font-bold">{parsedPreview.keplerian.inclinationDeg.toFixed(2)}°</span></div>
                <div>Perigee Alt: <span className="text-slate-100 font-bold">{parsedPreview.keplerian.perigeeAltitudeKm.toFixed(0)} km</span></div>
                <div>Apogee Alt: <span className="text-slate-100 font-bold">{parsedPreview.keplerian.apogeeAltitudeKm.toFixed(0)} km</span></div>
                <div>Mean Motion: <span className="text-slate-100 font-bold">{parsedPreview.keplerian.meanMotionRevDay.toFixed(4)} rev/d</span></div>
                <div>Period: <span className="text-slate-100 font-bold">{parsedPreview.keplerian.periodMinutes.toFixed(1)} min</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-[#07090E] border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          {!parsedPreview ? (
            <button
              onClick={handleValidate}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-bold rounded border border-slate-700 transition-colors"
            >
              VALIDATE TLE
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded transition-colors"
            >
              INGEST INTO STREAM
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
