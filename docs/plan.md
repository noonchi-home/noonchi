# Device, home layout and phone interfaces

Device states and commands are defined in [src/contract/devices.ts](../src/contract/devices.ts); layout changes are defined in [src/contract/layout.ts](../src/contract/layout.ts). For task steps, route points and plan revisions, see the [plan contract](plan-contract.md).

## Home and device discovery

The active home's scene defines rooms, furniture, appliance IDs and floor coordinates. `GET /api/scene` and `GET /api/rooms` identify those rooms and surfaces. `GET /api/devices` lists controllable devices and sensors. Use the returned ID for subsequent reads and writes. Display labels may be shared by several appliances in the same home.

The [device-kind registry](../src/devices/kinds.ts) defines capability profiles, supported twin types, labels, aliases, approval rules and optional ThinQ adapters. [Device construction](../src/devices/devices.ts) maps scene assets and added devices into these profiles. A visible asset is not necessarily a controllable appliance. Read the individual device profile before offering a command.

## Control and readback

- Read device state with `GET /api/devices/:id`. Its profile determines supported attributes, commands, modes and value ranges.
- Send an appliance request to `POST /api/devices/:id/command`. Unsupported commands are rejected; commands that require approval enter the normal approval flow.
- Use `POST /api/devices/:id/twin` to report a twin attribute change. The server translates controllable attributes into policy-checked commands. Sensor attributes update their readings.
- Subscribe to the hub WebSocket at `/events` for the initial snapshot and later changes. Use the reported state or appliance readback to verify completion. Sending a request alone is insufficient.
- Real ThinQ devices are paired to twin IDs during setup. Virtual Matter devices expose the capabilities of their registered profiles. `GET /api/matter` reports bridge status.

## Layout and phone pose

Use `GET /api/layout` for saved layout changes and `POST /api/layout/save` or `POST /api/layout/reset` to change them. Include the active home where the route requires it. Layout and plan coordinates use meters on the `[x, z]` floor plane. Resolve room, target and surface IDs against the selected home.

The phone sends its pose relative to its WebXR session. Starting alignment relates that pose to the twin. `GET /api/phone/sync` reports alignment status. Use `/api/phone/start-pose` to inspect or configure the initial pose. A rough pose may supply a first-person preview; it is not sufficient evidence for a step that requires a confirmed location.

For server configuration, route ownership and external contact requests, see the [server reference](reference.md).
