# Connect a TV to the home laptop

The Arduino sends a learned power key once. A light sensor facing the screen confirms the result. A physical press on the original remote immediately clears the automation's ownership of the TV, including when it was already off.

## Wire and upload

Use an Arduino Uno R3, a 38 kHz IR receiver module, a driven IR transmitter module, and an analog light module whose output rises with brightness. Connect transmitter signal to D3, receiver output to D2, and light output to A0. Connect the module grounds to the Uno ground and use each module's rated supply voltage. Use a transmitter module with its own LED driver. Aim the emitter at the TV's IR window and place the receiver where it can hear the original remote. Shade the light sensor from room lighting and place it on a part of the screen that distinguishes on from off.

Install **IRremote 4.4.1** in Arduino IDE, select **Arduino Uno**, and upload [ir_tv.ino](ir_tv/ir_tv.ino). If there is no light sensor, set `HAS_LIGHT_SENSOR` to `false` before uploading. An unconnected analog pin can report arbitrary numbers. The supported remote protocols are NEC (including single-frame NEC2), LG, and LG2. [Arduino-IRremote sending and receiving example](https://github.com/Arduino-IRremote/Arduino-IRremote/blob/v4.4.1/examples/ReceiveAndSend/ReceiveAndSend.ino)

## Calibrate and learn the remote

1. Select **시험 모드** in Noonchi. Open the Arduino Serial Monitor at 115200 baud. Press a TV power key and check for a `remote` line. Test the light readings with the screen off, on with dark content, and on with normal content. Pick two ADC thresholds between the off and on readings. If the ranges overlap, reposition the sensor and repeat. Close the monitor to release the COM port.
2. From the Noonchi repository on the Windows laptop, run the command below with the runtime directory used by the server, the home ID, the TV's twin ID, the board's COM port, the key, and the two thresholds. The values in this example must be replaced with the measured ones. Press and release the requested remote key twice. For separate power keys, repeat with `on` and `off`. For a single power key, use `toggle` once.

   ```powershell
   npx tsx scripts/ir-learn.ts runtime mokryeon_180b tv_62442cb3 COM3 toggle 180 420
   ```

3. Restart Noonchi or reopen the home to load the saved settings. Switch to **실제 모드** and accept the confirmation. This home can use IR without a ThinQ token. Test mode operates the twin. To recover after disconnecting USB, reconnect the board and switch to test mode and back to live.

The local file is `<runtime>/homes/<home>/ir.json`. Its `device` and `port` select one TV and USB adapter. The learner preserves existing keys. Keep `offBelow` lower than `onAbove`. Readings between the thresholds reset the hold. At the default `holdMs` of 600, seven 100 ms samples on the same side confirm a change. Default `confirmMs` is 4000 from the request. A single toggle needs a recent power reading from the light sensor. A dedicated on/off key can be sent even when the current state is unknown.

Without usable light readings, the hub accepts explicit, fresh camera evidence for the linked TV through the existing screen-on/screen-off vocabulary. The screen must be visible for this fallback. Silence, transmission acknowledgement alone, a lost port, or conflicting remote input cannot confirm the automation's command. A timeout clears the uncertain state. No automatic retransmission takes place.

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
