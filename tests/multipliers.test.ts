import { describe, expect, it } from 'vitest';
import { alchemyMult, beltSpeed, fuelMult, speedMult } from '../src/model/multipliers';

describe('upgrade multipliers', () => {
  it('speedMult', () => {
    expect(speedMult(0)).toBe(1);
    expect(speedMult(4)).toBe(2);
    expect(speedMult(12)).toBe(4);
    expect(speedMult(14)).toBeCloseTo(4.1);
  });
  it('alchemyMult: +6,+6 then +8 to lvl 8, then +10', () => {
    expect(alchemyMult(0)).toBe(1);
    expect(alchemyMult(2)).toBeCloseTo(1.12);
    expect(alchemyMult(8)).toBeCloseTo(1.6);
    expect(alchemyMult(10)).toBeCloseTo(1.8);
  });
  it('fuelMult', () => expect(fuelMult(5)).toBeCloseTo(1.5));
  it('beltSpeed', () => {
    expect(beltSpeed(0)).toBe(60);
    expect(beltSpeed(12)).toBe(240);
    expect(beltSpeed(15)).toBe(249);
  });
});
