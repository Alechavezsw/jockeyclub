/** Temporada de pileta del club: diciembre a marzo. */

function dayOf(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value || '').slice(0, 10);
}

export function poolSeasonWindow(today) {
  const [year, month] = dayOf(today).split('-').map(Number);
  if (month >= 4 && month <= 11) {
    return {
      open: `${year}-12-01`,
      close: `${year + 1}-03-31`,
      previousOpen: `${year - 1}-12-01`,
      previousClose: `${year}-03-31`,
      live: false,
    };
  }
  if (month === 12) {
    return {
      open: `${year}-12-01`,
      close: `${year + 1}-03-31`,
      previousOpen: `${year - 1}-12-01`,
      previousClose: `${year}-03-31`,
      live: true,
    };
  }
  return {
    open: `${year - 1}-12-01`,
    close: `${year}-03-31`,
    previousOpen: `${year - 2}-12-01`,
    previousClose: `${year - 1}-03-31`,
    live: true,
  };
}

export function isPoolSeasonLive(today) {
  return poolSeasonWindow(today).live === true;
}
