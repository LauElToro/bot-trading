import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LangProvider } from '@/i18n/context';
import { ResetPasswordPage } from '@/pages/reset-password';
import { api } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  api: { resetPassword: vi.fn(async () => ({ ok: true })) },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage(path = '/dashboard/reset-password?token=from-query') {
  window.localStorage.setItem('grvt-grid-lang', 'en');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LangProvider>
        <ResetPasswordPage />
      </LangProvider>
    </MemoryRouter>,
  );
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.mocked(api.resetPassword).mockClear();
  });

  it('ignores a token in the query string and posts the typed code', async () => {
    renderPage();
    const code = screen.getByLabelText(/token is missing/i);
    expect(code).toHaveValue('');
    await userEvent.type(code, 'one-time-code');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'long-enough');
    await userEvent.type(screen.getByLabelText(/^confirm password/i), 'long-enough');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(api.resetPassword).toHaveBeenCalledWith('one-time-code', 'long-enough');
  });
});
