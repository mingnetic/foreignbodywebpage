const TWO_PI = 2 * Math.PI;
const GAMMA_HZ_PER_T = 42.57747892e6;

export const DEFAULT_PARAMETERS = Object.freeze({
  chiMediumPpm: -9.05,
  chiBodyPpm: 0.36,
  bodyDiameterMm: 0.01,
  b0Tesla: 1.5,
  teMs: 20,
  b0Direction: "z",
  phaseSign: 1,
  fovMm: 20,
  voxelMm: 0.02,
  simulationSpacingMm: 0.001,
  farFieldToleranceRad: 0.005,
  signalThreshold: 0.03,
  displayHalfWidthMm: 0.5,
  maskLowSignal: true,
});

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number.`);
  return number;
}

function validate(raw) {
  const p = {
    chiMediumPpm: finiteNumber(raw.chiMediumPpm, "Medium susceptibility"),
    chiBodyPpm: finiteNumber(raw.chiBodyPpm, "Particle susceptibility"),
    bodyDiameterMm: finiteNumber(raw.bodyDiameterMm, "Particle diameter"),
    b0Tesla: finiteNumber(raw.b0Tesla, "B0"),
    teMs: finiteNumber(raw.teMs, "TE"),
    b0Direction: String(raw.b0Direction),
    phaseSign: Number(raw.phaseSign) === -1 ? -1 : 1,
    fovMm: finiteNumber(raw.fovMm, "FOV"),
    voxelMm: finiteNumber(raw.voxelMm, "MRI voxel size"),
    simulationSpacingMm: finiteNumber(raw.simulationSpacingMm, "Simulation spacing"),
    farFieldToleranceRad: finiteNumber(raw.farFieldToleranceRad, "Far-field tolerance"),
    signalThreshold: finiteNumber(raw.signalThreshold, "Signal threshold"),
    displayHalfWidthMm: finiteNumber(raw.displayHalfWidthMm, "Display width"),
    maskLowSignal: Boolean(raw.maskLowSignal),
  };

  if (p.bodyDiameterMm <= 0 || p.bodyDiameterMm > 1) {
    throw new Error("Particle diameter must be greater than 0 and at most 1 mm.");
  }
  if (p.b0Tesla <= 0 || p.b0Tesla > 14) throw new Error("B0 must be between 0 and 14 T.");
  if (p.teMs < 0 || p.teMs > 200) throw new Error("TE must be between 0 and 200 ms.");
  if (p.fovMm <= 0 || p.voxelMm <= 0 || p.simulationSpacingMm <= 0) {
    throw new Error("FOV, voxel size and simulation spacing must be positive.");
  }
  if (p.farFieldToleranceRad <= 0) throw new Error("Far-field tolerance must be positive.");
  if (p.signalThreshold < 0 || p.signalThreshold >= 1) {
    throw new Error("Signal threshold must be at least 0 and below 1.");
  }
  if (!['x', 'y', 'z'].includes(p.b0Direction)) throw new Error("Invalid B0 direction.");

  const matrixSize = Math.round(p.fovMm / p.voxelMm);
  if (matrixSize < 64 || matrixSize > 1500) {
    throw new Error(`The requested matrix is ${matrixSize} × ${matrixSize}. Use 64–1500 pixels per axis.`);
  }
  const nsub = Math.ceil(p.voxelMm / p.simulationSpacingMm);
  if (nsub < 1 || nsub > 64) {
    throw new Error(`The requested local grid needs ${nsub} samples per voxel axis. The browser limit is 64.`);
  }
  return { p, matrixSize, nsub };
}

function directionVector(direction) {
  if (direction === "x") return [0, 0, 1];
  if (direction === "y") return [0, 1, 0];
  return [1, 0, 0];
}

export function simulate(rawParameters, progress = () => {}) {
  const started = performance.now();
  const { p, matrixSize: n, nsub } = validate(rawParameters);
  const direction = directionVector(p.b0Direction);
  const deltaChi = (p.chiBodyPpm - p.chiMediumPpm) * 1e-6;
  const radius = p.bodyDiameterMm / 2;
  const teSeconds = p.teMs * 1e-3;
  const realisedFov = n * p.voxelMm;
  const simulationSpacing = p.voxelMm / nsub;
  const centerIndex = Math.floor(n / 2);
  const planeLength = n * n;
  const radiusSquared = radius * radius;
  const fieldScale = p.b0Tesla * deltaChi * radius ** 3 / 3;
  const phaseScale = p.phaseSign * TWO_PI * GAMMA_HZ_PER_T * teSeconds;

  const fieldAxialPpm = new Float32Array(planeLength);
  const fieldCoronalPpm = new Float32Array(planeLength);
  const phaseAxialRad = new Float32Array(planeLength);
  const phaseCoronalRad = new Float32Array(planeLength);
  const magnitudeAxial = new Float32Array(planeLength);
  const magnitudeCoronal = new Float32Array(planeLength);
  magnitudeAxial.fill(1);
  magnitudeCoronal.fill(1);

  const warnings = [];
  const samplesAcrossParticle = p.bodyDiameterMm / simulationSpacing;
  if (samplesAcrossParticle < 8) {
    warnings.push("Fewer than eight fine samples span the particle; reduce the simulation spacing and check convergence.");
  }
  if (Math.abs(deltaChi) > 100e-6) {
    warnings.push("Large susceptibility contrast: the linear, non-ferromagnetic sphere model may not be physically adequate.");
  }

  function fieldAt(x, y, z) {
    const r2 = x * x + y * y + z * z;
    if (r2 <= radiusSquared) return 0;
    const parallel = direction[0] * z + direction[1] * y + direction[2] * x;
    const angular = 3 * parallel * parallel / r2 - 1;
    return fieldScale * angular / (r2 * Math.sqrt(r2));
  }

  progress(0.05, "Calculating axial point field…");
  for (let row = 0; row < n; row += 1) {
    const y = (row - centerIndex) * p.voxelMm;
    for (let column = 0; column < n; column += 1) {
      const x = (column - centerIndex) * p.voxelMm;
      const index = row * n + column;
      const field = fieldAt(x, y, 0);
      const unwrapped = phaseScale * field;
      fieldAxialPpm[index] = field / p.b0Tesla * 1e6;
      phaseAxialRad[index] = Math.atan2(Math.sin(unwrapped), Math.cos(unwrapped));
    }
  }

  progress(0.3, "Calculating coronal point field…");
  for (let row = 0; row < n; row += 1) {
    const z = (row - centerIndex) * p.voxelMm;
    for (let column = 0; column < n; column += 1) {
      const x = (column - centerIndex) * p.voxelMm;
      const index = row * n + column;
      const field = fieldAt(x, 0, z);
      const unwrapped = phaseScale * field;
      fieldCoronalPpm[index] = field / p.b0Tesla * 1e6;
      phaseCoronalRad[index] = Math.atan2(Math.sin(unwrapped), Math.cos(unwrapped));
    }
  }

  const voxelDiagonal = Math.sqrt(3) * p.voxelMm;
  const phaseDipoleCoefficient = TWO_PI * GAMMA_HZ_PER_T * p.b0Tesla *
    Math.abs(deltaChi) * teSeconds * radius ** 3 / 3;
  const gradientRadius = phaseDipoleCoefficient > 0
    ? (8 * phaseDipoleCoefficient * voxelDiagonal / p.farFieldToleranceRad) ** 0.25
    : 0;
  const fineRadius = Math.max(4 * radius, radius + voxelDiagonal, gradientRadius);
  const margin = fineRadius + voxelDiagonal / 2;
  const localIndices = [];
  for (let i = 0; i < n; i += 1) {
    if (Math.abs((i - centerIndex) * p.voxelMm) <= margin) localIndices.push(i);
  }

  const samplesPerVoxel = nsub ** 3;
  const estimatedFineSamples = 2 * localIndices.length ** 2 * samplesPerVoxel;
  if (estimatedFineSamples > 50_000_000) {
    throw new Error("This parameter combination requires more than 50 million fine samples. Increase the local spacing or reduce the object/TE/susceptibility range.");
  }

  const offsets = new Float64Array(nsub);
  for (let i = 0; i < nsub; i += 1) {
    offsets[i] = ((i + 0.5) / nsub - 0.5) * p.voxelMm;
  }

  function integrateVoxel(cx, cy, cz) {
    let real = 0;
    let imaginary = 0;
    let insideCount = 0;
    for (let iz = 0; iz < nsub; iz += 1) {
      const z = cz + offsets[iz];
      for (let iy = 0; iy < nsub; iy += 1) {
        const y = cy + offsets[iy];
        for (let ix = 0; ix < nsub; ix += 1) {
          const x = cx + offsets[ix];
          const r2 = x * x + y * y + z * z;
          if (r2 <= radiusSquared) {
            insideCount += 1;
            continue;
          }
          const parallel = direction[0] * z + direction[1] * y + direction[2] * x;
          const angular = 3 * parallel * parallel / r2 - 1;
          const field = fieldScale * angular / (r2 * Math.sqrt(r2));
          const phase = phaseScale * field;
          real += Math.cos(phase);
          imaginary += Math.sin(phase);
        }
      }
    }
    real /= samplesPerVoxel;
    imaginary /= samplesPerVoxel;
    return {
      phase: Math.atan2(imaginary, real),
      magnitude: Math.hypot(real, imaginary),
      bodyFraction: insideCount / samplesPerVoxel,
    };
  }

  let maximumBodyFraction = 0;
  let minimumMagnitude = 1;
  let lowSignalAxial = 0;
  let lowSignalCoronal = 0;

  progress(0.55, "Integrating axial MRI voxels in 3D…");
  for (const row of localIndices) {
    const y = (row - centerIndex) * p.voxelMm;
    for (const column of localIndices) {
      const x = (column - centerIndex) * p.voxelMm;
      const index = row * n + column;
      const signal = integrateVoxel(x, y, 0);
      phaseAxialRad[index] = signal.phase;
      magnitudeAxial[index] = signal.magnitude;
      maximumBodyFraction = Math.max(maximumBodyFraction, signal.bodyFraction);
      minimumMagnitude = Math.min(minimumMagnitude, signal.magnitude);
      if (signal.magnitude < p.signalThreshold) lowSignalAxial += 1;
    }
  }

  progress(0.78, "Integrating coronal MRI voxels in 3D…");
  for (const row of localIndices) {
    const z = (row - centerIndex) * p.voxelMm;
    for (const column of localIndices) {
      const x = (column - centerIndex) * p.voxelMm;
      const index = row * n + column;
      const signal = integrateVoxel(x, 0, z);
      phaseCoronalRad[index] = signal.phase;
      magnitudeCoronal[index] = signal.magnitude;
      maximumBodyFraction = Math.max(maximumBodyFraction, signal.bodyFraction);
      minimumMagnitude = Math.min(minimumMagnitude, signal.magnitude);
      if (signal.magnitude < p.signalThreshold) lowSignalCoronal += 1;
    }
  }

  const runtimeMs = performance.now() - started;
  progress(1, "Simulation complete");
  return {
    parameters: p,
    arrays: {
      fieldAxialPpm,
      fieldCoronalPpm,
      phaseAxialRad,
      phaseCoronalRad,
      magnitudeAxial,
      magnitudeCoronal,
    },
    diagnostics: {
      matrixSize: n,
      realisedFovMm: realisedFov,
      subsamplesPerAxis: nsub,
      simulationSpacingMm: simulationSpacing,
      samplesAcrossParticle,
      fineRadiusMm: fineRadius,
      localRoiPixels: localIndices.length,
      estimatedFineSamples,
      maximumBodyFraction,
      minimumMagnitude,
      lowSignalAxial,
      lowSignalCoronal,
      deltaChiPpm: deltaChi * 1e6,
      runtimeMs,
    },
    warnings,
  };
}

