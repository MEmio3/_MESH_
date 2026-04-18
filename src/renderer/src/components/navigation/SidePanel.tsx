import { useLocation } from 'react-router-dom'
import { HomeSidePanel } from './panels/HomeSidePanel'
import { ServerSidePanel } from './panels/ServerSidePanel'
import { SettingsSidePanel } from './panels/SettingsSidePanel'

function SidePanel(): JSX.Element {
  const location = useLocation()

  const isHome = location.pathname.startsWith('/channels/@me')
  const isSettings = location.pathname.startsWith('/settings')
  // `[^/]+` to capture only the serverId segment, not the optional
  // `/:channelId` suffix that Phase 4 routing introduced.
  const serverMatch = location.pathname.match(/^\/channels\/(?!@me)([^/]+)/)
  const serverId = serverMatch?.[1] || null

  return (
    <div className="flex flex-col h-full w-60 bg-mesh-bg-secondary">
      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {isSettings ? (
          <SettingsSidePanel />
        ) : serverId ? (
          <ServerSidePanel serverId={serverId} />
        ) : isHome ? (
          <HomeSidePanel />
        ) : null}
      </div>
    </div>
  )
}

export { SidePanel }
