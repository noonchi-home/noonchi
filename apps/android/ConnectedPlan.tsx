import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { SceneJson, Vec2 } from "../../src/contract/layout";
import { Text } from "./AppText";
import { colors } from "./ConnectedUi";
import { planFrame, planLines, segments, type Segment } from "./plan-lines";

/** fan: 첫 점에서 나머지 점으로 옅은 선을 촘촘히 그어 부채꼴을 채운다(시야각). dots: 점을 찍을 꼭짓점. */
type Guide = { points: Vec2[]; color?: string; closed?: boolean; fan?: boolean; dots?: "all" | "first" };

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
  const draw = ([a, b]: Segment, key: string, backgroundColor: string, opacity = 1) => {
    const [ax, ay] = project(a);
    const [bx, by] = project(b);
    const distance = Math.hypot(bx - ax, by - ay);
    return <View key={key} style={[styles.line, {
      backgroundColor, opacity, width: distance, left: (ax + bx - distance) / 2, top: (ay + by) / 2 - 1,
      transform: [{ rotate: `${Math.atan2(by - ay, bx - ax)}rad` }],
    }]} />;
  };
  const fan = ([origin, ...arc]: Vec2[], key: string, color: string) => arc.slice(1).flatMap((end, index) => {
    const start = arc[index];
    return [0.25, 0.5, 0.75].map(t => draw([origin, [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]],
      `${key}-fan-${index}-${t}`, color, 0.18)).concat(draw([origin, end], `${key}-fan-${index}`, color, 0.18));
  });
  const drawing = <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {lines.map((line, index) => draw(line, `wall-${index}`, colors.edge))}
    {guides.flatMap((guide, index) => {
      const color = guide.color ?? colors.brand;
      return [
        ...(guide.fan && guide.points.length > 2 ? fan(guide.points, `${index}`, color) : []),
        ...segments(guide.points, guide.closed).map((line, lineIndex) => draw(line, `${index}-${lineIndex}`, color)),
        ...(guide.dots === "first" ? guide.points.slice(0, 1) : guide.points).map((point, pointIndex) => {
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
