import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCameraConstraintAttempts,
  cameraErrorMessage,
  openCameraStream,
  pickBackCameraIndex,
} from './qrCamera';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickBackCameraIndex', () => {
  it('elige la trasera por label', () => {
    const devices = [
      { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' },
      { kind: 'videoinput', deviceId: 'back', label: 'Camera Trasera' },
    ];
    expect(pickBackCameraIndex(devices)).toBe(1);
  });

  it('si no hay label, usa la última', () => {
    const devices = [
      { kind: 'videoinput', deviceId: 'a', label: '' },
      { kind: 'videoinput', deviceId: 'b', label: '' },
    ];
    expect(pickBackCameraIndex(devices)).toBe(1);
  });

  it('sin cámaras → -1', () => {
    expect(pickBackCameraIndex([])).toBe(-1);
    expect(pickBackCameraIndex([{ kind: 'audioinput' }])).toBe(-1);
  });
});

describe('buildCameraConstraintAttempts', () => {
  it('en escritorio empieza con video:true (Chrome)', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      maxTouchPoints: 0,
    });
    const attempts = buildCameraConstraintAttempts(null);
    expect(attempts[0]).toEqual({ audio: false, video: true });
    expect(attempts.at(-1).video).toEqual({ facingMode: { ideal: 'user' } });
  });

  it('en móvil prioriza facingMode environment', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    const attempts = buildCameraConstraintAttempts(null);
    expect(attempts[0].video).toEqual({ facingMode: { ideal: 'environment' } });
    expect(attempts.at(-1)).toEqual({ audio: false, video: true });
  });

  it('con deviceId exacto en los primeros intentos', () => {
    const attempts = buildCameraConstraintAttempts('cam-9');
    expect(attempts[0].video.deviceId).toEqual({ exact: 'cam-9' });
    expect(attempts[1].video.deviceId).toEqual({ exact: 'cam-9' });
  });
});

describe('openCameraStream', () => {
  it('usa el primer getUserMedia que responde', async () => {
    const stream = { id: 'ok' };
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(stream);
    await expect(openCameraStream(getUserMedia)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('si NotAllowed, no reintenta otros constraints', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    await expect(openCameraStream(getUserMedia)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('cameraErrorMessage', () => {
  it('traduce permiso y sin dispositivo', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/Permitir/);
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/No se encontró/);
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toMatch(/en uso/);
    expect(cameraErrorMessage({ message: 'boom' })).toMatch(/No se pudo iniciar/);
  });
});
