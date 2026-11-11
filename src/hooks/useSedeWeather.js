import { useEffect, useState } from 'react';
import {
  OPEN_METEO_FORECAST_URL,
  buildOperationalWeather,
  parseOpenMeteoCurrent,
} from '../domain/weather/sedeWeather';

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = {
  at: 0,
  data: null,
  promise: null,
};

async function loadRawWeather() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  if (cache.promise) return cache.promise;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), 12_000)
    : null;

  cache.promise = fetch(OPEN_METEO_FORECAST_URL, controller ? { signal: controller.signal } : undefined)
    .then((res) => {
      if (!res.ok) throw new Error(`Clima ${res.status}`);
      return res.json();
    })
    .then((payload) => {
      const parsed = parseOpenMeteoCurrent(payload);
      cache.data = parsed;
      cache.at = Date.now();
      cache.promise = null;
      return parsed;
    })
    .catch((err) => {
      cache.promise = null;
      throw err;
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });

  return cache.promise;
}

/** Clima vivo de la sede; una sola petición compartida entre montajes. */
export function useSedeWeather({ isZondaActive = false } = {}) {
  const [raw, setRaw] = useState(() => cache.data);
  const [status, setStatus] = useState(cache.data ? 'ready' : 'loading');

  useEffect(() => {
    let cancelled = false;
    loadRawWeather()
      .then((data) => {
        if (cancelled) return;
        setRaw(data);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(cache.data ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, []);

  return {
    weather: buildOperationalWeather(raw, { isZondaActive }),
    status,
  };
}
