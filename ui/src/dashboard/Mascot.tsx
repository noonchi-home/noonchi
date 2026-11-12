import { Button } from "../components/ui/button";
import { Dialog, DialogTrigger } from "../components/ui/dialog";
import type { HubState } from "./hub";
import type { Rect } from "./layout";
import type { MascotImage } from "./mascot-image";
import { SettingsDialog } from "./SettingsDialog";

/** 마스코트가 보는 쪽: 대기면 그림 그대로 오른쪽(video), 행동하기로 정하면 좌우를 뒤집어 왼쪽 트윈(twin). */
export type Facing = "video" | "twin";

/**
 * 마스코트. 칸·판 없이 트윈 오른쪽 아래에 눈치 마스코트를 세운다(box, layout.ts): 단추 아래 끝은 화면 밑 선이고
 * 몸은 밑 선 아래로 이어져 밑 선에서 올라온 모습이다. 그림은 image 자리(단추 기준 px)에 둔다. 머리와 귀는 화면 안에 다 보인다.
 * 보는 쪽(facing): 그림은 주둥이가 오른쪽이다. 대기 때는 그대로 두고, 행동하기로 정하면 단추 가운데 축을 중심으로
 * 좌우를 뒤집어(transform scaleX(-1), 자리·크기는 그대로) 트윈을 본다. 뒤집을 때는 transform으로 돌아선다(움직임 줄이기면 바로).
 * 가슴 LG 표시는 늘 바로 읽힌다: 표시 원(logo 자리)에 같은 그림을 한 번 더 얹고 그 원을 같은 transform으로 제 가운데를 중심으로 다시 뒤집는다.
 * 마스코트는 설정 창(SettingsDialog)을 여는 단추(Button ghost)다: 마우스를 올리면 바탕이 바뀌고, 키보드 초점 고리가 보이며, Enter·스페이스로도 열린다.
 * 화면 바탕 위라 바탕 바뀜이 옅어서, 마우스를 올리거나 초점이 오면 그림이 8px 올라온다(transform, 움직임 줄이기면 바로).
 * 창을 닫으면 초점이 단추로 돌아온다. 그림은 단추(relative overflow-hidden) 안 판에 있어 단추 끝에서 잘린다: 단추 바깥에 그려지는 초점 고리를 덮지 않는다.
 * 트윈·폰 칸 가림판(z-40)보다 위(z-50)에 있다. settingsOpen이면 설정 창을 연 채 그린다.
 */
export function Mascot({ image, hub, box, imageBox, logoBox, facing, settingsOpen = false }: {
  image: MascotImage;
  hub: HubState;
  box: Rect;
  imageBox: Rect;
  logoBox: Rect;
  facing: Facing;
  settingsOpen?: boolean;
}) {
  const turn = facing === "twin" ? "scaleX(-1)" : "scaleX(1)";
  return (
    <section aria-label="마스코트" data-mascot data-facing={facing} className="absolute z-50" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <Dialog defaultOpen={settingsOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" aria-label="설정 열기" className="group relative size-full cursor-pointer overflow-hidden p-0">
            <span data-mascot-turn className="pointer-events-none absolute inset-0 transition-transform duration-300 will-change-transform motion-reduce:transition-none" style={{ transform: turn, transformOrigin: "50% 50%" }}>
              <span className="absolute inset-0 transition-transform duration-150 group-hover:-translate-y-2 group-focus-visible:-translate-y-2 motion-reduce:transition-none">
                <img
                  src={image.src}
                  alt=""
                  aria-hidden="true"
                  width={image.width}
                  height={image.height}
                  draggable={false}
                  className="absolute max-w-none select-none"
                  style={{ left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height }}
                />
                <span
                  data-mascot-logo
                  className="absolute overflow-hidden transition-transform duration-300 will-change-transform motion-reduce:transition-none"
                  style={{ left: logoBox.left, top: logoBox.top, width: logoBox.width, height: logoBox.height, transform: turn, transformOrigin: "50% 50%", clipPath: "circle(50%)" }}
                >
                  <img
                    src={image.src}
                    alt=""
                    aria-hidden="true"
                    width={image.width}
                    height={image.height}
                    draggable={false}
                    className="absolute max-w-none select-none"
                    style={{ left: imageBox.left - logoBox.left, top: imageBox.top - logoBox.top, width: imageBox.width, height: imageBox.height }}
                  />
                </span>
              </span>
            </span>
          </Button>
        </DialogTrigger>
        <SettingsDialog hub={hub} />
      </Dialog>
    </section>
  );
}
