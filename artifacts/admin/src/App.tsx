import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { RequireAuth } from "@/components/RequireAuth";
import { AdminLayout } from "@/components/AdminLayout";
import { Toaster } from "@/components/ui/toaster";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import Dashboard from "@/pages/Dashboard";
import Traders from "@/pages/Traders";
import TraderDetail from "@/pages/TraderDetail";
import AuditReportPage from "@/pages/AuditReport";
import ExpiringDocs from "@/pages/ExpiringDocs";
import EnquiriesPage from "@/pages/Enquiries";
import EarlyAccess from "@/pages/EarlyAccess";
import Campaigns, { CampaignDetail } from "@/pages/Campaigns";
import OutreachContacts from "@/pages/OutreachContacts";
import ReviewsPage from "@/pages/Reviews";
import ConversationReportsPage from "@/pages/ConversationReports";
import UserReportsPage from "@/pages/UserReports";
import Subscriptions from "@/pages/Subscriptions";
import PromoCodes from "@/pages/PromoCodes";
import AccountDeletions from "@/pages/AccountDeletions";
import ProfileChangeRequestsPage from "@/pages/ProfileChangeRequests";
import NotificationHealthPage from "@/pages/NotificationHealth";
import TeamPage from "@/pages/Team";
import NotFound from "@/pages/not-found";

const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "/";

function ProtectedRoutes() {
  return (
    <RequireAuth>
      <AdminLayout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/traders" component={Traders} />
          <Route path="/traders/:userId">
            {(params) => <TraderDetail userId={Number(params.userId)} />}
          </Route>
          <Route path="/audit-report" component={AuditReportPage} />
          <Route path="/expiring-documents" component={ExpiringDocs} />
          <Route path="/enquiries" component={EnquiriesPage} />
          <Route path="/early-access" component={EarlyAccess} />
          <Route path="/outreach-contacts" component={OutreachContacts} />
          <Route path="/early-access/campaigns" component={Campaigns} />
          <Route path="/early-access/campaigns/:id">
            {(params) => <CampaignDetail id={Number(params.id)} />}
          </Route>
          <Route path="/reviews" component={ReviewsPage} />
          <Route path="/conversation-reports" component={ConversationReportsPage} />
          <Route path="/user-reports" component={UserReportsPage} />
          <Route path="/subscriptions" component={Subscriptions} />
          <Route path="/promo-codes" component={PromoCodes} />
          <Route path="/account-deletions" component={AccountDeletions} />
          <Route path="/profile-change-requests" component={ProfileChangeRequestsPage} />
          <Route path="/notification-health" component={NotificationHealthPage} />
          <Route path="/team" component={TeamPage} />
          <Route component={NotFound} />
        </Switch>
      </AdminLayout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <AuthProvider>
        <Router base={BASE_PATH === "/" ? "" : BASE_PATH}>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route>
              <ProtectedRoutes />
            </Route>
          </Switch>
        </Router>
        <Toaster />
      </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
