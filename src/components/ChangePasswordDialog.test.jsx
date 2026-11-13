// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordDialog from './ChangePasswordDialog';

afterEach(() => cleanup());

describe('ChangePasswordDialog', () => {
  it('muestra mínimo 6 y Guardar Clave', () => {
    render(
      <ChangePasswordDialog
        open
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Mínimo 6 caracteres.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar Clave' })).toBeTruthy();
  });

  it('genera una clave al abrir y permite regenerar', () => {
    render(
      <ChangePasswordDialog open onClose={() => {}} onSubmit={vi.fn()} />,
    );
    const input = screen.getByLabelText(/Nueva clave/i);
    const first = input.value;
    expect(first.length).toBeGreaterThanOrEqual(6);
    fireEvent.click(screen.getByTitle('Regenerar'));
    expect(input.value.length).toBeGreaterThanOrEqual(6);
  });

  it('deshabilita Guardar con clave corta y llama onSubmit con una válida', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ChangePasswordDialog open onClose={() => {}} onSubmit={onSubmit} />,
    );
    const input = screen.getByLabelText(/Nueva clave/i);
    fireEvent.change(input, { target: { value: '123' } });
    expect(screen.getByRole('button', { name: 'Guardar Clave' }).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'ABC12345' } });
    expect(screen.getByRole('button', { name: 'Guardar Clave' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Clave' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ password: 'ABC12345' });
    });
  });
});
