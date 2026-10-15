import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import AdminLayout from "./components/AdminLayout";
import Reports from "./pages/Reports";
import Dashboard from "./Dashboard";
import Login from "./Login";
import RegistrationLinks from "./pages/RegistrationLinks";
import Batches from "./pages/Batches";
import BatchDetails from "./pages/BatchDetails";
import Roles from "./pages/Roles";
import Schedules from "./pages/Schedules";
import Shuffle from "./pages/Shuffle";
import Students from "./pages/Students";
import Register from "./pages/Register";
import Trainers from "./pages/Trainers";
import ProtectedRoute from "./ProtectedRoute";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register/:token" element={<Register />} />
          <Route path="/r/:shortCode" element={<Register />} />
          <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/students" element={<Students />} />
            <Route path="/courses" element={<Roles />} />
            <Route path="/roles" element={<Navigate to="/courses" replace />} />
            <Route path="/trainers" element={<Trainers />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/batches/:batchId" element={<BatchDetails />} />
            <Route path="/shuffle" element={<Shuffle />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/schedule" element={<Navigate to="/schedules" replace />} />
            <Route
              path="/registration-links"
              element={<RegistrationLinks />}
            />
            <Route path="/reports" element={<Reports />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
