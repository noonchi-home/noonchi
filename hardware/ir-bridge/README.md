# Connect the IR board to the home laptop

One USB board sends and receives infrared signals for the home. The hub opens it once and shares that connection for learning buttons in the app, test sends, TV power and the agent's remote buttons. Test mode opens the board too, so buttons can be learned and tried. TV power and the agent's buttons transmit only in live mode.

## Wire and upload

The kit is an Uno-compatible **LGT8F328** board with an IR transmitter on D3 and a 38 kHz IR receiver on D2. It has no light sensor. Aim the emitter at the appliance's IR window and place the receiver where it can hear the original remote.

The board runs the `ir_bridge` firmware. Its source is in the experiment repository: `noonchi-home/experiment`, `jihoon/2026-11-24_lg-tv-infrared-relay/code/tvrelay/arduino/ir_bridge/ir_bridge.ino`. Install **IRremote 4.4.1** in Arduino IDE, add the lgt8fx board package (`https://raw.githubusercontent.com/dbuezas/lgt8fx/master/package_lgt8fx_index.json`) and select board **LGT8F328**, Clock Source **Internal 32MHz**, Clock Divider **2**, Upload **57600** and Variant **328P-LQFP32**. After upload the Serial Monitor at 115200 baud shows `ready ir_bridge raw=750`, and `PING` answers `ok pong`. Close the Serial Monitor and any other program that holds the COM port before the hub opens it.

## Register remotes in the app

1. Start Noonchi on the Windows laptop with the board plugged in.
2. In the app, open **설정 → 가전 연결 → 리모컨 등록**, choose the port that shows **적외선 장치**, and wait for **연결됨**. The port list shows USB serial ports only. Bluetooth serial ports are never opened.
3. Add a remote and choose the twin appliance it controls. One appliance has one remote. Cooking appliances that need care to turn on and door locks cannot have a remote.
4. Learn a button: enter its name and meaning (**켜기**, **끄기**, **전원** or **그 밖**), then press that button on the original remote twice toward the receiver within 30 seconds. NEC signals are stored by address and command. Other protocols are stored as raw timings of at most 750 marks and spaces. A signal equal to another button of the same remote is refused.
5. **신호 보내 보기** sends the stored signal once after a confirmation. For an LG TV whose remote has a single power key, **LG TV 켜기·끄기 신호 넣기** adds dedicated on and off keys (NEC address 0x04, commands 0xC4 and 0xC5). Check on the TV that they work.

Without the kit, start the hub with `IR_FAKE=1`. The port list then includes **가상 적외선 장치** (`FAKE`), a simulated board that presses a new button every 1.2 seconds while learning.

The settings are stored per home in `<runtime>/homes/<home>/remotes.json`: the chosen port (`COMn` with its USB device ID, or `FAKE`) and the remotes with their buttons. On each start the hub finds the same USB device again, even if its COM number changed. If the device is missing, the port shows **USB 장치 없음**.

## TV power

The TV's remote buttons with the meanings on, off or power drive TV power in live mode. A dedicated on or off key is sent even when the current state is unknown. A single power key needs a recent power reading from a light sensor, which this kit lacks, so use dedicated keys or the TV relay below. After a send, explicit and fresh camera evidence of the screen confirms the result within 8 seconds for on and 4 seconds for off. A press of a learned power key on the original remote clears the automation's ownership of the TV. The board's own transmission is ignored for 0.6 seconds after each send.

Other appliances use their remote's on and off keys for turn on and turn off when they have no ThinQ link. The result cannot be read back. Other buttons, such as volume or air conditioner settings, are available to the agent by name.

## Without a light sensor: use the TV relay

An IR kit without a light sensor runs through the TV relay (`tvrelay`) on a laptop next to the TV. The relay sends IR through its Arduino and reads power from the TV's Wi-Fi response (LG NetCast port 8080), including power changed with the original remote. The relay code and its Arduino sketch are in the experiment repository: `noonchi-home/experiment`, `jihoon/2026-11-24_lg-tv-infrared-relay/code/tvrelay/`. Pairing, learning and serving are described in that folder's README.

1. Start the relay with a token of at least 16 characters and keep it reachable over Tailscale.
2. In Noonchi's `.env`, set `TV_RELAY_URL` (an `https` URL, or `http` with the relay's Tailscale IP), `TV_RELAY_TOKEN` (the relay's token) and `TV_RELAY_DEVICE` (the TV's twin ID). Do not learn TV power keys in `remotes.json` for the same TV. Startup stops when both are set.
3. Start Noonchi, switch to **실제 모드** and accept the confirmation. Test mode operates the twin.

The relay's reading every 2 seconds is the TV's state, including a change made with the original remote. Camera sightings do not override it. A relay result of `done` completes the command. `unverified` means the relay sent IR but has not seen the TV change: a TV rule job counts it as not done, and a plan step finishes only when its end condition becomes true from a later reading. When the relay's answer is lost (timeout or dropped connection), the hub reads the TV again: the requested power counts as `done`, anything else as `unverified`. `failed`, `not_sent` (including a relay that is still busy), a refused connection and an HTTP rejection fail the command. The relay token never appears in logs, API responses or the dashboard.

## USB lines

The hub talks to the board through `serial.ps1` and the built-in .NET serial driver at **115200, 8N1**. Each ASCII line ends in LF. Opening the port restarts the board through DTR, and `ready ir_bridge raw=750` follows about 2 seconds later. If no ready line arrives within 4 seconds, the hub sends `PING`. A port held by another program ends `serial.ps1` with exit code 3. [Microsoft SerialPort documentation](https://learn.microsoft.com/en-us/dotnet/api/system.io.ports.serialport?view=netframework-4.8.1)

| Direction | Line | Meaning |
|---|---|---|
| Host → board | `NEC <address> <command> [repeats]`, for example `NEC 0x4 0xC4 0` | Send one NEC frame. Reply `ok sent NEC 0x4 0xC4`. |
| Host → board | `RAW <kHz> <n> <t1> … <tn>` | Replay raw timings in 50 µs units (1–255, n ≤ 750, 30–60 kHz). Reply `ok sent RAW <n>`. Reception pauses while sending. |
| Host → board | `RAWON`, `RAWOFF` | Also report received signals as raw timings. Reply `ok raw on`, `ok raw off`. |
| Host → board | `PING` | Reply `ok pong`. |
| Board → host | `ready ir_bridge raw=750` | The board started. |
| Board → host | `RX <protocol> 0x<address> 0x<command>` | A decoded press. Held-key repeats and unknown protocols are not reported. |
| Board → host | `RXRAW <n> <t1> … <tn>` | Raw timings of a press while `RAWON`. It comes before the `RX` line of the same press. |
| Board → host | `RXOVF` | The raw timings exceeded 750 entries. |
| Board → host | `err …` | `err unknown`, `err bad raw header`, `err bad raw value`, `err bad address` or `err bad command`. |
