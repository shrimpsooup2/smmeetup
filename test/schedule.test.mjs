import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRotatedSchedule, normalizeSchedule } from '../js/util.js';

test('generates the remaining six days from the first two days', () => {
  const result = generateRotatedSchedule([
    { day: 'Day 1', periods: [
      { period: 1, className: 'English', teacher: 'Ms. Lee' },
      { period: 2, className: 'History', teacher: 'Mr. Cole' },
      { period: 3, className: 'Math', teacher: 'Mrs. Grant' },
      { period: 4, className: 'Science', teacher: 'Dr. Vega' },
      { period: 5, className: 'Art', teacher: 'Ms. Ortiz' },
      { period: 6, className: 'PE', teacher: 'Coach Diaz' },
    ] },
    { day: 'Day 2', periods: [
      { period: 1, className: 'Biology', teacher: 'Mr. Shaw' },
      { period: 2, className: 'Music', teacher: 'Ms. Brooks' },
      { period: 3, className: 'Spanish', teacher: 'Sra. Ruiz' },
      { period: 4, className: 'Chemistry', teacher: 'Mrs. Chen' },
      { period: 5, className: 'Drama', teacher: 'Ms. Patel' },
      { period: 6, className: 'Lunch', teacher: 'N/A' },
    ] },
  ], 8, 6);

  assert.equal(result.length, 8);
  assert.equal(result[0].periods.length, 6);
  assert.equal(result[1].periods[1].className, 'Music');
  assert.equal(result[2].periods[1].className, 'Biology');
  assert.equal(result[2].periods[3].className, 'History');
  assert.equal(result[2].periods[2].className, 'Chemistry');
});

test('normalizes older schedule data to six periods per day', () => {
  const result = normalizeSchedule([
    { day: 'Day 1', periods: [{ period: 1, className: 'English', teacher: 'Ms. Lee' }] },
  ], 8, 6);

  assert.equal(result.length, 8);
  assert.equal(result[0].periods.length, 6);
  assert.equal(result[0].periods[0].className, 'English');
});
