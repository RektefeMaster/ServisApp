import { describe, expect, it } from 'vitest';
import { parseCli, SCENARIO_IDS, UsageError } from './cli.js';
import { formatReport, runSimulation } from './engine.js';

describe('simülatör CLI', () => {
  it('--vehicles ve --scenario okur', () => {
    expect(parseCli(['--vehicles=2', '--scenario=load', '--students=8'])).toEqual({
      vehicles: 2,
      students: 8,
      scenario: 'load',
    });
    expect(parseCli(['--', '--vehicles=3', '--scenario=ops'])).toMatchObject({
      vehicles: 3,
      scenario: 'ops',
    });
  });

  it('bilinmeyen senaryoyu reddeder', () => {
    expect(() => parseCli(['--scenario=nope'])).toThrow(UsageError);
  });
});

describe('simülatör senaryoları', () => {
  it('all (2 araç) invariantları geçer ve yayını veliyle çarpmaz', () => {
    const result = runSimulation({ vehicles: 2, students: 8, scenario: 'all' });
    expect(result.failures, result.failures.join('\n')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.invariants['broadcast_not_times_parents']).toBe(true);
    expect(result.invariants['event_append_only']).toBe(true);
    expect(result.scale.realtimeMessages).toBeGreaterThan(0);
    expect(result.scale.realtimeMessages).toBeLessThan(result.scale.gpsPackets);
    expect(result.scale.callsPerTrip).toBeLessThan(0.5);
    expect(formatReport(result)).toMatch(/simulator ok/);
  });

  it('TEMP kodsuz teslimi ve ON_BOARD kapanışı ayrı senaryolarda yakalar', () => {
    const temp = runSimulation({ vehicles: 1, students: 8, scenario: 'temp-delivery' });
    expect(temp.ok).toBe(true);
    expect(temp.notes.some((row) => row.includes('kodsuz red'))).toBe(true);
    const otp = runSimulation({ vehicles: 1, students: 8, scenario: 'otp-lock' });
    expect(otp.ok).toBe(true);
  });

  it('tünel senkronunda broadcast GPS kabulüne eşittir', () => {
    const result = runSimulation({ vehicles: 4, students: 4, scenario: 'tunnel-sync' });
    expect(result.ok).toBe(true);
    expect(result.scale.realtimeMessages).toBeGreaterThan(0);
    expect(result.scale.realtimeMessages).toBeLessThanOrEqual(result.scale.gpsPackets);
  });

  it('katalogdaki her senaryo en azından çalışır', () => {
    for (const scenario of SCENARIO_IDS) {
      if (scenario === 'all') continue;
      const result = runSimulation({ vehicles: 1, students: 8, scenario });
      expect(result.ok, `${scenario}: ${result.failures.join('; ')}`).toBe(true);
    }
  });
});
