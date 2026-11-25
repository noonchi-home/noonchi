import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type KeyboardTypeOptions } from "react-native";
import { Text, TextInput } from "./AppText";
import { font } from "./fonts";

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
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, secondary && styles.secondary, (pressed || disabled) && styles.dim]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}

export function Choice({ title, value, onPress, selected, disabled = false }: {
  title: string; value?: string; onPress: () => void; selected?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole={selected === undefined ? "button" : "checkbox"} accessibilityState={{ disabled, checked: selected }}
    onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.choice, selected && styles.chosen, (pressed || disabled) && styles.dim]}>
    <Text style={styles.choiceTitle}>{title}</Text>
    <Text style={styles.choiceValue}>{value ?? (selected === undefined ? "›" : selected ? "✓" : "○")}</Text>
  </Pressable>;
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
  dim: { opacity: 0.55 },
  choice: { minHeight: 48, borderBottomWidth: 1, borderColor: colors.edge, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
  chosen: { backgroundColor: colors.cream, borderRadius: 6 },
  choiceTitle: { flex: 1, color: colors.ink, ...font(600), fontSize: 15 },
  choiceValue: { flexShrink: 1, color: colors.brand, fontSize: 14 },
  field: { gap: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.edge, paddingHorizontal: 12, borderRadius: 8, color: colors.ink, backgroundColor: colors.white, fontSize: 16 },
});
