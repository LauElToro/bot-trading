import { Moon, Sun } from 'lucide-react';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      className={cn(
        'grid size-8 place-items-center border border-border-subtle',
        'bg-bg-elevated text-text-secondary transition-colors',
        'hover:border-primary hover:text-primary',
        className
      )}
    >
      {theme === 'dark'
        ? <Sun className="size-4" aria-hidden="true" />
        : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}
