# Implementation provenance

These modules adapt earlier project work. The source names and revisions below identify the original implementations. Runtime dependencies and license notices are documented in [THIRD_PARTY.md](../THIRD_PARTY.md).

| NOONCHI module | Source | Contribution |
|---|---|---|
| `src/world/confirm.ts` | Jihun Shin, noonchi-server `f8545a1`, `noonchi/changes.py` | Confirmation and disappearance from repeated observations. |
| `src/world/relations.ts` | Same revision, `relations.py`, `packet.py`, `remaining.py` and `config/noonchi.yaml` | Object-to-appliance relations, appliance state labels and remaining-time estimates. |
| `src/brain/history/summary.ts` | Same revision, `reflection.py:build_summary` | Chronological daily summaries of significant events. |
| `src/world/trigger.ts` | Same revision, `sendrule.py` | Periodic decision scheduling and idle suppression. |
| `src/observe/ring.ts` | Same revision, `sources.py:TwinEyeSource.next` | Sampling recent observations for a model request. |
| `src/brain/history/db.ts` | Same revision, `store.py:Store` | Persistent records and memory storage. |
| `src/brain/history/reflect.ts` | Same revision, `reflection.py:run_reflection` | Reflection on the daily record. |
| `src/brain/history/retention.ts`, `src/server/start.ts` | Same revision, `pipeline.py:Pipeline.start` and `vault.py:Vault.cleanup` | Retention and cleanup scheduling. |
| `src/brain/decide.ts` | Same revision, `pipeline.py:link_tick` and `send_tick` | Logging for decision triggers and inference connectivity. |
| `src/world/pose.ts` | Jihun Shin, Perception-lab `def9c23`, `lab/scene.py`, `lab/scene2.py` and `lab/config.py` | Pose classification and keypoint-to-box distances. |
| `src/world/fall.ts` | Noury et al., “Fall detection – Principles and Methods,” IEEE EMBC (2007); [BMC Geriatrics study of recorded falls](https://doi.org/10.1186/1471-2318-13-103) (2013) | Background for change-of-posture timing. The implementation also uses camera alignment, continuity and a sustained lying posture. The thresholds are configurable. |
| `twin/apartment/viewer/main.mjs`, `scene.mjs` | twin-studio `9e3aecf`, `apartment/viewer` | Imported viewer with a local change that restricts the mesh-position comparison to debug mode. |
