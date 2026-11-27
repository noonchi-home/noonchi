// 「가전 연결 → 리모컨 등록」: 리모컨 목록·포트 고르기·리모컨 추가·리모컨 단추·단추 배우기(시안 plans/sketches/2026-11-27-ir-remote-app.html).
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import type { IrRemoteView, IrView, RemoteRole } from "../../src/contract/ir";
import { Action, Choice, Copy, Failure, Field, Heading, Loading, Panel, Pulse, SlidePage, message, useResource, useSettingTask, useSlide } from "./ConnectedUi";
import type { ConnectedHub } from "./connected-hub";
import {
  POLL_MS, ROLE_CHOICES, addPreset, buttonNameProblem, canPreset, cancelLearn, choosePort, deleteButton, deleteRemote, firmwareLabel,
  learnLines, portLine, readIr, readPorts, remoteValue, roleLabel, saveRemote, startLearn, testButton, waitLearn,
} from "./ir-remotes";

type Inner = { kind: "port" } | { kind: "add" } | { kind: "remote"; id: string } | { kind: "learn"; id: string };
type Task = ReturnType<typeof useSettingTask>;
type Shared = { hub: ConnectedHub; home: string; view: IrView; setView: (view: IrView) => void; onBlock: (busy: boolean) => void };

export function ConnectedRemotes({ hub, home, onBlock, onBack }: {
  hub: ConnectedHub; home: string; onBlock: (busy: boolean) => void; onBack: () => void;
}) {
  const read = useCallback((signal: AbortSignal) => readIr(hub, home, signal), [hub, home]);
  const source = useResource(read);
  const { refresh } = source;
  const [fresh, setView] = useState<IrView>();
  const view = fresh ?? source.value;
  const [busy, setBusy] = useState(false);
  const block = useCallback((value: boolean) => { setBusy(value); onBlock(value); }, [onBlock]);
  const [inner, setInner] = useState<Inner>();
  const slide = useSlide(inner?.kind);
  const shownRemote = useRef<IrRemoteView>(undefined);
  const loaded = !!view;
  // 앱이 다시 앞에 오면 다시 읽는다. 읽은 뒤에는 화면을 비우지 않아 배우던 쪽이 그대로 남는다.
  useEffect(() => {
    const state = AppState.addEventListener("change", next => {
      if (next !== "active") return;
      if (loaded) void readIr(hub, home).then(setView, () => {}); else refresh();
    });
    return () => state.remove();
  }, [hub, home, loaded, refresh]);
  // 포트를 여는 동안 POLL_MS마다 다시 읽어 연결 결과를 보인다. 한 번 읽기가 실패해도 이어 읽고, 연결 상태가 바뀌면 멈춘다
  const portState = view?.port.state;
  useEffect(() => {
    if (portState !== "connecting") return;
    const request = new AbortController();
    const timer = setInterval(() => void readIr(hub, home, request.signal).then(setView, () => {}), POLL_MS);
    return () => { clearInterval(timer); request.abort(); };
  }, [hub, home, portState]);

  function go(next: Inner) {
    slide.enter();
    setInner(next);
  }
  const toList = () => slide.leave(() => setInner(undefined));
  if (!view) return <Panel>
    <Heading>리모컨</Heading>
    {source.error ? <><Failure>{source.error}</Failure><Action title="다시 불러오기" onPress={refresh} /></> : <Loading />}
    <Action title="가전 연결로" secondary onPress={onBack} />
  </Panel>;
  const shared: Shared = { hub, home, view, setView, onBlock: block };
  const found = inner && "id" in inner ? view.remotes.find(item => item.id === inner.id) : undefined;
  if (found) shownRemote.current = found;
  // 지운 리모컨은 목록으로 나가는 동안 마지막 모습을 그대로 둔다
  const remote = found ?? (inner && "id" in inner && shownRemote.current?.id === inner.id ? shownRemote.current : undefined);
  return <SlidePage slide={slide}><Panel>
    {!inner || ("id" in inner && !remote) ? <RemoteList view={view} busy={busy} onBack={onBack}
      onPort={() => go({ kind: "port" })} onAdd={() => go({ kind: "add" })} onRemote={id => go({ kind: "remote", id })} />
      : inner.kind === "port" ? <PortPicker {...shared} onDone={toList} />
        : inner.kind === "add" ? <RemoteAdder {...shared} onSaved={id => go({ kind: "remote", id })} />
          : remote && inner.kind === "remote" ? <RemoteButtons {...shared} remote={remote} onLearn={() => go({ kind: "learn", id: remote.id })} onDeleted={toList} />
            : remote && <ButtonLearner {...shared} remote={remote} />}
    {inner && <Action title="리모컨 목록으로" secondary disabled={busy} onPress={toList} />}
  </Panel></SlidePage>;
}

function RemoteList({ view, busy, onPort, onAdd, onRemote, onBack }: {
  view: IrView; busy: boolean; onPort: () => void; onAdd: () => void; onRemote: (id: string) => void; onBack: () => void;
}) {
  return <>
    <Heading>리모컨</Heading>
    <Copy>{portLine(view.port)}</Copy>
    {view.port.state !== "connected" && <Action title="포트 고르기" secondary disabled={busy} onPress={onPort} />}
    {view.remotes.map(remote => <Choice key={remote.id} title={remote.label} value={remoteValue(remote)} disabled={busy}
      onPress={() => onRemote(remote.id)} />)}
    <Action title="리모컨 추가" disabled={busy} onPress={onAdd} />
    <Action title="가전 연결로" secondary disabled={busy} onPress={onBack} />
  </>;
}

function PortPicker({ hub, home, view, setView, onBlock, onDone }: Shared & { onDone: () => void }) {
  const read = useCallback((signal: AbortSignal) => readPorts(hub, signal), [hub]);
  const ports = useResource(read);
  const [chosen, choose] = useState(view.port.name ?? undefined);
  const task = useSettingTask(onBlock);
  const listed = !!chosen && !!ports.value?.ports.some(port => port.name === chosen);
  return <>
    <Heading>포트 고르기</Heading>
    {!ports.value ? (ports.error ? <><Failure>{ports.error}</Failure><Action title="다시 불러오기" onPress={ports.refresh} /></> : <Loading>포트 확인 중</Loading>)
      : ports.value.ports.map(port => <Choice key={port.name} title={`${port.name} · ${port.label}`} value={firmwareLabel(port.firmware)}
        selected={chosen === port.name} disabled={task.busy} onPress={() => choose(port.name)} />)}
    <Failure>{task.error}</Failure>
    <Action title="이 포트 사용" disabled={!listed || task.busy} onPress={() => void task.run(async () => {
      if (!chosen) return;
      setView(await choosePort(hub, home, chosen));
      onDone();
    })} />
  </>;
}

function RemoteAdder({ hub, home, view, setView, onBlock, onSaved }: Shared & { onSaved: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [device, setDevice] = useState<string>();
  const task = useSettingTask(onBlock);
  return <>
    <Heading>리모컨 추가</Heading>
    <Field label="리모컨 이름" value={label} placeholder="거실 TV 리모컨" onChangeText={setLabel} />
    <Copy>가전 고르기</Copy>
    {view.devices.map(item => <Choice key={item.id} title={`${item.roomLabel} · ${item.label}`} selected={device === item.id}
      disabled={task.busy} onPress={() => setDevice(item.id)} />)}
    <Failure>{task.error}</Failure>
    <Action title="리모컨 저장" disabled={!label.trim() || !device || task.busy} onPress={() => void task.run(async () => {
      if (!device) return;
      const next = await saveRemote(hub, home, label.trim(), device);
      setView(next);
      const made = next.remotes.find(item => item.device === device);
      if (made) onSaved(made.id);
    })} />
  </>;
}

function confirmTest(task: Task, hub: ConnectedHub, home: string, remote: string, button: string) {
  Alert.alert("실제 가전에 신호를 보낼까요?", "연결한 실제 가전이 움직일 수 있어요.", [
    { text: "취소", style: "cancel" },
    { text: "보내기", onPress: () => void task.run(async () => { await testButton(hub, home, remote, button); }) },
  ]);
}

function RemoteButtons({ hub, home, remote, setView, onBlock, onLearn, onDeleted }: Shared & {
  remote: IrRemoteView; onLearn: () => void; onDeleted: () => void;
}) {
  const task = useSettingTask(onBlock);
  return <>
    <Heading>{remote.label}</Heading>
    {remote.buttons.map(button => <Choice key={button.id} title={button.label} value={roleLabel(button.role)} disabled={task.busy}
      onPress={() => Alert.alert(button.label, undefined, [
        { text: "취소", style: "cancel" },
        { text: "지우기", style: "destructive", onPress: () => void task.run(async () => { setView(await deleteButton(hub, home, remote.id, button.id)); }) },
        { text: "신호 보내 보기", onPress: () => confirmTest(task, hub, home, remote.id, button.id) },
      ])} />)}
    <Failure>{task.error}</Failure>
    <Action title="단추 배우기" disabled={task.busy} onPress={onLearn} />
    {canPreset(remote) && <Action title="LG TV 켜기·끄기 신호 넣기" secondary disabled={task.busy}
      onPress={() => void task.run(async () => { setView(await addPreset(hub, home, remote.id)); })} />}
    <Action title="리모컨 지우기" secondary disabled={task.busy} onPress={() => Alert.alert("리모컨을 지울까요?", "배운 단추도 모두 지워져요.", [
      { text: "취소", style: "cancel" },
      { text: "지우기", style: "destructive", onPress: () => void task.run(async () => {
        setView(await deleteRemote(hub, home, remote.id));
        onDeleted();
      }) },
    ])} />
  </>;
}

function ButtonLearner({ hub, home, remote, view, setView, onBlock }: Shared & { remote: IrRemoteView }) {
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<RemoteRole>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const task = useSettingTask(onBlock);
  const waiting = useRef<AbortController | null>(null);
  // 쪽을 떠나면 기다림을 멈추고, 아직 배우는 중이면 허브 배우기도 멈춘다
  useEffect(() => () => {
    const stop = waiting.current;
    if (stop && !stop.signal.aborted) { stop.abort(); void cancelLearn(hub, home).catch(() => {}); }
  }, [hub, home]);
  const learning = started && view.learning?.remote === remote.id ? view.learning : null;
  const lines = learning ? learnLines(learning) : { copy: [], failure: "" };
  const problem = buttonNameProblem(label);

  function start() {
    void task.run(async () => {
      setError("");
      setView(await startLearn(hub, home, remote.id, label.trim(), role));
      setStarted(true);
      const stop = new AbortController();
      waiting.current = stop;
      // 읽기 실패는 글로 알리고 계속 기다린다. 기다림이 실패로 끝나도 waiting을 남겨 쪽을 떠날 때 허브 배우기를 취소한다
      waitLearn(hub, home, { signal: stop.signal, onView: next => { setError(""); setView(next); }, onError: failure => setError(message(failure)) }).then(
        () => { waiting.current = null; },
        failure => { if (!stop.signal.aborted) setError(message(failure)); },
      );
    });
  }
  const halt = () => void task.run(async () => { setView(await cancelLearn(hub, home)); });

  if (learning?.state === "waiting") return <>
    <Heading>단추 배우기</Heading>
    <Copy>{lines.copy[0]}</Copy>
    <Pulse>버튼을 눌러 주세요</Pulse>
    <Copy>{lines.copy[1]}</Copy>
    <Failure>{error || task.error}</Failure>
    <Action title="그만" secondary disabled={task.busy} onPress={halt} />
  </>;
  const saved = learning?.state === "saved" ? learning.button : undefined;
  if (saved) return <>
    <Heading>단추 배우기</Heading>
    <Copy>{lines.copy[0]}</Copy>
    <Failure>{task.error}</Failure>
    <Action title="신호 보내 보기" disabled={task.busy} onPress={() => confirmTest(task, hub, home, remote.id, saved)} />
    <Action title="다음 단추 배우기" secondary disabled={task.busy} onPress={() => { setStarted(false); setLabel(""); setRole(null); }} />
  </>;
  return <>
    <Heading>단추 배우기</Heading>
    <Failure>{lines.failure}</Failure>
    {lines.copy.map(line => <Copy key={line}>{line}</Copy>)}
    <Field label="단추 이름" value={label} onChangeText={setLabel} />
    <Copy>단추 뜻</Copy>
    {ROLE_CHOICES.map(choice => <Choice key={String(choice)} title={roleLabel(choice)} selected={role === choice} disabled={task.busy}
      onPress={() => setRole(choice)} />)}
    <Failure>{label ? problem : ""}</Failure>
    <Failure>{error || task.error}</Failure>
    <Action title="배우기 시작" disabled={!!problem || task.busy} onPress={start} />
  </>;
}
