# 3D dashboard and twin assets

The dashboard renders the baked Mokryeon 180B home with three.js. Homes without a supported baked view use the viewer fallback. Home assets are served from the active home's `/twin/` routes.

| Path | Contents |
|---|---|
| `twin/homes/mokryeon_180b/bake/` | Baked GLB, light maps, ground image and manifest. |
| `twin/homes/mokryeon_180b/assets/` | Individual models loaded by the standalone twin and setup viewer through `scene.json`. |
| `twin/SOURCE.json` | Source revision and SHA-256 checksums of imported assets. |
| `ui/src/twin/3d/homes/mokryeon_180b.light.json` | Hemisphere lighting used by the dashboard. |

Layout edits appear immediately. Rebake the home to update shadows after moving or adding furniture.

## Rebuild and import assets

1. From the twin asset authoring checkout, build the home before baking it. This refreshes the individual door and wardrobe models, the assembled apartment and the Blender scene used for baking. These settings are an example.

```bash
uv run python -m studio apartment --home mokryeon_180b --no-render
uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step scene --density 32 --max-size 1024
uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step bake --samples 128
uv run python -m studio bake --home mokryeon_180b --out homes/mokryeon_180b/bake --step finish
```

2. From NOONCHI, import the individual models and the bake together. Replace `<source>` with the asset checkout path.

```bash
npx tsx scripts/twin-assets.ts --from <source> --only homes/mokryeon_180b/assets/ --only homes/mokryeon_180b/bake/ --only homes/mokryeon_180b/scene.json
```

3. If the environment lighting changed, regenerate it with `ui/scripts/bake-light.ts` using the HDR, baked manifest and output lighting JSON. Rebuild the UI before verifying an imported scene.

## Preview and check the dashboard

```bash
npm run heavy -- npm --prefix ui run build
npm run dev3d -- start
# Open http://127.0.0.1:8201/ and finish home setup on the first run.
npm run dev3d -- stop
```

Use `?view=first` for the phone-eye camera or `?view=minimap` for a minimap-only dashboard. In the development preview, `?debug=steps&step=0` shows the idle state and steps 1–4 show the sample cup-clearing plan. `play=4000` advances the sample every four seconds. `offline=1` and `settings=1` preview their respective UI states. The preview runs without a phone server; enable the real phone server to test pairing.

Run the dashboard end-to-end check after building the UI:

```bash
npm run heavy -- npx tsx scripts/twin3d/e2e-dashboard.ts --out runtime-3d/e2e
```

Use `npm run capture` for screenshots and `main[data-ready]` to wait for the rendered scene. Run one browser capture, bake, or heavy test at a time.
