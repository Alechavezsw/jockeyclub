-- Copias restantes con el mismo DNI y nombre deformado / huérfanas sin grupo.
DELETE FROM public.members
WHERE member_number IN ('12867', '9429', '100775', '12264', '7125');
