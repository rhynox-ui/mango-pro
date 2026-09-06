// Shared shell for the not-yet-built tabs (Portfolio/Activity/Settings) —
// same reasoning as SearchScreen: a real, minimal screen rather than a
// mock, honestly labeled as pending.
export function PlaceholderScreen({title, note}: {title: string; note: string}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-4 py-24 text-center">
      <h1 className="font-display text-[20px] font-semibold text-textPrimary">{title}</h1>
      <p className="max-w-xs text-[13px] text-textMuted">{note}</p>
    </div>
  );
}
