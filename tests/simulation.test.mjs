import assert from 'node:assert/strict';
import { DEFAULT_PARAMETERS, simulate } from '../dist/simulation-core.js';

const result = simulate(DEFAULT_PARAMETERS);
const d = result.diagnostics;
const a = result.arrays;

assert.equal(d.matrixSize, 1000);
assert.equal(d.subsamplesPerAxis, 20);
assert.equal(d.localRoiPixels, 13);
assert.ok(Math.abs(d.simulationSpacingMm - 0.001) < 1e-12);
assert.ok(Math.abs(d.fineRadiusMm - 0.1149) < 0.0002);
assert.ok(Math.abs(d.maximumBodyFraction - 0.069) < 1e-6);
assert.ok(Math.abs(d.minimumMagnitude - 0.15515) < 0.0002);

const min = (array) => array.reduce((value, item) => Math.min(value, item), Infinity);
const max = (array) => array.reduce((value, item) => Math.max(value, item), -Infinity);

assert.ok(Math.abs(min(a.fieldAxialPpm) - (-0.0490104)) < 1e-5);
assert.ok(Math.abs(max(a.fieldAxialPpm)) < 1e-12);
assert.ok(Math.abs(min(a.fieldCoronalPpm) - (-0.0490104)) < 1e-5);
assert.ok(Math.abs(max(a.fieldCoronalPpm) - 0.0980208) < 1e-5);
assert.ok(Math.abs(min(a.phaseAxialRad) - (-0.315272)) < 2e-4);
assert.ok(Math.abs(max(a.phaseCoronalRad) - 0.573296) < 2e-4);

for (const array of Object.values(a)) {
  assert.equal(array.length, 1_000_000);
  for (let i = 0; i < array.length; i += 97_531) assert.ok(Number.isFinite(array[i]));
}

console.log(`Validated notebook defaults in ${(d.runtimeMs / 1000).toFixed(2)} s.`);

