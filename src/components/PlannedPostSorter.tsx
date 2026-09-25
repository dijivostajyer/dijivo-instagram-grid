"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { PlannedPost } from "@/lib/types";

function SortablePlannedItem({
  post,
  onDelete,
}: {
  post: PlannedPost;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: post.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded border p-2 ${
        isDragging
          ? "z-10 border-sky-500 bg-sky-50 shadow-md"
          : "border-neutral-200 bg-white"
      }`}
    >
      {/* dnd-kit sunucu/istemcide farklı aria-describedby üretir; güvenli sadeleştirme */}
      <button
        type="button"
        suppressHydrationWarning
        className="cursor-grab touch-none rounded p-1 text-neutral-500 hover:bg-neutral-100 active:cursor-grabbing"
        aria-label={`Sürükleyerek sırala: ${post.alt ?? post.id}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.imageUrl}
        alt=""
        className="h-12 w-12 shrink-0 rounded object-cover"
      />
      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700">
        {post.alt ?? post.id}
      </span>
      <button
        type="button"
        onClick={() => onDelete(post.id)}
        className="shrink-0 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        aria-label={`Sil: ${post.alt ?? post.id}`}
      >
        Sil
      </button>
    </li>
  );
}

/**
 * Planlanan gönderileri sürükle-bırak ile sıralar (dnd-kit).
 * Klavye desteği dahil; sıra değişince üst bileşen anında yeniden hesaplar.
 */
export default function PlannedPostSorter({
  posts,
  onReorder,
  onDelete,
}: {
  posts: PlannedPost[];
  onReorder: (orderedIds: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ordered = arrayMove(
      posts,
      posts.findIndex((p) => p.id === active.id),
      posts.findIndex((p) => p.id === over.id),
    );
    onReorder(ordered.map((p) => p.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={posts.map((p) => p.id)}
        strategy={rectSortingStrategy}
      >
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <SortablePlannedItem key={post.id} post={post} onDelete={onDelete} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
