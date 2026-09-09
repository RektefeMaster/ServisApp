import { describe, expect, it } from 'vitest';
import { DELIVERY_TARGETS, STUDENT_STATES, TRIP_STATES } from '@servisapp/domain';
import { deliveryTargetEnum, studentStateEnum, tripStateEnum } from './enums.js';

describe('domain ve db enum hizası', () => {
  it('sefer durumları birebir aynıdır', () => {
    expect(tripStateEnum.enumValues).toEqual([...TRIP_STATES]);
  });

  it('öğrenci durumları birebir aynıdır', () => {
    expect(studentStateEnum.enumValues).toEqual([...STUDENT_STATES]);
  });

  it('teslim hedefleri birebir aynıdır', () => {
    expect(deliveryTargetEnum.enumValues).toEqual([...DELIVERY_TARGETS]);
  });
});
