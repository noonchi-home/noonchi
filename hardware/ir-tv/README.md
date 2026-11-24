# Connect a TV to the home laptop

The Arduino sends a learned power key once. A light sensor facing the screen confirms the result. A physical press on the original remote immediately clears the automation's ownership of the TV, including when it was already off.

## Wire and upload

Use an Arduino Uno R3, a 38 kHz IR receiver module, a driven IR transmitter module, and an analog light module whose output rises with brightness. Connect transmitter signal to D3, receiver output to D2, and light output to A0. Connect the module grounds to the Uno ground and use each module's rated supply voltage. Use a transmitter module with its own LED driver. Aim the emitter at the TV's IR window and place the receiver where it can hear the original remote. Shade the light sensor from room lighting and place it on a part of the screen that distinguishes on from off.

Install **IRremote 4.4.1** in Arduino IDE, select **Arduino Uno**, and upload [ir_tv.ino](ir_tv/ir_tv.ino). Some Uno-compatible boards carry an **LGT8F328** chip. For those, add the lgt8fx board package (`https://raw.githubusercontent.com/dbuezas/lgt8fx/master/package_lgt8fx_index.json`) and select board **LGT8F328**, Clock Source **Internal 32MHz**, Clock Divider **2**, Upload **57600** and Variant **328P-LQFP32**. Pins and wiring stay the same. If there is no light sensor, set `HAS_LIGHT_SENSOR` to `false` before uploading. An unconnected analog pin can report arbitrary numbers. The supported remote protocols are NEC (including single-frame NEC2), LG, and LG2. [Arduino-IRremote sending and receiving example](https://github.com/Arduino-IRremote/Arduino-IRremote/blob/v4.4.1/examples/ReceiveAndSend/ReceiveAndSend.ino)

## Calibrate and learn the remote

1. Select **시험 모드** in Noonchi. Open the Arduino Serial Monitor at 115200 baud. Press a TV power key and check for a `remote` line. Test the light readings with the screen off, on with dark content, and on with normal content. The starting thresholds on the 0–1023 scale are **180 or lower for off** and **420 or higher for on**. If the measured ranges need different thresholds, select values between the ranges. If the ranges overlap, reposition the sensor and repeat. Close the monitor to release the COM port.
2. From the Noonchi repository on the Windows laptop, run the command below with the runtime directory used by the server, the home ID, the TV's twin ID, the board's COM port, and the key. On first registration the learner saves the defaults. To use measured thresholds, append both numbers in off/on order. Omitting them on a later run preserves that home's calibration. Press and release the requested remote key twice. For separate power keys, repeat with `on` and `off`. For a single power key, use `toggle` once.

   ```powershell
   npx tsx scripts/ir-learn.ts runtime mokryeon_180b tv_62442cb3 COM3 toggle
   ```

3. Restart Noonchi or reopen the home to load the saved settings. Switch to **실제 모드** and accept the confirmation. This home can use IR without a ThinQ token. Test mode operates the twin. To recover after disconnecting USB, reconnect the board and switch to test mode and back to live.

The local file is `<runtime>/homes/<home>/ir.json`. Its `device` and `port` select one TV and USB adapter. The learner preserves existing keys. Keep `offBelow` lower than `onAbove`. Readings between the thresholds reset the hold. At the default `holdMs` of 600, seven 100 ms samples on the same side confirm a change. Confirmation windows run from the request: `confirmOnMs` (default 8000, a screen can take seconds to light up) and `confirmOffMs` (default 4000), each up to 15000. A file saved with the older single `confirmMs` reads it as `confirmOffMs`. A single toggle needs a recent power reading from the light sensor. A dedicated on/off key can be sent even when the current state is unknown.

Without usable light readings, the hub accepts explicit, fresh camera evidence for the linked TV through the existing screen-on/screen-off vocabulary. The screen must be visible for this fallback. Silence, transmission acknowledgement alone, a lost port, or conflicting remote input cannot confirm the automation's command. A timeout clears the uncertain state. No automatic retransmission takes place.

## Without a light sensor: use the TV relay

An IR kit without a light sensor runs through the TV relay (`tvrelay`) on a laptop next to the TV. The relay sends IR through its Arduino and reads power from the TV's Wi-Fi response (LG NetCast port 8080), including power changed with the original remote. The relay code and its Arduino sketch are in the experiment repository: `noonchi-home/experiment`, `jihoon/2026-11-24_lg-tv-infrared-relay/code/tvrelay/`. Pairing, learning and serving are described in that folder's README.

1. Start the relay with a token of at least 16 characters and keep it reachable over Tailscale.
2. In Noonchi's `.env`, set `TV_RELAY_URL` (an `https` URL, or `http` with the relay's Tailscale IP), `TV_RELAY_TOKEN` (the relay's token) and `TV_RELAY_DEVICE` (the TV's twin ID). Do not create `ir.json` for the same TV. Startup stops when both are set.
3. Start Noonchi, switch to **실제 모드** and accept the confirmation. Test mode operates the twin.

The relay's reading every 2 seconds is the TV's state, including a change made with the original remote. Camera sightings do not override it. A relay result of `done` completes the command. `unverified` means the relay sent IR but has not seen the TV change: a TV rule job counts it as not done, and a plan step finishes only when its end condition becomes true from a later reading. When the relay's answer is lost (timeout or dropped connection), the hub reads the TV again: the requested power counts as `done`, anything else as `unverified`. `failed`, `not_sent` (including a relay that is still busy), a refused connection and an HTTP rejection fail the command. The relay token never appears in logs, API responses or the dashboard.

## USB lines

The Windows host uses the built-in .NET serial driver at **115200, 8N1**. Each ASCII message ends in LF. The firmware also accepts CRLF. [Microsoft SerialPort documentation](https://learn.microsoft.com/en-us/dotnet/api/system.io.ports.serialport?view=netframework-4.8.1)

| Direction | Line | Meaning |
|---|---|---|
| Host → board | `hello` | Request a readiness reply. |
| Board → host | `boot` | The board restarted. Previously confirmed power and pending commands are cleared. |
| Board → host | `ready` | Ready for commands. Repeated handshake replies are harmless. |
| Host → board | `send <code>` | Transmit one full frame. |
| Board → host | `sent <code>` | Transmission finished. Power still needs independent confirmation. |
| Board → host | `remote <code>` | Original remote press. Held-key repeats and the transmitter's own signal are suppressed. |
| Board → host | `light 0` … `light 1023` or `light none` | Screen brightness sample every 100 ms, or sensor disabled. |

Codes use uppercase hexadecimal. NEC uses four address digits and two command digits. LG and LG2 use a zero-extended two-digit address and four command digits. Only learned power keys affect ownership. The existing `/device/power_intent` and `/device/changes` topics carry requests and confirmed state to the other nodes.
