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

import type { PlannedPost, PostType } from "@/lib/types";

function SortablePlannedItem({
  post,
  onDelete,
  onPostTypeChange,
  onSelect,
}: {
  post: PlannedPost;
  onDelete: (id: string) => void;
  onPostTypeChange: (id: string, type: PostType) => void;
  onSelect: (id: string) => void;
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
      className={`flex items-center gap-3 rounded-xl bg-white p-2 outline-1 -outline-offset-1 outline-black/10 ${
        isDragging
          ? "z-10 ring-2 ring-sky-600 shadow-md"
          : ""
      }`}
    >
      {/* dnd-kit sunucu/istemcide farklı aria-describedby üretir; güvenli sadeleştirme */}
      <button
        type="button"
        suppressHydrationWarning
        className="cursor-grab touch-none rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 active:cursor-grabbing"
        aria-label={`Sürükleyerek sırala: ${post.alt ?? post.id}`}
        {...attributes}
        {...listeners}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <button
        type="button"
        onClick={() => onSelect(post.id)}
        aria-label={`Düzenle: ${post.alt ?? post.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={post.imageUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-lg object-cover outline-1 -outline-offset-1 outline-black/5"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-700">
          {post.alt ?? post.id}
        </span>
      </button>
      <select aria-label={`${post.alt ?? post.id} içerik türü`} value={post.postType ?? "post"} onChange={(event) => onPostTypeChange(post.id, event.target.value as PostType)} className="rounded border border-black/10 bg-white px-1 py-1 text-xs">
        <option value="post">Post</option><option value="reel">Reel</option><option value="carousel">Carousel</option>
      </select>
      <button
        type="button"
        onClick={() => onDelete(post.id)}
        className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
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
  onPostTypeChange,
  onSelect,
}: {
  posts: PlannedPost[];
  onReorder: (orderedIds: string[]) => void;
  onDelete: (id: string) => void;
  onPostTypeChange: (id: string, type: PostType) => void;
  onSelect: (id: string) => void;
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
            <SortablePlannedItem key={post.id} post={post} onDelete={onDelete} onPostTypeChange={onPostTypeChange} onSelect={onSelect} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
