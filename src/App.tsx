import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import ProtectedRoute from '@/components/layout/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import POSPage from '@/pages/POSPage'
import SalesHistoryPage from '@/pages/SalesHistoryPage'
import ProductsPage from '@/pages/ProductsPage'
import InventoryPage from '@/pages/InventoryPage'
import ReturnsPage from '@/pages/ReturnsPage'
import CustomersPage from '@/pages/CustomersPage'
import ReportsPage from '@/pages/ReportsPage'
import ConfigPage from '@/pages/ConfigPage'
import CashShiftsHistoryPage from '@/pages/CashShiftsHistoryPage'
import ExpenseHistoryPage from '@/pages/ExpenseHistoryPage'
import LayawaysPage from '@/pages/LayawaysPage'
import SuppliersPage from '@/pages/SuppliersPage'
import CarteraPage from '@/pages/CarteraPage'
import RepairsPage from '@/pages/RepairsPage'
import CommissionsPage from '@/pages/CommissionsPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/ventas" replace />} />
          <Route path="ventas" element={<POSPage />} />
          <Route
            path="ventas/historial"
            element={
              <ProtectedRoute permission="historial.ver">
                <SalesHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route path="separados" element={<LayawaysPage />} />
          <Route
            path="reparaciones"
            element={
              <ProtectedRoute permission="reparaciones.gestionar">
                <RepairsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="productos"
            element={
              <ProtectedRoute permission="productos.gestionar">
                <ProductsPage />
              </ProtectedRoute>
            }
          />
          <Route path="inventario" element={<InventoryPage />} />
          <Route path="devoluciones" element={<ReturnsPage />} />
          {/* Comisiones: sin permission → visible a cualquier usuario. La página
              se acota sola (gestor ve/registra todo; trabajador ve solo lo suyo
              por RLS). */}
          <Route path="comisiones" element={<CommissionsPage />} />
          <Route
            path="proveedores"
            element={
              <ProtectedRoute permission="compras.gestionar">
                <SuppliersPage />
              </ProtectedRoute>
            }
          />
          <Route path="clientes" element={<CustomersPage />} />
          <Route
            path="cartera"
            element={
              <ProtectedRoute permission="pos.usar">
                <CarteraPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="reportes"
            element={
              <ProtectedRoute permission="reportes.ver">
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="caja/historial"
            element={
              <ProtectedRoute permission="reportes.ver">
                <CashShiftsHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="gastos/historial"
            element={
              <ProtectedRoute permission="gastos.ver">
                <ExpenseHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="configuracion"
            element={
              <ProtectedRoute permission="config.gestionar">
                <ConfigPage />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
