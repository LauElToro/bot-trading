import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LangProvider } from '@/i18n/context';
import { FollowControls } from '@/pages/profile';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: {
    followTrader: vi.fn(async () => ({ following: true, autoCopy: false, copyInvestmentUsdt: null })),
    unfollowTrader: vi.fn(async () => ({ following: false, autoCopy: false, copyInvestmentUsdt: null })),
    setFollowCopy: vi.fn(async () => ({ following: true, autoCopy: true, copyInvestmentUsdt: 80 })),
  },
}));

function renderControls(following: boolean, autoCopy = false) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <LangProvider>
        <FollowControls
          userId="trader-1"
          follow={{ following, autoCopy, copyInvestmentUsdt: autoCopy ? 80 : null }}
        />
      </LangProvider>
    </QueryClientProvider>,
  );
}

describe('FollowControls', () => {
  beforeEach(() => {
    window.localStorage.setItem('grvt-grid-lang', 'es');
    vi.mocked(api.followTrader).mockClear();
    vi.mocked(api.setFollowCopy).mockClear();
  });

  it('follows a trader from the public profile', async () => {
    renderControls(false);
    expect(screen.getByRole('tooltip')).toHaveTextContent('avisa por mail');
    await userEvent.click(screen.getByRole('button', { name: 'Seguir' }));
    expect(api.followTrader).toHaveBeenCalledWith('trader-1');
  });

  it('asks for an amount before enabling automatic copy and can turn it off', async () => {
    renderControls(true, true);
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar copia' }));
    expect(api.setFollowCopy).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox'), '80');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar copia' }));
    expect(api.setFollowCopy).toHaveBeenCalledWith('trader-1', { autoCopy: true, investmentUsdt: 80 });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar copia' }));
    expect(api.setFollowCopy).toHaveBeenCalledWith('trader-1', { autoCopy: false });
  });
});
