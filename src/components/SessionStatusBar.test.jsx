// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const updateUser = vi.fn();
const sendAccessInviteEmail = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      fullName: 'Super Administrador',
      email: 'super@jockey.sj',
      contactEmail: 'super.real@gmail.com',
      username: 'super.admin',
    },
    role: 'superadmin',
  }),
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { updateUser: (...args) => updateUser(...args) },
  },
}));

vi.mock('../data/repos', () => ({
  sendAccessInviteEmail: (...args) => sendAccessInviteEmail(...args),
}));

import SessionStatusBar from './SessionStatusBar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  sendAccessInviteEmail.mockResolvedValue({ ok: true, to: 'super.real@gmail.com' });
});

describe('SessionStatusBar cambiar clave', () => {
  it('abre el modal con mínimo 6 y Guardar Clave', () => {
    render(<SessionStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar clave/i }));
    expect(screen.getByText('Mínimo 6 caracteres.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar Clave' })).toBeTruthy();
  });

  it('guarda la clave y manda mail por Resend', async () => {
    render(<SessionStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar clave/i }));
    const input = screen.getByLabelText(/Nueva clave/i);
    fireEvent.change(input, { target: { value: 'ClaveNueva9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Clave' }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ password: 'ClaveNueva9' });
    });
    await waitFor(() => {
      expect(sendAccessInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'super.real@gmail.com',
        password: 'ClaveNueva9',
        kind: 'password_changed',
        loginEmail: 'super@jockey.sj',
      }));
    });
    expect(screen.getByRole('status').textContent).toMatch(/Clave actualizada/i);
    expect(screen.getByRole('status').textContent).toMatch(/Mail enviado/i);
  });

  it('si falla el mail, la clave igual quedó y avisa', async () => {
    sendAccessInviteEmail.mockRejectedValueOnce(new Error('Resend caído'));
    render(<SessionStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar clave/i }));
    fireEvent.change(screen.getByLabelText(/Nueva clave/i), { target: { value: 'OtraClave1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Clave' }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/clave quedó guardada/i);
    });
  });

  it('si Auth falla, muestra error y no manda mail', async () => {
    updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Weak password' } });
    render(<SessionStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar clave/i }));
    fireEvent.change(screen.getByLabelText(/Nueva clave/i), { target: { value: 'OtraClave1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Clave' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Weak password/i);
    });
    expect(sendAccessInviteEmail).not.toHaveBeenCalled();
  });
});

