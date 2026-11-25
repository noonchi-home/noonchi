// Alert 대화상자 같은 네이티브 글자는 RN Text를 거치지 않아서 앱 테마로 글꼴을 준다. 묶은 글꼴의 OFL 글도 APK에 넣는다.
const { copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { AndroidConfig, withAndroidStyles, withDangerousMod } = require("expo/config-plugins");

// app.json의 expo-font가 fontFamily "Pretendard-SemiBold"로 만드는 res/font XML 이름
const SEMIBOLD = "@font/xml_pretendard_semi_bold";
const LICENSE = "assets/fonts/OFL-pretendard.txt";

// 제목(RN DialogTitle)은 프레임워크 TextView라 android:fontFamily를 본다. 본문은 스타일이 sans-serif를 직접 줘서
// android:fontFamily 테마 값이 밀리고, 본문·버튼 같은 AppCompat 글자는 fontFamily(app 쪽)를 그보다 먼저 본다.
function withDialogFont(config) {
  return withAndroidStyles(config, (config) => {
    for (const name of ["android:fontFamily", "fontFamily"]) {
      config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
        add: true, parent: AndroidConfig.Styles.getAppThemeGroup(), name, value: SEMIBOLD,
      });
    }
    return config;
  });
}

function withFontLicense(config) {
  return withDangerousMod(config, ["android", async (config) => {
    const target = path.join(config.modRequest.platformProjectRoot, "app/src/main", LICENSE);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(config.modRequest.projectRoot, LICENSE), target);
    return config;
  }]);
}

module.exports = (config) => withFontLicense(withDialogFont(config));
