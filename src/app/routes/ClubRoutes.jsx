import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import {
  canAccessAdmin,
  canAccessQrGate,
  canAccessPool,
  canAccessConcessions,
  canTakeAttendance,
  canWriteMemberLedger,
} from '../../domain/auth/roles';
import RouteFallback from './RouteFallback';

const DashboardView = lazy(() => import('../../views/DashboardView'));
const ReservationsView = lazy(() => import('../../views/ReservationsView'));
const TeacherAttendanceView = lazy(() => import('../../views/TeacherAttendanceView'));
const NewsBoardView = lazy(() => import('../../views/NewsBoardView'));
const AdminView = lazy(() => import('../../views/AdminView'));
const MessagesView = lazy(() => import('../../views/MessagesView'));
const PaymentHistoryView = lazy(() => import('../../views/PaymentHistoryView'));
const MemberProfilePanel = lazy(() => import('../../components/admin/MemberProfilePanel'));
const AccessControlView = lazy(() => import('../../views/AccessControlView'));
const PoolControlView = lazy(() => import('../../views/PoolControlView'));
const PoolEntranceView = lazy(() => import('../../views/PoolEntranceView'));
const ConcessionsView = lazy(() => import('../../views/ConcessionsView'));
const ConcessionPortalView = lazy(() => import('../../views/ConcessionPortalView'));
const MemberAccessView = lazy(() => import('../../views/MemberAccessView'));

export default function ClubRoutes({
  activeMember,
  addReservation,
  attendanceSessions,
  cancelReservation,
  claims,
  cloudMode,
  clubSettings,
  disciplineCatalog,
  duesNotice,
  duesSettings,
  entryLogs,
  erp,
  facilityCatalog,
  guestPasses,
  isOnline,
  isOperativeRole,
  isZondaActive,
  journalEntries,
  memberSeesCurrentAccount,
  members,
  membersCount,
  membersLoading,
  membersProgress,
  membershipApplications,
  messages,
  newsList,
  pathForView,
  paymentPlans,
  persistReservation,
  poolAccesses,
  poolSettings,
  portalAccessRequests,
  refreshMessages,
  registeredUsersCount,
  reservations,
  rsvpList,
  sendMessage,
  setAttendanceSessions,
  setClaimsDb,
  setClubSettings,
  setCurrentView,
  setDisciplineCatalog,
  setDuesSettings,
  setEntryLogsDb,
  setFacilityCatalog,
  setGuestPassesDb,
  setIsZondaActive,
  setJournalEntries,
  setMembersDb,
  setMembershipApplications,
  setMessagesDb,
  setNewsDb,
  setPaymentPlans,
  setPoolAccessesDb,
  setPoolSettings,
  setPortalAccessRequests,
  setRegisteredUsersCount,
  setReservations,
  setStaffHrDb,
  setStaffMembersDb,
  setSurveysDb,
  setSyncQueue,
  setSystemRules,
  setTierCatalog,
  setWaitlistDb,
  staffHrRecords,
  staffMembers,
  surveys,
  syncQueue,
  systemRules,
  tierCatalog,
  toggleEventRSVP,
  updateMember,
  user,
  userRole,
  waitlist,
}) {
  // Vistas por rol: los socios ven su portal personal y los roles operativos
  // (cajero, contador, personal, admin) su panel de trabajo, cada una con URL propia.
  const memberDashboard = (
      <DashboardView
        member={activeMember}
        reservations={reservations}
        cancelReservation={cancelReservation}
        addReservation={addReservation}
        setCurrentView={setCurrentView}
        latestNews={newsList}
        staffMembers={staffMembers}
        members={members}
        claims={claims}
        setClaims={setClaimsDb}
        messages={messages}
        setMessages={setMessagesDb}
        isZondaActive={isZondaActive}
        setIsZondaActive={setIsZondaActive}
        surveys={surveys}
        setSurveys={setSurveysDb}
        waitlist={waitlist}
        setWaitlist={setWaitlistDb}
        guestPasses={guestPasses}
        setGuestPasses={setGuestPassesDb}
        updateMember={updateMember}
        facilityCatalog={facilityCatalog}
        user={user}
        sendMessage={sendMessage}
        membersCanViewCurrentAccounts={memberSeesCurrentAccount}
      />
    );

  const operativePanel = (
      <AdminView
        members={members}
        membersCount={membersCount}
        membersLoading={membersLoading}
        membersProgress={membersProgress}
        reservations={reservations}
        setMembers={setMembersDb}
        setReservations={setReservations}
        persistReservation={persistReservation}
        latestNews={newsList}
        setNewsList={setNewsDb}
        disciplineCatalog={disciplineCatalog}
        setDisciplineCatalog={setDisciplineCatalog}
        tierCatalog={tierCatalog}
        setTierCatalog={setTierCatalog}
        journalEntries={journalEntries}
        setJournalEntries={setJournalEntries}
        addJournalEntry={erp.addPostedEntry}
        staffMembers={staffMembers}
        setStaffMembers={setStaffMembersDb}
        staffHrRecords={staffHrRecords}
        setStaffHrRecords={setStaffHrDb}
        claims={claims}
        setClaims={setClaimsDb}
        messages={messages}
        setMessages={setMessagesDb}
        refreshMessages={refreshMessages}
        sendMessage={sendMessage}
        entryLogs={entryLogs}
        setEntryLogs={setEntryLogsDb}
        surveys={surveys}
        setSurveys={setSurveysDb}
        registeredUsersCount={registeredUsersCount}
        membershipApplications={membershipApplications}
        setMembershipApplications={setMembershipApplications}
        portalAccessRequests={portalAccessRequests}
        setPortalAccessRequests={setPortalAccessRequests}
        setRegisteredUsersCount={setRegisteredUsersCount}
        isOnline={isOnline}
        syncQueue={syncQueue}
        setSyncQueue={setSyncQueue}
        userRole={userRole}
        setCurrentView={setCurrentView}
        erp={erp}
        isZondaActive={isZondaActive}
        setIsZondaActive={setIsZondaActive}
        updateMember={updateMember}
        poolAccesses={poolAccesses}
        setPoolAccesses={setPoolAccessesDb}
        recordPoolCanon={erp.recordPoolCanon}
        poolSettings={poolSettings}
        setPoolSettings={setPoolSettings}
        clubSettings={clubSettings}
        setClubSettings={setClubSettings}
        duesSettings={duesSettings}
        setDuesSettings={setDuesSettings}
        systemRules={systemRules}
        setSystemRules={setSystemRules}
        paymentPlans={paymentPlans}
        setPaymentPlans={setPaymentPlans}
        facilityCatalog={facilityCatalog}
        setFacilityCatalog={setFacilityCatalog}
      />
    );

  const reservationsView = (
    <ReservationsView
      member={activeMember}
      reservations={reservations}
      addReservation={addReservation}
      setCurrentView={setCurrentView}
      isZondaActive={isZondaActive}
      waitlist={waitlist}
      setWaitlist={setWaitlistDb}
      facilityCatalog={facilityCatalog}
      user={user}
      sendMessage={sendMessage}
    />
  );

  const newsView = (
    <NewsBoardView
      newsList={newsList}
      userRole={canAccessAdmin(userRole) ? 'admin' : 'member'}
      toggleEventRSVP={toggleEventRSVP}
      rsvpList={rsvpList}
    />
  );

  const paymentHistoryView = (
    <PaymentHistoryView
      member={activeMember}
      user={user}
      setCurrentView={setCurrentView}
      sendMessage={sendMessage}
      membersCanViewCurrentAccounts={memberSeesCurrentAccount}
    />
  );

  const memberProfileView = (
    <MemberProfilePanel
      member={activeMember}
      members={members}
      onBack={() => setCurrentView('dashboard')}
      backLabel="Inicio"
      selfService
      showCurrentAccounts={memberSeesCurrentAccount}
      updateMember={updateMember}
      guestPasses={guestPasses}
      setGuestPasses={setGuestPassesDb}
      tierCatalog={tierCatalog}
      disciplineCatalog={disciplineCatalog}
      formatCurrency={(amount) =>
        new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount || 0)
      }
      journalEntries={journalEntries}
      entryLogs={entryLogs}
      reservations={reservations}
      claims={claims}
      messages={messages}
      poolSettings={poolSettings}
    />
  );
  const formatCurrency = (amount) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(amount || 0);

  const accessGateView = canAccessQrGate(userRole) ? (
    <AccessControlView
      members={members}
      entryLogs={entryLogs}
      setEntryLogs={setEntryLogsDb}
      formatCurrency={formatCurrency}
      guestPasses={guestPasses}
      poolSettings={poolSettings}
      operatorName={user?.fullName || user?.name || user?.email || ''}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  const canOpenPool = canAccessPool(userRole)
    || (user?.roles || []).some((r) => canAccessPool(r.roleKey || r.key || r));
  const poolMemberWriter = canWriteMemberLedger(user?.roles?.length ? user.roles : userRole);
  const poolGateView = canOpenPool ? (
    <PoolControlView
      members={members}
      setMembers={poolMemberWriter ? setMembersDb : null}
      updateMember={poolMemberWriter ? updateMember : null}
      formatCurrency={formatCurrency}
      recordPoolCanon={erp.recordPoolCanon}
      onUpsertMemberAccountEntry={erp.upsertMemberAccountEntryRecord}
      cashSessions={erp.cashSessions || []}
      cashRegisters={erp.cashRegisters || []}
      onOpenDayCash={erp.openPoolDayCash}
      dayCashOpen={erp.poolDayCashOpen}
      onRefreshDayCash={erp.refreshPoolDayCash}
      poolAccesses={poolAccesses}
      setPoolAccesses={setPoolAccessesDb}
      setEntryLogs={setEntryLogsDb}
      poolSettings={poolSettings}
      setPoolSettings={setPoolSettings}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  const poolEntranceView = canOpenPool ? (
    <PoolEntranceView
      members={members}
      setMembers={poolMemberWriter ? setMembersDb : null}
      membersLoading={membersLoading}
      membersCount={membersCount}
      formatCurrency={formatCurrency}
      recordPoolCanon={erp.recordPoolCanon}
      onUpsertMemberAccountEntry={erp.upsertMemberAccountEntryRecord}
      dayCashOpen={erp.poolDayCashOpen}
      onOpenDayCash={erp.openPoolDayCash}
      onRefreshDayCash={erp.refreshPoolDayCash}
      poolAccesses={poolAccesses}
      setPoolAccesses={setPoolAccessesDb}
      setEntryLogs={setEntryLogsDb}
      poolSettings={poolSettings}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  const concessionsView = canAccessConcessions(userRole) ? (
    <ConcessionsView
      concessions={erp.concessions || []}
      canonPayments={erp.canonPayments || []}
      upsertConcession={erp.upsertConcession}
      renewConcessionContract={erp.renewConcessionContract}
      setConcessionStatus={erp.setConcessionStatus}
      toggleConcessionChecklist={erp.toggleConcessionChecklist}
      addDocToConcession={erp.addDocToConcession}
      removeDocFromConcession={erp.removeDocFromConcession}
      recordCanonPayment={erp.recordCanonPayment}
      renewedBy={user?.fullName || user?.email || 'admin'}
    />
  ) : (
    <Navigate to="/panel" replace />
  );

  const attendanceView = canTakeAttendance(userRole) ? (
    <div className="fade-in">
      <TeacherAttendanceView
        members={members}
        disciplineCatalog={disciplineCatalog}
        attendanceSessions={attendanceSessions}
        setAttendanceSessions={setAttendanceSessions}
        teacher={user}
        teacherDisciplineIds={userRole === 'teacher' ? (user?.disciplineIds || null) : null}
      />
    </div>
  ) : (
    <Navigate to={isOperativeRole ? '/panel' : '/'} replace />
  );

  const homeElement = isOperativeRole
    ? <Navigate to="/panel" replace />
    : userRole === 'teacher'
      ? attendanceView
      : memberDashboard;
  return (
    <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={homeElement} />
          <Route path="/asistencia" element={attendanceView} />
          <Route path="/reservas" element={userRole === 'member' ? reservationsView : <Navigate to={pathForView('dashboard')} replace />} />
          <Route path="/revista" element={newsView} />
          <Route path="/cuenta" element={userRole === 'member' ? paymentHistoryView : <Navigate to={pathForView('dashboard')} replace />} />
          <Route path="/perfil" element={userRole === 'member' ? memberProfileView : <Navigate to={pathForView('dashboard')} replace />} />
          <Route
            path="/mensajes"
            element={
              <MessagesView
                messages={messages}
                setMessages={setMessagesDb}
                members={members}
                onRefresh={refreshMessages}
                onSendMessage={sendMessage}
                live={cloudMode}
                duesNotice={duesNotice}
                membersCanViewCurrentAccounts={memberSeesCurrentAccount}
              />
            }
          />
          <Route path="/acceso" element={accessGateView} />
          <Route path="/pileta" element={poolGateView} />
          <Route path="/entrada-pileta" element={poolEntranceView} />
          <Route path="/panel/pool" element={<Navigate to="/pileta" replace />} />
          <Route path="/concesiones" element={concessionsView} />
          <Route path="/registro" element={<MemberAccessView />} />
          <Route
            path="/concesionario/:code"
            element={
              <ConcessionPortalView
                concessions={erp.concessions || []}
                canonPayments={erp.canonPayments || []}
              />
            }
          />
          <Route path="/panel/qr_control" element={<Navigate to="/acceso" replace />} />
          <Route path="/panel/concessions" element={<Navigate to="/concesiones" replace />} />
          <Route path="/panel" element={isOperativeRole ? operativePanel : <Navigate to={pathForView('dashboard')} replace />} />
          <Route path="/panel/:tab/:memberId?" element={isOperativeRole ? operativePanel : <Navigate to={pathForView('dashboard')} replace />} />
          <Route path="*" element={<Navigate to={pathForView('dashboard')} replace />} />
        </Routes>
    </Suspense>
  );
}
