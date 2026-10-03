import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Link, NavLink, Route, Routes } from 'react-router-dom'

import { WalletBalance } from './components/WalletBalance'
import { CampaignPage } from './pages/CampaignPage'
import { CampaignsPage } from './pages/CampaignsPage'
import { CreateCampaignPage } from './pages/CreateCampaignPage'
import { HomePage } from './pages/HomePage'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { VerifyPage } from './pages/VerifyPage'
import { PROGRAM_ID } from './lib/program'
import { CLUSTER_LABEL, explorerAddress } from './lib/cluster'

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo">◎</span>
          <span className="brand-text">
            <strong>Chip In</strong>
            <small>Group fundraising</small>
          </span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/campaigns">Campaigns</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
          <NavLink to="/new">Start a campaign</NavLink>
        </nav>
        <div className="topbar-right">
          <span className="devnet-pill">{CLUSTER_LABEL} · test money only</span>
          <WalletMultiButton />
        </div>
      </header>

      <WalletBalance />

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/new" element={<CreateCampaignPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/c/:address" element={<CampaignPage />} />
          <Route path="*" element={<p className="empty">Nothing here.</p>} />
        </Routes>
      </main>

      <footer className="footer">
        <p>
          The rules of every campaign live in a Solana program, not in this web page.{' '}
          <a href={explorerAddress(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
            Inspect the program on Solana Explorer →
          </a>
        </p>
      </footer>
    </div>
  )
}
