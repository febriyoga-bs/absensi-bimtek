import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import Home from './pages/Home.jsx';
import Absen from './pages/Absen.jsx';
import Riwayat from './pages/Riwayat.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import Login from './pages/admin/Login.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Records from './pages/admin/Records.jsx';
import Sessions from './pages/admin/Sessions.jsx';
import People from './pages/admin/People.jsx';
import Settings from './pages/admin/Settings.jsx';
import VenueCode from './pages/admin/VenueCode.jsx';
import Venues from './pages/admin/Venues.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/absen/peserta" element={<Absen key="peserta" role="peserta" />} />
        <Route path="/absen/panitia" element={<Absen key="panitia" role="panitia" />} />
        <Route path="/riwayat" element={<Riwayat />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/admin/kode-venue" element={<VenueCode />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="absensi" element={<Records />} />
          <Route path="sesi" element={<Sessions />} />
          <Route path="orang" element={<People />} />
          <Route path="venue" element={<Venues />} />
          <Route path="pengaturan" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
