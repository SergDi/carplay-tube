import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNext } from '../js/nav.js';

const box = (left, top, width = 100, height = 60) => ({ left, top, width, height });

// 3×2 grid of cards, 20px gaps.
const grid = [box(0, 0), box(120, 0), box(240, 0), box(0, 80), box(120, 80), box(240, 80)];

test('right picks the neighbour in the same row', () => {
  assert.equal(pickNext(grid[0], grid.slice(1), 'right'), 0);
});

test('down picks the card straight below, not a diagonal one', () => {
  const others = grid.filter((_, i) => i !== 1);
  assert.equal(others[pickNext(grid[1], others, 'down')], grid[4]);
});

test('nothing ahead returns -1', () => {
  assert.equal(pickNext(grid[2], [grid[0], grid[1]], 'right'), -1);
});

test('left from the first card column reaches the rail', () => {
  const rail = [box(-140, -20, 80, 80), box(-140, 80, 80, 80)];
  assert.equal(pickNext(grid[3], rail, 'left'), 1);
});

test('down from a chip prefers the card below over the closer rail button', () => {
  const chip = box(20, 0, 60, 40);
  const rail = box(-90, 60, 80, 70); // closer, but off to the side
  const card = box(0, 120, 200, 140);
  assert.equal(pickNext(chip, [rail, card], 'down'), 1);
});
