import {Search} from 'lucide-react';

// Placeholder shell for the actual token-first search (build plan §4:
// DexScreener-backed search, GoPlus badges, token detail page). Kept
// honest — this renders the real intended layout (search bar, empty
// state) rather than fake results, since none of the search/quote wiring
// exists yet.
export function SearchScreen() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-[22px] font-semibold text-textPrimary">What do you want to buy?</h1>
      <div className="flex items-center gap-2 rounded-xl border border-panelBorder bg-input px-3.5 py-3">
        <Search size={18} className="text-textMuted" />
        <input
          type="text"
          placeholder="Search any token, any chain"
          disabled
          className="w-full bg-transparent text-[15px] text-textPrimary placeholder:text-textMuted outline-none"
        />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-[13px] text-textMuted">
          Token search is coming in Phase 1 (build plan §4/§7) — this is the real screen shell,
          not a mock, waiting on the DexScreener search integration.
        </p>
      </div>
    </div>
  );
}
