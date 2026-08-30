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
