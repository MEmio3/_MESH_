import { Outlet, useLocation } from 'react-router-dom'
import { TitleBar } from '@/components/titlebar/TitleBar'
import { ActivityBar } from '@/components/navigation/ActivityBar'
import { SidePanel } from '@/components/navigation/SidePanel'
import { VoiceConnectionBar, UserPanel } from '@/components/navigation/UserPanel'
import { StreamPickerModal } from '@/components/server/StreamPickerModal'
import { SelfPreviewPiP } from '@/components/server/SelfPreviewPiP'
import { StreamViewerModal } from '@/components/server/StreamViewerModal'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useVoiceStore } from '@/stores/voice.store'

function AppShell(): JSX.Element {
  const location = useLocation()
  const isSettings = location.pathname.startsWith('/settings')
  const pickerOpen = useVoiceStore((s) => s.pickerOpen)
  const pickerInitialTab = useVoiceStore((s) => s.pickerInitialTab)
  const closePicker = useVoiceStore((s) => s.closePicker)

  return (
    <div className="flex flex-col h-screen w-screen bg-mesh-bg-primary overflow-hidden">
      {/* Title Bar */}
      <TitleBar />

      {/* Main Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left section — activity bar + sidebar + bottom panels */}
        <div className="flex flex-col shrink-0 border-r border-mesh-border/50">
          {/* Top: Activity bar + Side panel side by side */}
          <div className="flex flex-1 min-h-0">
            <ActivityBar />
            <SidePanel />
          </div>

          {/* Bottom: Voice + User panels spanning full left width */}
          {!isSettings && (
            <div className="shrink-0">
              <VoiceConnectionBar />
              <UserPanel />
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 bg-mesh-bg-primary">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Global stream picker — rendered at the shell level so it can be opened
          from the VoiceConnectionBar (any page) or the VoiceControlBar (inside
          the voice room) and survives navigation. */}
      <StreamPickerModal
        isOpen={pickerOpen}
        onClose={closePicker}
        initialTab={pickerInitialTab}
      />

      {/* Always-visible floating self preview — confirms your stream is live. */}
      <SelfPreviewPiP />

      {/* Full-screen viewer, opened by clicking a participant's LIVE badge. */}
      <StreamViewerModal />
    </div>
  )
}

export { AppShell }
