import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SceneJson, Vec2 } from "../../src/contract/layout";
import { colors } from "./ConnectedUi";

type Guide = { points: Vec2[]; color?: string; closed?: boolean };

const inset = 16;

function segments(points: Vec2[], closed = false): [Vec2, Vec2][] {
  return points.slice(1).map((point, index) => [points[index], point] as [Vec2, Vec2])
    .concat(closed && points.length > 2 ? [[points[points.length - 1], points[0]]] : []);
}

export function ConnectedPlan({ scene, label = "도면", onPoint, guides = [] }: {
  scene?: SceneJson;
  label?: string;
  onPoint?: (point: Vec2) => void;
  guides?: Guide[];
}) {
  const [width, setWidth] = useState(0);
  const height = 230;
  const rooms = scene?.plan.rooms ?? [];
  const walls = scene?.plan.walls ?? [];
  const lines = rooms.flatMap(room => segments(room.polygon ?? [], true))
    .concat(walls.map(wall => [wall.a, wall.b] as [Vec2, Vec2]));
  const points = lines.flat();
  if (!points.length) return <Text style={styles.empty}>표시할 도면이 없습니다.</Text>;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - left);
  const spanY = Math.max(1, Math.max(...ys) - top);
  const scale = Math.max(0, Math.min((width - inset * 2) / spanX, (height - inset * 2) / spanY));
  const insetX = (width - spanX * scale) / 2;
  const insetY = (height - spanY * scale) / 2;
  const project = ([x, y]: Vec2): Vec2 => [(x - left) * scale + insetX, (y - top) * scale + insetY];
  const draw = ([a, b]: [Vec2, Vec2], key: string, backgroundColor: string) => {
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
