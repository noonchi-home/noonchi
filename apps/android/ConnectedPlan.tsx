import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SceneJson, Vec2 } from "../../src/contract/layout";
import { colors } from "./ConnectedUi";
import { planFrame, planLines, segments, type Segment } from "./plan-lines";

type Guide = { points: Vec2[]; color?: string; closed?: boolean };

const inset = 16;

export function ConnectedPlan({ scene, label = "도면", onPoint, guides = [] }: {
  scene?: SceneJson;
  label?: string;
  onPoint?: (point: Vec2) => void;
  guides?: Guide[];
}) {
  const [width, setWidth] = useState(0);
  const height = 230;
  const lines = planLines(scene);
  const frame = planFrame(lines);
  if (!frame) return <Text style={styles.empty}>표시할 도면이 없습니다.</Text>;
  const { left, top, spanX, spanY } = frame;
  const scale = Math.max(0, Math.min((width - inset * 2) / spanX, (height - inset * 2) / spanY));
  const insetX = (width - spanX * scale) / 2;
  const insetY = (height - spanY * scale) / 2;
  const project = ([x, y]: Vec2): Vec2 => [(x - left) * scale + insetX, (y - top) * scale + insetY];
  const draw = ([a, b]: Segment, key: string, backgroundColor: string) => {
    const [ax, ay] = project(a);
    const [bx, by] = project(b);
    const distance = Math.hypot(bx - ax, by - ay);
    return <View key={key} style={[styles.line, {
      backgroundColor, width: distance, left: (ax + bx - distance) / 2, top: (ay + by) / 2 - 1,
      transform: [{ rotate: `${Math.atan2(by - ay, bx - ax)}rad` }],
    }]} />;
  };
  const drawing = <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {lines.map((line, index) => draw(line, `wall-${index}`, colors.edge))}
    {guides.flatMap((guide, index) => {
      const color = guide.color ?? colors.brand;
      return [
        ...segments(guide.points, guide.closed).map((line, lineIndex) => draw(line, `${index}-${lineIndex}`, color)),
        ...guide.points.map((point, pointIndex) => {
          const [x, y] = project(point);
          return <View key={`${index}-point-${pointIndex}`} style={[styles.dot, { left: x - 5, top: y - 5, backgroundColor: color }]} />;
        }),
      ];
    })}
  </View>;
  const layout = (event: { nativeEvent: { layout: { width: number } } }) => setWidth(event.nativeEvent.layout.width);
  if (!onPoint) return <View accessibilityLabel={label} accessible onLayout={layout} style={styles.plan}>{drawing}</View>;
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onLayout={layout} style={styles.plan}
    onPress={event => {
      if (!scale) return;
      const { locationX, locationY } = event.nativeEvent;
      if (locationX < insetX || locationX > insetX + spanX * scale || locationY < insetY || locationY > insetY + spanY * scale) return;
      onPoint([Number((left + (locationX - insetX) / scale).toFixed(3)), Number((top + (locationY - insetY) / scale).toFixed(3))]);
    }}>{drawing}</Pressable>;
}

const styles = StyleSheet.create({
  plan: { height: 230, overflow: "hidden", borderRadius: 16, backgroundColor: "#faf7f1" },
  line: { position: "absolute", height: 2, borderRadius: 1 },
  dot: { position: "absolute", width: 10, height: 10, borderRadius: 5 },
  empty: { padding: 16, color: colors.muted },
});
