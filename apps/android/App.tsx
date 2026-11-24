import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, AppState, Image, Linking, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import ConnectedHome from "./ConnectedHome";
import { createDashboardFlow } from "./dashboard-flow";
import { connectDashboard } from "./pairing";
import { startNativeAr } from "./native-twa";
import { BrandWordmark, wordmarkBackground } from "./BrandWordmark";
import { ScreenBoundary } from "./screen-boundary";

const brand = "#a1143e";
const mascot = require("./assets/mascot-large.webp");
const activeNow = () => AppState.currentState === "active" || AppState.currentState === null;

function Button({ title, onPress, disabled = false }: {
  title: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dim]}>
    <Text style={styles.buttonText}>{title}</Text>
  </Pressable>;
}

function Loading() {
  const { width } = useWindowDimensions();
  return <SafeAreaView style={styles.launch} edges={["top", "left", "right"]}>
    <StatusBar barStyle="light-content" />
    <View style={styles.launchMark}><BrandWordmark width={Math.min(width * 0.59, 270)} /></View>
    <Image source={mascot} accessible={false} style={styles.mascot} resizeMode="contain" />
  </SafeAreaView>;
}

function ScreenFailed({ onRetry }: { onRetry: () => void }) {
  return <SafeAreaView style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <View style={styles.content}>
      <Text accessibilityRole="alert" style={styles.title}>화면을 열지 못했어요</Text>
      <Button title="다시 시도" onPress={onRetry} />
    </View>
  </SafeAreaView>;
}

function Portal({ flow }: { flow: ReturnType<typeof createDashboardFlow> }) {
  const { active, cameraEpoch, screen } = useSyncExternalStore(flow.subscribe, flow.view);
  const [permission, requestPermission, getPermission] = useCameraPermissions({ get: false });
  const [permissionError, setPermissionError] = useState(false);
  const permissionRequest = useRef(false);
  useEffect(() => {
    if (screen.kind === "dashboard" && screen.message) Alert.alert("클로이드를 열지 못했어요", screen.message);
  }, [screen]);

  useEffect(() => {
    flow.setActive(activeNow());
    const subscription = AppState.addEventListener("change", (state) => flow.setActive(state === "active"));
    const launch = setTimeout(flow.finishLaunch, 850);
    return () => {
      clearTimeout(launch);
      subscription.remove();
      flow.setActive(false);
    };
  }, [flow]);

  useEffect(() => {
    if (!active || screen.kind !== "scan") return;
    let current = true;
    void getPermission().then(
      () => { if (current) setPermissionError(false); },
      () => { if (current) setPermissionError(true); },
    );
    return () => { current = false; };
  }, [active, getPermission, screen.kind]);

  async function grantPermission() {
    if (permissionRequest.current) return;
    permissionRequest.current = true;
    setPermissionError(false);
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    } catch { setPermissionError(true); }
    finally { permissionRequest.current = false; }
  }

  if (screen.kind === "launch") return <Loading />;
  if (screen.kind === "dashboard") return <View style={styles.occupy}>
    <View style={styles.occupy} importantForAccessibility={screen.opening ? "no-hide-descendants" : "auto"}>
      <ConnectedHome hubUrl={screen.url} onStart={() => { void flow.startAr(); }} onDisconnect={flow.retryScan} />
    </View>
    {screen.opening && <View style={styles.opening}>
      <View style={styles.progress} accessibilityLiveRegion="polite">
        <ActivityIndicator color={brand} /><Text style={styles.text}>Chrome에서 연결을 확인하고 있어요.</Text>
      </View>
    </View>}
  </View>;
  return <SafeAreaView style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <View style={styles.header}><BrandWordmark /></View>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>대시보드 QR 찍기</Text>
      {screen.kind === "checking" ? <View style={styles.progress}>
        <ActivityIndicator color={brand} /><Text accessibilityLiveRegion="polite" style={styles.text}>연결을 확인하고 있어요.</Text>
      </View> : screen.message ? <>
        <Text accessibilityRole="alert" style={styles.text}>{screen.message}</Text>
        <Button title="QR 다시 찍기" onPress={flow.retryScan} disabled={!active} />
      </> : permission?.granted ? <>
        <Text style={styles.text}>대시보드의 폰 연결 QR을 비춰 주세요.</Text>
        <View style={styles.preview}>
          {active && <CameraView key={cameraEpoch} style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => { void flow.scan(data, cameraEpoch); }} onMountError={() => flow.cameraFailed(cameraEpoch)} />}
          <View pointerEvents="none" style={styles.guide} />
        </View>
      </> : <>
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {permissionError ? "카메라 권한을 확인하지 못했어요. 다시 시도해 주세요."
            : permission?.canAskAgain === false ? "앱 설정에서 카메라 권한을 허용해 주세요."
              : "QR을 찍으려면 카메라 권한을 허용해 주세요."}
        </Text>
        <Button title={permission?.canAskAgain === false ? "앱 설정 열기" : permissionError || permission?.status === "denied" ? "다시 시도" : "카메라 권한 허용"}
          onPress={() => { void grantPermission(); }} disabled={!active} />
      </>}
    </View>
  </SafeAreaView>;
}

export default function App() {
  const [flow] = useState(() => createDashboardFlow({ connect: connectDashboard, open: startNativeAr }, activeNow()));
  return <SafeAreaProvider>
    <ScreenBoundary fallback={retry => <ScreenFailed onRetry={retry} />}>
      <Portal flow={flow} />
    </ScreenBoundary>
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  launch: { flex: 1, backgroundColor: wordmarkBackground, alignItems: "center", paddingTop: 30 },
  launchMark: { flex: 1, justifyContent: "center", alignItems: "center" },
  occupy: { flex: 1 },
  opening: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#fbf7f0" },
  mascot: { width: "72%", maxWidth: 360, height: "66%", alignSelf: "center" },
  page: { flex: 1, backgroundColor: "#fbf7f0" },
  header: { minHeight: 64, backgroundColor: wordmarkBackground, justifyContent: "center", alignItems: "center" },
  content: { flex: 1, padding: 20, gap: 16 },
  title: { color: "#211d1d", fontSize: 24, fontWeight: "700" },
  text: { color: "#42403f", fontSize: 16, lineHeight: 23 },
  progress: { flexDirection: "row", alignItems: "center", gap: 10 },
  preview: { flex: 1, maxHeight: 470, minHeight: 160, borderRadius: 16, overflow: "hidden", backgroundColor: "#211d1d",
    alignItems: "center", justifyContent: "center" },
  guide: { width: "65%", aspectRatio: 1, borderRadius: 16, borderWidth: 2, borderColor: "#ffffff" },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", padding: 12, borderRadius: 10, backgroundColor: brand },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600", textAlign: "center" },
  dim: { opacity: 0.65 },
});
