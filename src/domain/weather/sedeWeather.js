/** Clima operativo de la Sede Rivadavia (Open-Meteo, sin API key). */

export const SEDE_RIVADAVIA = {
  name: 'Rivadavia, San Juan',
  latitude: -31.537,
  longitude: -68.594,
  timezone: 'America/Argentina/San_Juan',
};

export const OPEN_METEO_FORECAST_URL = [
  'https://api.open-meteo.com/v1/forecast',
  `?latitude=${SEDE_RIVADAVIA.latitude}`,
  `&longitude=${SEDE_RIVADAVIA.longitude}`,
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
  `&timezone=${encodeURIComponent(SEDE_RIVADAVIA.timezone)}`,
  '&wind_speed_unit=kmh',
].join('');

const WMO_LABELS = {
  0: 'Despejado',
  1: 'Mayormente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla con escarcha',
  51: 'Llovizna débil',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  61: 'Lluvia débil',
  63: 'Lluvia',
  65: 'Lluvia intensa',
  71: 'Nieve débil',
  73: 'Nieve',
  75: 'Nieve intensa',
  80: 'Chaparrones',
  81: 'Chaparrones',
  82: 'Chaparrones fuertes',
  95: 'Tormenta',
  96: 'Tormenta con granizo',
  99: 'Tormenta con granizo',
};

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function weatherCodeLabel(code) {
  const n = Number(code);
  if (WMO_LABELS[n]) return WMO_LABELS[n];
  if (n >= 51 && n <= 67) return 'Lluvia';
  if (n >= 80 && n <= 82) return 'Chaparrones';
  if (n >= 95) return 'Tormenta';
  return 'Sin dato';
}

export function windCardinal(degrees) {
  const deg = Number(degrees);
  if (!Number.isFinite(deg)) return '';
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[idx];
}

/** Zonda cuyano: oeste/noroeste, seco y con ráfagas. */
export function detectZonda(raw) {
  if (!raw) return false;
  const dir = Number(raw.windDir);
  const fromWest = Number.isFinite(dir) && (dir >= 230 || dir <= 20);
  const dry = (Number(raw.humidity) || 100) <= 28;
  const strong = (Number(raw.windKmh) || 0) >= 35 || (Number(raw.gustsKmh) || 0) >= 50;
  return fromWest && dry && strong;
}

export function isRainCondition(raw) {
  if (!raw) return false;
  const code = Number(raw.weatherCode);
  if ((Number(raw.precipitation) || 0) >= 0.2) return true;
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

export function outdoorPlayStatus({ zonda, raining, raw }) {
  if (zonda || raining) return 'closed';
  const wind = Number(raw?.windKmh) || 0;
  const gusts = Number(raw?.gustsKmh) || 0;
  const temp = Number(raw?.temperature);
  if (gusts >= 45 || wind >= 40) return 'caution';
  if (Number.isFinite(temp) && (temp >= 36 || temp <= 4)) return 'caution';
  return 'open';
}

export function parseOpenMeteoCurrent(payload) {
  const current = payload?.current || {};
  return {
    temperature: Number(current.temperature_2m),
    apparent: Number(current.apparent_temperature),
    humidity: Number(current.relative_humidity_2m),
    precipitation: Number(current.precipitation) || 0,
    weatherCode: Number(current.weather_code),
    windKmh: Number(current.wind_speed_10m),
    gustsKmh: Number(current.wind_gusts_10m),
    windDir: Number(current.wind_direction_10m),
    observedAt: current.time || null,
    source: 'open-meteo',
  };
}

export function buildOperationalWeather(raw, { isZondaActive = false } = {}) {
  if (!raw || !Number.isFinite(raw.temperature)) return null;
  const zondaDetected = detectZonda(raw);
  const raining = isRainCondition(raw);
  const zonda = Boolean(isZondaActive) || zondaDetected;
  const outdoor = outdoorPlayStatus({ zonda, raining, raw });
  const condition = zonda ? 'Viento Zonda' : weatherCodeLabel(raw.weatherCode);
  const cardinal = windCardinal(raw.windDir);
  const pill = zonda
    ? { tone: 'danger', label: isZondaActive && !zondaDetected ? 'Zonda declarado' : 'Zonda activo' }
    : raining
      ? { tone: 'warn', label: 'Lluvia en sede' }
      : outdoor === 'caution'
        ? { tone: 'warn', label: 'Viento fuerte' }
        : { tone: 'ok', label: 'Condiciones normales' };

  const outdoorLabel = outdoor === 'closed'
    ? 'Cerrado'
    : outdoor === 'caution'
      ? 'Precaución'
      : 'Abierto';

  return {
    ...raw,
    condition,
    location: SEDE_RIVADAVIA.name,
    windLabel: `${Math.round(raw.windKmh || 0)} km/h${cardinal ? ` ${cardinal}` : ''}`,
    zonda,
    zondaDetected,
    raining,
    outdoor,
    outdoorLabel,
    pill,
    summary: zonda
      ? 'Instalaciones exteriores suspendidas por Zonda.'
      : raining
        ? 'Lluvia en Rivadavia: canchas outdoor en pausa.'
        : outdoor === 'caution'
          ? `Ráfagas ${Math.round(raw.gustsKmh || raw.windKmh || 0)} km/h. Juego outdoor con precaución.`
          : `${condition} en Rivadavia. Outdoor habilitado.`,
  };
}

export function formatObservedClock(iso) {
  if (!iso) return '';
  const time = String(iso).includes('T') ? String(iso).slice(11, 16) : '';
  return time || '';
}
