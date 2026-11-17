import { describe, expect, it, vi } from 'vitest';
import {
  buildCameraConstraintAttempts,
  cameraErrorMessage,
  openCameraStream,
  pickBackCameraIndex,
} from './qrCamera';

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
  it('empieza liviano (facingMode) antes que 1280×720', () => {
    const attempts = buildCameraConstraintAttempts(null);
    expect(attempts[0].video).toEqual({ facingMode: { ideal: 'environment' } });
    expect(attempts[1].video.width).toEqual({ ideal: 1280 });
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

  it('si todos fallan, propaga el último error', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    await expect(openCameraStream(getUserMedia)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('cameraErrorMessage', () => {
  it('traduce permiso y sin dispositivo', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/Permití/);
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/No se encontró/);
    expect(cameraErrorMessage({ message: 'boom' })).toMatch(/No se pudo iniciar/);
  });
});
