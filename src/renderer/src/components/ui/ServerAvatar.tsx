import { cn } from '@/lib/utils'

interface ServerAvatarProps {
  src?: string | null
  name: string
  className?: string
  imageClassName?: string
}

function serverInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

function ServerAvatar({ src, name, className, imageClassName }: ServerAvatarProps): JSX.Element {
  return (
    <div
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center overflow-hidden font-bold',
        src ? 'bg-mesh-bg-elevated' : 'mesh-server-avatar-fallback',
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={cn('h-full w-full object-cover', imageClassName)}
          draggable={false}
        />
      ) : (
        <span className="relative z-[1]">{serverInitial(name)}</span>
      )}
    </div>
  )
}

export { ServerAvatar }
