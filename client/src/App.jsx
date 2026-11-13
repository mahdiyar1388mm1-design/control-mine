import React from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Seo } from './components/Seo';
import { HomePage } from './pages/HomePage';
import { ProductDetailPage, ShopPage } from './pages/ShopPage';
import { CartCheckoutPage } from './pages/CartCheckoutPage';
import { PaymentResultPage } from './pages/PaymentResultPage';
import { OrderDetailPage, OrdersListPage } from './pages/OrdersPage';
import { TicketDetailPage, TicketsListPage } from './pages/SupportPage';
import { AccountDashboardPage, AuthPage, NotificationsPage, ProfileAddressesPage } from './pages/AccountPage';
import { LthWalletPage } from './pages/LthWalletPage';
import { LthSmartContractPage } from './pages/LthSmartContractPage';
import { LthCalculatorPage } from './pages/LthCalculatorPage';
import { StaffWorkspacePage } from './pages/staff/StaffWorkspacePage';

function NotFoundPage() {
  return (
    <div className="state-box">
      <h1 style={{ marginTop: 0, fontSize: '1.25rem' }}>۴۰۴ — صفحهٔ مورد نظر یافت نشد</h1>
      <p className="muted">نشانی واردشده معتبر نیست یا جابه‌جا شده است.</p>
      <Link to="/" className="btn btn-primary btn-sm">بازگشت به صفحهٔ اصلی</Link>
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="container page">
          <div className="state-box">
            <h1 style={{ marginTop: 0, fontSize: '1.2rem' }}>خطای غیرمنتظره در نمایش صفحه</h1>
            <p className="muted">لطفاً صفحه را یک بار نوسازی (Reload) کنید.</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => window.location.reload()}
            >
              نوسازی صفحه
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Layout>
            <Seo />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/wallet" element={<LthWalletPage />} />
              <Route path="/wallet/sell" element={<LthWalletPage />} />
              <Route path="/wallet/sheba" element={<LthWalletPage />} />
              <Route path="/wallet/contracts" element={<LthSmartContractPage />} />
              <Route path="/wallet/p2p" element={<LthWalletPage />} />
              <Route path="/treasury" element={<Navigate to="/staff" replace />} />
              <Route path="/lth-calculator" element={<LthCalculatorPage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/products/:slug" element={<ProductDetailPage />} />
              <Route path="/cart" element={<CartCheckoutPage />} />
              <Route path="/pay/result" element={<PaymentResultPage />} />
              <Route path="/orders" element={<OrdersListPage />} />
              <Route path="/orders/:code" element={<OrderDetailPage />} />
              <Route path="/tickets" element={<TicketsListPage />} />
              <Route path="/tickets/:code" element={<TicketDetailPage />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/account" element={<AccountDashboardPage />} />
              <Route path="/account/shipping" element={<ProfileAddressesPage />} />
              <Route path="/account/notifications" element={<NotificationsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/staff/*" element={<StaffWorkspacePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Layout>
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
