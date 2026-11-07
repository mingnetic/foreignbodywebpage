# Foreign-body GRE simulator

A static, browser-only implementation of the analytic 3D spherical susceptibility model from `foreign_body_MRI_phase_simulation.ipynb`.

The simulator calculates central axial and coronal planes, with local 3D complex averaging inside MRI voxels near the particle. It does not use a dipole-convolution FFT or simulate MRI k-space acquisition.

## Run locally

Install a current Node.js release, then run:

```bash
npm test
npm run dev
```

Open the local address printed in the terminal. No npm packages are required.

## Publish with GitHub Pages

1. Create an empty repository on GitHub.
2. Upload or push this complete project, including `.github/workflows/pages.yml`.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **GitHub Actions** as the source.
5. Push to the `main` branch. The included workflow publishes the contents of `dist/`.

Using Git from the project directory:

```bash
git init
git add .
git commit -m "Add browser-based GRE simulator"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
git push -u origin main
```

After the workflow succeeds, the site is normally available at:

```text
https://YOUR-NAME.github.io/YOUR-REPOSITORY/
```

## Files

- `dist/index.html` — interface and scientific model description
- `dist/styles.css` — responsive layout
- `dist/app.js` — form controls, rendering and downloads
- `dist/simulation-core.js` — numerical model
- `dist/simulation-worker.js` — background browser thread
- `tests/simulation.test.mjs` — regression test against the notebook defaults
- `.github/workflows/pages.yml` — GitHub Pages deployment

## Scientific scope

The particle is modelled as an isotropic, linearly magnetisable sphere without MR-visible signal. Magnitude reflects particle partial volume and static intravoxel dephasing only. The model excludes intrinsic T2*, diffusion, noise, chemical shift, RF and slice-profile effects, k-space point-spread functions, readout distortion and vendor phase processing.

This simulator cannot determine MRI safety. Ferromagnetic, remanently magnetised, saturated or irregular particles require a different electromagnetic model.

