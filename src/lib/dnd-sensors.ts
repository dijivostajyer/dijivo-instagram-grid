import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  type CollisionDetection,
  type PointerSensorOptions,
  type TouchSensorOptions,
} from "@dnd-kit/core";

/**
 * Bölge kısıtlı çarpışma: en yakın hedef sürüklenen öğeyle aynı bölgede
 * değilse (ör. normal kart sabitlenmiş alanın üzerinde) hiç hedef yoktur;
 * bırakma sırayı değiştirmez ve diğer kartlar yer açmak için kaymaz.
 * Farklı bölgedeki hücreler bilerek çarpışma adayı olarak kalır; yoksa en
 * yakın AYNI bölgedeki hücre seçilir ve geçersiz bırakma sessizce başka
 * bir yer değiştirmeye dönüşürdü.
 */
export function zoneCollisionDetection(base: CollisionDetection, zoneKey = "zone"): CollisionDetection {
  return (args) => {
    const activeZone = args.active.data.current?.[zoneKey];
    const collisions = base(args);
    const first = collisions[0];
    if (!first) return [];
    const zoneOf = (id: unknown) => args.droppableContainers.find((container) => container.id === id)?.data.current?.[zoneKey];
    return zoneOf(first.id) === activeZone ? collisions.filter((collision) => zoneOf(collision.id) === activeZone) : [];
  };
}
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";

/**
 * Form kontrolleri, butonlar, linkler ve contenteditable alanlar sürükleme
 * başlatmaz. Sürüklenebilir öğenin KENDİSİ bir buton olabilir (grid kartı);
 * bu yüzden yalnız sürükleme dinleyicisinin bağlı olduğu öğenin İÇİNDEKİ
 * etkileşimli öğeler engellenir.
 */
const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[data-no-dnd]",
].join(",");

export function isInteractiveDragTarget(target: EventTarget | null, activator: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  if (!interactive) return false;
  return interactive !== activator;
}

/** Fare/kalem ile sürükleme; dokunmatik olaylar TouchSensor'a bırakılır. */
export class SafePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: (event: ReactPointerEvent, options: PointerSensorOptions) => {
        const native = event.nativeEvent;
        if (!native.isPrimary || native.button !== 0 || native.pointerType === "touch") return false;
        if (isInteractiveDragTarget(native.target, event.currentTarget)) return false;
        options.onActivation?.({ event: native });
        return true;
      },
    },
  ];
}

/** Dokunmatik: basılı tutma gecikmesi, böylece sayfa kaydırma bozulmaz. */
export class SafeTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: (event: ReactTouchEvent, options: TouchSensorOptions) => {
        const native = event.nativeEvent;
        if (native.touches.length > 1) return false;
        if (isInteractiveDragTarget(native.target, event.currentTarget)) return false;
        options.onActivation?.({ event: native });
        return true;
      },
    },
  ];
}

/**
 * Klavye ile sürükleme yalnız odak sürüklenebilir öğenin kendisindeyken
 * başlar; input/textarea/contenteditable içindeki Space/Enter asla
 * yakalanmaz.
 */
export class SafeKeyboardSensor extends KeyboardSensor {
  static activators = KeyboardSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: ReactKeyboardEvent, ...rest: Parameters<typeof activator.handler> extends [unknown, ...infer R] ? R : never) => {
      if (isInteractiveDragTarget(event.nativeEvent.target, event.currentTarget)) return false;
      return activator.handler(event, ...rest);
    },
  }));
}
