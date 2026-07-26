import MemberFacilitiesBooking from '../components/MemberFacilitiesBooking';

export default function ReservationsView({
  member,
  reservations,
  addReservation,
  setCurrentView,
  isZondaActive,
  waitlist = [],
  setWaitlist,
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
        onBooked={() => {
          setTimeout(() => setCurrentView?.('dashboard'), 1600);
        }}
      />
    </div>
  );
}
