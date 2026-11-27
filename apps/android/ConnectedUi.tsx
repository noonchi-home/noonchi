import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, StyleSheet, View, useWindowDimensions, type KeyboardTypeOptions, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { Text, TextInput } from "./AppText";
import { font } from "./fonts";
import { pressMotion, reduceMotionStore, savedMotion, slideMotion } from "./motion";

export const colors = { brand: "#a1143e", white: "#ffffff", canvas: "#f8f2ea", surface: "#fffcf8", edge: "#e7dbce",
  ink: "#2a2627", muted: "#645b5b", cream: "#f2e4d3", green: "#1b7041", warn: "#835700", error: "#b5350e" };

export function Panel({ children }: { children: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}
export function Heading({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>;
}
export function Copy({ children }: { children: ReactNode }) {
  return <Text style={styles.copy}>{children}</Text>;
}
export function Failure({ children }: { children: string }) {
  return children ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{children}</Text> : null;
}
export function Loading({ children = "불러오는 중이에요." }: { children?: string }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.brand} /><Text accessibilityLiveRegion="polite" style={styles.copy}>{children}</Text></View>;
}

export function Action({ title, onPress, disabled = false, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <MotionPressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[styles.action, secondary && styles.secondary]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{title}</Text>
  </MotionPressable>;
}

export function Choice({ title, value, onPress, selected, disabled = false }: {
  title: string; value?: string; onPress: () => void; selected?: boolean; disabled?: boolean;
}) {
  return <MotionPressable accessibilityRole={selected === undefined ? "button" : "checkbox"} accessibilityState={{ disabled, checked: selected }}
    onPress={onPress} disabled={disabled} style={[styles.choice, selected && styles.chosen]}>
    <Text style={styles.choiceTitle}>{title}</Text>
    <Text style={styles.choiceValue}>{value ?? (selected === undefined ? "›" : selected ? "✓" : "○")}</Text>
  </MotionPressable>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const DISABLED_OPACITY = 0.55;

/** 누르는 동안 조금 줄고 흐려졌다가 떼면 돌아온다. */
function MotionPressable({ disabled = false, style, children, ...props }: Omit<PressableProps, "style" | "children" | "onPressIn" | "onPressOut"> & {
  disabled?: boolean; style: StyleProp<ViewStyle>; children: ReactNode;
}) {
  const motion = pressMotion(useReduceMotion());
  const [pressed] = useState(() => new Animated.Value(0));
  // 누른 채로 비활성이 되면 떼는 알림이 오지 않을 수 있다
  useEffect(() => { if (disabled) pressed.setValue(0); }, [disabled, pressed]);
  function move(toValue: 0 | 1) {
    Animated.timing(pressed, { toValue, duration: toValue ? motion.inMs : motion.outMs, useNativeDriver: true }).start();
  }
  const rest = disabled ? DISABLED_OPACITY : 1;
  return <AnimatedPressable {...props} disabled={disabled} onPressIn={() => move(1)} onPressOut={() => move(0)} style={[style, {
    opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [rest, rest * motion.opacity] }),
    transform: [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, motion.scale] }) }],
  }]}>{children}</AnimatedPressable>;
}

const reduceMotion = reduceMotionStore(AccessibilityInfo);

export function useReduceMotion() {
  return useSyncExternalStore(reduceMotion.subscribe, reduceMotion.get);
}

/** 저장에 성공할 때마다(count가 늘 때) 체크 표시가 잠깐 나타났다 사라진다. */
export function SavedMark({ count }: { count: number }) {
  const reduce = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(0));
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!count) return;
    const motion = savedMotion(reduce);
    AccessibilityInfo.announceForAccessibility("저장됨");
    opacity.setValue(0);
    setShown(true);
    const run = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: motion.inMs, useNativeDriver: true }),
      Animated.delay(motion.holdMs),
      Animated.timing(opacity, { toValue: 0, duration: motion.outMs, useNativeDriver: true }),
    ]);
    run.start(({ finished }) => { if (finished) setShown(false); });
    return () => run.stop();
  }, [count, opacity]);
  if (!shown) return null;
  return <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.savedLayer, { opacity }]}>
    <View style={styles.saved}><Text style={styles.savedCheck}>✓</Text><Text style={styles.savedText}>저장됨</Text></View>
  </Animated.View>;
}

/** 설정 쪽 넘김: enter() 뒤 바뀐 쪽은 오른쪽에서 들어오고, leave()는 오른쪽으로 내보낸 뒤 돌아간다. */
export function useSlide(page: string | undefined) {
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const entering = useRef(page !== undefined);
  const leaving = useRef(false);
  const [x] = useState(() => new Animated.Value(page !== undefined ? slideMotion("in", width, reduce).from : 0));
  useLayoutEffect(() => {
    if (!entering.current) { x.setValue(0); return; }
    entering.current = false;
    const motion = slideMotion("in", width, reduce);
    x.setValue(motion.from);
    if (motion.ms) Animated.timing(x, { toValue: motion.to, duration: motion.ms, useNativeDriver: true }).start();
  }, [page]);
  return {
    style: { transform: [{ translateX: x }] },
    enter() { entering.current = true; },
    leave(back: () => void) {
      if (leaving.current) return;
      const motion = slideMotion("out", width, reduce);
      if (!motion.ms) return back();
      leaving.current = true;
      Animated.timing(x, { toValue: motion.to, duration: motion.ms, useNativeDriver: true }).start(() => {
        leaving.current = false;
        back();
      });
    },
  };
}

export function Field({ label, value, onChangeText, keyboardType, placeholder }: {
  label: string; value: string; onChangeText: (value: string) => void; keyboardType?: KeyboardTypeOptions; placeholder?: string;
}) {
  return <View style={styles.field}><Text style={styles.copy}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={placeholder}
      placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} /></View>;
}

export function useTask() {
  const pending = useRef(false);
  const live = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await work(); }
    catch (failure) { if (live.current) setError(message(failure)); }
    finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function useSettingTask(onBlock: (value: boolean) => void) {
  const task = useTask();
  useEffect(() => { onBlock(task.busy); }, [onBlock, task.busy]);
  useEffect(() => () => onBlock(false), [onBlock]);
  return task;
}

export function message(error: unknown, fallback = "허브 연결을 확인하고 다시 시도해 주세요."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useResource<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setValue(undefined); setError("");
    void read(request.signal).then(
      result => { if (!request.signal.aborted) setValue(result); },
      failure => { if (!request.signal.aborted) setError(message(failure)); },
    );
    return () => request.abort();
  }, [read, revision]);
  const refresh = useCallback(() => retry(n => n + 1), []);
  return { value, error, refresh };
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.edge, borderRadius: 12, padding: 17, gap: 12, elevation: 1 },
  heading: { color: colors.ink, fontSize: 24, ...font(700), lineHeight: 30 },
  copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  error: { color: colors.error, fontSize: 15, lineHeight: 22 },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 },
  action: { minHeight: 48, backgroundColor: colors.brand, borderRadius: 8, justifyContent: "center", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 },
  actionText: { color: colors.white, textAlign: "center", ...font(700), fontSize: 16 },
  secondary: { backgroundColor: colors.cream },
  secondaryText: { color: colors.ink },
  choice: { minHeight: 48, borderBottomWidth: 1, borderColor: colors.edge, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
  chosen: { backgroundColor: colors.cream, borderRadius: 6 },
  choiceTitle: { flex: 1, color: colors.ink, ...font(600), fontSize: 15 },
  choiceValue: { flexShrink: 1, color: colors.brand, fontSize: 14 },
  field: { gap: 4 },
  savedLayer: { position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" },
  saved: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.edge,
    borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, elevation: 3 },
  savedCheck: { color: colors.green, fontSize: 16, ...font(700) },
  savedText: { color: colors.ink, fontSize: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.edge, paddingHorizontal: 12, borderRadius: 8, color: colors.ink, backgroundColor: colors.white, fontSize: 16 },
});
