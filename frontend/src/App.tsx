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
        <header className="h-14 border-b bg-card flex items-center px-6 flex-shrink-0">
          {/* Logo */}
          <div className="w-32 flex-shrink-0">
            <span className="text-lg font-bold tracking-tight">gael</span>
          </div>

          {/* Nav — centered */}
          <nav className="flex-1 flex items-center justify-center gap-1">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                title={label}
                className={({ isActive }) =>
                  `flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
              </NavLink>
            ))}
          </nav>

          {/* Right actions */}
          <div className="w-32 flex-shrink-0 flex justify-end">
            <button
              onClick={toggle}
              title={dark ? 'Mode clair' : 'Mode sombre'}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="overflow-auto p-8" style={{ height: 'calc(100vh - 3.5rem)' }}>
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
