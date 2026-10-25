import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Asset, ListRow } from '@toss/tds-mobile';
import { adaptive } from '@toss/tds-colors';
import type { Chore } from '../lib/chores';

export function SortableChoreRow({ chore, description }: { chore: Chore; description: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chore.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <ListRow
        left={
          <div
            {...attributes}
            {...listeners}
            style={{ padding: 12, margin: -12, touchAction: 'none', cursor: 'grab' }}
          >
            <Asset.Icon name="icon-line-three-mono" color={adaptive.grey400} aria-hidden={true} />
          </div>
        }
        contents={
          <ListRow.Texts
            type="2RowTypeA"
            top={chore.name}
            topProps={{ color: adaptive.grey800, fontWeight: 'bold' }}
            bottom={description}
            bottomProps={{ color: adaptive.grey600, typography: 'st12' }}
          />
        }
        verticalPadding="large"
        horizontalPadding="small"
      />
    </div>
  );
}
