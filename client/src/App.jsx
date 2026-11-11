import React from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ProductDetailPage, ShopPage } from './pages/ShopPage';
import { CartCheckoutPage } from './pages/CartCheckoutPage';
import { PaymentResultPage } from './pages/PaymentResultPage';
import { OrderDetailPage, OrdersListPage } from './pages/OrdersPage';
import {
  CustomerServiceRequestDetailPage,
  MyServiceRequestsPage,
  ServiceDetailApplyPage,
  ServicesListPage
} from './pages/ServicesPage';
import { TicketDetailPage, TicketsListPage } from './pages/SupportPage';
import { AuthPage, NotificationsPage, ProfileAddressesPage } from './pages/AccountPage';
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/products/:slug" element={<ProductDetailPage />} />
            <Route path="/cart" element={<CartCheckoutPage />} />
            <Route path="/pay/result" element={<PaymentResultPage />} />
            <Route path="/orders" element={<OrdersListPage />} />
            <Route path="/orders/:code" element={<OrderDetailPage />} />
            <Route path="/services" element={<ServicesListPage />} />
            <Route path="/services/:slug" element={<ServiceDetailApplyPage />} />
            <Route path="/service-requests" element={<MyServiceRequestsPage />} />
            <Route path="/service-requests/:code" element={<CustomerServiceRequestDetailPage />} />
            <Route path="/tickets" element={<TicketsListPage />} />
            <Route path="/tickets/:code" element={<TicketDetailPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/account" element={<ProfileAddressesPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/staff/*" element={<StaffWorkspacePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  );
}
