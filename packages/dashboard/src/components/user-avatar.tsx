import { cn } from '@/lib/cn';
import { publicDisplayName } from '@/lib/avatar';

interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZES = {
  sm: 'size-7 text-[10px]',
  md: 'size-9 text-xs',
  lg: 'size-14 text-base',
  xl: 'size-20 text-xl',
};

export function UserAvatar({ name, email, src, size = 'md', className }: UserAvatarProps) {
  const label = publicDisplayName(name, email);
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden border border-primary/40 bg-primary-soft font-semibold text-primary',
        SIZES[size],
        className,
      )}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
