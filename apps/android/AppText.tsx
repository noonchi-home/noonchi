import { createContext, useContext } from "react";
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type TextInputProps, type TextProps } from "react-native";
import { systemFont, withFont } from "./fonts";

// 글꼴을 주지 않은 글자도 시스템 글꼴이 아니라 Pretendard SemiBold로 그린다.
// 다른 Text 안에 든 Text에 SemiBold를 다시 두면 바깥 Bold를 물려받지 못해서, 안에 들었는지를 따로 넘긴다.
const InText = createContext(false);

/** Expo Go에서 글꼴 파일을 못 올렸으면 true. 그때는 Pretendard 이름 대신 시스템 글꼴에 같은 굵기를 준다. */
export const FontsMissing = createContext(false);

export function Text({ style, ...props }: TextProps) {
  const nested = useContext(InText);
  const missing = useContext(FontsMissing);
  const own = withFont(style, nested);
  return <InText.Provider value><NativeText {...props} style={missing ? systemFont(StyleSheet.flatten(own)) : own} /></InText.Provider>;
}

export function TextInput({ style, ...props }: TextInputProps) {
  const missing = useContext(FontsMissing);
  const own = withFont(style, false);
  return <NativeTextInput {...props} style={missing ? systemFont(StyleSheet.flatten(own)) : own} />;
}
