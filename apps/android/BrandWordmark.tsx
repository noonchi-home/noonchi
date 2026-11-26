import { Image, type ColorValue } from "react-native";

export const wordmarkBackground = "#A50034";
const artwork = require("./assets/noonchi-wordmark.png");

export function BrandWordmark({ width = 135, color = "#ffffff" }: {
  width?: number;
  color?: ColorValue;
}) {
  return <Image source={artwork} accessible accessibilityLabel="NOONCHI" accessibilityRole="image"
    resizeMode="contain" style={{ width, height: width * 374 / 2130, tintColor: color }} />;
}
