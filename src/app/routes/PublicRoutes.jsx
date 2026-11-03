import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import LoginView from '../../views/LoginView';
import RouteFallback from './RouteFallback';

const ConcessionPortalView = lazy(() => import('../../views/ConcessionPortalView'));
const MemberAccessView = lazy(() => import('../../views/MemberAccessView'));

export default function PublicRoutes({ pathname, concessions, canonPayments }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route
          path="/concesionario/:code"
          element={
            <ConcessionPortalView
              code={decodeURIComponent(String(pathname || '').split('/').pop() || '')}
              concessions={concessions || []}
              canonPayments={canonPayments || []}
            />
          }
        />
        <Route path="/registro" element={<MemberAccessView />} />
        <Route path="*" element={<LoginView />} />
      </Routes>
    </Suspense>
  );
}
