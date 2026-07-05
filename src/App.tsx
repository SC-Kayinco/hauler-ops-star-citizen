import { useStore } from '@/store/useStore'
import TopNav from '@/components/layout/TopNav'
import ProfileSidebar from '@/components/layout/ProfileSidebar'
import FleetView from '@/components/fleet/FleetView'
import ShipDetail from '@/components/ship/ShipDetail'
import MissionsView from '@/components/mission/MissionsView'
import PlanView from '@/components/plan/PlanView'
import EarningsView from '@/components/earnings/EarningsView'
import StarMapView from '@/components/starmap/StarMapView'
import SettingsView from '@/components/settings/SettingsView'
import './styles.css'

export default function App() {
  const view = useStore((s) => s.view)

  return (
    <div className="app">
      <TopNav />
      <div className="app-body">
        <ProfileSidebar />
        <main className="app-main">
          {view === 'fleet' && <FleetView />}
          {view === 'ship' && <ShipDetail />}
          {view === 'missions' && <MissionsView />}
          {view === 'plan' && <PlanView />}
          {view === 'earnings' && <EarningsView />}
          {view === 'starmap' && <StarMapView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  )
}
