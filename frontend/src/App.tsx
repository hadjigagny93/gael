import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Building2, Upload, ListChecks, Tag, BarChart2, Brain, FolderOpen, Sun, Moon, Landmark } from 'lucide-react'
import { useTheme } from '@/lib/useTheme'
import BanksPage from '@/pages/BanksPage'
import ImportPage from '@/pages/ImportPage'
import TransactionsPage from '@/pages/TransactionsPage'
import TagsPage from '@/pages/TagsPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import BehaviorPage from '@/pages/BehaviorPage'
import FilesPage from '@/pages/FilesPage'
import SoldesPage from '@/pages/SoldesPage'

const nav = [
  { to: '/', label: 'Banques', icon: Building2 },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/files', label: 'Fichiers', icon: FolderOpen },
  { to: '/transactions', label: 'Transactions', icon: ListChecks },
  { to: '/soldes', label: 'Soldes', icon: Landmark },
  { to: '/tags', label: 'Tags', icon: Tag },
  { to: '/analytics', label: 'Analytics', icon: BarChart2 },
  { to: '/comportement', label: 'Comportement', icon: Brain },
]

export default function App() {
  const { dark, toggle } = useTheme()

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-background">

        {/* Top navbar */}
        <header className="h-16 border-b border-border/60 bg-card/80 backdrop-blur-md flex items-center px-6 flex-shrink-0 sticky top-0 z-50">
          {/* Logo */}
          <div className="w-36 flex-shrink-0 flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <span className="text-[11px] font-bold text-white tracking-tight">G</span>
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">gael</span>
          </div>

          {/* Nav — centered */}
          <nav className="flex-1 flex items-center justify-center gap-0.5">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Right actions */}
          <div className="w-36 flex-shrink-0 flex justify-end">
            <button
              onClick={toggle}
              title={dark ? 'Mode clair' : 'Mode sombre'}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="overflow-auto" style={{ height: 'calc(100vh - 4rem)' }}>
          <Routes>
            <Route path="/" element={<BanksPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/soldes" element={<SoldesPage />} />
            <Route path="/comportement" element={<BehaviorPage />} />
          </Routes>
        </main>

      </div>
    </BrowserRouter>
  )
}
