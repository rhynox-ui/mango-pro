import {Routes, Route} from 'react-router-dom';
import {Moon, Sun} from 'lucide-react';
import {useTheme} from './theme/ThemeContext';
import {TabBar} from './components/TabBar';
import {SearchScreen} from './screens/SearchScreen';
import {PlaceholderScreen} from './screens/PlaceholderScreen';

// Constrained to a phone-width column, centered on wider viewports — per
// the build plan (§2), Mango Pro should read as "the mobile app, in a
// browser," not a desktop trading-terminal layout.
export default function App() {
  const {mode, toggleMode} = useTheme();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-panelBorder px-4 py-3.5">
        <span className="font-display text-[17px] font-semibold text-textPrimary">Mango Pro</span>
        <button
          onClick={toggleMode}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-panelBorder bg-panel"
        >
          {mode === 'dark' ? <Sun size={16} className="text-textPrimary" /> : <Moon size={16} className="text-textPrimary" />}
        </button>
      </header>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<SearchScreen />} />
          <Route
            path="/portfolio"
            element={<PlaceholderScreen title="Portfolio" note="One balance across every chain — build plan §37/Phase 3." />}
          />
          <Route
            path="/activity"
            element={<PlaceholderScreen title="Activity" note="Transaction tracking lands with the Phase 1 core loop (build plan §7)." />}
          />
          <Route
            path="/settings"
            element={<PlaceholderScreen title="Settings" note="Wallet creation, Google sign-in, and theme live here once Phase 0's account-abstraction spike picks a provider." />}
          />
        </Routes>
      </main>

      <TabBar />
    </div>
  );
}
