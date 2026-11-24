import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { SetupView } from "../../src/contract/setup";
import { activeHome, createConnectedHub, readHomeCard, startPositionLabel, type ConnectedHub } from "./connected-hub";
import { connectedStore } from "./connected-storage";
import { Action, Copy, Failure, Heading, Loading, Panel, colors, useResource } from "./ConnectedUi";
import { ConnectedHouse } from "./ConnectedHouse";
import { ConnectedSettings } from "./ConnectedSettings";
import { BrandWordmark, wordmarkBackground } from "./BrandWordmark";

export interface ConnectedHomeProps {
  hubUrl: string;
  onStart: () => void;
  onDisconnect: () => void;
}

const peek = require("./assets/face-peek.webp");
const mascot = require("./assets/mascot-large.webp");
const tabs = [{ id: "home", name: "홈", glyph: "⌂" }, { id: "house", name: "집 관리", glyph: "▤" }, { id: "settings", name: "설정", glyph: "⚙" }] as const;
type Tab = (typeof tabs)[number]["id"];
const homeName = (name: string) => name.replace(/\s*[(（].*$/, "").trim() || name;

export default function ConnectedHome(props: ConnectedHomeProps) {
  return <HubTabs key={props.hubUrl} {...props} />;
}

function HubTabs({ hubUrl, onStart, onDisconnect }: ConnectedHomeProps) {
  const hub = useMemo(() => createConnectedHub(hubUrl), [hubUrl]);
  const store = useMemo(() => connectedStore(hub.origin), [hub]);
  const [tab, setTab] = useState<Tab>("home");
  const [startHome, setStartHome] = useState<string>();
  const [local, setLocal] = useState<{ setup: SetupView; registered: string | null }>();
  const [blocked, setBlocked] = useState(false);
  const [building, setBuilding] = useState(false);
  const [editingHubHouse, setEditingHubHouse] = useState(false);
  const [tabError, setTabError] = useState("");
  const started = useRef(0);
  const load = useCallback(async (signal: AbortSignal) => {
    const [setup, registered] = await Promise.all([hub.get<SetupView>("/api/setup", signal), store.registered()]);
    return { setup, registered };
  }, [hub, store]);
  const server = useResource(load);
  const serverRegistered = server.value?.registered ?? null;
  const acceptCheckedSetup = useCallback((setup: SetupView) => {
    setLocal(current => ({ setup, registered: current ? current.registered : serverRegistered }));
  }, [serverRegistered]);
  const data = local ?? server.value;
  const house = activeHome(data?.setup ?? null, data?.registered ?? null);
  const directStart = tab === "settings" && !!startHome && startHome === house?.id;
  const bounds = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const peekWidth = Math.min(bounds.width * 0.70, bounds.height * 0.35, 272);
  const spaceBelowCard = bounds.height - inset.top - inset.bottom - 352;
  const mascotWidth = Math.min(bounds.width * 0.81, Math.max(85, spaceBelowCard * 152 / 124), 315);

  const backFromStart = useCallback(() => {
    if (!directStart) return false;
    if (blocked) {
      setTabError("진행 중인 설정을 마친 뒤 이동해 주세요.");
      return true;
    }
    setStartHome(undefined);
    setTabError("");
    setTab("home");
    return true;
  }, [blocked, directStart]);
  useEffect(() => {
    if (!directStart) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", backFromStart);
    return () => subscription.remove();
  }, [backFromStart, directStart]);

  function move(next: Tab) {
    if (next === tab && !directStart) return;
    if (blocked) return setTabError("진행 중인 사진이나 설정을 마친 뒤 이동해 주세요.");
    setTabError("");
    setStartHome(undefined);
    setEditingHubHouse(false);
    setTab(next);
  }
  function openStartPosition() {
    if (!house || !data?.setup.position.start || blocked) return;
    setStartHome(house.id);
    setTabError("");
    setTab("settings");
  }
  function updated(setup: SetupView, registered = data?.registered ?? null) {
    setLocal({ setup, registered });
  }
  function refresh() {
    setLocal(undefined);
    setTabError("");
    server.refresh();
  }

  return <SafeAreaView edges={["top", "left", "right"]} style={styles.page}>
    <StatusBar barStyle="dark-content" />
    {!building && <View style={styles.header}>
      <BrandWordmark />
    </View>}
    <ScrollView style={styles.scroll} contentContainerStyle={building ? { flexGrow: 1 } : styles.content} keyboardShouldPersistTaps="handled">
      <Failure>{tabError}</Failure>
      {!data ? <Panel>{server.error ? <>
        <Failure>{server.error}</Failure><Action title="다시 불러오기" onPress={refresh} />
        <Action title="서버 연결 끊기" onPress={onDisconnect} secondary />
      </> : <Loading />}</Panel> : tab === "home" ? (house ? <View style={styles.homeCard}>
        <Heading>{homeName(house.name)}</Heading>
        <RegisteredHomeRows key={house.id} home={house.id} hub={hub} enabled={data.setup.position.start}
          openStartPosition={openStartPosition} acceptSetup={acceptCheckedSetup} />
        <Action title="클로이드 켜기" onPress={() => {
          const now = Date.now();
          if (now - started.current < 850) return;
          started.current = now;
          onStart();
        }} />
      </View> : <Panel>
        <Heading>우리 집</Heading>
        <View style={styles.status}><View accessible={false} style={[styles.dot, { backgroundColor: colors.warn }]} />
          <Copy>{data.setup.switching ? "허브가 집을 바꾸고 있어요." : "우리 집을 먼저 등록해 주세요."}</Copy>
        </View>
        <Action title={data.setup.switching ? "집 다시 확인하기" : "우리 집 등록하기"} onPress={() => {
          if (data.setup.switching) refresh(); else move("house");
        }} />
      </Panel>) : tab === "house" && !editingHubHouse ? <ConnectedHouse hub={hub} setup={data.setup} home={house} store={store} onBlock={setBlocked}
        onBuilding={setBuilding} onChooseHouse={() => setEditingHubHouse(true)}
        onRegistered={setup => updated(setup, setup.home?.id ?? null)} onHome={() => { setTabError(""); setTab("home"); }} />
        : <ConnectedSettings key={editingHubHouse ? "house-picker" : directStart ? startHome : "settings"}
          hub={hub} setup={data.setup} onBlock={setBlocked} onDisconnect={onDisconnect}
          initialPage={editingHubHouse ? "house" : directStart ? "position" : undefined} backToHome={directStart ? backFromStart : undefined}
          backToHouse={editingHubHouse ? () => setEditingHubHouse(false) : undefined}
          onSaved={async (setup, chosen) => {
            if (chosen) await store.remember(chosen);
            if (setup) updated(setup, chosen ?? data.registered);
            setStartHome(undefined);
            setTabError(""); setTab(editingHubHouse ? "house" : "home"); setEditingHubHouse(false);
          }} />}
    </ScrollView>
    {tab === "home" && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.peek}>
      {house ? <View style={[styles.mascotCrop, { width: mascotWidth, height: mascotWidth * 124 / 152 }]}>
        <Image source={mascot} accessible={false} resizeMode="contain" style={[styles.mascot, {
          width: mascotWidth * 206 / 152, height: mascotWidth * 360 / 152, left: -mascotWidth * 62 / 152, top: mascotWidth * 5 / 152,
        }]} />
      </View> : <Image source={peek} accessible={false} style={{ width: peekWidth, height: peekWidth * 252 / 768 }} />}
    </View>}
    {!building && <View accessibilityRole="tablist" style={[styles.nav, { paddingBottom: inset.bottom }]}>
      {tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.name}
        accessibilityState={{ selected: tab === item.id }} onPress={() => move(item.id)} style={[styles.tab, tab === item.id && styles.active]}>
        <Text accessible={false} importantForAccessibility="no" style={[styles.tabGlyph, tab === item.id && styles.activeText]}>{item.glyph}</Text>
        <Text accessible={false} style={[styles.tabLabel, tab === item.id && styles.activeText]}>{item.name}</Text>
      </Pressable>)}
    </View>}
  </SafeAreaView>;
}

function RegisteredHomeRows({ hub, home, enabled, openStartPosition, acceptSetup }: {
  hub: ConnectedHub; home: string; enabled: boolean; openStartPosition: () => void; acceptSetup: (setup: SetupView) => void;
}) {
  const [connected, setConnected] = useState(true);
  const read = useCallback(async (signal: AbortSignal) => {
    try {
      const card = await readHomeCard(hub, home, signal);
      if (!signal.aborted) {
        setConnected(true);
        acceptSetup(card.setup);
      }
      return card;
    } catch (error) {
      if (!signal.aborted) setConnected(false);
      throw error;
    }
  }, [acceptSetup, home, hub]);
  const { value, error, refresh } = useResource(read);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => listener.remove();
  }, [refresh]);
  const label = startPositionLabel(enabled, home, value?.reading, !!error || value?.startFailed === true);
  return <View style={styles.homeRows}>
    <View style={styles.homeRow}>
      <Text style={styles.rowTitle}>대시보드 연결</Text>
      <View style={styles.rowStatus}>
        <View accessible={false} style={[styles.dot, { backgroundColor: connected ? colors.green : colors.warn }]} />
        <Text style={styles.rowValue} accessibilityLiveRegion="polite">{connected ? "연결됨" : "연결 끊김"}</Text>
      </View>
    </View>
    <View style={styles.rowDivider} />
    <Pressable accessibilityRole="button" accessibilityLabel={`시작 위치 설정, ${label}`}
      accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={openStartPosition}
      style={({ pressed }) => [styles.homeRow, pressed && styles.rowPressed]}>
      <Text style={styles.rowTitle}>시작 위치 설정</Text>
      <View style={styles.rowStatus}>
        <Text style={styles.rowValue}>{label}</Text>
        {enabled && <Text accessible={false} importantForAccessibility="no" style={styles.rowArrow}>›</Text>}
      </View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas }, scroll: { flex: 1 },
  header: { minHeight: 56, alignItems: "center", justifyContent: "center", backgroundColor: wordmarkBackground,
    borderBottomColor: colors.edge, borderBottomWidth: 1 },
  content: { padding: 14, gap: 12, alignSelf: "center", width: "100%", maxWidth: 640 },
  status: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  homeCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.edge, borderRadius: 12, padding: 12, gap: 8, elevation: 1 },
  homeRows: { borderWidth: 1, borderColor: colors.edge, borderRadius: 8, backgroundColor: colors.canvas, overflow: "hidden" },
  homeRow: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.edge },
  rowTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: { color: colors.muted, fontSize: 13 },
  rowArrow: { color: colors.muted, fontSize: 17 },
  rowPressed: { backgroundColor: colors.cream },
  peek: { alignItems: "center", marginBottom: -1 },
  mascotCrop: { overflow: "hidden" },
  mascot: { position: "absolute" },
  nav: { flexDirection: "row", backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.edge, paddingHorizontal: 10, zIndex: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent", gap: 3 },
  active: { borderBottomColor: colors.brand }, activeText: { color: colors.brand, fontWeight: "700" },
  tabGlyph: { fontSize: 22, lineHeight: 24, color: colors.muted },
  tabLabel: { fontSize: 12, color: colors.ink },
});
