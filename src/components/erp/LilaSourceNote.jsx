/** Aviso de corte LILA: snapshot estático, no el saldo operativo del socio. */
export default function LilaSourceNote({ asOf, period, extra }) {
  return (
    <p className="lila-source-note">
      Corte LILA
      {asOf ? ` al ${asOf}` : ''}
      {period ? ` · ${period}` : ''}
      {' · '}esto no pisa el saldo operativo del socio.
      {extra ? ` ${extra}` : ''}
    </p>
  );
}
