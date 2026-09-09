import { describe, expect, it } from 'vitest';
import {
  buildOperationalWeather,
  detectZonda,
  formatObservedClock,
  parseOpenMeteoCurrent,
  weatherCodeLabel,
  windCardinal,
} from './sedeWeather';

const rivadaviaSample = {
  current: {
    time: '2026-09-05T11:45',
    temperature_2m: 11.4,
    relative_humidity_2m: 31,
    apparent_temperature: 5.7,
    precipitation: 0,
    weather_code: 0,
    wind_speed_10m: 24.5,
    wind_gusts_10m: 51.8,
    wind_direction_10m: 169,
  },
};

describe('sedeWeather', () => {
  it('parsea Open-Meteo y arma el clima operativo de Rivadavia', () => {
    const raw = parseOpenMeteoCurrent(rivadaviaSample);
    const ops = buildOperationalWeather(raw);
    expect(ops.temperature).toBe(11.4);
    expect(ops.condition).toBe('Despejado');
    expect(ops.windLabel).toMatch(/25 km\/h S|24 km\/h S/);
    expect(ops.zondaDetected).toBe(false);
    expect(ops.outdoor).toBe('caution');
    expect(ops.pill.tone).toBe('warn');
    expect(formatObservedClock(ops.observedAt)).toBe('11:45');
  });

  it('detecta Zonda oeste seco con ráfagas', () => {
    expect(detectZonda({
      humidity: 18,
      windKmh: 42,
      gustsKmh: 68,
      windDir: 280,
    })).toBe(true);
    expect(detectZonda({
      humidity: 31,
      windKmh: 24,
      gustsKmh: 51,
      windDir: 169,
    })).toBe(false);
  });

  it('cierra outdoor con lluvia o Zonda declarado', () => {
    const raw = parseOpenMeteoCurrent({
      current: {
        ...rivadaviaSample.current,
        precipitation: 1.2,
        weather_code: 63,
        wind_gusts_10m: 10,
      },
    });
    expect(buildOperationalWeather(raw).outdoor).toBe('closed');
    expect(buildOperationalWeather(parseOpenMeteoCurrent(rivadaviaSample), {
      isZondaActive: true,
    }).outdoor).toBe('closed');
  });

  it('traduce código WMO y rumbo', () => {
    expect(weatherCodeLabel(0)).toBe('Despejado');
    expect(weatherCodeLabel(95)).toBe('Tormenta');
    expect(windCardinal(169)).toBe('S');
    expect(windCardinal(280)).toBe('O');
  });
});
