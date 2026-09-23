-- Quita copias del grupo familiar: los integrantes ya viven en members.
-- También elimina fichas repetidas del mismo DNI cuando es la misma persona.

DELETE FROM public.member_adherents a
WHERE EXISTS (
  SELECT 1
  FROM public.members titular
  JOIN public.members integ
    ON lower(trim(integ.full_name)) = lower(trim(a.full_name))
  WHERE titular.id = a.member_id
    AND regexp_replace(coalesce(integ.meta->>'familyPrincipalNumber', ''), '\D', '', 'g')
        = regexp_replace(titular.member_number, '\D', '', 'g')
    AND regexp_replace(coalesce(integ.meta->>'familyPrincipalNumber', ''), '\D', '', 'g')
        <> regexp_replace(integ.member_number, '\D', '', 'g')
);

DELETE FROM public.member_adherents a
USING public.member_adherents b
WHERE a.member_id = b.member_id
  AND lower(trim(a.full_name)) = lower(trim(b.full_name))
  AND a.id > b.id;

DELETE FROM public.member_adherents a
USING public.members t
WHERE t.id = a.member_id
  AND lower(trim(a.full_name)) = lower(trim(t.full_name));

WITH src AS (
  SELECT
    id,
    member_number,
    full_name,
    regexp_replace(coalesce(document_number, ''), '\D', '', 'g') AS dni,
    lower(translate(trim(full_name), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS norm_name,
    regexp_replace(coalesce(meta->>'familyPrincipalNumber', ''), '\D', '', 'g') AS principal
  FROM public.members
  WHERE regexp_replace(coalesce(document_number, ''), '\D', '', 'g') <> ''
),
ranked AS (
  SELECT
    src.*,
    split_part(src.norm_name, ' ', 1) AS first_name,
    row_number() OVER (
      PARTITION BY src.dni
      ORDER BY
        CASE
          WHEN src.principal <> '' AND EXISTS (
            SELECT 1 FROM public.members t
            WHERE regexp_replace(t.member_number, '\D', '', 'g') = src.principal
          ) THEN 0 ELSE 1
        END,
        CASE
          WHEN src.member_number ~ '^[0-9]{1,6}$' THEN src.member_number::int
          ELSE 2000000
        END,
        length(src.full_name) DESC
    ) AS keep_rank
  FROM src
),
losers AS (
  SELECT r.id
  FROM ranked r
  JOIN ranked k ON k.dni = r.dni AND k.keep_rank = 1
  WHERE r.keep_rank > 1
    AND (
      r.norm_name = k.norm_name
      OR r.norm_name LIKE '%' || k.first_name || '%'
      OR k.norm_name LIKE '%' || r.first_name || '%'
    )
    AND r.first_name = k.first_name
)
DELETE FROM public.members m
WHERE m.id IN (SELECT id FROM losers);
