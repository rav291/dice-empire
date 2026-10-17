import { expect, test } from 'vitest';
import { coinSprites, fmt, fmtCounter, fmtTime } from './format';

test('fmt compacts and truncates', () => {
  expect(fmt(0)).toBe('0');
  expect(fmt(950)).toBe('950');
  expect(fmt(1200)).toBe('1.2K');
  expect(fmt(1999)).toBe('1.9K');
  expect(fmt(2000)).toBe('2K');
  expect(fmt(12_500)).toBe('12.5K');
  expect(fmt(125_000)).toBe('125K');
  expect(fmt(999_999)).toBe('999K');
  expect(fmt(3_400_000)).toBe('3.4M');
  expect(fmt(5_700_000)).toBe('5.7M');
  expect(fmt(1_200_000_000)).toBe('1.2B');
  expect(fmt(-12_500)).toBe('-12.5K');
});

test('counter and time', () => {
  expect(fmtCounter(1_234_567)).toBe('1,234,567');
  expect(fmtCounter(12_345_678)).toBe('12.3M');
  expect(fmtTime(0)).toBe('0:00');
  expect(fmtTime(83_000)).toBe('1:23');
  expect(fmtTime(3_723_000)).toBe('1:02:03');
  expect(coinSprites(10)).toBe(6);
  expect(coinSprites(1e12)).toBe(20);
});
