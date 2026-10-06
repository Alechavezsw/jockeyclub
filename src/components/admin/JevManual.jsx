import { useMemo, useState } from 'react';
import {
  APP_MANUAL,
  MANUAL_GROUPS,
  matchManualLessons,
  shotForLesson,
} from '../../domain/assistant/appManual';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function JevManual({ goToTab }) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('abrir-dia');

  const hits = useMemo(() => {
    const needle = fold(query);
    if (needle.length < 3) return APP_MANUAL;
    return matchManualLessons(query);
  }, [query]);

  const visibleGroups = useMemo(
    () => MANUAL_GROUPS
      .map((group) => ({
        ...group,
        lessons: hits.filter((lesson) => lesson.group === group.id),
      }))
      .filter((group) => group.lessons.length > 0),
    [hits],
  );

  const active = hits.find((lesson) => lesson.id === activeId) || hits[0] || APP_MANUAL[0];
  const shot = shotForLesson(active);

  const openLesson = (id) => {
    setActiveId(id);
  };

  return (
    <section className="jev-manual" aria-label="Manual de uso del club">
      <header className="jev-desk-plate">
        <div>
          <p className="jev-desk-kicker">Manual</p>
          <h2 className="jev-desk-name">Cómo se usa</h2>
          <p className="jev-desk-sub">El oficio, el quién y el paso. Completo y concreto.</p>
        </div>
        <p className="jev-desk-live" aria-live="polite">
          <i />
          <span>{hits.length} oficios</span>
        </p>
      </header>

      <label className="jev-manual-search">
        <span>Buscar un oficio</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            const first = fold(next).length >= 3 ? matchManualLessons(next)[0] : APP_MANUAL[0];
            if (first) setActiveId(first.id);
          }}
          placeholder="Cobrar, liquidar, QR, pileta, caja, alta…"
          aria-label="Buscar en el manual"
        />
      </label>

      <div className="jev-manual-board">
        <nav className="jev-manual-index" aria-label="Capítulos del manual">
          {visibleGroups.map((group) => (
            <div key={group.id} className="jev-manual-chapter">
              <p>{group.label}</p>
              <ul>
                {group.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      className={lesson.id === active.id ? 'is-on' : undefined}
                      onClick={() => openLesson(lesson.id)}
                    >
                      {lesson.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {visibleGroups.length === 0 ? (
            <p className="jev-manual-empty">Nada coincide. Probá cobrar, puerta o caja.</p>
          ) : null}
        </nav>

        {active ? (
          <article className="jev-manual-leaf" aria-live="polite">
            <p className="jev-desk-kicker">{MANUAL_GROUPS.find((group) => group.id === active.group)?.label}</p>
            <h3>{active.title}</h3>
            <p className="jev-manual-who">{active.who}</p>
            {shot ? (
              <figure className="jev-manual-shot">
                <div className="jev-manual-shot-mat">
                  <img
                    src={shot.src}
                    alt={`Captura de ${shot.caption}`}
                    width={960}
                    height={600}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.closest('figure')?.setAttribute('hidden', '');
                    }}
                  />
                </div>
                <figcaption>Captura · {shot.caption}</figcaption>
              </figure>
            ) : null}
            <ol>
              {active.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {active.dont ? <p className="jev-manual-dont">{active.dont}</p> : null}
            {typeof goToTab === 'function' && active.tab ? (
              <button
                type="button"
                className="jev-slip-go"
                onClick={() => goToTab(active.tab, active.focus || null)}
              >
                Ir a esa sección
              </button>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}
