import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { font, fontFamily, systemFont, withFont } from "./fonts.ts";

const bytes = (name: string) => readFileSync(new URL(name, import.meta.url));
const read = (name: string) => bytes(name).toString("utf8");
const lf = (name: string) => read(name).split("\r\n").join("\n");
// pretendard@1.3.9 꾸러미 dist/public/static의 정적 OTF
const bundled = {
  "Pretendard-SemiBold": "c89bc43027dc7cde5726e96223376f8eec09302b2fc1f8147fd5b57cfc376118",
  "Pretendard-Bold": "2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7",
};
const screens = readdirSync(new URL(".", import.meta.url)).filter(name => name.endsWith(".tsx"));

/** OTF cmap(형식 4·12)에 든 코드 포인트. */
function codePoints(file: Buffer): Set<number> {
  const tables = new Map<string, number>();
  for (let i = 0; i < file.readUInt16BE(4); i++) tables.set(file.toString("latin1", 12 + 16 * i, 16 + 16 * i), file.readUInt32BE(20 + 16 * i));
  const cmap = tables.get("cmap")!;
  const found = new Set<number>();
  for (let i = 0; i < file.readUInt16BE(cmap + 2); i++) {
    const at = cmap + file.readUInt32BE(cmap + 8 + 8 * i);
    const format = file.readUInt16BE(at);
    if (format === 12) {
      for (let g = 0; g < file.readUInt32BE(at + 12); g++) {
        for (let cp = file.readUInt32BE(at + 16 + 12 * g); cp <= file.readUInt32BE(at + 20 + 12 * g); cp++) found.add(cp);
      }
    } else if (format === 4) {
      const segments = file.readUInt16BE(at + 6) / 2;
      for (let s = 0; s < segments; s++) {
        for (let cp = file.readUInt16BE(at + 16 + 2 * segments + 2 * s); cp <= file.readUInt16BE(at + 14 + 2 * s); cp++) found.add(cp);
      }
    }
  }
  return found;
}

test("the app carries the Pretendard 1.3.9 SemiBold and Bold files with their OFL text", () => {
  for (const [name, sha256] of Object.entries(bundled)) {
    const file = bytes(`assets/fonts/${name}.otf`);
    assert.equal(file.subarray(0, 4).toString("latin1"), "OTTO", name);
    assert.equal(createHash("sha256").update(file).digest("hex"), sha256, name);
  }
  const license = read("assets/fonts/OFL-pretendard.txt");
  assert.match(license, /Kil Hyung-jin \(https:\/\/github\.com\/orioncactus\/pretendard\)/);
  assert.match(license, /with Reserved Font Name Pretendard/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("the expo-font plugin registers one res/font family per weight under the names fonts.ts uses", () => {
  const expo = JSON.parse(read("app.json")).expo;
  const plugin = (expo.plugins as unknown[]).find(entry => Array.isArray(entry) && entry[0] === "expo-font") as [string, unknown] | undefined;
  // res/font에 두어야 앱 테마(Alert 대화상자)가 같은 파일을 쓴다. assets/fonts에 또 넣으면 APK에 두 벌 들어간다.
  assert.deepEqual(plugin?.[1], { android: { fonts: [
    { fontFamily: "Pretendard-SemiBold", fontDefinitions: [{ path: "./assets/fonts/Pretendard-SemiBold.otf", weight: 600 }] },
    { fontFamily: "Pretendard-Bold", fontDefinitions: [{ path: "./assets/fonts/Pretendard-Bold.otf", weight: 700 }] },
  ] } });
  const manifest = JSON.parse(read("package.json"));
  assert.match(manifest.dependencies["expo-font"], /^~58\.0\.\d+$/);
  // APK 빌드는 package-lock으로 npm ci를 하므로 설정 플러그인이 찾을 자리(node_modules/expo-font)가 잠금에 있어야 한다
  const lock = JSON.parse(read("package-lock.json")).packages;
  assert.equal(lock[""].dependencies["expo-font"], manifest.dependencies["expo-font"]);
  assert.match(lock["node_modules/expo-font"]?.version ?? "", /^58\.0\.\d+$/);
});

test("the app theme draws native Alert dialogs in Pretendard SemiBold and the APK carries the OFL text", async () => {
  const expo = JSON.parse(read("app.json")).expo;
  assert.ok((expo.plugins as unknown[]).includes("./plugins/pretendard.cjs"));
  const plugin = createRequire(import.meta.url)("./plugins/pretendard.cjs");
  const config = plugin({ name: "NOONCHI", slug: "noonchi-android" });
  // expo 58 템플릿의 styles.xml
  const template = { resources: { style: [
    { $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" }, item: [{ $: { name: "android:editTextBackground" }, _: "@drawable/rn_edit_text_material" }] },
    { $: { name: "Theme.App.SplashScreen", parent: "AppTheme" }, item: [{ $: { name: "android:windowBackground" }, _: "@drawable/splashscreen_logo" }] },
  ] } };
  const native = mkdtempSync(join(tmpdir(), "pretendard-android-"));
  try {
    const modRequest = { platform: "android", projectRoot: fileURLToPath(new URL(".", import.meta.url)), platformProjectRoot: native, introspect: false };
    const styled = await config.mods.android.styles({ ...config, modResults: template, modRequest: { ...modRequest, modName: "styles" } });
    const [appTheme, splash] = styled.modResults.resources.style;
    assert.deepEqual(appTheme.item, [
      { $: { name: "android:editTextBackground" }, _: "@drawable/rn_edit_text_material" },
      { $: { name: "android:fontFamily" }, _: "@font/xml_pretendard_semi_bold" },
      { $: { name: "fontFamily" }, _: "@font/xml_pretendard_semi_bold" },
    ]);
    assert.deepEqual(splash.item, [{ $: { name: "android:windowBackground" }, _: "@drawable/splashscreen_logo" }]);
    await config.mods.android.dangerous({ ...config, modResults: {}, modRequest: { ...modRequest, modName: "dangerous" } });
    assert.equal(readFileSync(join(native, "app/src/main/assets/fonts/OFL-pretendard.txt"), "utf8"), read("assets/fonts/OFL-pretendard.txt"));
  } finally { rmSync(native, { recursive: true, force: true }); }
});

test("Expo Go loads the same font files under the same names before the first screen, only in development", () => {
  // 배포 번들은 __DEV__가 false라 Metro가 이 require를 빼서 APK에 글꼴이 두 벌 들어가지 않는다
  const dev = lf("dev-fonts.ts");
  assert.match(dev, /const devFonts: Record<string, FontSource> = __DEV__ \? \{\n\s*\[fontFamily\[600\]\]: require\("\.\/assets\/fonts\/Pretendard-SemiBold\.otf"\),\n\s*\[fontFamily\[700\]\]: require\("\.\/assets\/fonts\/Pretendard-Bold\.otf"\),\n\s*\} : \{\};/);
  assert.match(dev, /const \[loaded, error\] = useFonts\(devFonts\);\n\s*return error != null \? "missing" : loaded \? "ready" : "loading";/);
  const app = lf("App.tsx");
  // 올리다 실패해도 화면은 열고, 실패한 줄을 AppText에 알린다
  assert.match(app, /export default function App\(\) \{\n\s*const fonts = useAppFonts\(\);[\s\S]*?if \(fonts === "loading"\) return null;\n\s*return <FontsMissing\.Provider value=\{fonts === "missing"\}><SafeAreaProvider>/);
});

test("when Expo Go fails to load the font files, text drops the unregistered name and keeps its weight in the system font", () => {
  const title = { color: "#211d1d", fontSize: 24, fontFamily: "Pretendard-Bold" };
  assert.deepEqual(systemFont(title), { color: "#211d1d", fontSize: 24, fontWeight: "700" });
  assert.deepEqual(systemFont({ fontFamily: "Pretendard-SemiBold", lineHeight: 23 }), { lineHeight: 23, fontWeight: "600" });
  // 이름이 없는 안쪽 글자는 바깥 굵기를 물려받는다
  const inner = { color: "#a1143e" };
  assert.equal(systemFont(inner), inner);
  assert.equal(systemFont(undefined), undefined);
  const shared = lf("AppText.tsx");
  assert.match(shared, /export function Text\([^)]*\) \{\n\s*const nested = useContext\(InText\);\n\s*const missing = useContext\(FontsMissing\);\n\s*const own = withFont\(style, nested\);\n\s*return <InText\.Provider value><NativeText \{\.\.\.props\} style=\{missing \? systemFont\(StyleSheet\.flatten\(own\)\) : own\} \/><\/InText\.Provider>;/);
  assert.match(shared, /export function TextInput\([^)]*\) \{\n\s*const missing = useContext\(FontsMissing\);\n\s*const own = withFont\(style, false\);\n\s*return <NativeTextInput \{\.\.\.props\} style=\{missing \? systemFont\(StyleSheet\.flatten\(own\)\) : own\} \/>;/);
});

test("every character in the app code is in both Pretendard files, so no text falls back to a system font at 400", () => {
  const fonts = Object.keys(bundled).map(name => codePoints(bytes(`assets/fonts/${name}.otf`)));
  assert.ok(fonts.every(set => set.has(0xac00) && set.has(0x203a)), "cmap parsed");
  const sources = readdirSync(new URL(".", import.meta.url)).filter(name => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));
  const missing: string[] = [];
  for (const name of sources) {
    const code = read(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
    for (const char of new Set(code)) {
      const cp = char.codePointAt(0)!;
      if (cp > 0x7f && fonts.some(set => !set.has(cp))) missing.push(`${name} ${char} U+${cp.toString(16).toUpperCase()}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the bottom tabs draw the web phone tabs' lucide House, Map and Settings PNGs in a 22x22 box, tinted like the labels", () => {
  const home = lf("ConnectedHome.tsx");
  assert.match(home, /\{ id: "home", name: "홈", icon: require\("\.\/assets\/tabs\/house\.png"\) \}, \{ id: "house", name: "집 관리", icon: require\("\.\/assets\/tabs\/map\.png"\) \}, \{ id: "settings", name: "설정", icon: require\("\.\/assets\/tabs\/settings\.png"\) \}/);
  assert.match(home, /<Image source=\{item\.icon\} accessible=\{false\} style=\{\[styles\.tabIcon, tab === item\.id && styles\.activeIcon\]\} \/>/);
  assert.match(home, /tabIcon: \{ width: 22, height: 22, tintColor: colors\.muted \}/);
  assert.match(home, /activeIcon: \{ tintColor: colors\.brand \}/);
  for (const file of ["house", "map", "settings"]) {
    const png = bytes(`assets/tabs/${file}.png`);
    assert.equal(png.toString("latin1", 1, 4), "PNG", file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [66, 66], file);
  }
});

test("weights map to the bundled file names and nothing lighter than SemiBold can be named", () => {
  assert.deepEqual(fontFamily, { 600: "Pretendard-SemiBold", 700: "Pretendard-Bold" });
  assert.deepEqual(font(), { fontFamily: "Pretendard-SemiBold" });
  assert.deepEqual(font(700), { fontFamily: "Pretendard-Bold" });
});

test("every text goes through the shared Pretendard Text and no style sets fontWeight", () => {
  assert.ok(screens.includes("App.tsx") && screens.includes("AppText.tsx"));
  for (const name of screens) {
    const source = read(name);
    // 이름마다 파일이 하나라 fontWeight로는 없는 굵기를 찾게 된다. 굵기는 fonts.ts의 이름으로만 고른다
    assert.doesNotMatch(source, /fontWeight/, name);
    if (name === "AppText.tsx") continue;
    assert.doesNotMatch(source, /fontFamily\s*:/, name);
    const native = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"react-native"/g)]
      .flatMap(([, names]) => names.split(",").map(item => item.trim()));
    assert.ok(!native.includes("Text") && !native.includes("TextInput"), `${name} imports Text or TextInput from react-native`);
    if (/<Text(Input)?\b/.test(source)) assert.match(source, /import \{[^}]*\bText\b[^}]*\} from "\.\/AppText"/, name);
  }
  const shared = lf("AppText.tsx");
  assert.match(shared, /const nested = useContext\(InText\);/);
  assert.match(shared, /const own = withFont\(style, nested\);\n\s*return <InText\.Provider value><NativeText \{\.\.\.props\} style=\{[^}]*\bown\} \/><\/InText\.Provider>/);
  assert.match(shared, /const own = withFont\(style, false\);\n\s*return <NativeTextInput \{\.\.\.props\} style=\{[^}]*\bown\} \/>/);
});

test("an outer Text sets SemiBold first and a nested Text keeps the outer font", () => {
  const own = { color: "#000000" };
  assert.deepEqual(withFont(own, false), [{ fontFamily: "Pretendard-SemiBold" }, own]);
  assert.equal(withFont(own, true), own);
  assert.equal(withFont(undefined, true), undefined);
});

test("text that was bold before stays Pretendard Bold", () => {
  const bold = { "App.tsx": ["title"], "ConnectedUi.tsx": ["heading", "actionText"], "ConnectedHome.tsx": ["activeText"] };
  for (const [name, keys] of Object.entries(bold)) {
    const source = read(name);
    for (const key of keys) assert.match(source, new RegExp(`\\b${key}: \\{[^}]*\\.\\.\\.font\\(700\\)`), `${name} ${key}`);
  }
});
