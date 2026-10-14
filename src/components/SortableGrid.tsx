"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import GridCellView, { type GridCellViewProps, type GridRenderArgs } from "./GridCellView";
import { SafeKeyboardSensor, SafePointerSensor, SafeTouchSensor, zoneCollisionDetection } from "@/lib/dnd-sensors";
import { canDropInGridZone, gridCellZone, type GridZone } from "@/lib/grid-reorder";
import type { GridResult } from "@/lib/types";

function SortableGridCell({
  cell,
  activeZone,
  ...props
}: {
  cell: GridResult["cells"][number];
  activeZone: GridZone | null;
} & Omit<GridCellViewProps, "cell">) {
  const zone = gridCellZone(cell);
  const blocked = activeZone !== null && !canDropInGridZone(activeZone, zone);
  // Farklı bölgedeki hücreler droppable olarak kalır; bırakılamamalarını
  // zoneCollisionDetection sağlar (üzerlerindeyken hedef yoktur).
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: cell.post.id,
    data: { zone },
  });
  return (
    <GridCellView
      cell={cell}
      {...props}
      drag={{
        ref: (node) => {
          setNodeRef(node);
          setActivatorNodeRef(node);
        },
        // Yalnız öteleme: rectSortingStrategy'nin ölçeği Post 3:4 / Reel 2:3
        // oranını bozardı.
        style: { transform: CSS.Translate.toString(transform), transition },
        attributes,
        listeners,
        isDragging,
        blocked,
      }}
    />
  );
}

const ZONE_LABELS: Record<GridZone, string> = {
  pinned: "sabitlenmiş",
  normal: "sabitlenmemiş",
};

const GRID_ZONES: GridZone[] = ["pinned", "normal"];
const gridCollisionDetection = zoneCollisionDetection(closestCenter);

/**
 * Editör gridi için kısıtlı sürükle-bırak: sabitlenmiş içerikler yalnız kendi
 * aralarında, sabitlenmemiş içerikler (planlanan + mevcut) tek ortak bölgede
 * taşınır. Sıranın tek kaynağı
 * GridProject; onReorder üst bileşende saf reorder fonksiyonunu çağırır.
 */
export default function SortableGrid({
  cells,
  className,
  onReorder,
  cellProps,
}: GridRenderArgs & {
  onReorder: (activeId: string, overId: string) => void;
}) {
  const [activeZone, setActiveZone] = useState<GridZone | null>(null);
  const sensors = useSensors(
    // Birkaç piksel hareket olmadan sürükleme başlamaz: tıklama modalı açar.
    useSensor(SafePointerSensor, { activationConstraint: { distance: 6 } }),
    // Dokunmatikte basılı tutma; kısa dokunuş ve kaydırma sürüklemez.
    useSensor(SafeTouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space ile taşı, Enter ile içeriği aç (Enter tıklamaya bırakılır).
    useSensor(SafeKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  const cellsOf = (zone: GridZone) => cells.filter((cell) => gridCellZone(cell) === zone);
  const labelOf = (id: string | number) => cells.find((cell) => cell.post.id === id)?.post.alt || "İçerik";

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} taşınıyor.`,
    onDragOver: ({ active, over }) => {
      if (!over) return `${labelOf(active.id)} bırakılabilir bir alanın üzerinde değil.`;
      if (over.id === active.id) return `${labelOf(active.id)} taşınıyor.`;
      return `${labelOf(active.id)}, ${labelOf(over.id)} konumunun üzerinde.`;
    },
    onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)} yeni konuma bırakıldı.` : `${labelOf(active.id)} bırakılmadı; sıra değişmedi.`),
    onDragCancel: ({ active }) => `Taşıma iptal edildi; ${labelOf(active.id)} yerinde kaldı.`,
  };

  function handleDragStart(event: DragStartEvent) {
    setActiveZone((event.active.data.current?.zone as GridZone | undefined) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const fromZone = event.active.data.current?.zone as GridZone | undefined;
    const toZone = event.over?.data.current?.zone as GridZone | undefined;
    setActiveZone(null);
    if (!event.over || event.over.id === event.active.id) return;
    if (!canDropInGridZone(fromZone, toZone)) return;
    onReorder(String(event.active.id), String(event.over.id));
  }

  return (
    <DndContext
      id="grid-preview-dnd"
      sensors={sensors}
      collisionDetection={gridCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveZone(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Taşımak için Space tuşuna basın, ok tuşlarıyla konumu seçin ve Space ile bırakın. İptal için Escape. İçeriği açmak için Enter.",
        },
      }}
    >
      <div className={className}>
        {GRID_ZONES.map((zone) => (
          <SortableContext key={zone} id={`grid-${zone}`} items={cellsOf(zone).map((cell) => cell.post.id)} strategy={rectSortingStrategy}>
            {cellsOf(zone).map((cell) => (
              <SortableGridCell key={cell.post.id} cell={cell} activeZone={activeZone} {...cellProps(cell)} />
            ))}
          </SortableContext>
        ))}
      </div>
      {activeZone ? (
        <p className="sr-only" aria-live="polite">
          Yalnız {ZONE_LABELS[activeZone]} içerikler arasında taşınabilir.
        </p>
      ) : null}
    </DndContext>
  );
}
