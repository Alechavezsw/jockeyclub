import MemberFacilitiesBooking from '../components/MemberFacilitiesBooking';

export default function ReservationsView({
  member,
  reservations,
  addReservation,
  setCurrentView,
  isZondaActive,
  waitlist = [],
  setWaitlist,
  facilityCatalog = null,
}) {
  if (!member?.memberId) {
    return (
      <div className="fade-in glass-card" style={{ padding: '1.5rem', textAlign: 'center' }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Todavía no pudimos cargar tu ficha de socio para reservar.
        </p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <MemberFacilitiesBooking
        member={member}
        reservations={reservations}
        addReservation={addReservation}
        isZondaActive={isZondaActive}
        waitlist={waitlist}
        setWaitlist={setWaitlist}
        facilityCatalog={facilityCatalog}
        onBooked={() => {
          setTimeout(() => setCurrentView?.('dashboard'), 1600);
        }}
      />
    </div>
  );
}
